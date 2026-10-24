-- Fixed-window request counters for create / join / recover abuse (code enumeration, seat squatting).
-- Buckets hold hashed client IPs or room codes only; raw IPs are never stored.
create table app_private.rate_limits (
  bucket text not null check (char_length(bucket) between 1 and 128),
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (bucket, window_start)
);
alter table app_private.rate_limits enable row level security;
revoke all on app_private.rate_limits from public, anon, authenticated;

-- Atomically count one hit; returns true while the bucket is within p_limit for the current window.
create function public.rate_hit(p_bucket text, p_limit integer, p_window_seconds integer) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  if p_limit < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  insert into app_private.rate_limits as r (bucket, window_start, hits) values (p_bucket, v_window, 1)
    on conflict (bucket, window_start) do update set hits = r.hits + 1
    returning hits into v_hits;
  -- Opportunistic cleanup of expired windows, bounded so a hit never does much work.
  if random() < 0.01 then
    delete from app_private.rate_limits where ctid in (
      select ctid from app_private.rate_limits where window_start < now() - interval '1 day' limit 500);
  end if;
  return v_hits <= p_limit;
end;
$$;
revoke all on function public.rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_hit(text, integer, integer) to service_role;

-- Cap total seats ever used per room so join/leave churn cannot grow rows without bound.
create or replace function public.room_join(p_code text, p_nickname text, p_nickname_key text, p_credential_hash text, p_recovery_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_room app_private.rooms;
  v_player uuid := gen_random_uuid();
  v_count integer;
  v_order integer;
begin
  select * into v_room from app_private.rooms
    where code = p_code and status = 'open' and expires_at > now() for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_room.locked then raise exception 'ROOM_LOCKED' using errcode = 'P0001'; end if;
  select count(*) filter (where status <> 'left'), coalesce(max(join_order), 0) into v_count, v_order
    from app_private.players where room_id = v_room.id;
  if v_count >= 12 or v_order >= 50 then raise exception 'ROOM_FULL' using errcode = 'P0001'; end if;
  if exists (select 1 from app_private.players where room_id = v_room.id and status <> 'left'
      and nickname_key = p_nickname_key) then
    raise exception 'NICKNAME_TAKEN' using errcode = 'P0001';
  end if;
  insert into app_private.players (id, room_id, nickname, nickname_key, join_order, credential_hash, recovery_hash)
    values (v_player, v_room.id, p_nickname, p_nickname_key, v_order + 1, p_credential_hash, p_recovery_hash);
  return jsonb_build_object('room_id', v_room.id, 'code', v_room.code, 'player_id', v_player,
    'version', app_private.bump(v_room.id));
end;
$$;
revoke all on function public.room_join(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.room_join(text, text, text, text, text) to service_role;
