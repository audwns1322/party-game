-- Confirmed mafia MVP rules (Q1 A, Q2 A): no friendly fire, and zero surviving
-- actual mafia is a citizen victory even while a spy is alive.
create function app_private.mafia_prevent_friendly_fire() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.kind='mafia' and exists (
  select 1 from app_private.mafia_round_players target
  where target.round_id=new.round_id and target.player_id=new.target_id
   and target.eliminated_at is null and target.role='mafia'
 ) then raise exception 'INVALID_TARGET' using errcode='P0001';end if;
 return new;
end; $$;
create trigger mafia_no_friendly_fire before insert on app_private.mafia_night_actions
 for each row execute function app_private.mafia_prevent_friendly_fire();

-- Both existing day and night resolution paths update mafia_rounds. Resolve the
-- victory condition at their common boundary, without rewriting deployed RPCs.
create function app_private.mafia_citizen_win_when_mafia_gone() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.phase in ('DAY_DISCUSS','DAY_RESULT','FINAL_RESULT')
  and not exists (
   select 1 from app_private.mafia_round_players player
   where player.round_id=new.id and player.eliminated_at is null and player.role='mafia'
  ) then
   new.winner:='citizen';
   new.phase:='FINAL_RESULT';
 end if;
 return new;
end; $$;
create trigger mafia_victory_without_killer before update of phase on app_private.mafia_rounds
 for each row execute function app_private.mafia_citizen_win_when_mafia_gone();

revoke all on function app_private.mafia_prevent_friendly_fire(),
 app_private.mafia_citizen_win_when_mafia_gone()
 from public,anon,authenticated,service_role;
