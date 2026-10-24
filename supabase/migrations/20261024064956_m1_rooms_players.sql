-- M1: rooms, players and the room lifecycle RPCs.
-- Tables live in a non-exposed schema. Only service_role (Edge Functions) may execute the RPCs,
-- and every RPC re-checks the participant credential hash itself.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table app_private.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[0-9]{6}$'),
  host_player_id uuid not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  settings jsonb not null default '{"word_mode":"builtin","hint_rounds":1,"discussion_seconds":180}',
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours',
  closed_at timestamptz,
  check ((status = 'closed') = (closed_at is not null))
);
-- Codes are unique among open rooms only; a closed room's code can be reused.
create unique index rooms_open_code_key on app_private.rooms (code) where status = 'open';

create table app_private.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references app_private.rooms (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 16 and nickname = btrim(nickname)),
  join_order integer not null check (join_order > 0),
  status text not null default 'active' check (status in ('active', 'waiting_next_round', 'left')),
  wins integer not null default 0 check (wins >= 0),
  credential_hash text not null unique check (credential_hash ~ '^[0-9a-f]{64}$'),
  recovery_hash text not null unique check (recovery_hash ~ '^[0-9a-f]{64}$'),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (room_id, join_order),
  unique (id, room_id)
);
create unique index players_active_nickname_key on app_private.players (room_id, lower(nickname)) where status <> 'left';
create index players_room_idx on app_private.players (room_id);

-- Invariant: the host is always a participant of the same room.
alter table app_private.rooms add constraint rooms_host_in_room
  foreign key (host_player_id, id) references app_private.players (id, room_id) deferrable initially deferred;

alter table app_private.rooms enable row level security;
alter table app_private.players enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;

-- Public room DTO: never includes credential/recovery hashes.
create function app_private.room_dto(p_room uuid, p_me uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'room', jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status, 'version', r.version,
      'host_player_id', r.host_player_id, 'settings', r.settings, 'expires_at', r.expires_at),
    'me', jsonb_build_object('player_id', p_me, 'is_host', r.host_player_id = p_me),
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nickname', p.nickname,
        'join_order', p.join_order, 'status', p.status, 'wins', p.wins,
        'connected', p.last_seen_at > now() - interval '30 seconds') order by p.join_order)
      from app_private.players p where p.room_id = r.id and p.status <> 'left'), '[]'::jsonb))
  from app_private.rooms r where r.id = p_room;
$$;

create function app_private.bump(p_room uuid) returns integer
language sql volatile security definer set search_path = '' as $$
  update app_private.rooms set version = version + 1, last_activity_at = now(),
    expires_at = case when status = 'open' then now() + interval '2 hours' else expires_at end
  where id = p_room returning version;
$$;

