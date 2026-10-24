-- Preserve M3 authorization/version/receipt logic; allow an explicit host timer skip.
do $$
declare
  v_definition text := pg_get_functiondef('public.game_command(text,uuid,text,jsonb,integer,text,uuid)'::regprocedure);
  v_before text := 'if v_round.deadline_at is not null and v_round.deadline_at>v_now then';
  v_after text := 'if v_round.deadline_at is not null and v_round.deadline_at>v_now and (p_payload->''skip_timer'') is distinct from ''true''::jsonb then';
begin
  if position(v_before in v_definition)=0 then
    raise exception 'Unexpected game_command definition: review discussion skip migration';
  end if;
  execute replace(v_definition,v_before,v_after);
end;
$$;
