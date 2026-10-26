-- Admin-only. Cancel all active rounds before rollback. Curated vocabulary remains.
begin;
do $$ begin
  if exists(select 1 from app_private.rounds where ended_at is null) then raise exception 'Cancel active rounds before themes rollback'; end if;
end $$;
drop function app_private.room_dto(uuid,uuid);
alter function app_private.themes_previous_room_dto(uuid,uuid) rename to room_dto;
drop function app_private.room_command(text,uuid,text,jsonb,integer);
alter function app_private.themes_previous_room_command(text,uuid,text,jsonb,integer) rename to room_command;
drop function app_private.game_command_m2(text,uuid,text,jsonb,integer,text,uuid);
alter function app_private.themes_previous_game_command(text,uuid,text,jsonb,integer,text,uuid) rename to game_command_m2;
drop function app_private.pick_builtin_word(uuid,jsonb);
alter table app_private.round_secrets drop column liar_word;
alter table app_private.builtin_words drop column easy_word,drop column hard_word;
update app_private.rooms set settings=settings-'theme'-'custom_theme'-'game_mode'-'difficulty';
revoke all on all functions in schema app_private from public,anon,authenticated,service_role;
commit;