create function public.room_create(p_nickname text, p_credential_hash text, p_recovery_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_room uuid := gen_random_uuid();
  v_player uuid := gen_random_uuid();
  v_code text;
  v_try integer := 0;
begin
  loop
    v_try := v_try + 1;
    v_code := lpad(floor(random() * 1000000)::integer::text, 6, '0');
    -- Expired-but-unswept rooms must not block a code.
    update app_private.rooms set status = 'closed', closed_at = now()
      where code = v_code and status = 'open' and expires_at <= now();
    begin
      insert into app_private.rooms (id, code, host_player_id) values (v_room, v_code, v_player);
      exit;
    exception when unique_violation then
      if v_try >= 20 then raise exception 'CODE_EXHAUSTED' using errcode = 'P0001'; end if;
    end;
  end loop;
  insert into app_private.players (id, room_id, nickname, join_order, credential_hash, recovery_hash)
    values (v_player, v_room, p_nickname, 1, p_credential_hash, p_recovery_hash);
  return jsonb_build_object('room_id', v_room, 'code', v_code, 'player_id', v_player, 'version', 1);
end;
$$;

create function public.room_join(p_code text, p_nickname text, p_credential_hash text, p_recovery_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_room app_private.rooms;
  v_player uuid := gen_random_uuid();
  v_count integer;
  v_order integer;
begin
  select * into v_room from app_private.rooms
    where code = p_code and status = 'open' and expires_at > now() for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  select count(*) filter (where status <> 'left'), coalesce(max(join_order), 0) into v_count, v_order
    from app_private.players where room_id = v_room.id;
  if v_count >= 12 then raise exception 'ROOM_FULL' using errcode = 'P0001'; end if;
  if exists (select 1 from app_private.players where room_id = v_room.id and status <> 'left'
      and lower(nickname) = lower(p_nickname)) then
    raise exception 'NICKNAME_TAKEN' using errcode = 'P0001';
  end if;
  -- M2 will place joiners into waiting_next_round while a round is active.
  insert into app_private.players (id, room_id, nickname, join_order, credential_hash, recovery_hash)
    values (v_player, v_room.id, p_nickname, v_order + 1, p_credential_hash, p_recovery_hash);
  return jsonb_build_object('room_id', v_room.id, 'code', v_room.code, 'player_id', v_player,
    'version', app_private.bump(v_room.id));
end;
$$;

-- Recovery rotates BOTH the session credential and the recovery code: the old ones stop working at once.
create function public.player_recover(p_code text, p_recovery_hash text, p_credential_hash text, p_new_recovery_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_player app_private.players;
  v_code text;
begin
  select p.* into v_player from app_private.players p join app_private.rooms r on r.id = p.room_id
    where r.code = p_code and r.status = 'open' and r.expires_at > now()
      and p.recovery_hash = p_recovery_hash and p.status <> 'left'
    for update of p;
  if not found then raise exception 'RECOVERY_FAILED' using errcode = 'P0001'; end if;
  update app_private.players set credential_hash = p_credential_hash, recovery_hash = p_new_recovery_hash,
    last_seen_at = now() where id = v_player.id;
  select code into v_code from app_private.rooms where id = v_player.room_id;
  return jsonb_build_object('room_id', v_player.room_id, 'code', v_code, 'player_id', v_player.id,
    'version', app_private.bump(v_player.room_id));
end;
$$;

create function public.room_snapshot(p_credential_hash text, p_room uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_player uuid;
  v_open boolean;
begin
  select p.id, (r.status = 'open' and r.expires_at > now()) into v_player, v_open
    from app_private.players p join app_private.rooms r on r.id = p.room_id
    where p.credential_hash = p_credential_hash and p.room_id = p_room and p.status <> 'left';
  if not found then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  if not v_open then raise exception 'ROOM_CLOSED' using errcode = 'P0001'; end if;
  return app_private.room_dto(p_room, v_player);
end;
$$;

create function public.room_command(p_credential_hash text, p_room uuid, p_action text, p_payload jsonb, p_expected_version integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_room app_private.rooms;
  v_me app_private.players;
  v_settings jsonb;
  v_next uuid;
begin
  select * into v_room from app_private.rooms where id = p_room for update;
  if not found then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  select * into v_me from app_private.players
    where room_id = p_room and credential_hash = p_credential_hash and status <> 'left';
  if not found then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  if v_room.status <> 'open' or v_room.expires_at <= now() then raise exception 'ROOM_CLOSED' using errcode = 'P0001'; end if;

  -- Presence heartbeat: no version change and does not count as room activity.
  if p_action = 'heartbeat' then
    update app_private.players set last_seen_at = now() where id = v_me.id;
    return jsonb_build_object('version', v_room.version, 'changed', false);
  end if;

  if p_expected_version is distinct from v_room.version then
    raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
  end if;

  if p_action = 'update_settings' then
    if v_room.host_player_id <> v_me.id then raise exception 'HOST_ONLY' using errcode = 'P0001'; end if;
    if jsonb_typeof(p_payload) is distinct from 'object' or exists (select 1 from jsonb_object_keys(p_payload) k
        where k not in ('word_mode', 'hint_rounds', 'discussion_seconds')) then
      raise exception 'INVALID_SETTINGS' using errcode = 'P0001';
    end if;
    v_settings := v_room.settings || p_payload;
    if not (jsonb_typeof(v_settings -> 'word_mode') = 'string' and v_settings ->> 'word_mode' in ('builtin', 'custom')
        and jsonb_typeof(v_settings -> 'hint_rounds') = 'number' and v_settings ->> 'hint_rounds' in ('1', '2', '3')
        and jsonb_typeof(v_settings -> 'discussion_seconds') = 'number'
        and v_settings ->> 'discussion_seconds' in ('0', '60', '120', '180', '300')) then
      raise exception 'INVALID_SETTINGS' using errcode = 'P0001';
    end if;
    update app_private.rooms set settings = v_settings where id = p_room;
  elsif p_action = 'leave' then
    update app_private.players set status = 'left' where id = v_me.id;
    if v_room.host_player_id = v_me.id then
      select id into v_next from app_private.players
        where room_id = p_room and status <> 'left' order by join_order limit 1;
      if v_next is null then
        update app_private.rooms set status = 'closed', closed_at = now() where id = p_room;
      else
        update app_private.rooms set host_player_id = v_next where id = p_room;
      end if;
    end if;
  elsif p_action = 'close_room' then
    if v_room.host_player_id <> v_me.id then raise exception 'HOST_ONLY' using errcode = 'P0001'; end if;
    update app_private.rooms set status = 'closed', closed_at = now() where id = p_room;
  else
    raise exception 'UNKNOWN_ACTION' using errcode = 'P0001';
  end if;
  return jsonb_build_object('version', app_private.bump(p_room), 'changed', true);
end;
$$;

revoke all on all functions in schema app_private from public, anon, authenticated;
revoke all on function public.room_create(text, text, text) from public, anon, authenticated;
revoke all on function public.room_join(text, text, text, text) from public, anon, authenticated;
revoke all on function public.player_recover(text, text, text, text) from public, anon, authenticated;
revoke all on function public.room_snapshot(text, uuid) from public, anon, authenticated;
revoke all on function public.room_command(text, uuid, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.room_create(text, text, text) to service_role;
grant execute on function public.room_join(text, text, text, text) to service_role;
grant execute on function public.player_recover(text, text, text, text) to service_role;
grant execute on function public.room_snapshot(text, uuid) to service_role;
grant execute on function public.room_command(text, uuid, text, jsonb, integer) to service_role;
