-- Keep shared room cleanup reliable and make mafia connectivity non-blocking.
-- A closed/expired room already has a retention policy: delete its mafia
-- round before its players, because night/vote/mission targets reference players.
create or replace function app_private.maintain_rooms() returns integer
language plpgsql volatile security definer set search_path='' as $$
declare r app_private.rooms; v_deleted integer:=0;
begin
 if not pg_try_advisory_xact_lock(hashtext('party-game-maintenance')) then return 0;end if;
 for r in select * from app_private.rooms order by id for update skip locked loop
  if r.status='closed' or r.expires_at<=now() then
   if r.game_type='mafia' then
    delete from app_private.mafia_rounds where room_id=r.id;
   end if;
   delete from app_private.rooms where id=r.id;
   v_deleted:=v_deleted+1;
  else
   -- This already routes an active mafia round to advance_mafia_connectivity.
   perform app_private.advance_discussion(r.id);
  end if;
 end loop;
 delete from app_private.rate_limits where window_start<now()-interval '1 day';
 return v_deleted;
end; $$;

-- A mobile browser may suspend heartbeats during real-world discussion.
-- Keep the real phase; the existing game rules already wait for required actions.
-- Warn about all missing living players, not only power roles, to avoid role leaks.
create or replace function app_private.advance_mafia_connectivity(p_room uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare r app_private.rooms; g app_private.mafia_rounds; v_now timestamptz:=clock_timestamp();
 v_offline boolean; v_new_host uuid; v_changed boolean:=false;
begin
 select * into r from app_private.rooms where id=p_room for update;
 if r.id is null or r.status<>'open' or r.expires_at<=now() then return false;end if;
 select * into g from app_private.mafia_rounds where room_id=p_room and ended_at is null;
 if g.id is null or g.phase='CANCELLED' then return false;end if;

 -- Recover existing legacy pauses without discarding submitted actions.
 if g.phase='PAUSED_DISCONNECT' then
  update app_private.mafia_rounds set phase=disconnect_phase,disconnect_phase=null,
   disconnect_grace_until=null where id=g.id returning * into g;
  v_changed:=true;
 end if;

 -- Give the host the same 90-second threshold plus 30 seconds before handoff.
 if exists(select 1 from app_private.players p where p.id=r.host_player_id
  and (p.status='left' or p.last_seen_at<=v_now-interval '120 seconds')) then
  select p.id into v_new_host from app_private.mafia_round_players mp
   join app_private.players p on p.id=mp.player_id
   where mp.round_id=g.id and mp.eliminated_at is null and p.status<>'left'
    and p.last_seen_at>v_now-interval '90 seconds'
   order by p.join_order limit 1;
  if v_new_host is not null and v_new_host<>r.host_player_id then
   update app_private.rooms set host_player_id=v_new_host where id=p_room;
   v_changed:=true;
  end if;
 end if;

 select exists(select 1 from app_private.mafia_round_players mp
  join app_private.players p on p.id=mp.player_id
  where mp.round_id=g.id and mp.eliminated_at is null
   and (p.status='left' or p.last_seen_at<=v_now-interval '90 seconds')) into v_offline;
 if v_offline and g.phase<>'FINAL_RESULT' then
  if g.disconnect_phase is distinct from g.phase or g.disconnect_grace_until is null then
   update app_private.mafia_rounds set disconnect_phase=g.phase,
    disconnect_grace_until=coalesce(g.disconnect_grace_until,v_now+interval '30 seconds') where id=g.id;
   v_changed:=true;
  end if;
 elsif g.disconnect_phase is not null or g.disconnect_grace_until is not null then
  update app_private.mafia_rounds set disconnect_phase=null,disconnect_grace_until=null where id=g.id;
  v_changed:=true;
 end if;
 if v_changed then perform app_private.bump(p_room);end if;
 return v_changed;
end; $$;

-- Never report a successful command merely because connectivity changed.
-- Regular game commands retain their original phase/version/permission checks.
create or replace function public.room_command(p_credential_hash text,p_room uuid,p_action text,p_payload jsonb,p_expected_version integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r app_private.rooms; g app_private.mafia_rounds; v_me uuid;
begin
 if p_action not like 'mafia_%' then
  return app_private.room_command_before_mafia_reconnect(p_credential_hash,p_room,p_action,p_payload,p_expected_version);
 end if;
 select * into r from app_private.rooms where id=p_room for update;
 select id into v_me from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left';
 if v_me is null then raise exception 'FORBIDDEN' using errcode='P0001';end if;
 if r.status<>'open' or r.expires_at<=now() then raise exception 'ROOM_CLOSED' using errcode='P0001';end if;
 if r.game_type is distinct from 'mafia' then raise exception 'UNKNOWN_ACTION' using errcode='P0001';end if;

 -- An authenticated action is itself proof of recent activity.
 update app_private.players set last_seen_at=clock_timestamp() where id=v_me;
 if p_action not in ('mafia_wait_reconnect','mafia_cancel_round') then
  return app_private.room_command_before_mafia_reconnect(p_credential_hash,p_room,p_action,p_payload,p_expected_version);
 end if;

 select * into g from app_private.mafia_rounds where room_id=p_room and ended_at is null;
 if g.id is null or g.phase in ('FINAL_RESULT','CANCELLED') or g.disconnect_grace_until is null then
  raise exception 'PHASE_CONFLICT' using errcode='P0001';end if;
 if r.host_player_id<>v_me then raise exception 'HOST_ONLY' using errcode='P0001';end if;
 if p_expected_version is distinct from r.version then raise exception 'VERSION_CONFLICT' using errcode='P0001';end if;
 if p_payload is distinct from '{}'::jsonb then raise exception 'INVALID_REQUEST' using errcode='P0001';end if;
 -- Do not cancel a recovered game using a stale disconnect banner.
 if not exists(select 1 from app_private.mafia_round_players mp
  join app_private.players p on p.id=mp.player_id
  where mp.round_id=g.id and mp.eliminated_at is null
   and (p.status='left' or p.last_seen_at<=clock_timestamp()-interval '90 seconds')) then
  raise exception 'PHASE_CONFLICT' using errcode='P0001';end if;
 if g.disconnect_grace_until>clock_timestamp() then raise exception 'RECONNECT_GRACE' using errcode='P0001';end if;
 if p_action='mafia_wait_reconnect' then
  update app_private.mafia_rounds set disconnect_grace_until=clock_timestamp()+interval '30 seconds' where id=g.id;
 else
  update app_private.mafia_rounds set phase='CANCELLED',ended_at=now(),disconnect_phase=null,disconnect_grace_until=null where id=g.id;
  update app_private.rooms set locked=false where id=p_room;
 end if;
 perform app_private.touch_room(p_room);
 return jsonb_build_object('version',app_private.bump(p_room),'changed',true);
end; $$;

-- Connection warnings and roster use the same threshold during an active mafia game.
-- All missing IDs are public presence information, never a list of required roles.
create or replace function app_private.room_dto(p_room uuid,p_me uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when g.id is null then base.value else
  jsonb_set(
   jsonb_set(base.value,'{mafia}',(base.value->'mafia')||jsonb_build_object(
    'phase',g.phase,'night_expected_count',null,'night_submitted_count',null,
    'disconnect',case when g.disconnect_grace_until is not null and g.phase not in ('FINAL_RESULT','CANCELLED')
     then jsonb_build_object('original_phase',coalesce(g.disconnect_phase,g.phase),'grace_until',g.disconnect_grace_until,
      'missing_ids',coalesce((select jsonb_agg(mp.player_id order by p.join_order)
       from app_private.mafia_round_players mp join app_private.players p on p.id=mp.player_id
       where mp.round_id=g.id and mp.eliminated_at is null
        and (p.status='left' or p.last_seen_at<=statement_timestamp()-interval '90 seconds')),'[]'::jsonb))
     else null end)),
   '{players}',coalesce((select jsonb_agg(item||jsonb_build_object('connected',
    exists(select 1 from app_private.players p where p.id=(item->>'id')::uuid
     and p.room_id=p_room and p.status<>'left' and p.last_seen_at>statement_timestamp()-interval '90 seconds')) order by ord)
    from jsonb_array_elements(base.value->'players') with ordinality as roster(item,ord)),'[]'::jsonb))
 end
 from (select app_private.room_dto_before_mafia_reconnect(p_room,p_me) value) base
 left join app_private.mafia_rounds g on g.room_id=p_room and g.ended_at is null;
$$;

revoke all on function public.room_command(text,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.room_command(text,uuid,text,jsonb,integer) to service_role;
revoke all on function app_private.advance_mafia_connectivity(uuid),app_private.room_dto(uuid,uuid) from public,anon,authenticated,service_role;
