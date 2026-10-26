-- Curated three-word families: easy stays in a family, hard moves to another within the same public theme.
alter table app_private.builtin_words add column easy_word text, add column hard_word text;
alter table app_private.round_secrets add column liar_word text check(liar_word is null or liar_word<>word);
delete from app_private.builtin_words;
insert into app_private.builtin_words(category,word,easy_word,hard_word) values
('음식','김밥','주먹밥','팥빙수'),
('음식','주먹밥','유부초밥','아이스크림'),
('음식','유부초밥','김밥','젤라토'),
('음식','냉면','쫄면','된장찌개'),
('음식','쫄면','막국수','김치찌개'),
('음식','막국수','냉면','순두부찌개'),
('음식','팥빙수','아이스크림','호떡'),
('음식','아이스크림','젤라토','붕어빵'),
('음식','젤라토','팥빙수','국화빵'),
('음식','된장찌개','김치찌개','김밥'),
('음식','김치찌개','순두부찌개','주먹밥'),
('음식','순두부찌개','된장찌개','유부초밥'),
('음식','호떡','붕어빵','냉면'),
('음식','붕어빵','국화빵','쫄면'),
('음식','국화빵','호떡','막국수'),
('동물','고양이','호랑이','문어'),
('동물','호랑이','사자','오징어'),
('동물','사자','고양이','낙지'),
('동물','강아지','늑대','참새'),
('동물','늑대','여우','비둘기'),
('동물','여우','강아지','까치'),
('동물','문어','오징어','말벌'),
('동물','오징어','낙지','꿀벌'),
('동물','낙지','문어','쌍살벌'),
('동물','참새','비둘기','고양이'),
('동물','비둘기','까치','호랑이'),
('동물','까치','참새','사자'),
('동물','말벌','꿀벌','강아지'),
('동물','꿀벌','쌍살벌','늑대'),
('동물','쌍살벌','말벌','여우'),
('생활용품','텀블러','보온병','빗자루'),
('생활용품','보온병','물통','청소기'),
('생활용품','물통','텀블러','물걸레'),
('생활용품','칫솔','치간칫솔','스탠드'),
('생활용품','치간칫솔','전동칫솔','손전등'),
('생활용품','전동칫솔','칫솔','랜턴'),
('생활용품','빗자루','청소기','이불'),
('생활용품','청소기','물걸레','담요'),
('생활용품','물걸레','빗자루','침낭'),
('생활용품','스탠드','손전등','텀블러'),
('생활용품','손전등','랜턴','보온병'),
('생활용품','랜턴','스탠드','물통'),
('생활용품','이불','담요','칫솔'),
('생활용품','담요','침낭','치간칫솔'),
('생활용품','침낭','이불','전동칫솔'),
('장소','도서관','서점','빵집'),
('장소','서점','독서실','카페'),
('장소','독서실','도서관','디저트가게'),
('장소','수영장','워터파크','미술관'),
('장소','워터파크','해수욕장','박물관'),
('장소','해수욕장','수영장','전시관'),
('장소','빵집','카페','기차역'),
('장소','카페','디저트가게','지하철역'),
('장소','디저트가게','빵집','버스터미널'),
('장소','미술관','박물관','도서관'),
('장소','박물관','전시관','서점'),
('장소','전시관','미술관','독서실'),
('장소','기차역','지하철역','수영장'),
('장소','지하철역','버스터미널','워터파크'),
('장소','버스터미널','기차역','해수욕장'),
('취미','뜨개질','자수','보드게임'),
('취미','자수','바느질','카드게임'),
('취미','바느질','뜨개질','퍼즐'),
('취미','사진촬영','영상촬영','피아노'),
('취미','영상촬영','필름촬영','키보드연주'),
('취미','필름촬영','사진촬영','오르간연주'),
('취미','보드게임','카드게임','도예'),
('취미','카드게임','퍼즐','점토공예'),
('취미','퍼즐','보드게임','찰흙놀이'),
('취미','피아노','키보드연주','뜨개질'),
('취미','키보드연주','오르간연주','자수'),
('취미','오르간연주','피아노','바느질'),
('취미','도예','점토공예','사진촬영'),
('취미','점토공예','찰흙놀이','영상촬영'),
('취미','찰흙놀이','도예','필름촬영'),
('자연','폭포','계곡','은하수'),
('자연','계곡','시냇물','별자리'),
('자연','시냇물','폭포','유성우'),
('자연','소나무','전나무','모래사장'),
('자연','전나무','잣나무','갯벌'),
('자연','잣나무','소나무','자갈해변'),
('자연','은하수','별자리','무지개'),
('자연','별자리','유성우','달무리'),
('자연','유성우','은하수','햇무리'),
('자연','모래사장','갯벌','폭포'),
('자연','갯벌','자갈해변','계곡'),
('자연','자갈해변','모래사장','시냇물'),
('자연','무지개','달무리','소나무'),
('자연','달무리','햇무리','전나무'),
('자연','햇무리','무지개','잣나무'),
('운동','축구','풋살','테니스'),
('운동','풋살','비치사커','배드민턴'),
('운동','비치사커','축구','스쿼시'),
('운동','수영','다이빙','달리기'),
('운동','다이빙','수구','조깅'),
('운동','수구','수영','마라톤'),
('운동','테니스','배드민턴','복싱'),
('운동','배드민턴','스쿼시','킥복싱'),
('운동','스쿼시','테니스','무에타이'),
('운동','달리기','조깅','축구'),
('운동','조깅','마라톤','풋살'),
('운동','마라톤','달리기','비치사커'),
('운동','복싱','킥복싱','수영'),
('운동','킥복싱','무에타이','다이빙'),
('운동','무에타이','복싱','수구'),
('크로스핏','에어스쿼트','프런트스쿼트','로잉'),
('크로스핏','프런트스쿼트','백스쿼트','스키에르그'),
('크로스핏','백스쿼트','에어스쿼트','에어바이크'),
('크로스핏','풀업','체스트투바','버피'),
('크로스핏','체스트투바','바머슬업','바페이싱버피'),
('크로스핏','바머슬업','풀업','버피박스점프'),
('크로스핏','로잉','스키에르그','스내치'),
('크로스핏','스키에르그','에어바이크','파워스내치'),
('크로스핏','에어바이크','로잉','행스내치'),
('크로스핏','버피','바페이싱버피','에어스쿼트'),
('크로스핏','바페이싱버피','버피박스점프','프런트스쿼트'),
('크로스핏','버피박스점프','버피','백스쿼트'),
('크로스핏','스내치','파워스내치','풀업'),
('크로스핏','파워스내치','행스내치','체스트투바'),
('크로스핏','행스내치','스내치','바머슬업'),
('여행','캐리어','여행가방','여권'),
('여행','여행가방','배낭','비자'),
('여행','배낭','캐리어','탑승권'),
('여행','호텔','게스트하우스','패키지여행'),
('여행','게스트하우스','호스텔','단체여행'),
('여행','호스텔','호텔','가이드투어'),
('여행','여권','비자','기념품'),
('여행','비자','탑승권','엽서'),
('여행','탑승권','여권','마그넷'),
('여행','패키지여행','단체여행','캐리어'),
('여행','단체여행','가이드투어','여행가방'),
('여행','가이드투어','패키지여행','배낭'),
('여행','기념품','엽서','호텔'),
('여행','엽서','마그넷','게스트하우스'),
('여행','마그넷','기념품','호스텔');
alter table app_private.builtin_words alter column easy_word set not null, alter column hard_word set not null;
alter table app_private.builtin_words add constraint distinct_word_options check(word<>easy_word and word<>hard_word and easy_word<>hard_word);

