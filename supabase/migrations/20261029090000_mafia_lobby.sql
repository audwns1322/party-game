-- MAF-1: room type and host-controlled mafia roster; no mafia rounds yet.
alter table app_private.rooms add column game_type text not null default 'liar'
  check (game_type in ('liar','mafia'));

create function public.room_create(p_nickname text,p_nickname_key text,p_credential_hash text,p_recovery_hash text,p_game_type text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_result jsonb;
begin
 if p_game_type not in ('liar','mafia') or p_game_type is null then
  raise exception 'INVALID_REQUEST' using errcode='P0001';
 end if;
 v_result:=public.room_create(p_nickname,p_nickname_key,p_credential_hash,p_recovery_hash);
 update app_private.rooms set game_type=p_game_type,
  settings=case when p_game_type='mafia' then settings||'{"mafia_roles":{"mafia":1,"spy":0,"citizen":2,"police":1,"doctor":0,"journalist":0,"traitor":0}}'::jsonb else settings end
 where id=(v_result->>'room_id')::uuid;
 return v_result;
end; $$;

alter function app_private.room_dto(uuid,uuid) rename to room_dto_before_mafia;
create function app_private.room_dto(p_room uuid,p_me uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select dto.value||jsonb_build_object('room',(dto.value->'room')||jsonb_build_object('game_type',r.game_type))
 from (select app_private.room_dto_before_mafia(p_room,p_me) value) dto
 join app_private.rooms r on r.id=p_room;
$$;

alter function public.room_command(text,uuid,text,jsonb,integer) rename to room_command_before_mafia;
alter function public.room_command_before_mafia(text,uuid,text,jsonb,integer) set schema app_private;
create function public.room_command(p_credential_hash text,p_room uuid,p_action text,p_payload jsonb,p_expected_version integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
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
end; $$;

-- A mafia lobby must never enter the liar-specific state machine.
alter function public.game_command(text,uuid,text,jsonb,integer,text,uuid) rename to game_command_before_mafia;
alter function public.game_command_before_mafia(text,uuid,text,jsonb,integer,text,uuid) set schema app_private;
create function public.game_command(p_credential_hash text,p_room uuid,p_action text,p_payload jsonb,p_expected_version integer,p_expected_phase text,p_request_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 if exists(select 1 from app_private.rooms where id=p_room and game_type='mafia') then
  if not exists(select 1 from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left') then
   raise exception 'FORBIDDEN' using errcode='P0001';
  end if;
  raise exception 'GAME_NOT_READY' using errcode='P0001';
 end if;
 return app_private.game_command_before_mafia(p_credential_hash,p_room,p_action,p_payload,p_expected_version,p_expected_phase,p_request_id);
end; $$;

revoke all on function public.room_create(text,text,text,text,text),public.room_command(text,uuid,text,jsonb,integer),public.game_command(text,uuid,text,jsonb,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.room_create(text,text,text,text,text),public.room_command(text,uuid,text,jsonb,integer),public.game_command(text,uuid,text,jsonb,integer,text,uuid) to service_role;
-- Only functions introduced or moved by MAF-1: do not change unrelated M0-M6 privileges.
revoke all on function app_private.room_dto(uuid,uuid),app_private.room_dto_before_mafia(uuid,uuid),
  app_private.room_command_before_mafia(text,uuid,text,jsonb,integer),
  app_private.game_command_before_mafia(text,uuid,text,jsonb,integer,text,uuid)
  from public,anon,authenticated,service_role;
