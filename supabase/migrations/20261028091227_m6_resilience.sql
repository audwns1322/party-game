-- Heartbeat is authoritative; public Presence can only request a fresh authenticated snapshot.
alter table app_private.rounds drop constraint rounds_phase_check;
alter table app_private.rounds add constraint rounds_phase_check check(phase in ('COLLECT_WORDS','REVEAL_ROLE','HINT','DISCUSS','VOTE_1','VOTE_RUNOFF','REVEAL_VOTE','REVEAL_LIAR','GUESS','APPEAL_WINDOW','APPEAL_VOTE','FINAL_RESULT','PAUSED_HOST','PAUSED_DISCONNECT','CANCELLED'));
alter table app_private.rounds add column disconnect_phase text;
alter table app_private.rounds add column disconnect_remaining_ms bigint check(disconnect_remaining_ms is null or disconnect_remaining_ms>=0);
alter table app_private.rounds add column disconnect_grace_until timestamptz;

alter function app_private.bump(uuid) rename to bump_before_m6;
create function app_private.bump(p_room uuid) returns integer language sql volatile security definer set search_path='' as $$
 update app_private.rooms set version=version+1 where id=p_room returning version;
$$;
create function app_private.touch_room(p_room uuid) returns void language sql volatile security definer set search_path='' as $$
 update app_private.rooms set last_activity_at=now(),expires_at=now()+interval '2 hours' where id=p_room and status='open';
$$;

