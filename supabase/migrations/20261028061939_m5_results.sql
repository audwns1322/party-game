-- M5: sequential reveal, per-liar guess/appeal, elimination cycles and exactly-once team scores.
alter table app_private.rounds drop constraint rounds_phase_check;
alter table app_private.rounds add constraint rounds_phase_check check(phase in ('COLLECT_WORDS','REVEAL_ROLE','HINT','DISCUSS','VOTE_1','VOTE_RUNOFF','REVEAL_VOTE','REVEAL_LIAR','GUESS','APPEAL_WINDOW','APPEAL_VOTE','FINAL_RESULT','PAUSED_HOST','CANCELLED'));
alter table app_private.round_players add column eliminated_at timestamptz;
alter table app_private.rounds add column vote_cycle integer not null default 1 check(vote_cycle between 1 and 2);
alter table app_private.votes add column cycle_no integer not null default 1 check(cycle_no between 1 and 2);
alter table app_private.votes drop constraint votes_pkey;
alter table app_private.votes add primary key(round_id,cycle_no,ballot_no,voter_id);
create table app_private.guesses(
 id uuid primary key default gen_random_uuid(),round_id uuid not null,player_id uuid not null,
 answer text not null check(char_length(answer) between 1 and 60),provisional_correct boolean not null,decision boolean,resolved_at timestamptz,created_at timestamptz not null default now(),
 unique(round_id,player_id),unique(id,round_id),foreign key(round_id,player_id) references app_private.round_players(round_id,player_id) on delete cascade
);
alter table app_private.rounds add column current_guess_id uuid;
alter table app_private.rounds add constraint rounds_current_guess_fk foreign key(current_guess_id,id) references app_private.guesses(id,round_id) deferrable initially deferred;
create index rounds_current_guess_idx on app_private.rounds(current_guess_id,id);
create table app_private.appeals(
 guess_id uuid primary key,round_id uuid not null,opened_by uuid not null,deadline_at timestamptz not null,created_at timestamptz not null default now(),
 unique(guess_id,round_id),foreign key(guess_id,round_id) references app_private.guesses(id,round_id) on delete cascade,
 foreign key(round_id,opened_by) references app_private.round_players(round_id,player_id) on delete cascade
);
create index appeals_opener_idx on app_private.appeals(round_id,opened_by);
create table app_private.appeal_votes(
 guess_id uuid not null,round_id uuid not null,voter_id uuid not null,accept boolean not null,created_at timestamptz not null default now(),
 primary key(guess_id,voter_id),foreign key(guess_id,round_id) references app_private.appeals(guess_id,round_id) on delete cascade,
 foreign key(round_id,voter_id) references app_private.round_players(round_id,player_id) on delete cascade
);
create index appeal_votes_guess_round_idx on app_private.appeal_votes(guess_id,round_id);
create index appeal_votes_voter_idx on app_private.appeal_votes(round_id,voter_id);
create table app_private.round_results(round_id uuid primary key references app_private.rounds(id) on delete cascade,winner text not null check(winner in ('citizen','liar','DRAW')),reason text not null,created_at timestamptz not null default now());
create table app_private.word_aliases(word text not null,alias text not null,primary key(word,alias));
insert into app_private.word_aliases values('돈가스','돈까스'),('푸시프레스','푸쉬프레스'),('프런트스쿼트','프론트스쿼트'),('프런트스쿼트','프런트 스쿼트'),('토즈투바','토투바'),('토즈투바','토즈 투 바'),('버피','burpee'),('풀업','pull-up'),('풀업','pull up');
alter table app_private.guesses enable row level security;
alter table app_private.appeals enable row level security;
alter table app_private.appeal_votes enable row level security;
alter table app_private.round_results enable row level security;
alter table app_private.word_aliases enable row level security;
revoke all on app_private.guesses,app_private.appeals,app_private.appeal_votes,app_private.round_results,app_private.word_aliases from public,anon,authenticated,service_role;

create function app_private.normalize_answer(p_text text) returns text language sql immutable set search_path='' as $$ select lower(regexp_replace(btrim(normalize(p_text,NFC)),'[[:space:]]+',' ','g')); $$;

