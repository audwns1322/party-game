-- Select liar positions uniformly from the already shuffled speaking order.
-- Keep the public command wrapper and all existing game rules unchanged.
do $$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('app_private.game_command_m2(text,uuid,text,jsonb,integer,text,uuid)'::regprocedure);
  updated:=replace(definition,
    'select array_agg(id) into v_liar_ids from (select id from unnest(v_ids) id order by gen_random_uuid() limit coalesce((v_room.settings->>''liar_count'')::int,1)) selected;',
    'select array_agg(v_ids[idx]) into v_liar_ids from (select idx from generate_subscripts(v_ids,1) idx order by random() limit coalesce((v_room.settings->>''liar_count'')::int,1)) selected;');
  if updated=definition then raise exception 'Unexpected liar assignment function'; end if;
  execute updated;
end $$;