-- Caller holds the room lock. Keep manual-pause fields separate from a network pause.
create function app_private.advance_connectivity(p_room uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare r app_private.rooms;g app_private.rounds;v_now timestamptz:=clock_timestamp();v_next uuid;v_missing integer;v_cutoff timestamptz;v_deadline timestamptz;v_changed boolean:=false;
begin
 select * into r from app_private.rooms where id=p_room;
 if r.status<>'open' or r.expires_at<=now() then return false;end if;
 select * into g from app_private.rounds where room_id=p_room and ended_at is null;
 -- A departed host never takes the role back automatically. Waiters cannot inherit an active game.
 if exists(select 1 from app_private.players where id=r.host_player_id and (status='left' or last_seen_at<=v_now-interval '60 seconds')) then
  select p.id into v_next from app_private.players p where p.room_id=p_room and p.status<>'left' and p.id<>r.host_player_id
   and p.last_seen_at>v_now-interval '30 seconds'
   and (g.id is null or exists(select 1 from app_private.round_players rp where rp.round_id=g.id and rp.player_id=p.id and rp.eliminated_at is null))
   order by p.join_order limit 1;
  if v_next is not null then update app_private.rooms set host_player_id=v_next where id=p_room;v_changed:=true;end if;
 end if;
 if g.id is not null then
  select count(*)::int,min(p.last_seen_at+interval '30 seconds') into v_missing,v_cutoff
   from app_private.round_players rp join app_private.players p on p.id=rp.player_id
   where rp.round_id=g.id and rp.eliminated_at is null and (p.status='left' or p.last_seen_at<=v_now-interval '30 seconds');
  if v_missing>0 and g.phase<>'PAUSED_DISCONNECT' then
   v_cutoff:=greatest(v_cutoff,coalesce(g.phase_started_at,g.created_at));
   v_deadline:=case when g.phase='REVEAL_VOTE' then coalesce(g.deadline_at,g.phase_started_at+interval '3 seconds') else g.deadline_at end;
   update app_private.rounds set disconnect_phase=phase,phase='PAUSED_DISCONNECT',
    disconnect_remaining_ms=case when v_deadline is null then null else greatest(0,ceil(extract(epoch from v_deadline-v_cutoff)*1000))::bigint end,
    disconnect_grace_until=v_cutoff+interval '30 seconds',deadline_at=null,version=version+1 where id=g.id;
   v_changed:=true;
  elsif v_missing=0 and g.phase='PAUSED_DISCONNECT' then
   update app_private.rounds set phase=disconnect_phase,phase_started_at=v_now,
    deadline_at=case when disconnect_remaining_ms is null then null else v_now+disconnect_remaining_ms*interval '1 millisecond' end,
    disconnect_phase=null,disconnect_remaining_ms=null,disconnect_grace_until=null,version=version+1 where id=g.id;
   update app_private.appeals set deadline_at=(select deadline_at from app_private.rounds where id=g.id)
    where guess_id=g.current_guess_id and g.disconnect_phase='APPEAL_VOTE';
   v_changed:=true;
  end if;
 end if;
 if v_changed then perform app_private.bump(p_room);end if;
 return v_changed;
end; $$;

alter function app_private.advance_discussion(uuid) rename to advance_before_m6;
create function app_private.advance_discussion(p_room uuid) returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 if app_private.advance_connectivity(p_room) then return true;end if;
 if exists(select 1 from app_private.rounds where room_id=p_room and ended_at is null and phase='PAUSED_DISCONNECT') then return false;end if;
 return app_private.advance_before_m6(p_room);
end; $$;

alter function public.room_command(text,uuid,text,jsonb,integer) rename to room_command_before_m6;
alter function public.room_command_before_m6(text,uuid,text,jsonb,integer) set schema app_private;
create function public.room_command(p_credential_hash text,p_room uuid,p_action text,p_payload jsonb,p_expected_version integer) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 result:=app_private.room_command_before_m6(p_credential_hash,p_room,p_action,p_payload,p_expected_version);
 if p_action<>'heartbeat' then perform app_private.touch_room(p_room);end if;
 return result;
end; $$;

alter function public.room_join(text,text,text,text,text) rename to room_join_before_m6;
alter function public.room_join_before_m6(text,text,text,text,text) set schema app_private;
create function public.room_join(p_code text,p_nickname text,p_nickname_key text,p_credential_hash text,p_recovery_hash text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 result:=app_private.room_join_before_m6(p_code,p_nickname,p_nickname_key,p_credential_hash,p_recovery_hash);
 perform app_private.touch_room((result->>'room_id')::uuid);return result;
end; $$;

alter function public.player_recover(text,text,text,text) rename to player_recover_before_m6;
alter function public.player_recover_before_m6(text,text,text,text) set schema app_private;
create function public.player_recover(p_code text,p_recovery_hash text,p_credential_hash text,p_new_recovery_hash text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare r app_private.rooms;p app_private.players;v_changed boolean;
begin
 -- Same lock order as heartbeat/game commands; concurrent use of a recovery code has one winner.
 select * into r from app_private.rooms where code=p_code and status='open' and expires_at>now() for update;
 if not found then raise exception 'RECOVERY_FAILED' using errcode='P0001';end if;
 select * into p from app_private.players where room_id=r.id and recovery_hash=p_recovery_hash and status<>'left' for update;
 if not found then raise exception 'RECOVERY_FAILED' using errcode='P0001';end if;
 update app_private.players set credential_hash=p_credential_hash,recovery_hash=p_new_recovery_hash,last_seen_at=clock_timestamp() where id=p.id;
 v_changed:=app_private.advance_connectivity(r.id);perform app_private.touch_room(r.id);
 return jsonb_build_object('room_id',r.id,'code',r.code,'player_id',p.id,'version',(select version from app_private.rooms where id=r.id),'_transition_applied',v_changed);
end; $$;

alter function public.game_command(text,uuid,text,jsonb,integer,text,uuid) rename to game_command_before_m6;
alter function public.game_command_before_m6(text,uuid,text,jsonb,integer,text,uuid) set schema app_private;
create function public.game_command(p_credential_hash text,p_room uuid,p_action text,p_payload jsonb,p_expected_version integer,p_expected_phase text,p_request_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare r app_private.rooms;g app_private.rounds;v_me uuid;v_result jsonb;v_fingerprint jsonb;receipt app_private.command_receipts;
begin
 if not exists(select 1 from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left') then raise exception 'FORBIDDEN' using errcode='P0001';end if;
 select * into r from app_private.rooms where id=p_room for update;
 select id into v_me from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left' for update;
 if not found then raise exception 'FORBIDDEN' using errcode='P0001';end if;
 if r.status<>'open' or r.expires_at<=now() then raise exception 'ROOM_CLOSED' using errcode='P0001';end if;
 if p_request_id is null or p_expected_version is null or p_expected_phase is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'INVALID_REQUEST' using errcode='P0001';end if;
 v_fingerprint:=jsonb_build_object('room',p_room,'action',p_action,'payload',p_payload,'version',p_expected_version,'phase',p_expected_phase);
 select * into receipt from app_private.command_receipts where player_id=v_me and request_id=p_request_id;
 if found then
  if receipt.fingerprint<>v_fingerprint then raise exception 'REQUEST_CONFLICT' using errcode='P0001';end if;
  return receipt.response_meta||jsonb_build_object('changed',false);
 end if;
 -- Returning a conflict as data commits the automatic pause/transfer instead of rolling it back.
 if app_private.advance_connectivity(p_room) then
  return jsonb_build_object('version',(select version from app_private.rooms where id=p_room),'changed',true,'error','VERSION_CONFLICT');
 end if;
 select * into g from app_private.rounds where room_id=p_room and ended_at is null;
 if g.phase='PAUSED_DISCONNECT' and p_action not in ('cancel_round','wait_reconnect') then raise exception 'ROUND_PAUSED' using errcode='P0001';end if;
 if p_action='wait_reconnect' or (p_action='cancel_round' and g.phase='PAUSED_DISCONNECT') then
  if r.host_player_id<>v_me then raise exception 'HOST_ONLY' using errcode='P0001';end if;
  if p_expected_version<>r.version then raise exception 'VERSION_CONFLICT' using errcode='P0001';end if;
  if g.phase is distinct from 'PAUSED_DISCONNECT' or p_expected_phase<>g.phase or (p_action='wait_reconnect' and p_payload->>'round_id' is distinct from g.id::text) then raise exception 'PHASE_CONFLICT' using errcode='P0001';end if;
  if g.disconnect_grace_until>clock_timestamp() then raise exception 'RECONNECT_GRACE' using errcode='P0001';end if;
  if p_action='wait_reconnect' then
   update app_private.rounds set disconnect_grace_until=clock_timestamp()+interval '30 seconds',version=version+1 where id=g.id;
   v_result:=jsonb_build_object('version',app_private.bump(p_room),'changed',true);
   insert into app_private.command_receipts values(p_room,v_me,p_request_id,v_fingerprint,v_result,now());
  end if;
 end if;
 if v_result is null then v_result:=app_private.game_command_before_m6(p_credential_hash,p_room,p_action,p_payload,p_expected_version,p_expected_phase,p_request_id);end if;
 update app_private.players set last_seen_at=clock_timestamp() where id=v_me;
 perform app_private.touch_room(p_room);return v_result;
end; $$;

alter function app_private.room_dto(uuid,uuid) rename to room_dto_before_m6;
create function app_private.room_dto(p_room uuid,p_me uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select case when g.id is null then base.value else base.value||jsonb_build_object('round',(base.value->'round')||jsonb_build_object(
  'me',case when g.phase='PAUSED_DISCONNECT' and g.disconnect_phase='COLLECT_WORDS' and base.value->'round'->'me'<>'null'::jsonb then (base.value->'round'->'me')||jsonb_build_object('role',null,'word',null) else base.value->'round'->'me' end,
  'disconnect',case when g.phase='PAUSED_DISCONNECT' then jsonb_build_object('original_phase',g.disconnect_phase,'remaining_ms',g.disconnect_remaining_ms,'grace_until',g.disconnect_grace_until,
    'missing_ids',coalesce((select jsonb_agg(p.id order by p.join_order) from app_private.round_players rp join app_private.players p on p.id=rp.player_id where rp.round_id=g.id and rp.eliminated_at is null and (p.status='left' or p.last_seen_at<=statement_timestamp()-interval '30 seconds')),'[]'::jsonb)) else null end
 )) end
 from (select app_private.room_dto_before_m6(p_room,p_me) value) base
 left join app_private.rounds g on g.room_id=p_room and g.ended_at is null;
$$;

-- One scheduled transaction, no client required. Cascades also remove tokens, votes and results.
create function app_private.maintain_rooms() returns integer language plpgsql volatile security definer set search_path='' as $$
declare r app_private.rooms;v_deleted integer:=0;
begin
 if not pg_try_advisory_xact_lock(hashtext('party-game-maintenance')) then return 0;end if;
 for r in select * from app_private.rooms order by id for update skip locked loop
  if r.status='closed' or r.expires_at<=now() then
   delete from app_private.rooms where id=r.id;v_deleted:=v_deleted+1;
  else perform app_private.advance_discussion(r.id);
  end if;
 end loop;
 delete from app_private.rate_limits where window_start<now()-interval '1 day';
 return v_deleted;
end; $$;

revoke all on all functions in schema app_private from public,anon,authenticated,service_role;
revoke all on function public.room_command(text,uuid,text,jsonb,integer),public.room_join(text,text,text,text,text),public.player_recover(text,text,text,text),public.game_command(text,uuid,text,jsonb,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.room_command(text,uuid,text,jsonb,integer),public.room_join(text,text,text,text,text),public.player_recover(text,text,text,text),public.game_command(text,uuid,text,jsonb,integer,text,uuid) to service_role;

-- PGlite has no scheduler extension; its tests invoke the exact same maintenance function.
do $scheduler$ begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then
  execute 'create extension if not exists pg_cron';
  execute $job$select cron.schedule('party-game-maintenance','5 seconds','select app_private.maintain_rooms()')$job$;
 end if;
end; $scheduler$;
