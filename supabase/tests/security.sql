-- Beveiligings- en databasetests voor het multiplayer-schema.
--
-- Draait volledig binnen één transactie die aan het eind wordt teruggedraaid:
-- er blijft niets achter in de database. Uitvoer: één rij per test
-- (test, ok, detail). Uitvoeren met: npm run db:test
--
-- Rollen:
--   A = organisator van kamer 1 (en deelnemer 0)
--   B = deelnemer 1 in kamer 1
--   C = buitenstaander zonder kamer
--   X = organisator van kamer 2

begin;

create temp table results (n serial, test text, ok boolean, detail text);
do $$ begin
  execute format('grant usage on schema %I to anon, authenticated, service_role', pg_my_temp_schema()::regnamespace);
end $$;
grant insert, select on results to anon, authenticated, service_role;
grant usage on sequence results_n_seq to anon, authenticated, service_role;

create function pg_temp.check(p_test text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into pg_temp.results (test, ok, detail) values (p_test, coalesce(p_ok, false), p_detail) $$;

-- Verwacht dat p_sql faalt met foutcode p_code (bijv. 42501 = geen rechten).
create function pg_temp.expect_error(p_test text, p_sql text, p_code text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
    perform pg_temp.check(p_test, false, 'geen fout, maar ' || p_code || ' verwacht');
  exception when others then
    perform pg_temp.check(p_test, sqlstate = p_code, sqlstate || ': ' || sqlerrm);
  end;
end $$;

-- Wissel naar een ingelogde (anonieme) deelnemer, de server of terug.
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.as_role(p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  perform set_config('role', p_role, true);
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Testgegevens (als beheerder)
insert into public.rooms (id, code, organizer_id, state) values
  ('11111111-1111-1111-1111-111111111111', 'TEST22', 'aaaaaaaa-0000-0000-0000-00000000000a', '{"phase":"draw"}'),
  ('22222222-2222-2222-2222-222222222222', 'TEST33', 'eeeeeeee-0000-0000-0000-00000000000e', '{"phase":"draw"}');
insert into public.seats (room_id, participant, user_id, is_organizer) values
  ('11111111-1111-1111-1111-111111111111', 0, 'aaaaaaaa-0000-0000-0000-00000000000a', true),
  ('11111111-1111-1111-1111-111111111111', 1, 'bbbbbbbb-0000-0000-0000-00000000000b', false),
  ('22222222-2222-2222-2222-222222222222', 0, 'eeeeeeee-0000-0000-0000-00000000000e', true);
insert into public.draws (room_id, spin_id, result_id, participant, round, bid_cents, started_at, spun_by) values
  ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), '3-1', 0, '1', null, now(), 'aaaaaaaa-0000-0000-0000-00000000000a'),
  ('22222222-2222-2222-2222-222222222222', gen_random_uuid(), '2-2', 0, '1', null, now(), 'eeeeeeee-0000-0000-0000-00000000000e');

-- ===========================================================================
-- 1. Lezen: alleen je eigen kamer
-- ===========================================================================
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-00000000000a');
select pg_temp.check('organisator ziet alleen zijn eigen kamer', (select array_agg(code) from public.rooms) = array['TEST22']);
select pg_temp.check('organisator ziet de plaatsen van zijn kamer', (select count(*) from public.seats) = 2);

select pg_temp.as_user('bbbbbbbb-0000-0000-0000-00000000000b');
select pg_temp.check('deelnemer ziet de kamer waarin hij een naam heeft', (select array_agg(code) from public.rooms) = array['TEST22']);
select pg_temp.check('deelnemer ziet de trekkingen van zijn kamer, niet die van een andere',
  (select array_agg(result_id) from public.draws) = array['3-1']);
select pg_temp.check('deelnemer ziet geen plaatsen van een andere kamer',
  not exists (select 1 from public.seats where room_id = '22222222-2222-2222-2222-222222222222'));

select pg_temp.as_user('cccccccc-0000-0000-0000-00000000000c');
select pg_temp.check('buitenstaander ziet geen kamers', (select count(*) from public.rooms) = 0);
select pg_temp.check('buitenstaander ziet geen plaatsen', (select count(*) from public.seats) = 0);
select pg_temp.check('buitenstaander ziet geen trekkingen', (select count(*) from public.draws) = 0);

select pg_temp.as_role('anon');
select pg_temp.expect_error('niet-ingelogd (anon) kan kamers niet lezen', 'select * from public.rooms', '42501');
select pg_temp.expect_error('niet-ingelogd (anon) kan trekkingen niet lezen', 'select * from public.draws', '42501');

-- ===========================================================================
-- 2. Schrijven: deelnemers kunnen niets rechtstreeks wijzigen
-- ===========================================================================
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-00000000000b');
select pg_temp.expect_error('deelnemer kan de spelstatus niet wijzigen',
  $q$update public.rooms set state = '{"phase":"finished"}' where code = 'TEST22'$q$, '42501');
select pg_temp.expect_error('deelnemer kan de versie niet ophogen',
  $q$update public.rooms set version = version + 1$q$, '42501');
select pg_temp.expect_error('deelnemer kan geen kamer aanmaken',
  $q$insert into public.rooms (code, organizer_id, state) values ('HACK22', 'bbbbbbbb-0000-0000-0000-00000000000b', '{}')$q$, '42501');
select pg_temp.expect_error('deelnemer kan geen kamer verwijderen',
  $q$delete from public.rooms$q$, '42501');
select pg_temp.expect_error('deelnemer kan zelf geen trekking toevoegen',
  $q$insert into public.draws (room_id, spin_id, result_id, participant, round, started_at, spun_by)
     values ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), '0-0', 1, '1', now(), 'bbbbbbbb-0000-0000-0000-00000000000b')$q$, '42501');
