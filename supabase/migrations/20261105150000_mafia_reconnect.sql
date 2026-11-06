-- MAF-6: keep disconnected mafia participants from silently advancing a round.
alter table app_private.mafia_rounds drop constraint mafia_rounds_phase_check;
alter table app_private.mafia_rounds add constraint mafia_rounds_phase_check
 check(phase in ('REVEAL_ROLE','INTRO','NIGHT','DAY_DISCUSS','DAY_VOTE','DAY_RUNOFF','DAY_RESULT','FINAL_RESULT','PAUSED_DISCONNECT','CANCELLED'));
alter table app_private.mafia_rounds add column disconnect_phase text;
alter table app_private.mafia_rounds add column disconnect_grace_until timestamptz;

-- The maintenance Cron already exists; extend its function instead of scheduling another job.
create function app_private.advance_mafia_connectivity(p_room uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare g app_private.mafia_rounds;r app_private.rooms;v_now timestamptz:=clock_timestamp();v_offline boolean;v_new_host uuid;v_changed boolean:=false;
begin
 select * into r from app_private.rooms where id=p_room;
 select * into g from app_private.mafia_rounds where room_id=p_room and ended_at is null;
 if g.id is null or g.phase in ('FINAL_RESULT','CANCELLED') then return false;end if;
 -- Prefer an online survivor when the old host is gone; the Liar maintenance
 -- otherwise delegates mafia rooms to any joined player, including eliminated seats.
 if exists(select 1 from app_private.players p where p.id=r.host_player_id
  and (p.status='left' or p.last_seen_at<=v_now-interval '60 seconds')) then
  select p.id into v_new_host from app_private.mafia_round_players mp
   join app_private.players p on p.id=mp.player_id
   where mp.round_id=g.id and mp.eliminated_at is null and p.status<>'left'
    and p.last_seen_at>v_now-interval '30 seconds'
   order by p.join_order limit 1;
  if v_new_host is not null and v_new_host<>r.host_player_id then
   update app_private.rooms set host_player_id=v_new_host where id=p_room;
   v_changed:=true;
  end if;
 end if;
 select exists(select 1 from app_private.mafia_round_players mp
  join app_private.players p on p.id=mp.player_id where mp.round_id=g.id
  and mp.eliminated_at is null and (p.status='left' or p.last_seen_at<=v_now-interval '30 seconds')) into v_offline;
 if v_offline and g.phase<>'PAUSED_DISCONNECT' then
  update app_private.mafia_rounds set disconnect_phase=phase,phase='PAUSED_DISCONNECT',
   disconnect_grace_until=v_now+interval '30 seconds' where id=g.id;
  v_changed:=true;
 elsif not v_offline and g.phase='PAUSED_DISCONNECT' then
  update app_private.mafia_rounds set phase=disconnect_phase,disconnect_phase=null,
   disconnect_grace_until=null where id=g.id;
  v_changed:=true;
 end if;
 if not v_changed then return false;end if;
 perform app_private.bump(p_room);
 return true;
end; $$;

-- The original connection helper has no mafia round and can hand the host to
-- an eliminated (or late-joined) player. Route active mafia games to the
-- survivor-aware helper even when called from existing heartbeats.
alter function app_private.advance_connectivity(uuid) rename to advance_connectivity_before_mafia_reconnect;
create function app_private.advance_connectivity(p_room uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
 if exists(select 1 from app_private.mafia_rounds where room_id=p_room and ended_at is null) then
  return app_private.advance_mafia_connectivity(p_room);
 end if;
 return app_private.advance_connectivity_before_mafia_reconnect(p_room);
end; $$;

alter function app_private.maintain_rooms() rename to maintain_rooms_before_mafia_reconnect;
create function app_private.maintain_rooms() returns integer
language plpgsql volatile security definer set search_path='' as $$
declare r record;v_deleted integer;
begin
 -- Resolve mafia host ownership first. The previous Liar maintenance also delegates
 -- on this room and otherwise might choose an eliminated mafia participant.
 for r in select id from app_private.rooms where game_type='mafia' and status='open'
  and expires_at>now() order by id for update skip locked loop
  perform app_private.advance_mafia_connectivity(r.id);
 end loop;
 v_deleted:=app_private.maintain_rooms_before_mafia_reconnect();
 return v_deleted;
end; $$;

alter function public.room_command(text,uuid,text,jsonb,integer) rename to room_command_before_mafia_reconnect;
alter function public.room_command_before_mafia_reconnect(text,uuid,text,jsonb,integer) set schema app_private;
create function public.room_command(p_credential_hash text,p_room uuid,p_action text,p_payload jsonb,p_expected_version integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r app_private.rooms;g app_private.mafia_rounds;v_me uuid;
begin
 if p_action not like 'mafia_%' then
  return app_private.room_command_before_mafia_reconnect(p_credential_hash,p_room,p_action,p_payload,p_expected_version);
 end if;
 select * into r from app_private.rooms where id=p_room for update;
 select id into v_me from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left';
 if v_me is null then raise exception 'FORBIDDEN' using errcode='P0001';end if;
 if r.status<>'open' or r.expires_at<=now() then raise exception 'ROOM_CLOSED' using errcode='P0001';end if;
 select * into g from app_private.mafia_rounds where room_id=p_room and ended_at is null;
 if g.id is not null and app_private.advance_mafia_connectivity(p_room) then
  return jsonb_build_object('version',(select version from app_private.rooms where id=p_room),'changed',true);
 end if;
 if p_action in ('mafia_wait_reconnect','mafia_cancel_round') then
  if g.id is null or g.phase<>'PAUSED_DISCONNECT' then raise exception 'PHASE_CONFLICT' using errcode='P0001';end if;
  if r.host_player_id<>v_me then raise exception 'HOST_ONLY' using errcode='P0001';end if;
  if p_expected_version is distinct from (select version from app_private.rooms where id=p_room) then raise exception 'VERSION_CONFLICT' using errcode='P0001';end if;
  if p_payload is distinct from '{}'::jsonb then raise exception 'INVALID_REQUEST' using errcode='P0001';end if;
  if g.disconnect_grace_until>clock_timestamp() then raise exception 'RECONNECT_GRACE' using errcode='P0001';end if;
  if p_action='mafia_wait_reconnect' then
   update app_private.mafia_rounds set disconnect_grace_until=clock_timestamp()+interval '30 seconds' where id=g.id;
  else
   update app_private.mafia_rounds set phase='CANCELLED',ended_at=now(),disconnect_phase=null,disconnect_grace_until=null where id=g.id;
   update app_private.rooms set locked=false where id=p_room;
  end if;
  perform app_private.touch_room(p_room);
  return jsonb_build_object('version',app_private.bump(p_room),'changed',true);
 end if;
 if g.phase='PAUSED_DISCONNECT' then raise exception 'ROUND_PAUSED' using errcode='P0001';end if;
 return app_private.room_command_before_mafia_reconnect(p_credential_hash,p_room,p_action,p_payload,p_expected_version);
end; $$;

alter function app_private.room_dto(uuid,uuid) rename to room_dto_before_mafia_reconnect;
create function app_private.room_dto(p_room uuid,p_me uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when g.id is null then base.value else
  jsonb_set(base.value,'{mafia}',(base.value->'mafia')||jsonb_build_object(
   'phase',g.phase,
   -- Counts of required night actors reveal the number of power roles.
   'night_expected_count',null,'night_submitted_count',null,
   'disconnect',case when g.phase='PAUSED_DISCONNECT' then jsonb_build_object(
    'original_phase',g.disconnect_phase,'grace_until',g.disconnect_grace_until,
    'missing_ids',coalesce((select jsonb_agg(mp.player_id) from app_private.mafia_round_players mp
     join app_private.players p on p.id=mp.player_id where mp.round_id=g.id
     and mp.eliminated_at is null and (p.status='left' or p.last_seen_at<=statement_timestamp()-interval '30 seconds')),'[]'::jsonb)) else null end
  )) end
 from (select app_private.room_dto_before_mafia_reconnect(p_room,p_me) value) base
 left join app_private.mafia_rounds g on g.room_id=p_room and g.ended_at is null;
$$;
revoke all on function public.room_command(text,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.room_command(text,uuid,text,jsonb,integer) to service_role;
revoke all on function app_private.advance_mafia_connectivity(uuid),app_private.advance_connectivity(uuid),
 app_private.advance_connectivity_before_mafia_reconnect(uuid),app_private.maintain_rooms_before_mafia_reconnect(),
 app_private.room_command_before_mafia_reconnect(text,uuid,text,jsonb,integer),
 app_private.room_dto_before_mafia_reconnect(uuid,uuid),app_private.room_dto(uuid,uuid)
 from public,anon,authenticated,service_role;
