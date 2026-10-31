-- Beveiligings- en databasetests voor het multiplayer-schema (na migratie 3).
--
-- Draait volledig binnen één transactie die aan het eind wordt teruggedraaid:
-- er blijft niets achter in de database. Uitvoer: één rij per test
-- (test, ok, detail). Uitvoeren met: npm run db:test
--
-- Principe: telefoons lezen de kamer alleen via de server (Edge Function, per
-- rol gefilterd) en ontvangen via Realtime alleen room_pulses (kamer + versie).
--
-- Rollen:
--   A = organisator van kamer 1 en deelnemer
--   B = deelnemer in kamer 1
--   O = organisator van kamer 3 die zelf niet meespeelt
--   R = uit kamer 1 verwijderd
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

-- Testgegevens (als beheerder). De kamer is één document in state.
insert into public.rooms (id, code, organizer_id, state) values
  ('11111111-1111-1111-1111-111111111111', 'TEST22', 'aaaaaaaa-0000-0000-0000-00000000000a',
   '{"phase":"lobby","players":[{"slot":0,"userId":"aaaaaaaa-0000-0000-0000-00000000000a","name":"Lars"},
                                {"slot":1,"userId":"bbbbbbbb-0000-0000-0000-00000000000b","name":"Sanne"},
                                {"slot":2,"userId":null,"name":"Opa","manual":true}],
     "removedUserIds":["dddddddd-0000-0000-0000-00000000000d"],
     "draft":{"maxPlayers":3,"rounds":1,"priceCents":1000,"pool":["0-0","1-1","2-2","OVERIG"],"mega":["0-0"]}}'),
  ('22222222-2222-2222-2222-222222222222', 'TEST33', 'eeeeeeee-0000-0000-0000-00000000000e',
   '{"phase":"lobby","players":[{"slot":0,"userId":"eeeeeeee-0000-0000-0000-00000000000e","name":"Xander"}]}'),
  ('33333333-3333-3333-3333-333333333333', 'TEST44', 'ffffffff-0000-0000-0000-00000000000f',
   '{"phase":"lobby","players":[{"slot":1,"userId":"bbbbbbbb-0000-0000-0000-00000000000b","name":"Sanne"}]}');
insert into public.draws (room_id, spin_id, result_id, participant, round, bid_cents, started_at, spun_by) values
  ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), '3-1', 0, '1', null, now(), 'aaaaaaaa-0000-0000-0000-00000000000a'),
  ('22222222-2222-2222-2222-222222222222', gen_random_uuid(), '2-2', 0, '1', null, now(), 'eeeeeeee-0000-0000-0000-00000000000e');

-- ===========================================================================
-- 1. Lezen: geen directe toegang tot de speltabellen; alleen het eigen signaal
-- ===========================================================================
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-00000000000b');
select pg_temp.expect_error('deelnemer kan de kamer (spelregels, volgorde, id''s) niet rechtstreeks lezen', 'select * from public.rooms', '42501');
select pg_temp.expect_error('deelnemer kan plaatsen niet rechtstreeks lezen', 'select * from public.seats', '42501');
select pg_temp.expect_error('deelnemer kan trekkingen niet rechtstreeks lezen', 'select * from public.draws', '42501');
select pg_temp.check('deelnemer ziet alleen de signalen van zijn eigen kamers',
  (select array_agg(room_id order by room_id) from public.room_pulses)
    = array['11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333']::uuid[]);
