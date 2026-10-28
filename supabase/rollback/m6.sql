-- Admin-only. Deleted room data cannot be recovered by a schema rollback.
begin;
do $$ begin
 if exists(select 1 from app_private.rounds where ended_at is null) then raise exception 'Cancel active rounds before M6 rollback';end if;
 if to_regclass('cron.job') is not null then
  execute $q$select cron.unschedule(jobid) from cron.job where jobname='party-game-maintenance'$q$;
 end if;
end $$;
drop function app_private.maintain_rooms();
drop function public.game_command(text,uuid,text,jsonb,integer,text,uuid);
alter function app_private.game_command_before_m6(text,uuid,text,jsonb,integer,text,uuid) set schema public;
alter function public.game_command_before_m6(text,uuid,text,jsonb,integer,text,uuid) rename to game_command;
drop function public.room_command(text,uuid,text,jsonb,integer);
alter function app_private.room_command_before_m6(text,uuid,text,jsonb,integer) set schema public;
alter function public.room_command_before_m6(text,uuid,text,jsonb,integer) rename to room_command;
drop function public.room_join(text,text,text,text,text);
alter function app_private.room_join_before_m6(text,text,text,text,text) set schema public;
alter function public.room_join_before_m6(text,text,text,text,text) rename to room_join;
drop function public.player_recover(text,text,text,text);
alter function app_private.player_recover_before_m6(text,text,text,text) set schema public;
alter function public.player_recover_before_m6(text,text,text,text) rename to player_recover;
drop function app_private.room_dto(uuid,uuid);
alter function app_private.room_dto_before_m6(uuid,uuid) rename to room_dto;
drop function app_private.advance_discussion(uuid);
alter function app_private.advance_before_m6(uuid) rename to advance_discussion;
drop function app_private.advance_connectivity(uuid);
drop function app_private.touch_room(uuid);
drop function app_private.bump(uuid);
alter function app_private.bump_before_m6(uuid) rename to bump;
alter table app_private.rounds drop column disconnect_phase,drop column disconnect_remaining_ms,drop column disconnect_grace_until;
alter table app_private.rounds drop constraint rounds_phase_check;
alter table app_private.rounds add constraint rounds_phase_check check(phase in ('COLLECT_WORDS','REVEAL_ROLE','HINT','DISCUSS','VOTE_1','VOTE_RUNOFF','REVEAL_VOTE','REVEAL_LIAR','GUESS','APPEAL_WINDOW','APPEAL_VOTE','FINAL_RESULT','PAUSED_HOST','CANCELLED'));
revoke all on function public.game_command(text,uuid,text,jsonb,integer,text,uuid),public.room_command(text,uuid,text,jsonb,integer),public.room_join(text,text,text,text,text),public.player_recover(text,text,text,text) from public,anon,authenticated;
grant execute on function public.game_command(text,uuid,text,jsonb,integer,text,uuid),public.room_command(text,uuid,text,jsonb,integer),public.room_join(text,text,text,text,text),public.player_recover(text,text,text,text) to service_role;
commit;
