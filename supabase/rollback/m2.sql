-- DESTRUCTIVE rollback, admin-only. Review/backup and cancel active rounds first.
-- Not run automatically. Remove only M2 migration history entries after successful rollback.
begin;
drop function public.game_command(text,uuid,text,jsonb,integer,text,uuid);
drop function public.room_join(text,text,text,text,text);
drop function public.room_command(text,uuid,text,jsonb,integer);
alter function app_private.room_join(text,text,text,text,text) set schema public;
alter function app_private.room_command(text,uuid,text,jsonb,integer) set schema public;
drop function app_private.room_dto(uuid,uuid);
alter function app_private.lobby_dto(uuid,uuid) rename to room_dto;
drop table app_private.command_receipts;
drop table app_private.word_candidates;
drop table app_private.round_secrets;
drop table app_private.round_players;
drop table app_private.rounds;
drop table app_private.builtin_words;
drop function app_private.check_round_assignment();
drop index app_private.rooms_host_room_idx;
revoke all on function public.room_join(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.room_command(text,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.room_join(text,text,text,text,text) to service_role;
grant execute on function public.room_command(text,uuid,text,jsonb,integer) to service_role;
commit;