select pg_temp.expect_error('deelnemer kan een trekking niet wijzigen',
  $q$update public.draws set participant = 1$q$, '42501');
select pg_temp.expect_error('deelnemer kan een trekking niet verwijderen',
  $q$delete from public.draws$q$, '42501');
select pg_temp.expect_error('deelnemer kan niet zelf een andere naam claimen',
  $q$insert into public.seats (room_id, participant, user_id) values ('11111111-1111-1111-1111-111111111111', 5, 'bbbbbbbb-0000-0000-0000-00000000000b')$q$, '42501');
select pg_temp.expect_error('deelnemer kan zich niet tot organisator maken',
  $q$update public.seats set is_organizer = true$q$, '42501');
select pg_temp.expect_error('deelnemer kan een naam niet vrijgeven',
  $q$delete from public.seats$q$, '42501');
select pg_temp.expect_error('deelnemer kan de serverfunctie niet aanroepen',
  $q$select public.commit_room_state('11111111-1111-1111-1111-111111111111', 0, '{"phase":"finished"}')$q$, '42501');

select pg_temp.as_user('aaaaaaaa-0000-0000-0000-00000000000a');
select pg_temp.expect_error('ook de organisator kan de spelstatus niet rechtstreeks wijzigen',
  $q$update public.rooms set state = '{"phase":"finished"}'$q$, '42501');
select pg_temp.expect_error('ook de organisator kan geen trekking toevoegen',
  $q$insert into public.draws (room_id, spin_id, result_id, participant, round, started_at, spun_by)
     values ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), '0-0', 0, '2', now(), 'aaaaaaaa-0000-0000-0000-00000000000a')$q$, '42501');
select pg_temp.expect_error('ook de organisator kan de serverfunctie niet aanroepen',
  $q$select public.commit_room_state('11111111-1111-1111-1111-111111111111', 0, '{}')$q$, '42501');

select pg_temp.as_role('anon');
select pg_temp.expect_error('niet-ingelogd (anon) kan de serverfunctie niet aanroepen',
  $q$select public.commit_room_state('11111111-1111-1111-1111-111111111111', 0, '{}')$q$, '42501');

-- ===========================================================================
-- 3. Server: atomair vastleggen, één SPIN per versie, unieke trekkingen
-- ===========================================================================
select pg_temp.as_role('service_role');
select pg_temp.check('server legt status vast en verhoogt de versie',
  public.commit_room_state('11111111-1111-1111-1111-111111111111', 0, '{"phase":"draw","turn":1}') = 1);
select pg_temp.expect_error('tweede verzoek op dezelfde versie wordt geweigerd (dubbele SPIN)',
  $q$select public.commit_room_state('11111111-1111-1111-1111-111111111111', 0, '{"phase":"draw","turn":99}')$q$, 'PT409');
