-- MAF-3: first night, private actions and server resolution. Day voting follows in MAF-4.
alter table app_private.mafia_rounds drop constraint mafia_rounds_phase_check;
alter table app_private.mafia_rounds add constraint mafia_rounds_phase_check
 check(phase in ('REVEAL_ROLE','INTRO','NIGHT','DAY_DISCUSS','FINAL_RESULT','CANCELLED'));
alter table app_private.mafia_rounds add column night_no integer not null default 0 check(night_no>=0);
alter table app_private.mafia_rounds add column night_result jsonb;
alter table app_private.mafia_rounds add column winner text check(winner in ('mafia','citizen'));
alter table app_private.mafia_round_players add column eliminated_at timestamptz;
alter table app_private.mafia_round_players add column original_role text;
alter table app_private.mafia_round_players add column mission_target_id uuid references app_private.players(id);
update app_private.mafia_round_players set original_role=role;
alter table app_private.mafia_round_players alter column original_role set not null;
create function app_private.mafia_set_original_role() returns trigger language plpgsql set search_path='' as $$
begin
 new.original_role:=new.role;
 return new;
end; $$;
create trigger mafia_original_role_insert before insert on app_private.mafia_round_players
 for each row execute function app_private.mafia_set_original_role();
create table app_private.mafia_night_actions(
 round_id uuid not null references app_private.mafia_rounds(id) on delete cascade,
 night_no integer not null check(night_no>0),
 actor_id uuid not null references app_private.players(id) on delete cascade,
 kind text not null check(kind in ('mafia','police','doctor','spy','journalist')),
 target_id uuid references app_private.players(id),
 primary key(round_id,night_no,actor_id)
);
alter table app_private.mafia_night_actions enable row level security;
revoke all on app_private.mafia_night_actions from public,anon,authenticated;

alter function public.room_command(text,uuid,text,jsonb,integer) rename to room_command_before_mafia_night;
alter function public.room_command_before_mafia_night(text,uuid,text,jsonb,integer) set schema app_private;
create function public.room_command(p_credential_hash text,p_room uuid,p_action text,p_payload jsonb,p_expected_version integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
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
end; $$;

alter function app_private.room_dto(uuid,uuid) rename to room_dto_before_mafia_night;
create function app_private.room_dto(p_room uuid,p_me uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select case when g.id is null then base.value else jsonb_set(base.value,'{mafia}',
  (base.value->'mafia')||jsonb_build_object(
   'phase',g.phase,'night_no',g.night_no,'night_result',case when g.phase in ('DAY_DISCUSS','FINAL_RESULT') then g.night_result else null end,
   'winner',g.winner,
   'alive_ids',coalesce((select jsonb_agg(p.player_id) from app_private.mafia_round_players p where p.round_id=g.id and p.eliminated_at is null),'[]'::jsonb),
   'night_submitted_count',(select count(*) from app_private.mafia_night_actions a where a.round_id=g.id and a.night_no=g.night_no),
   'night_expected_count',(select count(*) from app_private.mafia_round_players p where p.round_id=g.id and p.eliminated_at is null and p.role in ('mafia','police','doctor','spy','journalist')),
   'me',case when p.player_id is null then 'null'::jsonb else (base.value->'mafia'->'me')||jsonb_build_object(
    'role',p.role,'original_role',p.original_role,'alive',p.eliminated_at is null,
    'mission_target_id',case when p.original_role='traitor' then p.mission_target_id else null end,
    'teammate_ids',case when p.role in ('mafia','spy') then coalesce((select jsonb_agg(t.player_id) from app_private.mafia_round_players t where t.round_id=g.id and t.role='mafia' and t.player_id<>p_me and t.eliminated_at is null),'[]'::jsonb) else '[]'::jsonb end,
    'night_submitted',exists(select 1 from app_private.mafia_night_actions a where a.round_id=g.id and a.night_no=g.night_no and a.actor_id=p_me),
    'investigation',case when g.phase in ('DAY_DISCUSS','FINAL_RESULT') and p.role in ('police','spy') then
     (select jsonb_build_object('target_id',a.target_id,'result',case when p.role='police' then case when t.role='mafia' then 'mafia' else 'not_mafia' end else t.role end)
      from app_private.mafia_night_actions a join app_private.mafia_round_players t on t.round_id=a.round_id and t.player_id=a.target_id
      where a.round_id=g.id and a.night_no=g.night_no and a.actor_id=p_me) else null end
   ) end)) end
 from (select app_private.room_dto_before_mafia_night(p_room,p_me) value) base
 left join app_private.mafia_rounds g on g.room_id=p_room and g.ended_at is null
 left join app_private.mafia_round_players p on p.round_id=g.id and p.player_id=p_me;
$$;

revoke all on function public.room_command(text,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.room_command(text,uuid,text,jsonb,integer) to service_role;
revoke all on function app_private.room_command_before_mafia_night(text,uuid,text,jsonb,integer),
 app_private.room_dto(uuid,uuid),app_private.room_dto_before_mafia_night(uuid,uuid),app_private.mafia_set_original_role()
 from public,anon,authenticated,service_role;
