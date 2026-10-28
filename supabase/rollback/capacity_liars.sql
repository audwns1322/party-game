-- Admin-only. Full rollback requires no expanded-capacity/two-liar history; back up first.
begin;
do $$ declare x record; begin
 if exists(select 1 from app_private.rounds where ended_at is null) or exists(select 1 from app_private.round_players where turn_order>12) or exists(select 1 from app_private.rounds where hint_index>36) or exists(select 1 from app_private.round_players group by round_id having count(*) filter(where role='liar')>1) then raise exception 'Back up/remove expanded game history and cancel rounds before capacity rollback'; end if;
 for x in select * from (values
 ('room_join','capacity_previous_room_join','text,text,text,text,text'),
 ('room_command','capacity_previous_room_command','text,uuid,text,jsonb,integer'),
 ('game_command_m2','capacity_previous_game_command','text,uuid,text,jsonb,integer,text,uuid'),
 ('check_round_assignment','capacity_previous_assignment',''),
 ('room_dto','capacity_previous_room_dto','uuid,uuid')) t(original,backup,args) loop
 execute replace(pg_get_functiondef(('app_private.'||x.backup||'('||x.args||')')::regprocedure),'FUNCTION app_private.'||x.backup||'(','FUNCTION app_private.'||x.original||'(');
 execute 'drop function app_private.'||x.backup||'('||x.args||')';
 end loop;
end $$;
alter table app_private.round_players drop constraint round_players_turn_order_check;
alter table app_private.round_players add constraint round_players_turn_order_check check(turn_order between 1 and 12);
alter table app_private.rounds drop constraint rounds_hint_index_check;
alter table app_private.rounds add constraint rounds_hint_index_check check(hint_index between 0 and 36);
create unique index round_players_one_liar on app_private.round_players(round_id) where role='liar';
update app_private.rooms set settings=settings-'liar_count';
revoke all on all functions in schema app_private from public,anon,authenticated,service_role;
commit;
