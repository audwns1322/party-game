-- M2: private round state, owner-only secrets and transactional idempotent commands.
create table app_private.rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references app_private.rooms(id) on delete cascade,
  phase text not null check (phase in ('COLLECT_WORDS','REVEAL_ROLE','HINT','CANCELLED')),
  version integer not null default 1 check (version > 0),
  config jsonb not null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  unique(id, room_id),
  check ((phase = 'CANCELLED') = (ended_at is not null))
);
create unique index rounds_one_active on app_private.rounds(room_id) where ended_at is null;
create table app_private.round_players (
  round_id uuid not null,
  room_id uuid not null,
  player_id uuid not null,
  role text not null check (role in ('citizen','liar')),
  turn_order integer not null check (turn_order between 1 and 12),
  acknowledged_at timestamptz,
  primary key(round_id, player_id),
  unique(round_id, turn_order),
  foreign key(round_id,room_id) references app_private.rounds(id,room_id) on delete cascade,
  foreign key(player_id,room_id) references app_private.players(id,room_id) on delete cascade
);
create unique index round_players_one_liar on app_private.round_players(round_id) where role='liar';
create table app_private.round_secrets (
  round_id uuid primary key references app_private.rounds(id) on delete cascade,
  word text not null check (char_length(word) between 2 and 30),
  category text not null
);
create table app_private.word_candidates (
  round_id uuid not null,
  player_id uuid not null,
  word text not null check (char_length(word) between 2 and 30),
  primary key(round_id,player_id),
  foreign key(round_id,player_id) references app_private.round_players(round_id,player_id) on delete cascade
);
create table app_private.command_receipts (
  room_id uuid not null references app_private.rooms(id) on delete cascade,
  player_id uuid not null,
  request_id uuid not null,
  fingerprint jsonb not null,
  response_meta jsonb not null,
  created_at timestamptz not null default now(),
  primary key(player_id,request_id),
  foreign key(player_id,room_id) references app_private.players(id,room_id) on delete cascade
);
create index command_receipts_room on app_private.command_receipts(room_id);
create table app_private.builtin_words (
  category text not null,
  word text not null check (char_length(word) between 2 and 30),
  primary key(category,word)
);

-- Also enforces the lower bound: the partial unique index alone only ensures at most one liar.
create function app_private.check_round_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_round uuid := coalesce(new.round_id,old.round_id); v_count integer; v_liars integer;
begin
  if exists(select 1 from app_private.rounds where id=v_round and ended_at is null) then
    select count(*), count(*) filter(where role='liar') into v_count,v_liars
      from app_private.round_players where round_id=v_round;
    if v_count not between 3 and 12 or v_liars<>1 then raise exception 'INVALID_ASSIGNMENT'; end if;
  end if;
  return null;
end;
$$;
create constraint trigger round_assignment_check after insert or update or delete on app_private.round_players
  deferrable initially deferred for each row execute function app_private.check_round_assignment();

