-- M4: private immutable ballots, atomic tally and one runoff.
alter table app_private.rounds drop constraint rounds_phase_check;
alter table app_private.rounds add constraint rounds_phase_check check(phase in ('COLLECT_WORDS','REVEAL_ROLE','HINT','DISCUSS','VOTE_1','VOTE_RUNOFF','REVEAL_VOTE','FINAL_RESULT','PAUSED_HOST','CANCELLED'));
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='app_private.rounds'::regclass and contype='c' and pg_get_constraintdef(oid) like '%ended_at%' loop
    execute format('alter table app_private.rounds drop constraint %I',c.conname);
  end loop;
end $$;
alter table app_private.rounds add constraint rounds_ended_phase_check check((phase in ('CANCELLED','FINAL_RESULT'))=(ended_at is not null));
alter table app_private.rounds add column runoff_candidates uuid[];
alter table app_private.rounds add column vote_tallies jsonb not null default '[]';
alter table app_private.rounds add column selected_player_id uuid;
alter table app_private.rounds add column vote_outcome text check(vote_outcome='DRAW');
alter table app_private.rounds add constraint rounds_selected_player_fk foreign key(id,selected_player_id) references app_private.round_players(round_id,player_id) deferrable initially deferred;
create index rounds_selected_player_idx on app_private.rounds(id,selected_player_id);
create table app_private.votes (
  round_id uuid not null,
  ballot_no smallint not null check(ballot_no in (1,2)),
  voter_id uuid not null,
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(round_id,ballot_no,voter_id),
  check(voter_id<>target_id),
  foreign key(round_id,voter_id) references app_private.round_players(round_id,player_id) on delete cascade,
  foreign key(round_id,target_id) references app_private.round_players(round_id,player_id) on delete cascade
);
create index votes_voter_idx on app_private.votes(round_id,voter_id);
create index votes_target_idx on app_private.votes(round_id,target_id);
alter table app_private.votes enable row level security;
revoke all on app_private.votes from public,anon,authenticated,service_role;