create function app_private.pick_builtin_word(p_round uuid,p_settings jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$
declare v_theme text:=coalesce(p_settings->>'theme','random'); v_word app_private.builtin_words; v_liar text;
begin
  if v_theme='random' then select category into v_theme from (select distinct category from app_private.builtin_words) t order by gen_random_uuid() limit 1; end if;
  select * into v_word from app_private.builtin_words where category=v_theme order by gen_random_uuid() limit 1;
  if not found then raise exception 'INVALID_SETTINGS' using errcode='P0001'; end if;
  if p_settings->>'game_mode'='confusion' then v_liar:=case when p_settings->>'difficulty'='hard' then v_word.hard_word else v_word.easy_word end; end if;
  insert into app_private.round_secrets(round_id,word,category,liar_word) values(p_round,v_word.word,v_theme,v_liar);
end;
$$;

-- Keep the previous private definitions for a guarded rollback; public RPC signatures and authentication stay intact.
do $migration$
declare v_def text; v_before text; v_after text;
begin
  v_def:=pg_get_functiondef('app_private.room_command(text,uuid,text,jsonb,integer)'::regprocedure);
  execute replace(v_def,'FUNCTION app_private.room_command(','FUNCTION app_private.themes_previous_room_command(');
  v_before:='(''word_mode'', ''hint_rounds'', ''discussion_seconds'')';
  if position(v_before in v_def)=0 then raise exception 'Unexpected settings validation'; end if;
  v_def:=replace(v_def,v_before,'(''word_mode'', ''hint_rounds'', ''discussion_seconds'', ''theme'', ''custom_theme'', ''game_mode'', ''difficulty'')');
  v_def:=replace(v_def,'v_settings := v_room.settings || p_payload;', 'v_settings := ''{"theme":"random","custom_theme":"","game_mode":"classic","difficulty":"easy"}''::jsonb || v_room.settings || p_payload;');
  v_before:='if v_settings = v_room.settings then';
  v_after:=$settings$
    if (jsonb_typeof(v_settings->'word_mode')='string' and v_settings->>'word_mode' in ('builtin','custom')
      and jsonb_typeof(v_settings->'hint_rounds')='number' and v_settings->>'hint_rounds' in ('1','2','3')
      and jsonb_typeof(v_settings->'discussion_seconds')='number' and v_settings->>'discussion_seconds' in ('0','60','120','180','300')
      and jsonb_typeof(v_settings->'theme')='string' and v_settings->>'theme' in ('random','음식','동물','생활용품','장소','취미','자연','운동','크로스핏','여행')
      and jsonb_typeof(v_settings->'custom_theme')='string' and char_length(v_settings->>'custom_theme')<=30
      and (v_settings->>'custom_theme') !~ '[[:cntrl:]]' and (v_settings->>'custom_theme') !~ U&'[\200B-\200F\202A-\202E\2060-\206F\FEFF]'
      and jsonb_typeof(v_settings->'game_mode')='string' and v_settings->>'game_mode' in ('classic','confusion')
      and jsonb_typeof(v_settings->'difficulty')='string' and v_settings->>'difficulty' in ('easy','hard')
      and (v_settings->>'word_mode'<>'custom' or v_settings->>'game_mode'='classic')) is not true then
      raise exception 'INVALID_SETTINGS' using errcode='P0001';
    end if;
    v_settings:=jsonb_set(v_settings,'{custom_theme}',to_jsonb(btrim(v_settings->>'custom_theme')));
    if v_settings = ('{"theme":"random","custom_theme":"","game_mode":"classic","difficulty":"easy"}'::jsonb || v_room.settings) then
$settings$;
  if position(v_before in v_def)=0 then raise exception 'Unexpected settings update'; end if;
  execute replace(v_def,v_before,v_after);

  v_def:=pg_get_functiondef('app_private.game_command_m2(text,uuid,text,jsonb,integer,text,uuid)'::regprocedure);
  execute replace(v_def,'FUNCTION app_private.game_command_m2(','FUNCTION app_private.themes_previous_game_command(');
  v_before:=$before$      select word,category into v_word,v_category from app_private.builtin_words order by gen_random_uuid() limit 1;
      if v_word is null then raise exception 'TEMPORARILY_UNAVAILABLE' using errcode='P0001'; end if;
      insert into app_private.round_secrets values(v_round.id,v_word,v_category);$before$;
  if position(v_before in v_def)=0 then raise exception 'Unexpected builtin selection'; end if;
  v_def:=replace(v_def,v_before,'      perform app_private.pick_builtin_word(v_round.id,v_room.settings);');
  v_before:='    insert into app_private.rounds(room_id,phase,config)';
  v_after:=$validate$    if v_room.settings->>'word_mode'='custom' and char_length(btrim(coalesce(v_room.settings->>'custom_theme','')))=0 then
      raise exception 'INVALID_SETTINGS' using errcode='P0001'; end if;
    insert into app_private.rounds(room_id,phase,config)$validate$;
  if position(v_before in v_def)=0 then raise exception 'Unexpected round start'; end if;
  v_def:=replace(v_def,v_before,v_after);
  v_def:=replace(v_def,'values(v_round.id,v_word,''직접 입력'')','values(v_round.id,v_word,coalesce(nullif(v_round.config->>''custom_theme'',''''),''직접 입력''))');
  execute v_def;

  v_def:=pg_get_functiondef('app_private.room_dto(uuid,uuid)'::regprocedure);
  execute replace(v_def,'FUNCTION app_private.room_dto(','FUNCTION app_private.themes_previous_room_dto(');
  v_def:=replace(v_def,'''hint_index'',g.hint_index,',$dto$
      'theme',case when g.config->>'word_mode'='custom' then coalesce(nullif(g.config->>'custom_theme',''),'직접 입력') else secret.category end,
      'game_mode',coalesce(g.config->>'game_mode','classic'),'difficulty',coalesce(g.config->>'difficulty','easy'),
      'hint_index',g.hint_index,$dto$);
  v_before:='case when g.phase<>''COLLECT_WORDS'' and mine.role=''citizen'' then secret.word else null end';
  v_after:='case when g.phase=''COLLECT_WORDS'' then null when mine.role=''citizen'' then secret.word else secret.liar_word end';
  if position(v_before in v_def)=0 then raise exception 'Unexpected private word projection'; end if;
  execute replace(v_def,v_before,v_after);
end;
$migration$;
revoke all on all functions in schema app_private from public,anon,authenticated,service_role;
revoke all on all tables in schema app_private from public,anon,authenticated;
