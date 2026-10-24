-- Isolated M0 proof; NOT the production M1 room schema.
create schema if not exists m0_private;
revoke all on schema m0_private from public, anon, authenticated;
create table m0_private.sessions (
  player_id uuid primary key,
  room_id uuid not null,
  credential_hash text not null unique check (credential_hash ~ '^[0-9a-f]{64}$'),
  role text not null check (role in ('citizen', 'liar')),
  word text not null,
  version integer not null default 1,
  active boolean not null default true
);
alter table m0_private.sessions enable row level security;
revoke all on m0_private.sessions from public, anon, authenticated;
create function public.m0_snapshot(p_hash text, p_room uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('room_id', s.room_id, 'player_id', s.player_id,
    'role', s.role, 'word', case when s.role = 'citizen' then s.word else null end,
    'version', s.version)
  from m0_private.sessions s
  where s.credential_hash = p_hash and s.room_id = p_room and s.active;
$$;
revoke all on function public.m0_snapshot(text, uuid) from public, anon, authenticated;
grant execute on function public.m0_snapshot(text, uuid) to service_role;
