-- Raise capacity and freeze one/two liars per round; keep previous definitions for rollback.
alter table app_private.round_players drop constraint round_players_turn_order_check;
alter table app_private.round_players add constraint round_players_turn_order_check check(turn_order between 1 and 15);
alter table app_private.rounds drop constraint rounds_hint_index_check;
alter table app_private.rounds add constraint rounds_hint_index_check check(hint_index between 0 and 45);
drop index app_private.round_players_one_liar;
do $m$
declare d text;
begin
 d:=pg_get_functiondef('app_private.room_join(text,text,text,text,text)'::regprocedure);
 execute replace(d,'FUNCTION app_private.room_join(','FUNCTION app_private.capacity_previous_room_join(');
 if position('v_count >= 12' in d)=0 then raise exception 'Unexpected room capacity guard'; end if;
 execute replace(d,'v_count >= 12','v_count >= 15');
 d:=pg_get_functiondef('app_private.room_command(text,uuid,text,jsonb,integer)'::regprocedure);
 execute replace(d,'FUNCTION app_private.room_command(','FUNCTION app_private.capacity_previous_room_command(');
 d:=replace(d,'''game_mode'', ''difficulty'')','''game_mode'', ''difficulty'', ''liar_count'')');
 d:=replace(d,'"difficulty":"easy"}','"difficulty":"easy","liar_count":1}');
 d:=replace(d,'and jsonb_typeof(v_settings->''difficulty'')=', 'and jsonb_typeof(v_settings->''liar_count'')=''number'' and v_settings->>''liar_count'' in (''1'',''2'') and jsonb_typeof(v_settings->''difficulty'')=');
 execute d;
 d:=pg_get_functiondef('app_private.game_command_m2(text,uuid,text,jsonb,integer,text,uuid)'::regprocedure);
 execute replace(d,'FUNCTION app_private.game_command_m2(','FUNCTION app_private.capacity_previous_game_command(');
 if position('v_liar uuid;' in d)=0 then raise exception 'Unexpected liar assignment'; end if;
 d:=replace(d,'v_liar uuid;','v_liar_ids uuid[];');
 d:=replace(d,'between 3 and 12','between 3 and 15');
 d:=replace(d,'select id into v_liar from unnest(v_ids) id order by gen_random_uuid() limit 1;','select array_agg(id) into v_liar_ids from (select id from unnest(v_ids) id order by gen_random_uuid() limit coalesce((v_room.settings->>''liar_count'')::int,1)) selected;');
 d:=replace(d,'when v_id=v_liar then','when v_id=any(v_liar_ids) then');
 execute d;
 d:=pg_get_functiondef('app_private.check_round_assignment()'::regprocedure);
 execute replace(d,'FUNCTION app_private.check_round_assignment(','FUNCTION app_private.capacity_previous_assignment(');
 d:=replace(d,'v_count not between 3 and 12 or v_liars<>1','v_count not between 3 and 15 or v_liars<>coalesce((select (config->>''liar_count'')::int from app_private.rounds where id=v_round),1)');
 execute d;
 d:=pg_get_functiondef('app_private.room_dto(uuid,uuid)'::regprocedure);
 execute replace(d,'FUNCTION app_private.room_dto(','FUNCTION app_private.capacity_previous_room_dto(');
 d:=replace(d,'''id'',g.id,''phase'',g.phase,','''id'',g.id,''liar_count'',coalesce((g.config->>''liar_count'')::int,1),''phase'',g.phase,');
 execute d;
end;
$m$;
revoke all on all functions in schema app_private from public,anon,authenticated,service_role;
