-- Apply only after recovering the missing MAF-1..3 migrations; never replay MAF-3.
-- Replaces one existing function; no table data or RPC permissions change.
do $preflight$
begin
  if to_regclass('app_private.mafia_night_actions') is null
     or to_regclass('app_private.mafia_round_players') is null then
    raise exception 'MAF-3 schema required';
  end if;
  if not exists (
    select 1 from pg_proc
    where oid = to_regprocedure('app_private.room_command(text,uuid,text,jsonb,integer)')
      and md5(prosrc) in ('aa5a1e87c9b7fb25a20e926129d2aa8d', 'e294f66adb900542b436c003213a7128')
  ) then raise exception 'room_command changed: review before applying'; end if;
end;
$preflight$;

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

  -- The room lock above serializes this check with mafia start and night resolution.
  if p_action = 'leave' and exists (
    select 1 from app_private.mafia_rounds active_mafia
    join app_private.mafia_round_players mp on mp.round_id = active_mafia.id
    where active_mafia.room_id = p_room and active_mafia.ended_at is null
      and active_mafia.phase not in ('FINAL_RESULT', 'CANCELLED')
      and mp.player_id = v_me and mp.eliminated_at is null
  ) then raise exception 'ROUND_ACTIVE' using errcode = 'P0001'; end if;

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
$function$
