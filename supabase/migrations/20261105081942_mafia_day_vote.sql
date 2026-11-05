-- MAF-4: server-authoritative daytime voting, one runoff and the next night.
alter table app_private.mafia_rounds drop constraint mafia_rounds_phase_check;
alter table app_private.mafia_rounds add constraint mafia_rounds_phase_check
 check(phase in ('REVEAL_ROLE','INTRO','NIGHT','DAY_DISCUSS','DAY_VOTE','DAY_RUNOFF','DAY_RESULT','FINAL_RESULT','CANCELLED'));
alter table app_private.mafia_rounds add column day_no integer not null default 0 check(day_no>=0);
alter table app_private.mafia_rounds add column day_result jsonb;
create table app_private.mafia_day_votes(
 round_id uuid not null references app_private.mafia_rounds(id) on delete cascade,
 day_no integer not null check(day_no>0),
 ballot integer not null check(ballot in (1,2)),
 voter_id uuid not null references app_private.players(id) on delete cascade,
 target_id uuid not null references app_private.players(id),
 primary key(round_id,day_no,ballot,voter_id)
);
alter table app_private.mafia_day_votes enable row level security;
revoke all on app_private.mafia_day_votes from public,anon,authenticated;

alter function public.room_command(text,uuid,text,jsonb,integer) rename to room_command_before_mafia_day;
alter function public.room_command_before_mafia_day(text,uuid,text,jsonb,integer) set schema app_private;
create function public.room_command(p_credential_hash text,p_room uuid,p_action text,p_payload jsonb,p_expected_version integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r app_private.rooms;g app_private.mafia_rounds;v_me uuid;v_target uuid;v_ballot integer;
 v_expected integer;v_submitted integer;v_top integer;v_tied uuid[];v_eliminated uuid;v_team text;
 v_mafia integer;v_citizen integer;v_winner text;v_result jsonb;
begin
 if p_action not in ('mafia_day_start_vote','mafia_day_vote','mafia_day_next_night') then
  return app_private.room_command_before_mafia_day(p_credential_hash,p_room,p_action,p_payload,p_expected_version);
 end if;
 select * into r from app_private.rooms where id=p_room for update;
 select id into v_me from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left';
 if v_me is null then raise exception 'FORBIDDEN' using errcode='P0001';end if;
 if r.status<>'open' or r.expires_at<=now() then raise exception 'ROOM_CLOSED' using errcode='P0001';end if;
 if r.game_type<>'mafia' then raise exception 'UNKNOWN_ACTION' using errcode='P0001';end if;
 if p_expected_version is distinct from r.version then raise exception 'VERSION_CONFLICT' using errcode='P0001';end if;
 select * into g from app_private.mafia_rounds where room_id=p_room and ended_at is null;
 if g.id is null then raise exception 'PHASE_CONFLICT' using errcode='P0001';end if;
 if p_action='mafia_day_start_vote' then
  if r.host_player_id<>v_me then raise exception 'HOST_ONLY' using errcode='P0001';end if;
  if g.phase<>'DAY_DISCUSS' or p_payload<>'{}'::jsonb then raise exception 'PHASE_CONFLICT' using errcode='P0001';end if;
  update app_private.mafia_rounds set phase='DAY_VOTE',day_no=day_no+1,day_result=null where id=g.id;
 elsif p_action='mafia_day_next_night' then
  if r.host_player_id<>v_me then raise exception 'HOST_ONLY' using errcode='P0001';end if;
  if g.phase<>'DAY_RESULT' or p_payload<>'{}'::jsonb then raise exception 'PHASE_CONFLICT' using errcode='P0001';end if;
  update app_private.mafia_rounds set phase='NIGHT',night_no=night_no+1,night_result=null where id=g.id;
 else
  if g.phase not in ('DAY_VOTE','DAY_RUNOFF') then raise exception 'PHASE_CONFLICT' using errcode='P0001';end if;
  if not exists(select 1 from app_private.mafia_round_players where round_id=g.id and player_id=v_me and eliminated_at is null) then
   raise exception 'FORBIDDEN' using errcode='P0001';end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_payload))<>1 or
     coalesce(p_payload->>'target_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise exception 'INVALID_TARGET' using errcode='P0001';end if;
  v_target:=(p_payload->>'target_id')::uuid;
  if v_target=v_me or not exists(select 1 from app_private.mafia_round_players where round_id=g.id and player_id=v_target and eliminated_at is null) or
     (g.phase='DAY_RUNOFF' and not (v_target=any(array(select jsonb_array_elements_text(g.day_result->'runoff_ids')::uuid)))) then
   raise exception 'INVALID_TARGET' using errcode='P0001';end if;
  v_ballot:=case when g.phase='DAY_RUNOFF' then 2 else 1 end;
  insert into app_private.mafia_day_votes values(g.id,g.day_no,v_ballot,v_me,v_target) on conflict do nothing;
  if not found then raise exception 'ALREADY_VOTED' using errcode='P0001';end if;
  select count(*) into v_expected from app_private.mafia_round_players where round_id=g.id and eliminated_at is null;
  select count(*) into v_submitted from app_private.mafia_day_votes where round_id=g.id and day_no=g.day_no and ballot=v_ballot;
  if v_expected=v_submitted then
   select max(n) into v_top from (select count(*) n from app_private.mafia_day_votes where round_id=g.id and day_no=g.day_no and ballot=v_ballot group by target_id) counts;
   select array_agg(target_id order by target_id) into v_tied from (
    select target_id from app_private.mafia_day_votes where round_id=g.id and day_no=g.day_no and ballot=v_ballot
    group by target_id having count(*)=v_top) tied;
   if cardinality(v_tied)>1 and v_ballot=1 then
    update app_private.mafia_rounds set phase='DAY_RUNOFF',day_result=jsonb_build_object('runoff_ids',to_jsonb(v_tied)) where id=g.id;
   else
    if cardinality(v_tied)=1 then
     v_eliminated:=v_tied[1];
     select case when role in ('mafia','spy') then 'mafia' else 'citizen' end into v_team
      from app_private.mafia_round_players where round_id=g.id and player_id=v_eliminated;
     update app_private.mafia_round_players set eliminated_at=now() where round_id=g.id and player_id=v_eliminated;
     update app_private.mafia_round_players set role='mafia' where round_id=g.id and original_role='traitor'
      and eliminated_at is null and mission_target_id=v_eliminated;
    end if;
    select count(*) filter(where role in ('mafia','spy')),count(*) filter(where role not in ('mafia','spy'))
     into v_mafia,v_citizen from app_private.mafia_round_players where round_id=g.id and eliminated_at is null;
    v_winner:=case when v_mafia=0 then 'citizen' when v_mafia>=v_citizen then 'mafia' else null end;
    update app_private.mafia_rounds set day_result=jsonb_build_object('eliminated_player_id',v_eliminated,'eliminated_team',v_team,'runoff',v_ballot=2),
     winner=v_winner,phase=case when v_winner is null then 'DAY_RESULT' else 'FINAL_RESULT' end where id=g.id;
   end if;
  end if;
 end if;
 perform app_private.touch_room(p_room);
 return jsonb_build_object('version',app_private.bump(p_room),'changed',true);
end; $$;

alter function app_private.room_dto(uuid,uuid) rename to room_dto_before_mafia_day;
create function app_private.room_dto(p_room uuid,p_me uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select case when g.id is null then base.value else jsonb_set(base.value,'{mafia}',(base.value->'mafia')||jsonb_build_object(
  'phase',g.phase,'day_no',g.day_no,
  'day_result',case when g.phase in ('DAY_RUNOFF','DAY_RESULT','FINAL_RESULT') then g.day_result else null end,
  'vote_submitted_count',case when g.phase in ('DAY_VOTE','DAY_RUNOFF') then
   (select count(*) from app_private.mafia_day_votes v where v.round_id=g.id and v.day_no=g.day_no and v.ballot=case when g.phase='DAY_RUNOFF' then 2 else 1 end) else 0 end,
  'me',case when base.value->'mafia'->'me'='null'::jsonb then 'null'::jsonb else
   (base.value->'mafia'->'me')||jsonb_build_object('day_voted',exists(
    select 1 from app_private.mafia_day_votes v where v.round_id=g.id and v.day_no=g.day_no and v.voter_id=p_me and v.ballot=case when g.phase='DAY_RUNOFF' then 2 else 1 end)) end
 )) end
 from (select app_private.room_dto_before_mafia_day(p_room,p_me) value) base
 left join app_private.mafia_rounds g on g.room_id=p_room and g.ended_at is null;
$$;
revoke all on function public.room_command(text,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.room_command(text,uuid,text,jsonb,integer) to service_role;
revoke all on function app_private.room_command_before_mafia_day(text,uuid,text,jsonb,integer),
 app_private.room_dto(uuid,uuid),app_private.room_dto_before_mafia_day(uuid,uuid) from public,anon,authenticated,service_role;