create function app_private.finalize_result(p_round uuid,p_winner text,p_reason text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
 if not exists(select 1 from app_private.rounds where id=p_round and (ended_at is null or phase='FINAL_RESULT')) then return false; end if;
 insert into app_private.round_results(round_id,winner,reason) values(p_round,p_winner,p_reason) on conflict(round_id) do nothing;
 if not found then return false; end if;
 if p_winner<>'DRAW' then
  update app_private.players p set wins=wins+1 from app_private.round_players r where r.round_id=p_round and r.player_id=p.id and r.role=p_winner;
 end if;
 update app_private.rounds set phase='FINAL_RESULT',ended_at=coalesce(ended_at,clock_timestamp()),phase_started_at=clock_timestamp(),deadline_at=null where id=p_round;
 update app_private.players set status='active' where room_id=(select room_id from app_private.rounds where id=p_round) and status='waiting_next_round';
 return true;
end; $$;

create function app_private.resolve_guess(p_guess uuid,p_correct boolean) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare v_guess app_private.guesses; v_round app_private.rounds;
begin
 select * into v_guess from app_private.guesses where id=p_guess;
 if not found or v_guess.decision is not null then return false; end if;
 select * into v_round from app_private.rounds where id=v_guess.round_id;
 if v_round.ended_at is not null or v_round.current_guess_id is distinct from p_guess then return false; end if;
 update app_private.guesses set decision=p_correct,resolved_at=clock_timestamp() where id=p_guess and decision is null;
 if not found then return false; end if;
 if p_correct then perform app_private.finalize_result(v_round.id,'liar','CORRECT_GUESS');
 else
  update app_private.round_players set eliminated_at=clock_timestamp() where round_id=v_round.id and player_id=v_guess.player_id and eliminated_at is null;
  if not exists(select 1 from app_private.round_players where round_id=v_round.id and role='liar' and eliminated_at is null) then perform app_private.finalize_result(v_round.id,'citizen','ALL_LIARS_ELIMINATED');
  else
   update app_private.rounds set phase='DISCUSS',phase_started_at=clock_timestamp(),deadline_at=case when (config->>'discussion_seconds')::int=0 then null else clock_timestamp()+make_interval(secs=>(config->>'discussion_seconds')::int) end,
    vote_cycle=vote_cycle+1,vote_tallies='[]',runoff_candidates=null,selected_player_id=null,current_guess_id=null where id=v_round.id;
  end if;
 end if;
 return true;
end; $$;

-- Caller holds the authenticated room lock. One public transition per request.
create function app_private.advance_m5(p_room uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare g app_private.rounds; q app_private.guesses; v_count integer; v_submitted integer; v_yes integer;
begin
 select * into g from app_private.rounds where room_id=p_room and (ended_at is null or phase='FINAL_RESULT') order by (ended_at is null) desc,created_at desc limit 1;
 if not found then return false; end if;
 if g.phase='REVEAL_VOTE' and coalesce(g.deadline_at,g.phase_started_at+interval '3 seconds')<=clock_timestamp() then
  update app_private.rounds set phase='REVEAL_LIAR',phase_started_at=clock_timestamp(),deadline_at=clock_timestamp()+interval '3 seconds',version=version+1 where id=g.id;return true;
 elsif g.phase='REVEAL_LIAR' and g.deadline_at<=clock_timestamp() then
  if (select role from app_private.round_players where round_id=g.id and player_id=g.selected_player_id)='citizen' then perform app_private.finalize_result(g.id,'liar','WRONG_ACCUSATION');
  else update app_private.rounds set phase='GUESS',phase_started_at=clock_timestamp(),deadline_at=null where id=g.id; end if;
  update app_private.rounds set version=version+1 where id=g.id;return true;
 elsif g.phase in ('APPEAL_WINDOW','APPEAL_VOTE') then
  select * into q from app_private.guesses where id=g.current_guess_id;
  if g.phase='APPEAL_WINDOW' then
   if g.deadline_at>clock_timestamp() then return false; end if;
   if app_private.resolve_guess(q.id,q.provisional_correct) then update app_private.rounds set version=version+1 where id=g.id;return true; end if;
  else
   select count(*)::int into v_count from app_private.round_players where round_id=g.id and role='citizen';
   select count(*)::int,count(*) filter(where accept)::int into v_submitted,v_yes from app_private.appeal_votes where guess_id=q.id;
   if v_yes>v_count/2 or v_submitted=v_count or g.deadline_at<=clock_timestamp() then
    if app_private.resolve_guess(q.id,v_yes>v_count/2) then update app_private.rounds set version=version+1 where id=g.id;return true; end if;
   end if;
  end if;
 elsif g.phase='FINAL_RESULT' and g.vote_outcome='DRAW' and not exists(select 1 from app_private.round_results where round_id=g.id) then
  return app_private.finalize_result(g.id,'DRAW','TIED_RUNOFF');
 end if;
 return false;
end; $$;

alter function app_private.advance_discussion(uuid) rename to advance_before_m5;
create function app_private.advance_discussion(p_room uuid) returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 if app_private.advance_before_m5(p_room) then return true; end if;
 if app_private.advance_m5(p_room) then perform app_private.bump(p_room);return true;end if;
 return false;
end; $$;

-- Preserve M4's receipt/authorization logic, restricting each subsequent ballot to survivors and its cycle.
do $m$ declare d text; begin
 d:=pg_get_functiondef('public.game_command(text,uuid,text,jsonb,integer,text,uuid)'::regprocedure);
 execute replace(d,'FUNCTION public.game_command(','FUNCTION app_private.voting_previous_m5(');
 d:=replace(d,'ballot_no=v_ballot','ballot_no=v_ballot and cycle_no=v_round.vote_cycle');
 d:=replace(d,'if p_payload->''ballot_no'' is distinct from to_jsonb(v_ballot) then','if p_payload->''ballot_no'' is distinct from to_jsonb(v_ballot) or coalesce(p_payload->''cycle_no'',''1''::jsonb) is distinct from to_jsonb(v_round.vote_cycle) then');
 d:=replace(d,'where round_id=v_round.id and player_id=v_me)','where round_id=v_round.id and player_id=v_me and eliminated_at is null)');
 d:=replace(d,'where round_id=v_round.id and player_id=v_target)','where round_id=v_round.id and player_id=v_target and eliminated_at is null)');
 d:=replace(d,'from app_private.round_players where round_id=v_round.id)','from app_private.round_players where round_id=v_round.id and eliminated_at is null)');
 d:=replace(d,'where p.round_id=v_round.id and (v_ballot=1','where p.round_id=v_round.id and p.eliminated_at is null and (v_ballot=1');
 d:=replace(d,'where p.round_id=v_round.id and not exists','where p.round_id=v_round.id and p.eliminated_at is null and not exists');
 d:=replace(d,'insert into app_private.votes(round_id,ballot_no,voter_id,target_id) values(v_round.id,v_ballot,v_me,v_target)','insert into app_private.votes(round_id,cycle_no,ballot_no,voter_id,target_id) values(v_round.id,v_round.vote_cycle,v_ballot,v_me,v_target)');
 d:=replace(d,'phase=''REVEAL_VOTE'',selected_player_id=v_candidates[1],phase_started_at=clock_timestamp()','phase=''REVEAL_VOTE'',selected_player_id=v_candidates[1],phase_started_at=clock_timestamp(),deadline_at=clock_timestamp()+interval ''3 seconds''');
 d:=replace(d,'update app_private.rounds set phase=''FINAL_RESULT'',vote_outcome=''DRAW'',ended_at=clock_timestamp(),phase_started_at=clock_timestamp() where id=v_round.id;', 'update app_private.rounds set vote_outcome=''DRAW'' where id=v_round.id; perform app_private.finalize_result(v_round.id,''DRAW'',''TIED_RUNOFF'');');
 execute d;
end; $m$;
alter function public.game_command(text,uuid,text,jsonb,integer,text,uuid) rename to game_command_before_m5;
alter function public.game_command_before_m5(text,uuid,text,jsonb,integer,text,uuid) set schema app_private;
create function public.game_command(p_credential_hash text,p_room uuid,p_action text,p_payload jsonb,p_expected_version integer,p_expected_phase text,p_request_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare r app_private.rooms;g app_private.rounds;v_me uuid;v_role text;v_fingerprint jsonb;receipt app_private.command_receipts;v_result jsonb;v_answer text;v_word text;v_correct boolean;v_guess uuid;v_progress boolean:=false;
begin
 if p_action not in ('submit_guess','open_appeal','submit_appeal_vote','return_lobby') then
  v_result:=app_private.game_command_before_m5(p_credential_hash,p_room,p_action,p_payload,p_expected_version,p_expected_phase,p_request_id);
  if p_action='start_round' and (v_result->>'changed')::boolean then update app_private.rounds set phase='CANCELLED' where room_id=p_room and phase='FINAL_RESULT';end if;
  return v_result;
 end if;
 if not exists(select 1 from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left') then raise exception 'FORBIDDEN' using errcode='P0001';end if;
 select * into r from app_private.rooms where id=p_room for update;
 select id into v_me from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left' for update;
 if not found then raise exception 'FORBIDDEN' using errcode='P0001';end if;
 if r.status<>'open' or r.expires_at<=now() then raise exception 'ROOM_CLOSED' using errcode='P0001';end if;
 if p_request_id is null or p_expected_version is null or p_expected_phase is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'INVALID_REQUEST' using errcode='P0001';end if;
 v_fingerprint:=jsonb_build_object('room',p_room,'action',p_action,'payload',p_payload,'version',p_expected_version,'phase',p_expected_phase);
 select * into receipt from app_private.command_receipts where player_id=v_me and request_id=p_request_id;
 if found then if receipt.fingerprint<>v_fingerprint then raise exception 'REQUEST_CONFLICT' using errcode='P0001';end if;return receipt.response_meta||jsonb_build_object('changed',false);end if;
 if p_expected_version is distinct from r.version then raise exception 'VERSION_CONFLICT' using errcode='P0001';end if;
 select * into g from app_private.rounds where room_id=p_room and (ended_at is null or phase='FINAL_RESULT') order by (ended_at is null) desc,created_at desc limit 1;
 if g.id is null or p_expected_phase is distinct from g.phase or p_payload->>'round_id' is distinct from g.id::text then raise exception 'PHASE_CONFLICT' using errcode='P0001';end if;
 if p_action='return_lobby' then
  if r.host_player_id<>v_me then raise exception 'HOST_ONLY' using errcode='P0001';end if;
  if g.phase<>'FINAL_RESULT' then raise exception 'PHASE_CONFLICT' using errcode='P0001';end if;
  update app_private.rounds set phase='CANCELLED' where id=g.id;
 else
  select role into v_role from app_private.round_players where round_id=g.id and player_id=v_me and eliminated_at is null;
  if not found then raise exception 'NOT_ROUND_PLAYER' using errcode='P0001';end if;
  if p_action='submit_guess' then
   if g.phase<>'GUESS' then raise exception 'PHASE_CONFLICT' using errcode='P0001';end if;
   if v_role<>'liar' or v_me<>g.selected_player_id then raise exception 'NOT_GUESSER' using errcode='P0001';end if;
   if jsonb_typeof(p_payload->'answer') is distinct from 'string' then raise exception 'INVALID_GUESS' using errcode='P0001';end if;
   v_answer:=app_private.normalize_answer(p_payload->>'answer');
   if char_length(v_answer) not between 1 and 60 or v_answer ~ '[[:cntrl:]]' or v_answer ~ U&'[\200B-\200F\202A-\202E\2060-\206F\FEFF]' then raise exception 'INVALID_GUESS' using errcode='P0001';end if;
   select word into v_word from app_private.round_secrets where round_id=g.id;
   v_correct:=v_answer=app_private.normalize_answer(v_word) or exists(select 1 from app_private.word_aliases where word=v_word and app_private.normalize_answer(alias)=v_answer);
   insert into app_private.guesses(round_id,player_id,answer,provisional_correct) values(g.id,v_me,v_answer,v_correct) returning id into v_guess;
   update app_private.rounds set current_guess_id=v_guess,phase='APPEAL_WINDOW',phase_started_at=clock_timestamp(),deadline_at=clock_timestamp()+interval '20 seconds' where id=g.id;
  else
   if v_role<>'citizen' then raise exception 'CITIZEN_ONLY' using errcode='P0001';end if;
   if p_payload->>'guess_id' is distinct from g.current_guess_id::text or g.deadline_at<=clock_timestamp() then raise exception 'PHASE_CONFLICT' using errcode='P0001';end if;
   if p_action='open_appeal' then
    if g.phase<>'APPEAL_WINDOW' then raise exception 'PHASE_CONFLICT' using errcode='P0001';end if;
    insert into app_private.appeals(guess_id,round_id,opened_by,deadline_at) values(g.current_guess_id,g.id,v_me,clock_timestamp()+interval '30 seconds');
    update app_private.rounds set phase='APPEAL_VOTE',phase_started_at=clock_timestamp(),deadline_at=clock_timestamp()+interval '30 seconds' where id=g.id;
   else
    if g.phase<>'APPEAL_VOTE' then raise exception 'PHASE_CONFLICT' using errcode='P0001';end if;
    if jsonb_typeof(p_payload->'accept') is distinct from 'boolean' then raise exception 'INVALID_REQUEST' using errcode='P0001';end if;
    if exists(select 1 from app_private.appeal_votes where guess_id=g.current_guess_id and voter_id=v_me) then raise exception 'ALREADY_APPEAL_VOTED' using errcode='P0001';end if;
    insert into app_private.appeal_votes(guess_id,round_id,voter_id,accept) values(g.current_guess_id,g.id,v_me,(p_payload->>'accept')::boolean);
    v_progress:=app_private.advance_m5(p_room);
   end if;
  end if;
 end if;
 if not v_progress then update app_private.rounds set version=version+1 where id=g.id;end if;
 v_result:=jsonb_build_object('version',app_private.bump(p_room),'changed',true);
 insert into app_private.command_receipts values(p_room,v_me,p_request_id,v_fingerprint,v_result,now());return v_result;
end; $$;

alter function app_private.room_dto(uuid,uuid) rename to room_dto_before_m5;
create function app_private.room_dto(p_room uuid,p_me uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select case when g.id is null then base.value else base.value||jsonb_build_object('round',(base.value->'round')||jsonb_build_object(
  'participant_ids',(select jsonb_agg(player_id order by turn_order) from app_private.round_players where round_id=g.id and eliminated_at is null),
  'eliminated_ids',coalesce((select jsonb_agg(player_id order by turn_order) from app_private.round_players where round_id=g.id and eliminated_at is not null),'[]'::jsonb),
  'deadline_at',g.deadline_at,'phase_started_at',g.phase_started_at,
  'me',case when mine.player_id is null then null else (base.value->'round'->'me')||jsonb_build_object('eliminated',mine.eliminated_at is not null,'voted',exists(select 1 from app_private.votes where round_id=g.id and cycle_no=g.vote_cycle and ballot_no=b.number and voter_id=p_me)) end,
  'vote',(base.value->'round'->'vote')||jsonb_build_object('cycle_no',g.vote_cycle,'submitted_count',(select count(*) from app_private.votes where round_id=g.id and cycle_no=g.vote_cycle and ballot_no=b.number),
   'candidate_ids',case when b.number=2 then to_jsonb(g.runoff_candidates) else (select jsonb_agg(player_id order by turn_order) from app_private.round_players where round_id=g.id and eliminated_at is null) end),
  'm5',jsonb_build_object('selected_player_id',g.selected_player_id,
   'selected_role',case when g.phase in ('REVEAL_LIAR','GUESS','APPEAL_WINDOW','APPEAL_VOTE','FINAL_RESULT') then selected.role else null end,
   'guess_id',q.id,'answer',q.answer,'provisional_correct',q.provisional_correct,'resolved_correct',q.decision,
   'citizen_count',(select count(*) from app_private.round_players where round_id=g.id and role='citizen'),
   'appeal_submitted_count',(select count(*) from app_private.appeal_votes where guess_id=q.id),
   'my_appeal_voted',exists(select 1 from app_private.appeal_votes where guess_id=q.id and voter_id=p_me),
   'winner',case when g.phase='FINAL_RESULT' then result.winner else null end,'reason',case when g.phase='FINAL_RESULT' then result.reason else null end,
   'correct_word',case when g.phase='FINAL_RESULT' then secret.word else null end,
   'liar_ids',case when g.phase='FINAL_RESULT' then (select jsonb_agg(player_id order by turn_order) from app_private.round_players where round_id=g.id and role='liar') else null end
  ))) end
 from (select app_private.room_dto_before_m5(p_room,p_me) value) base
 left join lateral(select * from app_private.rounds where room_id=p_room and (ended_at is null or phase='FINAL_RESULT') order by (ended_at is null) desc,created_at desc limit 1) g on true
 left join app_private.round_players mine on mine.round_id=g.id and mine.player_id=p_me
 left join app_private.round_players selected on selected.round_id=g.id and selected.player_id=g.selected_player_id
 left join app_private.guesses q on q.id=g.current_guess_id
 left join app_private.round_results result on result.round_id=g.id
 left join app_private.round_secrets secret on secret.round_id=g.id
 cross join lateral(select case when g.phase='VOTE_RUNOFF' or jsonb_array_length(g.vote_tallies)=2 then 2 else 1 end number) b;
$$;
revoke all on all functions in schema app_private from public,anon,authenticated,service_role;
revoke all on function public.game_command(text,uuid,text,jsonb,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.game_command(text,uuid,text,jsonb,integer,text,uuid) to service_role;