select pg_temp.check('na de geweigerde poging is de status ongewijzigd',
  (select state ->> 'turn' from public.rooms where code = 'TEST22') = '1');

select pg_temp.check('server legt status en trekking samen vast',
  public.commit_room_state('11111111-1111-1111-1111-111111111111', 1, '{"phase":"draw","turn":2}',
    json_build_object('spin_id', gen_random_uuid(), 'result_id', '0-0', 'participant', 1, 'round', '1',
                      'started_at', now(), 'spun_by', 'bbbbbbbb-0000-0000-0000-00000000000b')::jsonb) = 2);
select pg_temp.expect_error('dezelfde uitslag kan niet nog eens vallen in dezelfde kamer',
  $q$select public.commit_room_state('11111111-1111-1111-1111-111111111111', 2, '{"phase":"draw","turn":3}',
     json_build_object('spin_id', gen_random_uuid(), 'result_id', '3-1', 'participant', 2, 'round', '1',
                       'started_at', now(), 'spun_by', 'bbbbbbbb-0000-0000-0000-00000000000b')::jsonb)$q$, '23505');
select pg_temp.check('mislukte trekking draait ook de statuswijziging terug (atomair)',
  (select version = 2 and state ->> 'turn' = '2' from public.rooms where code = 'TEST22'));
select pg_temp.check('dezelfde uitslag mag wel in een andere kamer vallen',
  public.commit_room_state('22222222-2222-2222-2222-222222222222', 0, '{"phase":"draw"}',
    json_build_object('spin_id', gen_random_uuid(), 'result_id', '3-1', 'participant', 1, 'round', '1',
                      'started_at', now(), 'spun_by', 'eeeeeeee-0000-0000-0000-00000000000e')::jsonb) = 1);
select pg_temp.expect_error('dezelfde draai (spin_id) kan niet twee keer worden vastgelegd',
  $q$insert into public.draws (room_id, spin_id, result_id, participant, round, started_at, spun_by)
     select room_id, spin_id, '4-4', 3, '2', now(), spun_by from public.draws limit 1$q$, '23505');
select pg_temp.expect_error('een deelnemer trekt maar één keer per vaste ronde',
  $q$insert into public.draws (room_id, spin_id, result_id, participant, round, started_at, spun_by)
     values ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), '4-4', 1, '1', now(), gen_random_uuid())$q$, '23505');
select pg_temp.expect_error('uitslagen met een 5 bestaan niet',
  $q$insert into public.draws (room_id, spin_id, result_id, participant, round, started_at, spun_by)
     values ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), '5-0', 4, '1', now(), gen_random_uuid())$q$, '23514');
select pg_temp.expect_error('een veilingtrekking heeft altijd een bod',
  $q$insert into public.draws (room_id, spin_id, result_id, participant, round, started_at, spun_by)
     values ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), '4-4', 4, 'veiling', now(), gen_random_uuid())$q$, '23514');
select pg_temp.expect_error('een reguliere trekking heeft geen bod',
  $q$insert into public.draws (room_id, spin_id, result_id, participant, round, bid_cents, started_at, spun_by)
     values ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), '4-4', 4, '2', 1000, now(), gen_random_uuid())$q$, '23514');
select pg_temp.check('veilingtrekking met bod in centen wordt geaccepteerd',
  public.commit_room_state('11111111-1111-1111-1111-111111111111', 2, '{"phase":"auction"}',
    json_build_object('spin_id', gen_random_uuid(), 'result_id', 'OVERIG', 'participant', 4, 'round', 'veiling',
                      'bid_cents', 50, 'started_at', now(), 'spun_by', 'aaaaaaaa-0000-0000-0000-00000000000a',
                      'on_behalf', true)::jsonb) = 3);
select pg_temp.expect_error('trekkingen zijn onveranderlijk, ook voor de server',
  $q$update public.draws set participant = 8 where result_id = '0-0'$q$, '42501');

-- ===========================================================================
-- 4. Plaatsen en kamers: unieke sleutels
-- ===========================================================================
select pg_temp.expect_error('een naam kan maar door één telefoon worden geclaimd',
  $q$insert into public.seats (room_id, participant, user_id) values ('11111111-1111-1111-1111-111111111111', 1, gen_random_uuid())$q$, '23505');
