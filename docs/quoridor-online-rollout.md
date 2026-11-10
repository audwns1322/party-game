# Quoridor online — production rollout and recovery

## Scope

- Adds one private, RLS-enabled table (`app_private.quoridor_matches`) and two service-role-only RPC functions (`public.quoridor_get`, `public.quoridor_commit`).
- Expands the `game_type` constraint to include `quoridor`.
- Replaces the five-argument `room_create` wrapper to initialize a Quoridor match. The four-argument room creation function and mafia/lie-specific state machines remain unchanged.
- Wraps `room_join` in a row lock and Quoridor-specific four-seat limit. The previous implementation is retained as `app_private.room_join_pre_quoridor`.
- Updates the `room-create` Edge Function to accept `quoridor`, deploys a dedicated `quoridor-command` Edge Function, and merges the online UI.

## Preflight

1. Record currently active room counts by game type, migration history, function grants and versions.
2. Verify the SQL migration against PGlite, including existing room/mafia permission tests.
3. Confirm the old `room_join` function and room-create overload are present and inspect their definitions.
4. Deploy database migration, then edge functions, then frontend. During the intermediate stage, no Quoridor room is accessible from the public home screen.
5. Use unique temporary room codes and test with two independent session tokens before directing users to the new mode.

## Recovery (non-destructive)

If Quoridor or shared room creation/join is faulty:

1. Roll the frontend back to the last working `main` release; do not remove shared room data.
2. Redeploy the prior `room-create` Edge Function if its Quoridor support causes a regression.
3. If the SQL wrapper is responsible, restore the pre-Quoridor `room_join` implementation using the following **reviewed** commands in a transaction:

   ```sql
   begin;
   drop function public.room_join(text,text,text,text,text);
   alter function app_private.room_join_pre_quoridor(text,text,text,text,text) set schema public;
   alter function public.room_join_pre_quoridor(text,text,text,text,text) rename to room_join;
   grant execute on function public.room_join(text,text,text,text,text) to service_role;
   commit;
   ```

4. Restore the original five-argument `public.room_create` implementation from `20261029090000_mafia_lobby.sql` using `CREATE OR REPLACE FUNCTION`, then revoke it from `PUBLIC`, `anon`, `authenticated`, and grant to `service_role`.
5. Keep Quoridor tables/constraints and existing data intact while any Quoridor rooms survive. Remove them only in a separately approved cleanup after confirming no active Quoridor rooms.

Never run a blanket database restore or erase existing rooms to roll back a feature. Capture the error response and server logs, isolate the affected function, and restore only that component.
