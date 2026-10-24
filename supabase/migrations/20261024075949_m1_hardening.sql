-- M1 hardening after expert review:
--  * nickname spoofing: uniqueness on a server-computed confusable "skeleton" key, not raw lower()
--  * host moderation: kick a player, lock the room against new joins
--  * authenticate before taking the room lock; no-op commands do not bump the version
--  * recovery does not bump the room version (it changes nothing other players can see)

alter table app_private.players drop constraint if exists players_nickname_check;
alter table app_private.players add constraint players_nickname_check
  check (char_length(nickname) between 1 and 64 and nickname = btrim(nickname));
alter table app_private.players add column nickname_key text;
update app_private.players set nickname_key = lower(nickname) where nickname_key is null;
alter table app_private.players alter column nickname_key set not null;
alter table app_private.players add constraint players_nickname_key_check check (char_length(nickname_key) between 1 and 64);
drop index if exists app_private.players_active_nickname_key;
create unique index players_active_nickname_key on app_private.players (room_id, nickname_key) where status <> 'left';

alter table app_private.rooms add column locked boolean not null default false;

create or replace function app_private.room_dto(p_room uuid, p_me uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'room', jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status, 'version', r.version,
      'host_player_id', r.host_player_id, 'settings', r.settings, 'locked', r.locked, 'expires_at', r.expires_at),
    'me', jsonb_build_object('player_id', p_me, 'is_host', r.host_player_id = p_me),
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nickname', p.nickname,
        'join_order', p.join_order, 'status', p.status, 'wins', p.wins,
        'connected', p.last_seen_at > now() - interval '30 seconds') order by p.join_order)
      from app_private.players p where p.room_id = r.id and p.status <> 'left'), '[]'::jsonb))
  from app_private.rooms r where r.id = p_room;
$$;

drop function public.room_create(text, text, text);
drop function public.room_join(text, text, text, text);
drop function public.player_recover(text, text, text, text);
drop function public.room_command(text, uuid, text, jsonb, integer);

create function public.room_create(p_nickname text, p_nickname_key text, p_credential_hash text, p_recovery_hash text) returns jsonb
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
    update app_private.rooms set status = 'closed', closed_at = now()
      where code = v_code and status = 'open' and expires_at <= now();
    begin
      insert into app_private.rooms (id, code, host_player_id) values (v_room, v_code, v_player);
      exit;
    exception when unique_violation then
      if v_try >= 40 then raise exception 'TEMPORARILY_UNAVAILABLE' using errcode = 'P0001'; end if;
    end;
  end loop;
  insert into app_private.players (id, room_id, nickname, nickname_key, join_order, credential_hash, recovery_hash)
    values (v_player, v_room, p_nickname, p_nickname_key, 1, p_credential_hash, p_recovery_hash);
  return jsonb_build_object('room_id', v_room, 'code', v_code, 'player_id', v_player, 'version', 1);
end;
$$;

create function public.room_join(p_code text, p_nickname text, p_nickname_key text, p_credential_hash text, p_recovery_hash text) returns jsonb
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
  if v_room.locked then raise exception 'ROOM_LOCKED' using errcode = 'P0001'; end if;
  select count(*) filter (where status <> 'left'), coalesce(max(join_order), 0) into v_count, v_order
    from app_private.players where room_id = v_room.id;
  if v_count >= 12 then raise exception 'ROOM_FULL' using errcode = 'P0001'; end if;
  if exists (select 1 from app_private.players where room_id = v_room.id and status <> 'left'
      and nickname_key = p_nickname_key) then
    raise exception 'NICKNAME_TAKEN' using errcode = 'P0001';
  end if;
  insert into app_private.players (id, room_id, nickname, nickname_key, join_order, credential_hash, recovery_hash)
    values (v_player, v_room.id, p_nickname, p_nickname_key, v_order + 1, p_credential_hash, p_recovery_hash);
  return jsonb_build_object('room_id', v_room.id, 'code', v_room.code, 'player_id', v_player,
    'version', app_private.bump(v_room.id));
end;
$$;

create function public.player_recover(p_code text, p_recovery_hash text, p_credential_hash text, p_new_recovery_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_player app_private.players;
  v_room app_private.rooms;
begin
  select p.* into v_player from app_private.players p join app_private.rooms r on r.id = p.room_id
    where r.code = p_code and r.status = 'open' and r.expires_at > now()
      and p.recovery_hash = p_recovery_hash and p.status <> 'left'
    for update of p;
  if not found then raise exception 'RECOVERY_FAILED' using errcode = 'P0001'; end if;
  update app_private.players set credential_hash = p_credential_hash, recovery_hash = p_new_recovery_hash,
    last_seen_at = now() where id = v_player.id;
  select * into v_room from app_private.rooms where id = v_player.room_id;
  return jsonb_build_object('room_id', v_room.id, 'code', v_room.code, 'player_id', v_player.id, 'version', v_room.version);
end;
$$;

create function public.room_command(p_credential_hash text, p_room uuid, p_action text, p_payload jsonb, p_expected_version integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
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
    if v_settings = v_room.settings then return jsonb_build_object('version', v_room.version, 'changed', false); end if;
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
$$;

revoke all on all functions in schema app_private from public, anon, authenticated;
revoke all on function public.room_create(text, text, text, text) from public, anon, authenticated;
revoke all on function public.room_join(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.player_recover(text, text, text, text) from public, anon, authenticated;
revoke all on function public.room_command(text, uuid, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.room_create(text, text, text, text) to service_role;
grant execute on function public.room_join(text, text, text, text, text) to service_role;
grant execute on function public.player_recover(text, text, text, text) to service_role;
grant execute on function public.room_command(text, uuid, text, jsonb, integer) to service_role;
