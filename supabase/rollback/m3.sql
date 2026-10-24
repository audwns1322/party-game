-- Admin-only rollback. Cancel active rounds and back up before running.
begin;
do $$ begin
  if exists(select 1 from app_private.rounds where ended_at is null) then
    raise exception 'Cancel active rounds before M3 rollback';
  end if;
end $$;
drop function public.game_command(text,uuid,text,jsonb,integer,text,uuid);
alter function app_private.game_command_m2(text,uuid,text,jsonb,integer,text,uuid) set schema public;
alter function public.game_command_m2(text,uuid,text,jsonb,integer,text,uuid) rename to game_command;
drop function public.room_command(text,uuid,text,jsonb,integer);
alter function app_private.room_command_m2(text,uuid,text,jsonb,integer) set schema public;
alter function public.room_command_m2(text,uuid,text,jsonb,integer) rename to room_command;
drop function public.room_snapshot(text,uuid);
alter function app_private.room_snapshot_m2(text,uuid) set schema public;
alter function public.room_snapshot_m2(text,uuid) rename to room_snapshot;
drop function app_private.room_dto(uuid,uuid);
alter function app_private.m2_room_dto(uuid,uuid) rename to room_dto;
drop function app_private.advance_discussion(uuid);
alter table app_private.rounds drop column hint_index, drop column phase_started_at,
  drop column deadline_at, drop column remaining_ms, drop column paused_phase;
alter table app_private.rounds drop constraint rounds_phase_check;
alter table app_private.rounds add constraint rounds_phase_check check(phase in ('COLLECT_WORDS','REVEAL_ROLE','HINT','CANCELLED'));
grant execute on function public.game_command(text,uuid,text,jsonb,integer,text,uuid) to service_role;
grant execute on function public.room_command(text,uuid,text,jsonb,integer) to service_role;
grant execute on function public.room_snapshot(text,uuid) to service_role;
commit;
