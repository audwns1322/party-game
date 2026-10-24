-- M3: server-owned hint cursor, discussion deadline and manual pause/resume.
alter table app_private.rounds drop constraint rounds_phase_check;
alter table app_private.rounds add constraint rounds_phase_check
  check(phase in ('COLLECT_WORDS','REVEAL_ROLE','HINT','DISCUSS','VOTE_1','PAUSED_HOST','CANCELLED'));
alter table app_private.rounds add column hint_index integer not null default 0 check(hint_index between 0 and 36);
alter table app_private.rounds add column phase_started_at timestamptz;
alter table app_private.rounds add column deadline_at timestamptz;
alter table app_private.rounds add column remaining_ms bigint check(remaining_ms is null or remaining_ms>=0);
alter table app_private.rounds add column paused_phase text check(paused_phase in ('HINT','DISCUSS'));

-- Caller already holds the room lock and has authenticated. No scheduler process is kept alive.
create function app_private.advance_discussion(p_room uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  update app_private.rounds set phase='VOTE_1',deadline_at=null,phase_started_at=clock_timestamp(),version=version+1
    where room_id=p_room and ended_at is null and phase='DISCUSS' and deadline_at<=clock_timestamp();
  if found then perform app_private.bump(p_room); return true; end if;
  return false;
end;
$$;

alter function app_private.room_dto(uuid,uuid) rename to m2_room_dto;
create function app_private.room_dto(p_room uuid,p_me uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select base.value || jsonb_build_object('server_now',statement_timestamp(),'round',case when g.id is null then null else
    (base.value->'round') || jsonb_build_object(
      'hint_index',g.hint_index,'hint_rounds',(g.config->>'hint_rounds')::int,
      'hint_round',least((g.config->>'hint_rounds')::int,g.hint_index / (select count(*)::int from app_private.round_players where round_id=g.id)+1),
      'current_player_id',case when g.phase='HINT' or g.paused_phase='HINT' then (
        select player_id from app_private.round_players where round_id=g.id
          and turn_order=g.hint_index % (select count(*)::int from app_private.round_players where round_id=g.id)+1
      ) else null end,
      'deadline_at',g.deadline_at,'remaining_ms',g.remaining_ms,'paused_phase',g.paused_phase,
      'phase_started_at',g.phase_started_at,
      'me',case when mine.player_id is null then null else (base.value->'round'->'me') || jsonb_build_object(
        'role',case when g.phase<>'COLLECT_WORDS' then mine.role else null end,
        'word',case when g.phase<>'COLLECT_WORDS' and mine.role='citizen' then secret.word else null end
      ) end) end)
  from (select app_private.m2_room_dto(p_room,p_me) value) base
  left join app_private.rounds g on g.room_id=p_room and g.ended_at is null
  left join app_private.round_players mine on mine.round_id=g.id and mine.player_id=p_me
  left join app_private.round_secrets secret on secret.round_id=g.id;
$$;

-- Snapshot may atomically settle a due deadline, then return the fresh state.
alter function public.room_snapshot(text,uuid) rename to room_snapshot_m2;
alter function public.room_snapshot_m2(text,uuid) set schema app_private;
create function public.room_snapshot(p_credential_hash text,p_room uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_room app_private.rooms; v_me uuid; v_changed boolean;
begin
  if not exists(select 1 from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left') then
    raise exception 'FORBIDDEN' using errcode='P0001'; end if;
  select * into v_room from app_private.rooms where id=p_room for update;
  select id into v_me from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left';
  if not found then raise exception 'FORBIDDEN' using errcode='P0001'; end if;
  if v_room.status<>'open' or v_room.expires_at<=now() then raise exception 'ROOM_CLOSED' using errcode='P0001'; end if;
  v_changed:=app_private.advance_discussion(p_room);
  return app_private.room_dto(p_room,v_me) || jsonb_build_object('_transition_applied',v_changed);
end;
$$;

alter function public.room_command(text,uuid,text,jsonb,integer) rename to room_command_m2;
alter function public.room_command_m2(text,uuid,text,jsonb,integer) set schema app_private;
create function public.room_command(p_credential_hash text,p_room uuid,p_action text,p_payload jsonb,p_expected_version integer) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_result jsonb;
begin
  v_result:=app_private.room_command_m2(p_credential_hash,p_room,p_action,p_payload,p_expected_version);
  if p_action='heartbeat' and app_private.advance_discussion(p_room) then
    return jsonb_build_object('version',(select version from app_private.rooms where id=p_room),'changed',true);
  end if;
  return v_result;
end;
$$;

alter function public.game_command(text,uuid,text,jsonb,integer,text,uuid) rename to game_command_m2;
alter function public.game_command_m2(text,uuid,text,jsonb,integer,text,uuid) set schema app_private;
create function public.game_command(p_credential_hash text,p_room uuid,p_action text,p_payload jsonb,
  p_expected_version integer,p_expected_phase text,p_request_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare
  v_room app_private.rooms; v_round app_private.rounds; v_me uuid; v_speaker uuid; v_count integer;
  v_now timestamptz; v_fingerprint jsonb; v_receipt app_private.command_receipts; v_result jsonb;
begin
  if p_action in ('start_round','submit_word','ack_role','cancel_round') then
    v_result:=app_private.game_command_m2(p_credential_hash,p_room,p_action,p_payload,p_expected_version,p_expected_phase,p_request_id);
    if p_action='ack_role' and (v_result->>'changed')::boolean then
      update app_private.rounds set phase_started_at=clock_timestamp() where room_id=p_room and ended_at is null and phase='HINT' and phase_started_at is null;
    end if;
    return v_result;
  end if;
  if not exists(select 1 from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left') then
    raise exception 'FORBIDDEN' using errcode='P0001'; end if;
  select * into v_room from app_private.rooms where id=p_room for update;
  select id into v_me from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left' for update;
  if not found then raise exception 'FORBIDDEN' using errcode='P0001'; end if;
  if v_room.status<>'open' or v_room.expires_at<=now() then raise exception 'ROOM_CLOSED' using errcode='P0001'; end if;
  if p_request_id is null or p_expected_version is null or p_expected_phase is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'INVALID_REQUEST' using errcode='P0001'; end if;
  v_fingerprint:=jsonb_build_object('room',p_room,'action',p_action,'payload',p_payload,'version',p_expected_version,'phase',p_expected_phase);
  select * into v_receipt from app_private.command_receipts where player_id=v_me and request_id=p_request_id;
  if found then
    if v_receipt.fingerprint<>v_fingerprint then raise exception 'REQUEST_CONFLICT' using errcode='P0001'; end if;
    return v_receipt.response_meta || jsonb_build_object('changed',false);
  end if;
  if p_expected_version is distinct from v_room.version then raise exception 'VERSION_CONFLICT' using errcode='P0001'; end if;
  select * into v_round from app_private.rounds where room_id=p_room and ended_at is null;
  if v_round.id is null or p_expected_phase is distinct from v_round.phase or p_payload->>'round_id' is distinct from v_round.id::text then
    raise exception 'PHASE_CONFLICT' using errcode='P0001'; end if;
  if not exists(select 1 from app_private.round_players where round_id=v_round.id and player_id=v_me) then
    raise exception 'NOT_ROUND_PLAYER' using errcode='P0001'; end if;
  v_now:=clock_timestamp();
  if p_action='finish_hint' then
    if v_round.phase<>'HINT' or p_payload->'hint_index' is distinct from to_jsonb(v_round.hint_index) then
      raise exception 'PHASE_CONFLICT' using errcode='P0001'; end if;
    select count(*)::int into v_count from app_private.round_players where round_id=v_round.id;
    select player_id into v_speaker from app_private.round_players where round_id=v_round.id and turn_order=v_round.hint_index % v_count+1;
    if v_speaker<>v_me then raise exception 'NOT_YOUR_TURN' using errcode='P0001'; end if;
    if v_round.hint_index+1=v_count*(v_round.config->>'hint_rounds')::int then
      update app_private.rounds set hint_index=hint_index+1,phase='DISCUSS',phase_started_at=v_now,
        deadline_at=case when (config->>'discussion_seconds')::int=0 then null else v_now+make_interval(secs=>(config->>'discussion_seconds')::int) end
        where id=v_round.id;
    else update app_private.rounds set hint_index=hint_index+1 where id=v_round.id;
    end if;
  elsif p_action in ('pause','resume','start_vote') then
    if v_room.host_player_id<>v_me then raise exception 'HOST_ONLY' using errcode='P0001'; end if;
    if p_action='pause' then
      if v_round.phase not in ('HINT','DISCUSS') then raise exception 'PHASE_CONFLICT' using errcode='P0001'; end if;
      if v_round.deadline_at<=v_now then raise exception 'DISCUSSION_OVER' using errcode='P0001'; end if;
      update app_private.rounds set paused_phase=phase,phase='PAUSED_HOST',
        remaining_ms=case when deadline_at is null then null else greatest(0,ceil(extract(epoch from deadline_at-v_now)*1000))::bigint end,
        deadline_at=null where id=v_round.id;
    elsif p_action='resume' then
      if v_round.phase<>'PAUSED_HOST' then raise exception 'PHASE_CONFLICT' using errcode='P0001'; end if;
      update app_private.rounds set phase=paused_phase,phase_started_at=v_now,
        deadline_at=case when paused_phase='DISCUSS' and remaining_ms is not null then v_now+remaining_ms*interval '1 millisecond' else null end,
        remaining_ms=null,paused_phase=null where id=v_round.id;
    else
      if v_round.phase<>'DISCUSS' then raise exception 'PHASE_CONFLICT' using errcode='P0001'; end if;
      if v_round.deadline_at is not null and v_round.deadline_at>v_now then raise exception 'DISCUSSION_NOT_OVER' using errcode='P0001'; end if;
      update app_private.rounds set phase='VOTE_1',phase_started_at=v_now,deadline_at=null where id=v_round.id;
    end if;
  else raise exception 'UNKNOWN_ACTION' using errcode='P0001';
  end if;
  update app_private.rounds set version=version+1 where id=v_round.id;
  v_result:=jsonb_build_object('version',app_private.bump(p_room),'changed',true);
  insert into app_private.command_receipts values(p_room,v_me,p_request_id,v_fingerprint,v_result,now());
  return v_result;
end;
$$;
revoke all on all functions in schema app_private from public,anon,authenticated,service_role;
revoke all on function public.room_snapshot(text,uuid) from public,anon,authenticated;
revoke all on function public.room_command(text,uuid,text,jsonb,integer) from public,anon,authenticated;
revoke all on function public.game_command(text,uuid,text,jsonb,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.room_snapshot(text,uuid) to service_role;
grant execute on function public.room_command(text,uuid,text,jsonb,integer) to service_role;
grant execute on function public.game_command(text,uuid,text,jsonb,integer,text,uuid) to service_role;
