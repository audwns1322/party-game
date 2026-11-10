-- QOR-1: server-authoritative multiplayer state, attached to existing secure rooms.
alter table app_private.rooms drop constraint if exists rooms_game_type_check;
alter table app_private.rooms add constraint rooms_game_type_check check (game_type in ('liar','mafia','quoridor'));

create table app_private.quoridor_matches (
 room_id uuid primary key references app_private.rooms(id) on delete cascade,
 state jsonb not null default '{"status":"lobby","playerCount":2,"turnLimit":0,"undoEnabled":false,"scores":{}}'::jsonb,
 version integer not null default 1 check (version>0),
 updated_at timestamptz not null default now()
);
alter table app_private.quoridor_matches enable row level security;
revoke all on app_private.quoridor_matches from public,anon,authenticated;

-- Preserve the old implementation for liar/mafia; only permit the new game type here.
create or replace function public.room_create(p_nickname text,p_nickname_key text,p_credential_hash text,p_recovery_hash text,p_game_type text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_result jsonb;
begin
 if p_game_type not in ('liar','mafia','quoridor') or p_game_type is null then
  raise exception 'INVALID_REQUEST' using errcode='P0001';
 end if;
 v_result:=public.room_create(p_nickname,p_nickname_key,p_credential_hash,p_recovery_hash);
 update app_private.rooms set game_type=p_game_type,
  settings=case when p_game_type='mafia' then settings||'{"mafia_roles":{"mafia":1,"spy":0,"citizen":2,"police":1,"doctor":0,"journalist":0,"traitor":0}}'::jsonb else settings end
 where id=(v_result->>'room_id')::uuid;
 if p_game_type='quoridor' then
  insert into app_private.quoridor_matches(room_id) values ((v_result->>'room_id')::uuid);
 end if;
 return v_result;
end; $$;

alter function public.room_join(text,text,text,text,text) rename to room_join_pre_quoridor;
alter function public.room_join_pre_quoridor(text,text,text,text,text) set schema app_private;
create function public.room_join(p_code text,p_nickname text,p_nickname_key text,p_credential_hash text,p_recovery_hash text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_room app_private.rooms; v_match app_private.quoridor_matches;
begin
 select * into v_room from app_private.rooms where code=p_code and status='open' for update;
 if found and v_room.game_type='quoridor' then
  select * into v_match from app_private.quoridor_matches where room_id=v_room.id;
  if (v_match.state->>'status')='playing' then raise exception 'ROOM_LOCKED' using errcode='P0001';end if;
  if (select count(*) from app_private.players where room_id=v_room.id and status<>'left')>=4 then
   raise exception 'ROOM_FULL' using errcode='P0001';
  end if;
 end if;
 return app_private.room_join_pre_quoridor(p_code,p_nickname,p_nickname_key,p_credential_hash,p_recovery_hash);
end; $$;

create function public.quoridor_get(p_credential_hash text,p_room uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_player uuid; v_match app_private.quoridor_matches; v_room app_private.rooms;
begin
 select id into v_player from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left';
 if v_player is null then raise exception 'FORBIDDEN' using errcode='P0001';end if;
 select * into v_room from app_private.rooms where id=p_room and status='open' and expires_at>now();
 if not found then raise exception 'ROOM_CLOSED' using errcode='P0001';end if;
 if v_room.game_type<>'quoridor' then raise exception 'UNKNOWN_ACTION' using errcode='P0001';end if;
 select * into v_match from app_private.quoridor_matches where room_id=p_room;
 return jsonb_build_object('version',v_match.version,'room_version',v_room.version,'state',v_match.state,
  'me',v_player,'host',v_room.host_player_id,
  'players',coalesce((select jsonb_agg(jsonb_build_object('id',id,'nickname',nickname,'wins',wins) order by join_order)
    from app_private.players where room_id=p_room and status<>'left'),'[]'::jsonb),'server_now',now());
end; $$;

-- Commit only from the server-held service key; optimistic locking makes every turn atomic.
create function public.quoridor_commit(p_credential_hash text,p_room uuid,p_expected_version integer,p_state jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_room app_private.rooms; v_match app_private.quoridor_matches; v_me uuid; v_version integer;
begin
 select * into v_room from app_private.rooms where id=p_room for update;
 if not found or v_room.status<>'open' or v_room.expires_at<=now() then raise exception 'ROOM_CLOSED' using errcode='P0001';end if;
 if v_room.game_type<>'quoridor' then raise exception 'UNKNOWN_ACTION' using errcode='P0001';end if;
 select id into v_me from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left';
 if v_me is null then raise exception 'FORBIDDEN' using errcode='P0001';end if;
 select * into v_match from app_private.quoridor_matches where room_id=p_room for update;
 if v_match.version<>p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='P0001';end if;
 if jsonb_typeof(p_state) <> 'object' or length(p_state::text)>20000 then raise exception 'INVALID_REQUEST' using errcode='P0001';end if;
 update app_private.quoridor_matches set state=p_state,version=version+1,updated_at=now() where room_id=p_room returning version into v_version;
 perform app_private.touch_room(p_room);
 return jsonb_build_object('version',v_version,'room_version',app_private.bump(p_room));
end; $$;

revoke all on function public.room_create(text,text,text,text,text),public.room_join(text,text,text,text,text),
 public.quoridor_get(text,uuid),public.quoridor_commit(text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.room_create(text,text,text,text,text),public.room_join(text,text,text,text,text),
 public.quoridor_get(text,uuid),public.quoridor_commit(text,uuid,integer,jsonb) to service_role;
revoke all on function app_private.room_join_pre_quoridor(text,text,text,text,text) from public,anon,authenticated,service_role;
