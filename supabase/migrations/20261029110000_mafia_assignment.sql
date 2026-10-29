-- MAF-2: isolated private assignment; no night actions yet.
create table app_private.mafia_rounds (
 id uuid primary key default gen_random_uuid(),
 room_id uuid not null references app_private.rooms(id) on delete cascade,
 phase text not null default 'REVEAL_ROLE' check(phase in ('REVEAL_ROLE','INTRO','CANCELLED')),
 created_at timestamptz not null default now(),
 ended_at timestamptz,
 unique(id,room_id)
);
create unique index mafia_one_active_round on app_private.mafia_rounds(room_id) where ended_at is null;
create table app_private.mafia_round_players (
 round_id uuid not null references app_private.mafia_rounds(id) on delete cascade,
 player_id uuid not null references app_private.players(id) on delete cascade,
 role text not null check(role in ('mafia','spy','citizen','police','doctor','journalist','traitor')),
 acknowledged_at timestamptz,
 primary key(round_id,player_id)
);
create index mafia_round_players_player on app_private.mafia_round_players(player_id);
alter table app_private.mafia_rounds enable row level security;
alter table app_private.mafia_round_players enable row level security;
revoke all on app_private.mafia_rounds,app_private.mafia_round_players from public,anon,authenticated;

alter function public.room_command(text,uuid,text,jsonb,integer) rename to room_command_before_mafia_assignment;
alter function public.room_command_before_mafia_assignment(text,uuid,text,jsonb,integer) set schema app_private;
create function public.room_command(p_credential_hash text,p_room uuid,p_action text,p_payload jsonb,p_expected_version integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
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
end; $$;

alter function app_private.room_dto(uuid,uuid) rename to room_dto_before_mafia_assignment;
create function app_private.room_dto(p_room uuid,p_me uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when g.id is null then base.value else base.value||jsonb_build_object('mafia',jsonb_build_object(
  'id',g.id,'phase',g.phase,
  'participant_ids',coalesce((select jsonb_agg(mp.player_id) from app_private.mafia_round_players mp where mp.round_id=g.id),'[]'::jsonb),
  'acknowledged_count',(select count(*) from app_private.mafia_round_players mp where mp.round_id=g.id and mp.acknowledged_at is not null),
  'me',(select jsonb_build_object('role',mp.role,'acknowledged',mp.acknowledged_at is not null,
   'teammate_ids',case when mp.role='mafia' then coalesce((select jsonb_agg(t.player_id) from app_private.mafia_round_players t where t.round_id=g.id and t.role='mafia' and t.player_id<>p_me),'[]'::jsonb) else '[]'::jsonb end)
   from app_private.mafia_round_players mp where mp.round_id=g.id and mp.player_id=p_me)
 )) end
 from (select app_private.room_dto_before_mafia_assignment(p_room,p_me) value) base
 left join app_private.mafia_rounds g on g.room_id=p_room and g.ended_at is null;
$$;

revoke all on function public.room_command(text,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.room_command(text,uuid,text,jsonb,integer) to service_role;
revoke all on function app_private.room_command_before_mafia_assignment(text,uuid,text,jsonb,integer),
 app_private.room_dto(uuid,uuid),app_private.room_dto_before_mafia_assignment(uuid,uuid)
 from public,anon,authenticated,service_role;