select pg_temp.check('het signaal bevat alleen kamer, versie en tijd',
  (select array_agg(column_name::text order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'room_pulses') = array['room_id', 'updated_at', 'version']);

select pg_temp.as_user('aaaaaaaa-0000-0000-0000-00000000000a');
select pg_temp.check('organisator ziet het signaal van zijn eigen kamer',
  (select array_agg(room_id) from public.room_pulses) = array['11111111-1111-1111-1111-111111111111']::uuid[]);
select pg_temp.expect_error('ook de organisator leest de kamer niet rechtstreeks', 'select state from public.rooms', '42501');

select pg_temp.as_user('ffffffff-0000-0000-0000-00000000000f');
select pg_temp.check('organisator die zelf niet meespeelt is lid van zijn kamer',
  (select array_agg(room_id) from public.room_pulses) = array['33333333-3333-3333-3333-333333333333']::uuid[]);

select pg_temp.as_user('dddddddd-0000-0000-0000-00000000000d');
select pg_temp.check('verwijderde deelnemer ontvangt geen signalen meer', (select count(*) from public.room_pulses) = 0);

select pg_temp.as_user('cccccccc-0000-0000-0000-00000000000c');
select pg_temp.check('buitenstaander ziet geen signalen', (select count(*) from public.room_pulses) = 0);

select pg_temp.as_role('anon');
select pg_temp.expect_error('niet-ingelogd (anon) kan signalen niet lezen', 'select * from public.room_pulses', '42501');
select pg_temp.expect_error('niet-ingelogd (anon) kan kamers niet lezen', 'select * from public.rooms', '42501');

-- ===========================================================================
-- 2. Schrijven: deelnemers kunnen niets rechtstreeks wijzigen
-- ===========================================================================
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-00000000000b');
select pg_temp.expect_error('deelnemer kan de spelstatus niet wijzigen',
  $q$update public.rooms set state = '{"phase":"finished"}' where code = 'TEST22'$q$, '42501');
select pg_temp.expect_error('deelnemer kan geen kamer aanmaken',
  $q$insert into public.rooms (code, organizer_id, state) values ('HACK22', 'bbbbbbbb-0000-0000-0000-00000000000b', '{}')$q$, '42501');
select pg_temp.expect_error('deelnemer kan geen kamer verwijderen', $q$delete from public.rooms$q$, '42501');
select pg_temp.expect_error('deelnemer kan zelf geen trekking toevoegen',
  $q$insert into public.draws (room_id, spin_id, result_id, participant, round, started_at, spun_by)
     values ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), '0-0', 1, '1', now(), 'bbbbbbbb-0000-0000-0000-00000000000b')$q$, '42501');
select pg_temp.expect_error('deelnemer kan een trekking niet wijzigen', $q$update public.draws set participant = 1$q$, '42501');
select pg_temp.expect_error('deelnemer kan een trekking niet verwijderen', $q$delete from public.draws$q$, '42501');
select pg_temp.expect_error('deelnemer kan zich niet tot organisator maken',
  $q$update public.rooms set organizer_id = 'bbbbbbbb-0000-0000-0000-00000000000b'$q$, '42501');
select pg_temp.expect_error('deelnemer kan geen signaal vervalsen',
  $q$update public.room_pulses set version = version + 1$q$, '42501');
select pg_temp.expect_error('deelnemer kan geen signaal toevoegen',
  $q$insert into public.room_pulses (room_id, version) values ('22222222-2222-2222-2222-222222222222', 9)$q$, '42501');
select pg_temp.expect_error('deelnemer kan de serverfunctie niet aanroepen',
  $q$select public.commit_room_state('11111111-1111-1111-1111-111111111111', 0, '{"phase":"finished"}')$q$, '42501');
select pg_temp.expect_error('deelnemer kan de signaalfunctie niet aanroepen',
  $q$select private.pulse_room()$q$, '42501');

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
select pg_temp.check('nieuwe kamer krijgt meteen een signaal (versie 0)',
  (select version from public.room_pulses where room_id = '22222222-2222-2222-2222-222222222222') = 0);
select pg_temp.check('server legt status vast en verhoogt de versie',
  public.commit_room_state('11111111-1111-1111-1111-111111111111', 0, '{"phase":"started","turn":1}') = 1);
select pg_temp.check('signaal volgt de versie', (select version from public.room_pulses where room_id = '11111111-1111-1111-1111-111111111111') = 1);
select pg_temp.expect_error('tweede verzoek op dezelfde versie wordt geweigerd (dubbele SPIN)',
  $q$select public.commit_room_state('11111111-1111-1111-1111-111111111111', 0, '{"phase":"started","turn":99}')$q$, 'PT409');
