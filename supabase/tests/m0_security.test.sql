begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
insert into m0_private.sessions (player_id, room_id, credential_hash, role, word) values
('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001', repeat('a',64),'citizen','사과'),
('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001', repeat('b',64),'liar','사과');
select ok((select relrowsecurity from pg_class where oid='m0_private.sessions'::regclass), 'RLS enabled');
select ok(not has_schema_privilege('anon','m0_private','USAGE'), 'anon schema denied');
select ok(not has_table_privilege('anon','m0_private.sessions','SELECT'), 'anon read denied');
select ok(not has_table_privilege('authenticated','m0_private.sessions','SELECT'), 'JWT user read denied');
select ok(not has_function_privilege('anon','public.m0_snapshot(text,uuid)','EXECUTE'), 'anon RPC denied');
select ok(not has_function_privilege('authenticated','public.m0_snapshot(text,uuid)','EXECUTE'), 'JWT user RPC denied');
set local role service_role;
select is(public.m0_snapshot(repeat('a',64),'00000000-0000-4000-8000-000000000001')->>'word','사과','citizen sees own allowed word');
select is(public.m0_snapshot(repeat('b',64),'00000000-0000-4000-8000-000000000001')->>'word',null,'liar cannot see word');
select is(public.m0_snapshot(repeat('a',64),'00000000-0000-4000-8000-000000000002'),null,'cross-room denied');
select is(public.m0_snapshot(repeat('c',64),'00000000-0000-4000-8000-000000000001'),null,'unknown token denied');
reset role;
update m0_private.sessions set active=false where credential_hash=repeat('a',64);
set local role service_role;
select is(public.m0_snapshot(repeat('a',64),'00000000-0000-4000-8000-000000000001'),null,'revoked token denied');
select is(public.m0_snapshot(repeat('b',64),'00000000-0000-4000-8000-000000000001')->>'player_id','00000000-0000-4000-8000-000000000012','only credential owner returned');
reset role;
select * from finish();
rollback;