select pg_temp.expect_error('een telefoon kan maar één naam per kamer hebben',
  $q$insert into public.seats (room_id, participant, user_id) values ('11111111-1111-1111-1111-111111111111', 6, 'bbbbbbbb-0000-0000-0000-00000000000b')$q$, '23505');
select pg_temp.expect_error('een kamer heeft maar één organisator',
  $q$insert into public.seats (room_id, participant, user_id, is_organizer) values ('11111111-1111-1111-1111-111111111111', 7, gen_random_uuid(), true)$q$, '23505');
select pg_temp.expect_error('deelnemernummers lopen van 0 tot en met 8',
  $q$insert into public.seats (room_id, participant, user_id) values ('11111111-1111-1111-1111-111111111111', 9, gen_random_uuid())$q$, '23514');
select pg_temp.expect_error('kamercodes zijn uniek',
  $q$insert into public.rooms (code, organizer_id, state) values ('TEST22', gen_random_uuid(), '{}')$q$, '23505');
select pg_temp.expect_error('kamercodes hebben een vast formaat (geen I, O, 0 of 1)',
  $q$insert into public.rooms (code, organizer_id, state) values ('TEST10', gen_random_uuid(), '{}')$q$, '23514');

-- ===========================================================================
-- 5. Configuratie
-- ===========================================================================
select pg_temp.as_admin();
select pg_temp.check('Row Level Security staat aan op alle tabellen in public',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity));
select pg_temp.check('er zijn geen schrijfregels voor deelnemers',
  not exists (select 1 from pg_policies where schemaname = 'public' and cmd <> 'SELECT'));
select pg_temp.check('deelnemers hebben alleen leesrechten op de tabellen',
  not exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name in ('rooms', 'seats', 'draws')
                and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT')
  and not has_table_privilege('anon', 'public.rooms', 'SELECT'));
select pg_temp.check('alleen de server mag de serverfunctie uitvoeren',
  has_function_privilege('service_role', 'public.commit_room_state(uuid, integer, jsonb, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.commit_room_state(uuid, integer, jsonb, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.commit_room_state(uuid, integer, jsonb, jsonb)', 'EXECUTE'));
select pg_temp.check('versieconflict gebruikt PT409, niet 40001 (anders herhaalt PostgREST eindeloos)',
  pg_get_functiondef('public.commit_room_state(uuid, integer, jsonb, jsonb)'::regprocedure) like '%errcode = ''PT409''%'
  and pg_get_functiondef('public.commit_room_state(uuid, integer, jsonb, jsonb)'::regprocedure) not like '%40001%');
-- Met "Automatically expose new tables" UIT krijgen nieuwe tabellen geen
-- standaardrechten: alles wat het spel nodig heeft moet expliciet verleend zijn.
select pg_temp.check('server heeft expliciet alle benodigde tabelrechten',
  (select bool_and(has_table_privilege('service_role', t, p))
     from unnest(array['public.rooms', 'public.seats', 'public.draws']) t,
          unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p)
  and has_sequence_privilege('service_role', pg_get_serial_sequence('public.draws', 'id'), 'USAGE'));
select pg_temp.check('ingelogde deelnemers hebben expliciet leesrecht (voor RLS en Realtime)',
  (select bool_and(has_table_privilege('authenticated', t, 'SELECT'))
     from unnest(array['public.rooms', 'public.seats', 'public.draws']) t)
  and has_function_privilege('authenticated', 'private.is_room_member(uuid)', 'EXECUTE'));
select pg_temp.check('deelnemers hebben geen bijrechten (truncate, trigger, references)',
  not exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name in ('rooms', 'seats', 'draws')
                and grantee in ('anon', 'authenticated') and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')));
select pg_temp.check('het hulpschema is niet bereikbaar voor niet-ingelogden',
  not has_schema_privilege('anon', 'private', 'USAGE'));
select pg_temp.check('kamers en plaatsen worden realtime doorgegeven',
  (select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
     and schemaname = 'public' and tablename in ('rooms', 'seats')) = 2);

select test, ok, detail from pg_temp.results order by n;

rollback;
