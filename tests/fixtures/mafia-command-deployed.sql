-- Local test fixture recovered from party-game-dev on 2026-10-29.
-- Contains only the schema and command definitions required to reproduce the leave bug.
-- Not an original migration, not a deployable recovery of MAF-1..3; contains no game data.
alter table app_private.rooms add column game_type text not null default 'liar';

create table app_private.mafia_rounds (
  id uuid default gen_random_uuid() not null,
  room_id uuid not null,
  phase text default 'REVEAL_ROLE'::text not null,
  created_at timestamp with time zone default now() not null,
  ended_at timestamp with time zone,
  night_no integer default 0 not null,
  night_result jsonb,
  winner text
);

create table app_private.mafia_round_players (
  round_id uuid not null,
  player_id uuid not null,
  role text not null,
  acknowledged_at timestamp with time zone,
  eliminated_at timestamp with time zone,
  original_role text not null,
  mission_target_id uuid
);

create table app_private.mafia_night_actions (
  round_id uuid not null,
  night_no integer not null,
  actor_id uuid not null,
  kind text not null,
  target_id uuid
);
alter table app_private.mafia_night_actions add constraint mafia_night_actions_kind_check CHECK ((kind = ANY (ARRAY['mafia'::text, 'police'::text, 'doctor'::text, 'spy'::text, 'journalist'::text])));
alter table app_private.mafia_night_actions add constraint mafia_night_actions_night_no_check CHECK ((night_no > 0));
alter table app_private.mafia_night_actions add constraint mafia_night_actions_pkey PRIMARY KEY (round_id, night_no, actor_id);
alter table app_private.mafia_round_players add constraint mafia_round_players_pkey PRIMARY KEY (round_id, player_id);
alter table app_private.mafia_round_players add constraint mafia_round_players_role_check CHECK ((role = ANY (ARRAY['mafia'::text, 'spy'::text, 'citizen'::text, 'police'::text, 'doctor'::text, 'journalist'::text, 'traitor'::text])));
alter table app_private.mafia_rounds add constraint mafia_rounds_id_room_id_key UNIQUE (id, room_id);
alter table app_private.mafia_rounds add constraint mafia_rounds_night_no_check CHECK ((night_no >= 0));
alter table app_private.mafia_rounds add constraint mafia_rounds_phase_check CHECK ((phase = ANY (ARRAY['REVEAL_ROLE'::text, 'INTRO'::text, 'NIGHT'::text, 'DAY_DISCUSS'::text, 'FINAL_RESULT'::text, 'CANCELLED'::text])));
alter table app_private.mafia_rounds add constraint mafia_rounds_pkey PRIMARY KEY (id);
alter table app_private.mafia_rounds add constraint mafia_rounds_winner_check CHECK ((winner = ANY (ARRAY['mafia'::text, 'citizen'::text])));
alter table app_private.mafia_night_actions add constraint mafia_night_actions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES app_private.players(id) ON DELETE CASCADE;
alter table app_private.mafia_night_actions add constraint mafia_night_actions_round_id_fkey FOREIGN KEY (round_id) REFERENCES app_private.mafia_rounds(id) ON DELETE CASCADE;
alter table app_private.mafia_night_actions add constraint mafia_night_actions_target_id_fkey FOREIGN KEY (target_id) REFERENCES app_private.players(id);
alter table app_private.mafia_round_players add constraint mafia_round_players_mission_target_id_fkey FOREIGN KEY (mission_target_id) REFERENCES app_private.players(id);
alter table app_private.mafia_round_players add constraint mafia_round_players_player_id_fkey FOREIGN KEY (player_id) REFERENCES app_private.players(id) ON DELETE CASCADE;
alter table app_private.mafia_round_players add constraint mafia_round_players_round_id_fkey FOREIGN KEY (round_id) REFERENCES app_private.mafia_rounds(id) ON DELETE CASCADE;
alter table app_private.mafia_rounds add constraint mafia_rounds_room_id_fkey FOREIGN KEY (room_id) REFERENCES app_private.rooms(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION app_private.room_command(p_credential_hash text, p_room uuid, p_action text, p_payload jsonb, p_expected_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room app_private.rooms;
  v_me uuid;
  v_settings jsonb;
  v_next uuid;
  v_target uuid;
begin
  -- Authenticate first, without locks, so random tokens cannot contend on the room row.
  select id into v_me from app_private.players
    where room_id = p_room and credential_hash = p_credential_hash and status <> 'left';
  if not found then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  select * into v_room from app_private.rooms where id = p_room for update;
  -- Re-check under the lock: the player may have been kicked or rotated meanwhile.
  if not exists (select 1 from app_private.players where id = v_me and credential_hash = p_credential_hash and status <> 'left') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_room.status <> 'open' or v_room.expires_at <= now() then raise exception 'ROOM_CLOSED' using errcode = 'P0001'; end if;

  if p_action = 'heartbeat' then
    update app_private.players set last_seen_at = now() where id = v_me;
    return jsonb_build_object('version', v_room.version, 'changed', false);
  end if;

  if p_expected_version is distinct from v_room.version then
    raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
  end if;
  if p_action in ('update_settings', 'close_room', 'kick', 'lock') and v_room.host_player_id <> v_me then
    raise exception 'HOST_ONLY' using errcode = 'P0001';
  end if;

  if p_action = 'update_settings' then
    if jsonb_typeof(p_payload) is distinct from 'object' or exists (select 1 from jsonb_object_keys(p_payload) k
        where k not in ('word_mode', 'hint_rounds', 'discussion_seconds', 'theme', 'custom_theme', 'game_mode', 'difficulty', 'liar_count')) then
      raise exception 'INVALID_SETTINGS' using errcode = 'P0001';
    end if;
    v_settings := '{"theme":"random","custom_theme":"","game_mode":"classic","difficulty":"easy","liar_count":1}'::jsonb || v_room.settings || p_payload;
    if not (jsonb_typeof(v_settings -> 'word_mode') = 'string' and v_settings ->> 'word_mode' in ('builtin', 'custom')
        and jsonb_typeof(v_settings -> 'hint_rounds') = 'number' and v_settings ->> 'hint_rounds' in ('1', '2', '3')
        and jsonb_typeof(v_settings -> 'discussion_seconds') = 'number'
        and v_settings ->> 'discussion_seconds' in ('0', '60', '120', '180', '300')) then
      raise exception 'INVALID_SETTINGS' using errcode = 'P0001';
    end if;
    
    if (jsonb_typeof(v_settings->'word_mode')='string' and v_settings->>'word_mode' in ('builtin','custom')
      and jsonb_typeof(v_settings->'hint_rounds')='number' and v_settings->>'hint_rounds' in ('1','2','3')
      and jsonb_typeof(v_settings->'discussion_seconds')='number' and v_settings->>'discussion_seconds' in ('0','60','120','180','300')
      and jsonb_typeof(v_settings->'theme')='string' and v_settings->>'theme' in ('random','음식','동물','생활용품','장소','취미','자연','운동','크로스핏','여행')
      and jsonb_typeof(v_settings->'custom_theme')='string' and char_length(v_settings->>'custom_theme')<=30
      and (v_settings->>'custom_theme') !~ '[[:cntrl:]]' and (v_settings->>'custom_theme') !~ U&'[\200B-\200F\202A-\202E\2060-\206F\FEFF]'
      and jsonb_typeof(v_settings->'game_mode')='string' and v_settings->>'game_mode' in ('classic','confusion')
      and jsonb_typeof(v_settings->'liar_count')='number' and v_settings->>'liar_count' in ('1','2') and jsonb_typeof(v_settings->'difficulty')='string' and v_settings->>'difficulty' in ('easy','hard')
      and (v_settings->>'word_mode'<>'custom' or v_settings->>'game_mode'='classic')) is not true then
      raise exception 'INVALID_SETTINGS' using errcode='P0001';
    end if;
    v_settings:=jsonb_set(v_settings,'{custom_theme}',to_jsonb(btrim(v_settings->>'custom_theme')));
    if v_settings = ('{"theme":"random","custom_theme":"","game_mode":"classic","difficulty":"easy","liar_count":1}'::jsonb || v_room.settings) then
 return jsonb_build_object('version', v_room.version, 'changed', false); end if;
    update app_private.rooms set settings = v_settings where id = p_room;
  elsif p_action = 'lock' then
    if jsonb_typeof(p_payload -> 'locked') is distinct from 'boolean' then raise exception 'INVALID_REQUEST' using errcode = 'P0001'; end if;
    if (p_payload ->> 'locked')::boolean = v_room.locked then return jsonb_build_object('version', v_room.version, 'changed', false); end if;
    update app_private.rooms set locked = (p_payload ->> 'locked')::boolean where id = p_room;
  elsif p_action = 'kick' then
    if coalesce(p_payload ->> 'player_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'PLAYER_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_target := (p_payload ->> 'player_id')::uuid;
    if v_target = v_me then raise exception 'CANNOT_KICK_SELF' using errcode = 'P0001'; end if;
    update app_private.players set status = 'left' where id = v_target and room_id = p_room and status <> 'left';
    if not found then raise exception 'PLAYER_NOT_FOUND' using errcode = 'P0001'; end if;
  elsif p_action = 'leave' then
    update app_private.players set status = 'left' where id = v_me;
    if v_room.host_player_id = v_me then
      select id into v_next from app_private.players
        where room_id = p_room and status <> 'left' order by join_order limit 1;
      if v_next is null then
        update app_private.rooms set status = 'closed', closed_at = now() where id = p_room;
      else
        update app_private.rooms set host_player_id = v_next where id = p_room;
      end if;
    end if;
  elsif p_action = 'close_room' then
    update app_private.rooms set status = 'closed', closed_at = now() where id = p_room;
  else
    raise exception 'UNKNOWN_ACTION' using errcode = 'P0001';
  end if;
  return jsonb_build_object('version', app_private.bump(p_room), 'changed', true);
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.room_command_before_mafia(p_credential_hash text, p_room uuid, p_action text, p_payload jsonb, p_expected_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 result:=app_private.room_command_before_m6(p_credential_hash,p_room,p_action,p_payload,p_expected_version);
 if p_action<>'heartbeat' then perform app_private.touch_room(p_room);end if;
 return result;
end; $function$;

CREATE OR REPLACE FUNCTION app_private.room_command_before_mafia_assignment(p_credential_hash text, p_room uuid, p_action text, p_payload jsonb, p_expected_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r app_private.rooms;v_me uuid;v_roles jsonb;v_key text;v_value jsonb;v_total integer:=0;v_mafia integer;v_spy integer;v_citizens integer;
begin
 select * into r from app_private.rooms where id=p_room for update;
 if r.game_type is distinct from 'mafia' or p_action<>'update_settings' then
  return app_private.room_command_before_mafia(p_credential_hash,p_room,p_action,p_payload,p_expected_version);
 end if;
 select id into v_me from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left';
 if v_me is null then raise exception 'FORBIDDEN' using errcode='P0001';end if;
 if r.status<>'open' or r.expires_at<=now() then raise exception 'ROOM_CLOSED' using errcode='P0001';end if;
 if r.host_player_id<>v_me then raise exception 'HOST_ONLY' using errcode='P0001';end if;
 if p_expected_version is distinct from r.version then raise exception 'VERSION_CONFLICT' using errcode='P0001';end if;
 if exists(select 1 from app_private.rounds where room_id=p_room and ended_at is null) then raise exception 'ROUND_ACTIVE' using errcode='P0001';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_payload))<>1 or not (p_payload?'mafia_roles') then
  raise exception 'INVALID_SETTINGS' using errcode='P0001';end if;
 v_roles:=p_payload->'mafia_roles';
 if jsonb_typeof(v_roles) is distinct from 'object' or (select count(*) from jsonb_object_keys(v_roles))<>7 then
  raise exception 'INVALID_SETTINGS' using errcode='P0001';end if;
 for v_key,v_value in select key,value from jsonb_each(v_roles) loop
  if v_key not in ('mafia','spy','citizen','police','doctor','journalist','traitor')
   or jsonb_typeof(v_value) is distinct from 'number' or (v_value#>>'{}') !~ '^(0|[1-9][0-9]*)$'
   or (v_value#>>'{}')::numeric>15 then raise exception 'INVALID_SETTINGS' using errcode='P0001';end if;
  if v_key in ('spy','police','doctor','journalist','traitor') and (v_value#>>'{}')::integer>1 then raise exception 'INVALID_SETTINGS' using errcode='P0001';end if;
  if v_key='mafia' and (v_value#>>'{}')::integer>4 then raise exception 'INVALID_SETTINGS' using errcode='P0001';end if;
  v_total:=v_total+(v_value#>>'{}')::integer;
 end loop;
 v_mafia:=(v_roles->>'mafia')::integer;v_spy:=(v_roles->>'spy')::integer;v_citizens:=(v_roles->>'citizen')::integer;
 if v_total not between 4 and 15 or v_mafia<1 or v_citizens<1 or v_mafia+v_spy>=v_total-v_mafia-v_spy then
  raise exception 'INVALID_SETTINGS' using errcode='P0001';end if;
 if r.settings->'mafia_roles'=v_roles then return jsonb_build_object('version',r.version,'changed',false);end if;
 update app_private.rooms set settings=jsonb_set(settings,'{mafia_roles}',v_roles) where id=p_room;
 perform app_private.touch_room(p_room);
 return jsonb_build_object('version',app_private.bump(p_room),'changed',true);
end; $function$;

CREATE OR REPLACE FUNCTION app_private.room_command_before_mafia_night(p_credential_hash text, p_room uuid, p_action text, p_payload jsonb, p_expected_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r app_private.rooms;v_me uuid;g app_private.mafia_rounds;v_total integer;v_players integer;v_changed boolean:=false;
begin
 if p_action not in ('mafia_start','mafia_ack') then
  if p_action in ('update_settings','kick') and exists(select 1 from app_private.mafia_rounds where room_id=p_room and ended_at is null) then
   if not exists(select 1 from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left') then
    raise exception 'FORBIDDEN' using errcode='P0001';end if;
   raise exception 'ROUND_ACTIVE' using errcode='P0001';
  end if;
  return app_private.room_command_before_mafia_assignment(p_credential_hash,p_room,p_action,p_payload,p_expected_version);
 end if;
 select * into r from app_private.rooms where id=p_room for update;
 select id into v_me from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left';
 if v_me is null then raise exception 'FORBIDDEN' using errcode='P0001';end if;
 if r.status<>'open' or r.expires_at<=now() then raise exception 'ROOM_CLOSED' using errcode='P0001';end if;
 if r.game_type<>'mafia' then raise exception 'UNKNOWN_ACTION' using errcode='P0001';end if;
 if p_expected_version is distinct from r.version or jsonb_typeof(p_payload) is distinct from 'object' or p_payload<>'{}'::jsonb then
  raise exception 'VERSION_CONFLICT' using errcode='P0001';end if;
 select * into g from app_private.mafia_rounds where room_id=p_room and ended_at is null;
 if p_action='mafia_start' then
  if r.host_player_id<>v_me then raise exception 'HOST_ONLY' using errcode='P0001';end if;
  if g.id is not null or exists(select 1 from app_private.rounds where room_id=p_room and ended_at is null) then
   raise exception 'ROUND_ACTIVE' using errcode='P0001';end if;
  select count(*)::int into v_players from app_private.players where room_id=p_room and status='active';
  select sum(value::int)::int into v_total from jsonb_each_text(r.settings->'mafia_roles');
  if v_players not between 4 and 15 or v_total is distinct from v_players or
     exists(select 1 from app_private.players where room_id=p_room and status='active' and last_seen_at<=clock_timestamp()-interval '30 seconds') then
   raise exception 'PLAYER_COUNT' using errcode='P0001';end if;
  insert into app_private.mafia_rounds(room_id) values(p_room) returning * into g;
  insert into app_private.mafia_round_players(round_id,player_id,role)
   with seats as (select id,row_number() over(order by gen_random_uuid()) n from app_private.players where room_id=p_room and status='active'),
   roles as (select key role,row_number() over(order by gen_random_uuid()) n from jsonb_each_text(r.settings->'mafia_roles') cross join lateral generate_series(1,value::int))
   select g.id,seats.id,roles.role from seats join roles using(n);
  update app_private.rooms set locked=true where id=p_room;
  v_changed:=true;
 else
  if g.id is null or g.phase<>'REVEAL_ROLE' then raise exception 'PHASE_CONFLICT' using errcode='P0001';end if;
  update app_private.mafia_round_players set acknowledged_at=now() where round_id=g.id and player_id=v_me and acknowledged_at is null;
  if not found then raise exception 'ALREADY_ACKNOWLEDGED' using errcode='P0001';end if;
  if not exists(select 1 from app_private.mafia_round_players where round_id=g.id and acknowledged_at is null) then
   update app_private.mafia_rounds set phase='INTRO' where id=g.id;
  end if;
  v_changed:=true;
 end if;
 perform app_private.touch_room(p_room);
 return jsonb_build_object('version',case when v_changed then app_private.bump(p_room) else r.version end,'changed',v_changed);
end; $function$;

CREATE OR REPLACE FUNCTION public.room_command(p_credential_hash text, p_room uuid, p_action text, p_payload jsonb, p_expected_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r app_private.rooms;g app_private.mafia_rounds;actor app_private.mafia_round_players;
 v_me uuid;v_target uuid;v_target_text text;v_kind text;v_total integer;v_submitted integer;
 v_kill uuid;v_votes integer;v_mafias integer;v_protected uuid;v_team text;v_journal jsonb;v_mafia_team integer;v_other_team integer;v_result jsonb;
begin
 if p_action not in ('mafia_start','mafia_intro_done','mafia_night_action') then
  return app_private.room_command_before_mafia_night(p_credential_hash,p_room,p_action,p_payload,p_expected_version);
 end if;
 if p_action='mafia_start' then
  v_result:=app_private.room_command_before_mafia_night(p_credential_hash,p_room,p_action,p_payload,p_expected_version);
  select * into g from app_private.mafia_rounds where room_id=p_room and ended_at is null;
  -- A mission target is a different, initially citizen-team participant. The mission is private.
  update app_private.mafia_round_players t set mission_target_id=(
   select p.player_id from app_private.mafia_round_players p
   where p.round_id=g.id and p.role in ('citizen','police','doctor','journalist')
    and p.player_id<>t.player_id order by gen_random_uuid() limit 1)
   where t.round_id=g.id and t.role='traitor';
  return v_result;
 end if;
 select * into r from app_private.rooms where id=p_room for update;
 select id into v_me from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left';
 if v_me is null then raise exception 'FORBIDDEN' using errcode='P0001';end if;
 if r.status<>'open' or r.expires_at<=now() then raise exception 'ROOM_CLOSED' using errcode='P0001';end if;
 if r.game_type<>'mafia' then raise exception 'UNKNOWN_ACTION' using errcode='P0001';end if;
 if p_expected_version is distinct from r.version then raise exception 'VERSION_CONFLICT' using errcode='P0001';end if;
 select * into g from app_private.mafia_rounds where room_id=p_room and ended_at is null;
 if g.id is null then raise exception 'PHASE_CONFLICT' using errcode='P0001';end if;
 if p_action='mafia_intro_done' then
  if r.host_player_id<>v_me then raise exception 'HOST_ONLY' using errcode='P0001';end if;
  if g.phase<>'INTRO' or p_payload<>'{}'::jsonb then raise exception 'PHASE_CONFLICT' using errcode='P0001';end if;
  update app_private.mafia_rounds set phase='NIGHT',night_no=1 where id=g.id;
 else
  if g.phase<>'NIGHT' then raise exception 'PHASE_CONFLICT' using errcode='P0001';end if;
  select * into actor from app_private.mafia_round_players where round_id=g.id and player_id=v_me and eliminated_at is null;
  if actor.player_id is null or actor.role not in ('mafia','police','doctor','spy','journalist') then raise exception 'FORBIDDEN' using errcode='P0001';end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_payload))<>1 or not (p_payload?'target_id') then
   raise exception 'INVALID_TARGET' using errcode='P0001';end if;
  v_target_text:=p_payload->>'target_id';
  if v_target_text is not null and v_target_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise exception 'INVALID_TARGET' using errcode='P0001';end if;
  if v_target_text is null and actor.role<>'journalist' then raise exception 'INVALID_TARGET' using errcode='P0001';end if;
  v_target:=v_target_text::uuid;
  if v_target is not null and ((v_target=v_me and actor.role<>'doctor') or not exists(select 1 from app_private.mafia_round_players p where p.round_id=g.id and p.player_id=v_target and p.eliminated_at is null)) then
   raise exception 'INVALID_TARGET' using errcode='P0001';end if;
  insert into app_private.mafia_night_actions(round_id,night_no,actor_id,kind,target_id)
    values(g.id,g.night_no,v_me,actor.role,v_target)
    on conflict do nothing;
  if not found then raise exception 'ALREADY_SUBMITTED' using errcode='P0001';end if;
  select count(*)::int into v_total from app_private.mafia_round_players where round_id=g.id and eliminated_at is null and role in ('mafia','police','doctor','spy','journalist');
  select count(*)::int into v_submitted from app_private.mafia_night_actions where round_id=g.id and night_no=g.night_no;
  if v_total=v_submitted then
   select count(*)::int into v_mafias from app_private.mafia_round_players where round_id=g.id and eliminated_at is null and role='mafia';
   select target_id,count(*)::int into v_kill,v_votes from app_private.mafia_night_actions
    where round_id=g.id and night_no=g.night_no and kind='mafia' group by target_id order by count(*) desc,target_id limit 1;
   if coalesce(v_votes,0)<=v_mafias/2 then v_kill:=null;end if;
   select target_id into v_protected from app_private.mafia_night_actions where round_id=g.id and night_no=g.night_no and kind='doctor';
   if v_kill=v_protected then v_kill:=null;end if;
   if v_kill is not null then
    select case when role in ('mafia','spy') then 'mafia' else 'citizen' end into v_team
     from app_private.mafia_round_players where round_id=g.id and player_id=v_kill;
    update app_private.mafia_round_players set eliminated_at=now() where round_id=g.id and player_id=v_kill;
    update app_private.mafia_round_players set role='mafia' where round_id=g.id and original_role='traitor'
      and eliminated_at is null and mission_target_id=v_kill;
   end if;
   select jsonb_build_object('player_id',a.target_id,'role',p.role) into v_journal
    from app_private.mafia_night_actions a join app_private.mafia_round_players p on p.round_id=a.round_id and p.player_id=a.target_id
    where a.round_id=g.id and a.night_no=g.night_no and a.kind='journalist' and a.target_id is not null;
   select count(*) filter(where role in ('mafia','spy'))::int,count(*) filter(where role not in ('mafia','spy'))::int into v_mafia_team,v_other_team
    from app_private.mafia_round_players where round_id=g.id and eliminated_at is null;
   update app_private.mafia_rounds set night_result=jsonb_build_object('eliminated_player_id',v_kill,'eliminated_team',v_team,'journalist',v_journal),
     winner=case when v_mafia_team>=v_other_team then 'mafia' else null end,
     phase=case when v_mafia_team>=v_other_team then 'FINAL_RESULT' else 'DAY_DISCUSS' end where id=g.id;
  end if;
 end if;
 perform app_private.touch_room(p_room);
 return jsonb_build_object('version',app_private.bump(p_room),'changed',true);
end; $function$;