alter function public.game_command(text,uuid,text,jsonb,integer,text,uuid) rename to game_command_before_m4;
alter function public.game_command_before_m4(text,uuid,text,jsonb,integer,text,uuid) set schema app_private;
create function public.game_command(p_credential_hash text,p_room uuid,p_action text,p_payload jsonb,
  p_expected_version integer,p_expected_phase text,p_request_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare
  v_room app_private.rooms; v_round app_private.rounds; v_me uuid; v_target uuid; v_ballot integer;
  v_fingerprint jsonb; v_receipt app_private.command_receipts; v_result jsonb;
  v_counts jsonb; v_candidates uuid[]; v_max integer; v_draw boolean:=false;
begin
  if p_action not in ('submit_vote','return_lobby') then
    return app_private.game_command_before_m4(p_credential_hash,p_room,p_action,p_payload,p_expected_version,p_expected_phase,p_request_id);
  end if;
  if not exists(select 1 from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left') then raise exception 'FORBIDDEN' using errcode='P0001'; end if;
  select * into v_room from app_private.rooms where id=p_room for update;
  select id into v_me from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left' for update;
  if not found then raise exception 'FORBIDDEN' using errcode='P0001'; end if;
  if v_room.status<>'open' or v_room.expires_at<=now() then raise exception 'ROOM_CLOSED' using errcode='P0001'; end if;
  if p_request_id is null or p_expected_version is null or p_expected_phase is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'INVALID_REQUEST' using errcode='P0001'; end if;
  v_fingerprint:=jsonb_build_object('room',p_room,'action',p_action,'payload',p_payload,'version',p_expected_version,'phase',p_expected_phase);
  select * into v_receipt from app_private.command_receipts where player_id=v_me and request_id=p_request_id;
  if found then
    if v_receipt.fingerprint<>v_fingerprint then raise exception 'REQUEST_CONFLICT' using errcode='P0001'; end if;
    return v_receipt.response_meta || jsonb_build_object('changed',false);
  end if;
  if p_expected_version is distinct from v_room.version then raise exception 'VERSION_CONFLICT' using errcode='P0001'; end if;
  select * into v_round from app_private.rounds where room_id=p_room and (ended_at is null or phase='FINAL_RESULT') order by (ended_at is null) desc,created_at desc limit 1;
  if v_round.id is null or p_expected_phase is distinct from v_round.phase or p_payload->>'round_id' is distinct from v_round.id::text then raise exception 'PHASE_CONFLICT' using errcode='P0001'; end if;
  if p_action='return_lobby' then
    if v_room.host_player_id<>v_me then raise exception 'HOST_ONLY' using errcode='P0001'; end if;
    if v_round.phase<>'FINAL_RESULT' or v_round.vote_outcome is distinct from 'DRAW' then raise exception 'PHASE_CONFLICT' using errcode='P0001'; end if;
    update app_private.rounds set phase='CANCELLED',version=version+1 where id=v_round.id;
  else
    if not exists(select 1 from app_private.round_players where round_id=v_round.id and player_id=v_me) then raise exception 'NOT_ROUND_PLAYER' using errcode='P0001'; end if;
    if v_round.phase not in ('VOTE_1','VOTE_RUNOFF') then raise exception 'PHASE_CONFLICT' using errcode='P0001'; end if;
    v_ballot:=case when v_round.phase='VOTE_1' then 1 else 2 end;
    if p_payload->'ballot_no' is distinct from to_jsonb(v_ballot) then raise exception 'PHASE_CONFLICT' using errcode='P0001'; end if;
    if jsonb_typeof(p_payload->'target_id') is distinct from 'string' or coalesce(p_payload->>'target_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID_TARGET' using errcode='P0001'; end if;
    v_target:=(p_payload->>'target_id')::uuid;
    if v_target=v_me or not exists(select 1 from app_private.round_players where round_id=v_round.id and player_id=v_target)
      or (v_ballot=2 and not(v_target=any(coalesce(v_round.runoff_candidates,'{}'::uuid[])))) then raise exception 'INVALID_TARGET' using errcode='P0001'; end if;
    if exists(select 1 from app_private.votes where round_id=v_round.id and ballot_no=v_ballot and voter_id=v_me) then raise exception 'ALREADY_VOTED' using errcode='P0001'; end if;
    insert into app_private.votes(round_id,ballot_no,voter_id,target_id) values(v_round.id,v_ballot,v_me,v_target);
    if (select count(*) from app_private.votes where round_id=v_round.id and ballot_no=v_ballot)=(select count(*) from app_private.round_players where round_id=v_round.id) then
      select jsonb_agg(jsonb_build_object('player_id',p.player_id,'votes',coalesce(t.n,0)) order by p.turn_order) into v_counts
        from app_private.round_players p left join (select target_id,count(*)::int n from app_private.votes where round_id=v_round.id and ballot_no=v_ballot group by target_id) t on t.target_id=p.player_id
        where p.round_id=v_round.id and (v_ballot=1 or p.player_id=any(v_round.runoff_candidates));
      select max((value->>'votes')::int) into v_max from jsonb_array_elements(v_counts);
      select array_agg((value->>'player_id')::uuid order by value->>'player_id') into v_candidates from jsonb_array_elements(v_counts) where (value->>'votes')::int=v_max;
      update app_private.rounds set vote_tallies=vote_tallies || jsonb_build_array(jsonb_build_object('ballot_no',v_ballot,'counts',v_counts)) where id=v_round.id;
      if cardinality(v_candidates)=1 then
        update app_private.rounds set phase='REVEAL_VOTE',selected_player_id=v_candidates[1],phase_started_at=clock_timestamp() where id=v_round.id;
      elsif v_ballot=1 then
        -- Defensive guard for a candidate set that leaves any voter without a legal target.
        v_draw:=exists(select 1 from app_private.round_players p where p.round_id=v_round.id and not exists(select 1 from unnest(v_candidates) c where c<>p.player_id));
        if not v_draw then update app_private.rounds set phase='VOTE_RUNOFF',runoff_candidates=v_candidates,phase_started_at=clock_timestamp() where id=v_round.id; end if;
      else v_draw:=true;
      end if;
      if v_draw then
        update app_private.rounds set phase='FINAL_RESULT',vote_outcome='DRAW',ended_at=clock_timestamp(),phase_started_at=clock_timestamp() where id=v_round.id;
        update app_private.players set status='active' where room_id=p_room and status='waiting_next_round';
      end if;
    end if;
    update app_private.rounds set version=version+1 where id=v_round.id;
  end if;
  v_result:=jsonb_build_object('version',app_private.bump(p_room),'changed',true);
  insert into app_private.command_receipts values(p_room,v_me,p_request_id,v_fingerprint,v_result,now());
  return v_result;
end;
$$;

alter function app_private.room_dto(uuid,uuid) rename to room_dto_before_m4;
create function app_private.room_dto(p_room uuid,p_me uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select base.value || jsonb_build_object('round',case when g.id is null then null else jsonb_build_object(
    'id',g.id,'phase',g.phase,'version',g.version,
    'participant_ids',(select jsonb_agg(player_id order by turn_order) from app_private.round_players where round_id=g.id),
    'submitted_count',(select count(*) from app_private.word_candidates where round_id=g.id),
    'acknowledged_count',(select count(*) from app_private.round_players where round_id=g.id and acknowledged_at is not null),
    'theme',case when g.config->>'word_mode'='custom' then coalesce(nullif(g.config->>'custom_theme',''),'직접 입력') else secret.category end,
    'game_mode',coalesce(g.config->>'game_mode','classic'),'difficulty',coalesce(g.config->>'difficulty','easy'),
    'hint_index',g.hint_index,'hint_rounds',(g.config->>'hint_rounds')::int,
    'hint_round',least((g.config->>'hint_rounds')::int,g.hint_index/(select count(*)::int from app_private.round_players where round_id=g.id)+1),
    'current_player_id',case when g.phase='HINT' or g.paused_phase='HINT' then (select player_id from app_private.round_players where round_id=g.id and turn_order=g.hint_index%(select count(*)::int from app_private.round_players where round_id=g.id)+1) else null end,
    'deadline_at',g.deadline_at,'remaining_ms',g.remaining_ms,'paused_phase',g.paused_phase,'phase_started_at',g.phase_started_at,
    'me',case when mine.player_id is null then null else jsonb_build_object(
      'submitted',exists(select 1 from app_private.word_candidates where round_id=g.id and player_id=p_me),
      'acknowledged',mine.acknowledged_at is not null,
      'role',case when g.phase<>'COLLECT_WORDS' then mine.role else null end,
      'word',case when g.phase='COLLECT_WORDS' then null when mine.role='citizen' then secret.word else secret.liar_word end,
      'voted',exists(select 1 from app_private.votes where round_id=g.id and ballot_no=b.number and voter_id=p_me)) end,
    'vote',jsonb_build_object('ballot_no',b.number,
      'candidate_ids',case when b.number=2 then to_jsonb(g.runoff_candidates) else (select jsonb_agg(player_id order by turn_order) from app_private.round_players where round_id=g.id) end,
      'submitted_count',(select count(*) from app_private.votes where round_id=g.id and ballot_no=b.number),
      'tallies',g.vote_tallies,'selected_player_id',g.selected_player_id,'outcome',g.vote_outcome)
    ) end)
  from (select app_private.room_dto_before_m4(p_room,p_me) value) base
  left join lateral(select * from app_private.rounds where room_id=p_room and (ended_at is null or phase='FINAL_RESULT') order by (ended_at is null) desc,created_at desc limit 1) g on true
  left join app_private.round_players mine on mine.round_id=g.id and mine.player_id=p_me
  left join app_private.round_secrets secret on secret.round_id=g.id
  cross join lateral(select case when g.phase='VOTE_RUNOFF' or jsonb_array_length(g.vote_tallies)=2 then 2 else 1 end number) b;
$$;
revoke all on all functions in schema app_private from public,anon,authenticated,service_role;
revoke all on function public.game_command(text,uuid,text,jsonb,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.game_command(text,uuid,text,jsonb,integer,text,uuid) to service_role;
