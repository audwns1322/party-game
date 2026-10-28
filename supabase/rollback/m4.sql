-- Admin-only. Cancel active rounds / dismiss draw results before rollback. Votes are deleted.
begin;
do $$ begin
  if exists(select 1 from app_private.rounds where ended_at is null or phase='FINAL_RESULT') then raise exception 'Cancel rounds and dismiss draw results before M4 rollback'; end if;
end $$;
drop function public.game_command(text,uuid,text,jsonb,integer,text,uuid);
alter function app_private.game_command_before_m4(text,uuid,text,jsonb,integer,text,uuid) set schema public;
alter function public.game_command_before_m4(text,uuid,text,jsonb,integer,text,uuid) rename to game_command;
drop function app_private.room_dto(uuid,uuid);
alter function app_private.room_dto_before_m4(uuid,uuid) rename to room_dto;
drop table app_private.votes;
drop index app_private.rounds_selected_player_idx;
alter table app_private.rounds drop column runoff_candidates,drop column vote_tallies,drop column selected_player_id,drop column vote_outcome;
alter table app_private.rounds drop constraint rounds_phase_check,drop constraint rounds_ended_phase_check;
alter table app_private.rounds add constraint rounds_phase_check check(phase in ('COLLECT_WORDS','REVEAL_ROLE','HINT','DISCUSS','VOTE_1','PAUSED_HOST','CANCELLED'));
alter table app_private.rounds add constraint rounds_ended_phase_check check((phase='CANCELLED')=(ended_at is not null));
revoke all on function public.game_command(text,uuid,text,jsonb,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.game_command(text,uuid,text,jsonb,integer,text,uuid) to service_role;
commit;
