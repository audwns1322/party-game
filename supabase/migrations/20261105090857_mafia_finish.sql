-- MAF-5: journalist once per game, final profession reveal, and return to lobby.
create function app_private.mafia_journalist_once() returns trigger language plpgsql set search_path='' as $$
begin
 if new.kind='journalist' and new.target_id is not null and exists (
  select 1 from app_private.mafia_night_actions a
  where a.round_id=new.round_id and a.actor_id=new.actor_id and a.kind='journalist'
    and a.target_id is not null and a.night_no<new.night_no
 ) then raise exception 'JOURNALIST_USED' using errcode='P0001';end if;
 return new;
end; $$;
create trigger mafia_journalist_limit before insert on app_private.mafia_night_actions
 for each row execute function app_private.mafia_journalist_once();

alter function public.room_command(text,uuid,text,jsonb,integer) rename to room_command_before_mafia_finish;
alter function public.room_command_before_mafia_finish(text,uuid,text,jsonb,integer) set schema app_private;
create function public.room_command(p_credential_hash text,p_room uuid,p_action text,p_payload jsonb,p_expected_version integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r app_private.rooms;g app_private.mafia_rounds;v_me uuid;
begin
 if p_action<>'mafia_finish' then
  return app_private.room_command_before_mafia_finish(p_credential_hash,p_room,p_action,p_payload,p_expected_version);
 end if;
 select * into r from app_private.rooms where id=p_room for update;
 select id into v_me from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left';
 if v_me is null then raise exception 'FORBIDDEN' using errcode='P0001';end if;
 if r.status<>'open' or r.expires_at<=now() then raise exception 'ROOM_CLOSED' using errcode='P0001';end if;
 if r.game_type<>'mafia' then raise exception 'UNKNOWN_ACTION' using errcode='P0001';end if;
 if r.host_player_id<>v_me then raise exception 'HOST_ONLY' using errcode='P0001';end if;
 if p_expected_version is distinct from r.version then raise exception 'VERSION_CONFLICT' using errcode='P0001';end if;
 if p_payload<>'{}'::jsonb then raise exception 'INVALID_REQUEST' using errcode='P0001';end if;
 select * into g from app_private.mafia_rounds where room_id=p_room and ended_at is null;
 if g.id is null or g.phase<>'FINAL_RESULT' then raise exception 'PHASE_CONFLICT' using errcode='P0001';end if;
 update app_private.mafia_rounds set ended_at=now() where id=g.id;
 update app_private.rooms set locked=false where id=p_room;
 perform app_private.touch_room(p_room);
 return jsonb_build_object('version',app_private.bump(p_room),'changed',true);
end; $$;

alter function app_private.room_dto(uuid,uuid) rename to room_dto_before_mafia_finish;
create function app_private.room_dto(p_room uuid,p_me uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select case when g.id is null then base.value else jsonb_set(base.value,'{mafia}',(base.value->'mafia')||jsonb_build_object(
  'final_roles',case when g.phase='FINAL_RESULT' then coalesce((select jsonb_agg(jsonb_build_object(
   'player_id',p.player_id,'role',p.role,'original_role',p.original_role) order by pl.join_order)
   from app_private.mafia_round_players p join app_private.players pl on pl.id=p.player_id where p.round_id=g.id),'[]'::jsonb) else null end,
  'me',case when base.value->'mafia'->'me'='null'::jsonb then 'null'::jsonb else
   (base.value->'mafia'->'me')||jsonb_build_object('journalist_used',exists(
    select 1 from app_private.mafia_night_actions a where a.round_id=g.id and a.actor_id=p_me
     and a.kind='journalist' and a.target_id is not null)) end
 )) end
 from (select app_private.room_dto_before_mafia_finish(p_room,p_me) value) base
 left join app_private.mafia_rounds g on g.room_id=p_room and g.ended_at is null;
$$;
revoke all on function public.room_command(text,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.room_command(text,uuid,text,jsonb,integer) to service_role;
revoke all on function app_private.room_command_before_mafia_finish(text,uuid,text,jsonb,integer),
 app_private.room_dto(uuid,uuid),app_private.room_dto_before_mafia_finish(uuid,uuid),
 app_private.mafia_journalist_once() from public,anon,authenticated,service_role;