select pg_temp.check('na de geweigerde poging zijn status en signaal ongewijzigd',
  (select state ->> 'turn' = '1' from public.rooms where code = 'TEST22')
  and (select version from public.room_pulses where room_id = '11111111-1111-1111-1111-111111111111') = 1);

select pg_temp.check('server legt status en trekking samen vast',
  public.commit_room_state('11111111-1111-1111-1111-111111111111', 1, '{"phase":"started","turn":2}',
    json_build_object('spin_id', gen_random_uuid(), 'result_id', '0-0', 'participant', 1, 'round', '1',
                      'started_at', now(), 'spun_by', 'bbbbbbbb-0000-0000-0000-00000000000b')::jsonb) = 2);
select pg_temp.expect_error('dezelfde uitslag kan niet nog eens vallen in dezelfde kamer',
  $q$select public.commit_room_state('11111111-1111-1111-1111-111111111111', 2, '{"turn":3}',
     json_build_object('spin_id', gen_random_uuid(), 'result_id', '3-1', 'participant', 2, 'round', '1',
                       'started_at', now(), 'spun_by', 'bbbbbbbb-0000-0000-0000-00000000000b')::jsonb)$q$, '23505');
select pg_temp.check('mislukte trekking draait ook de statuswijziging terug (atomair)',
  (select version = 2 and state ->> 'turn' = '2' from public.rooms where code = 'TEST22'));
select pg_temp.check('dezelfde uitslag mag wel in een andere kamer vallen',
  public.commit_room_state('22222222-2222-2222-2222-222222222222', 0, '{"phase":"started"}',
    json_build_object('spin_id', gen_random_uuid(), 'result_id', '3-1', 'participant', 1, 'round', '1',
                      'started_at', now(), 'spun_by', 'eeeeeeee-0000-0000-0000-00000000000e')::jsonb) = 1);
select pg_temp.expect_error('dezelfde draai (spin_id) kan niet twee keer worden vastgelegd',
  $q$insert into public.draws (room_id, spin_id, result_id, participant, round, started_at, spun_by)
     select room_id, spin_id, '4-4', 3, '2', now(), spun_by from public.draws limit 1$q$, '23505');
select pg_temp.expect_error('een deelnemer trekt maar één keer per vaste ronde',
  $q$insert into public.draws (room_id, spin_id, result_id, participant, round, started_at, spun_by)
     values ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), '4-4', 1, '1', now(), gen_random_uuid())$q$, '23505');
-- Instelbaar spel: 0-0 t/m 6-6, deelnemers 0–11, rondes 1–4.
select pg_temp.check('uitslagen tot 6-6, deelnemer 11 en ronde 4 worden geaccepteerd',
  public.commit_room_state('11111111-1111-1111-1111-111111111111', 2, '{"turn":3}',
    json_build_object('spin_id', gen_random_uuid(), 'result_id', '6-5', 'participant', 11, 'round', '4',
                      'started_at', now(), 'spun_by', gen_random_uuid())::jsonb) = 3);
select pg_temp.expect_error('uitslagen boven 6 goals bestaan niet',
  $q$insert into public.draws (room_id, spin_id, result_id, participant, round, started_at, spun_by)
     values ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), '7-0', 4, '1', now(), gen_random_uuid())$q$, '23514');
select pg_temp.expect_error('onbekende uitslag-id wordt geweigerd',
  $q$insert into public.draws (room_id, spin_id, result_id, participant, round, started_at, spun_by)
     values ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), 'OVERIGE', 4, '1', now(), gen_random_uuid())$q$, '23514');
select pg_temp.expect_error('deelnemernummers lopen van 0 tot en met 11',
  $q$insert into public.draws (room_id, spin_id, result_id, participant, round, started_at, spun_by)
     values ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), '4-4', 12, '1', now(), gen_random_uuid())$q$, '23514');