-- Preserve M1 room DTO; attach only the current caller's round fields.
alter function app_private.room_dto(uuid,uuid) rename to lobby_dto;
create function app_private.room_dto(p_room uuid,p_me uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select app_private.lobby_dto(p_room,p_me) || jsonb_build_object('round',(
    select jsonb_build_object('id',g.id,'phase',g.phase,'version',g.version,
      'participant_ids',(select jsonb_agg(p.player_id order by p.turn_order) from app_private.round_players p where p.round_id=g.id),
      'submitted_count',(select count(*) from app_private.word_candidates w where w.round_id=g.id),
      'acknowledged_count',(select count(*) from app_private.round_players p where p.round_id=g.id and p.acknowledged_at is not null),
      'me',case when mine.player_id is null then null else jsonb_build_object(
        'submitted',exists(select 1 from app_private.word_candidates w where w.round_id=g.id and w.player_id=p_me),
        'acknowledged',mine.acknowledged_at is not null,
        'role',case when g.phase in ('REVEAL_ROLE','HINT') then mine.role else null end,
        'word',case when g.phase in ('REVEAL_ROLE','HINT') and mine.role='citizen' then secret.word else null end
      ) end)
    from app_private.rounds g
    left join app_private.round_players mine on mine.round_id=g.id and mine.player_id=p_me
    left join app_private.round_secrets secret on secret.round_id=g.id
    where g.room_id=p_room and g.ended_at is null
  ));
$$;

-- Keep M1 limits/moderation; joiners during a round never enter its frozen participant list.
alter function public.room_join(text,text,text,text,text) set schema app_private;
create function public.room_join(p_code text,p_nickname text,p_nickname_key text,p_credential_hash text,p_recovery_hash text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_result jsonb;
begin
  v_result:=app_private.room_join(p_code,p_nickname,p_nickname_key,p_credential_hash,p_recovery_hash);
  if exists(select 1 from app_private.rounds where room_id=(v_result->>'room_id')::uuid and ended_at is null) then
    update app_private.players set status='waiting_next_round' where id=(v_result->>'player_id')::uuid;
  end if;
  return v_result;
end;
$$;

-- Room lock is shared by joins, M1 commands and game commands; no external I/O inside it.
alter function public.room_command(text,uuid,text,jsonb,integer) set schema app_private;
create function public.room_command(p_credential_hash text,p_room uuid,p_action text,p_payload jsonb,p_expected_version integer) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_result jsonb;
begin
  if not exists(select 1 from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left') then
    raise exception 'FORBIDDEN' using errcode='P0001';
  end if;
  perform 1 from app_private.rooms where id=p_room for update;
  if (p_action in ('update_settings','kick') or (p_action='leave' and exists(
    select 1 from app_private.round_players rp join app_private.players p on p.id=rp.player_id
    join app_private.rounds g on g.id=rp.round_id where g.room_id=p_room and g.ended_at is null and p.credential_hash=p_credential_hash
  ))) and exists(select 1 from app_private.rounds where room_id=p_room and ended_at is null) then
    raise exception 'ROUND_ACTIVE' using errcode='P0001';
  end if;
  v_result:=app_private.room_command(p_credential_hash,p_room,p_action,p_payload,p_expected_version);
  if p_action='close_room' then
    update app_private.rounds set phase='CANCELLED',ended_at=now(),version=version+1 where room_id=p_room and ended_at is null;
  end if;
  return v_result;
end;
$$;

create function public.game_command(p_credential_hash text,p_room uuid,p_action text,p_payload jsonb,
  p_expected_version integer,p_expected_phase text,p_request_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare
  v_room app_private.rooms; v_me app_private.players; v_round app_private.rounds;
  v_ids uuid[]; v_id uuid; v_liar uuid; v_index integer; v_count integer; v_word text; v_category text;
  v_fingerprint jsonb; v_receipt app_private.command_receipts; v_result jsonb;
begin
  if not exists(select 1 from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left') then
    raise exception 'FORBIDDEN' using errcode='P0001';
  end if;
  select * into v_room from app_private.rooms where id=p_room for update;
  select * into v_me from app_private.players where room_id=p_room and credential_hash=p_credential_hash and status<>'left' for update;
  if not found then raise exception 'FORBIDDEN' using errcode='P0001'; end if;
  if v_room.status<>'open' or v_room.expires_at<=now() then raise exception 'ROOM_CLOSED' using errcode='P0001'; end if;
  if p_request_id is null or p_expected_version is null or p_expected_phase is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'INVALID_REQUEST' using errcode='P0001';
  end if;
  v_fingerprint:=jsonb_build_object('room',p_room,'action',p_action,'payload',p_payload,'version',p_expected_version,'phase',p_expected_phase);
  select * into v_receipt from app_private.command_receipts where player_id=v_me.id and request_id=p_request_id;
  if found then
    if v_receipt.fingerprint<>v_fingerprint then raise exception 'REQUEST_CONFLICT' using errcode='P0001'; end if;
    return v_receipt.response_meta || jsonb_build_object('changed',false);
  end if;
  if p_expected_version is distinct from v_room.version then raise exception 'VERSION_CONFLICT' using errcode='P0001'; end if;
  select * into v_round from app_private.rounds where room_id=p_room and ended_at is null;
  if p_expected_phase is distinct from coalesce(v_round.phase,'LOBBY') then raise exception 'PHASE_CONFLICT' using errcode='P0001'; end if;
  if p_action in ('start_round','cancel_round') and v_room.host_player_id<>v_me.id then raise exception 'HOST_ONLY' using errcode='P0001'; end if;

  if p_action='start_round' then
    if v_round.id is not null then raise exception 'ROUND_ACTIVE' using errcode='P0001'; end if;
    if p_payload<>'{}'::jsonb then raise exception 'INVALID_REQUEST' using errcode='P0001'; end if;
    select array_agg(id order by gen_random_uuid()) into v_ids from app_private.players where room_id=p_room and status<>'left';
    v_count:=cardinality(v_ids);
    if v_count not between 3 and 12 then raise exception 'PLAYER_COUNT' using errcode='P0001'; end if;
    if exists(select 1 from app_private.players where room_id=p_room and status<>'left' and last_seen_at<=now()-interval '30 seconds') then
      raise exception 'PLAYERS_OFFLINE' using errcode='P0001';
    end if;
    insert into app_private.rounds(room_id,phase,config) values(p_room,
      case when v_room.settings->>'word_mode'='custom' then 'COLLECT_WORDS' else 'REVEAL_ROLE' end,v_room.settings) returning * into v_round;
    select id into v_liar from unnest(v_ids) id order by gen_random_uuid() limit 1;
    for v_index in 1..v_count loop
      v_id:=v_ids[v_index];
      insert into app_private.round_players(round_id,room_id,player_id,role,turn_order)
        values(v_round.id,p_room,v_id,case when v_id=v_liar then 'liar' else 'citizen' end,v_index);
    end loop;
    update app_private.players set status='active' where room_id=p_room and status='waiting_next_round';
    if v_round.phase='REVEAL_ROLE' then
      select word,category into v_word,v_category from app_private.builtin_words order by gen_random_uuid() limit 1;
      if v_word is null then raise exception 'TEMPORARILY_UNAVAILABLE' using errcode='P0001'; end if;
      insert into app_private.round_secrets values(v_round.id,v_word,v_category);
    end if;
  elsif p_action='cancel_round' then
    if v_round.id is null then raise exception 'PHASE_CONFLICT' using errcode='P0001'; end if;
    update app_private.rounds set phase='CANCELLED',ended_at=now(),version=version+1 where id=v_round.id;
    update app_private.players set status='active' where room_id=p_room and status='waiting_next_round';
  else
    if not exists(select 1 from app_private.round_players where round_id=v_round.id and player_id=v_me.id) then
      raise exception 'NOT_ROUND_PLAYER' using errcode='P0001';
    end if;
    if p_payload->>'round_id' is distinct from v_round.id::text then raise exception 'PHASE_CONFLICT' using errcode='P0001'; end if;
    if p_action='submit_word' then
      if v_round.phase<>'COLLECT_WORDS' then raise exception 'PHASE_CONFLICT' using errcode='P0001'; end if;
      v_word:=p_payload->>'word';
      if jsonb_typeof(p_payload->'word') is distinct from 'string' or char_length(v_word) not between 2 and 30
        or char_length(regexp_replace(v_word,'[[:space:]]','','g'))<2 or v_word ~ '[[:cntrl:]]' then
        raise exception 'INVALID_WORD' using errcode='P0001';
      end if;
      if exists(select 1 from app_private.word_candidates where round_id=v_round.id and player_id=v_me.id) then
        raise exception 'ALREADY_SUBMITTED' using errcode='P0001';
      end if;
      insert into app_private.word_candidates values(v_round.id,v_me.id,btrim(v_word));
      if (select count(*) from app_private.word_candidates where round_id=v_round.id)=(select count(*) from app_private.round_players where round_id=v_round.id) then
        select w.word into v_word from app_private.word_candidates w join app_private.round_players p using(round_id,player_id)
          where w.round_id=v_round.id and p.role='citizen' order by gen_random_uuid() limit 1;
        insert into app_private.round_secrets values(v_round.id,v_word,'직접 입력');
        update app_private.rounds set phase='REVEAL_ROLE' where id=v_round.id;
      end if;
    elsif p_action='ack_role' then
      if v_round.phase<>'REVEAL_ROLE' then raise exception 'PHASE_CONFLICT' using errcode='P0001'; end if;
      update app_private.round_players set acknowledged_at=now() where round_id=v_round.id and player_id=v_me.id and acknowledged_at is null;
      if not found then raise exception 'ALREADY_ACKNOWLEDGED' using errcode='P0001'; end if;
      if not exists(select 1 from app_private.round_players where round_id=v_round.id and acknowledged_at is null) then
        update app_private.rounds set phase='HINT' where id=v_round.id;
      end if;
    else raise exception 'UNKNOWN_ACTION' using errcode='P0001';
    end if;
    update app_private.rounds set version=version+1 where id=v_round.id;
  end if;
  v_result:=jsonb_build_object('version',app_private.bump(p_room),'changed',true);
  insert into app_private.command_receipts values(p_room,v_me.id,p_request_id,v_fingerprint,v_result,now());
  return v_result;
end;
$$;

alter table app_private.rounds enable row level security;
alter table app_private.round_players enable row level security;
alter table app_private.round_secrets enable row level security;
alter table app_private.word_candidates enable row level security;
alter table app_private.command_receipts enable row level security;
alter table app_private.builtin_words enable row level security;
revoke all on all tables in schema app_private from public,anon,authenticated;
revoke all on all functions in schema app_private from public,anon,authenticated,service_role;
revoke all on function public.game_command(text,uuid,text,jsonb,integer,text,uuid) from public,anon,authenticated;
revoke all on function public.room_join(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.room_command(text,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.game_command(text,uuid,text,jsonb,integer,text,uuid) to service_role;
grant execute on function public.room_join(text,text,text,text,text) to service_role;
grant execute on function public.room_command(text,uuid,text,jsonb,integer) to service_role;

-- Original curated starter vocabulary: 5 categories × 15 distinct words.
insert into app_private.builtin_words(category,word)
select category,unnest(words) from (values
 ('식탁',array['김밥','비빔밥','떡볶이','된장찌개','감자전','잡채','수제비','칼국수','주먹밥','누룽지','호떡','붕어빵','냉면','콩국수','계란말이']),
 ('생활',array['우산','책갈피','텀블러','슬리퍼','빨래집게','칫솔','손거울','알람시계','충전기','보온병','필통','옷걸이','휴지통','도마','빗자루']),
 ('자연',array['무지개','폭포','갯벌','소나무','단풍잎','민들레','조약돌','산호초','눈사람','은하수','아지랑이','수평선','모래사장','반딧불이','고드름']),
 ('장소',array['도서관','수영장','우체국','빵집','미술관','정류장','천문대','놀이터','기차역','수족관','편의점','전망대','영화관','운동장','식물원']),
 ('취미',array['종이접기','보드게임','자전거','캠핑','뜨개질','사진촬영','낚시','등산','독서','스케이트','퍼즐','도예','피아노','요가','배드민턴'])
) as vocabulary(category,words);
