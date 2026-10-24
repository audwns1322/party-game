-- Validate both the round row and both sides of a participant move, at transaction end.
create or replace function app_private.check_round_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_round uuid; v_rounds uuid[]; v_count integer; v_liars integer;
begin
  if tg_table_name='rounds' then
    v_rounds:=array[new.id];
  elsif tg_op='UPDATE' then
    v_rounds:=array[old.round_id,new.round_id];
  elsif tg_op='DELETE' then
    v_rounds:=array[old.round_id];
  else
    v_rounds:=array[new.round_id];
  end if;
  foreach v_round in array v_rounds loop
    if exists(select 1 from app_private.rounds where id=v_round and ended_at is null) then
      select count(*),count(*) filter(where role='liar') into v_count,v_liars
        from app_private.round_players where round_id=v_round;
      if v_count not between 3 and 12 or v_liars<>1 then raise exception 'INVALID_ASSIGNMENT'; end if;
    end if;
  end loop;
  return null;
end;
$$;
create constraint trigger rounds_assignment_check after insert or update on app_private.rounds
  deferrable initially deferred for each row execute function app_private.check_round_assignment();