select pg_temp.expect_error('er zijn maximaal 4 vaste rondes',
  $q$insert into public.draws (room_id, spin_id, result_id, participant, round, started_at, spun_by)
     values ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), '4-4', 4, '5', now(), gen_random_uuid())$q$, '23514');
select pg_temp.expect_error('een veilingtrekking heeft altijd een bod',
  $q$insert into public.draws (room_id, spin_id, result_id, participant, round, started_at, spun_by)
     values ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), '4-4', 4, 'veiling', now(), gen_random_uuid())$q$, '23514');
select pg_temp.expect_error('een reguliere trekking heeft geen bod',
  $q$insert into public.draws (room_id, spin_id, result_id, participant, round, bid_cents, started_at, spun_by)
     values ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), '4-4', 4, '2', 1000, now(), gen_random_uuid())$q$, '23514');
select pg_temp.check('veilingtrekking met bod in centen (ook namens) wordt geaccepteerd',
  public.commit_room_state('11111111-1111-1111-1111-111111111111', 3, '{"phase":"started"}',
    json_build_object('spin_id', gen_random_uuid(), 'result_id', 'OVERIG', 'participant', 4, 'round', 'veiling',
                      'bid_cents', 50, 'started_at', now(), 'spun_by', 'aaaaaaaa-0000-0000-0000-00000000000a',
                      'on_behalf', true)::jsonb) = 4);
select pg_temp.expect_error('trekkingen zijn onveranderlijk, ook voor de server',
  $q$update public.draws set participant = 8 where result_id = '0-0'$q$, '42501');
delete from public.rooms where id = '33333333-3333-3333-3333-333333333333';
select pg_temp.check('kamer verwijderen ruimt het signaal op',
  not exists (select 1 from public.room_pulses where room_id = '33333333-3333-3333-3333-333333333333'));

-- ===========================================================================
-- 4. Kamers: unieke sleutels
-- ===========================================================================
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
select pg_temp.check('de enige leesregel is die voor de eigen signalen',
  (select array_agg(policyname::text) from pg_policies where schemaname = 'public') = array['room_pulses_select_members']);
select pg_temp.check('deelnemers hebben geen enkel recht op kamers, plaatsen en trekkingen',
  not exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name in ('rooms', 'seats', 'draws')
                and grantee in ('anon', 'authenticated')));
select pg_temp.check('deelnemers mogen signalen alleen lezen; niet-ingelogden niets',
  (select array_agg(privilege_type::text) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'room_pulses' and grantee = 'authenticated') = array['SELECT']
  and not exists (select 1 from information_schema.role_table_grants
                  where table_schema = 'public' and table_name = 'room_pulses' and grantee = 'anon'));
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
     from unnest(array['public.rooms', 'public.seats', 'public.draws', 'public.room_pulses']) t,
          unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p)
  and has_sequence_privilege('service_role', pg_get_serial_sequence('public.draws', 'id'), 'USAGE'));
select pg_temp.check('lidmaatschapscontrole uitvoerbaar voor ingelogden (RLS en Realtime)',
  has_function_privilege('authenticated', 'private.is_room_member(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.is_room_member(uuid)', 'EXECUTE'));
select pg_temp.check('signaalfunctie niet uitvoerbaar voor deelnemers',
  not has_function_privilege('authenticated', 'private.pulse_room()', 'EXECUTE')
  and not has_function_privilege('anon', 'private.pulse_room()', 'EXECUTE'));
select pg_temp.check('het hulpschema is niet bereikbaar voor niet-ingelogden',
  not has_schema_privilege('anon', 'private', 'USAGE'));
select pg_temp.check('alleen de signalen worden realtime doorgegeven',
  (select array_agg(tablename::text) from pg_publication_tables where pubname = 'supabase_realtime'
     and schemaname = 'public') = array['room_pulses']);

select test, ok, detail from pg_temp.results order by n;

rollback;
