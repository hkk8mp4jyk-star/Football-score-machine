-- Football Score Machine — migratie 3: het instelbare online spel (F3/F4).
--
-- Wat verandert:
-- 1. De volledige kamer (deelnemers met hun gebruikers-id's, spelregels,
--    volgorde, engine-status, starttijd, veilingaankondiging, faseovergangen)
--    staat als één document in rooms.state en wordt alleen nog door de server
--    gelezen en geschreven. Telefoons lezen de kamer uitsluitend via de Edge
--    Function, die per rol filtert (deelnemers zien in de wachtkamer geen
--    spelregels of volgorde, niemand ziet andermans gebruikers-id).
--    Daarom: geen directe leesrechten meer op rooms, seats en draws.
-- 2. Nieuwe tabel room_pulses (kamer-id + versie): het enige wat telefoons via
--    Realtime ontvangen. Een wijziging betekent "haal de kamer opnieuw op".
--    Bevat geen spelgegevens. Wordt bijgewerkt door een trigger op rooms.
-- 3. Lidmaatschap (voor room_pulses) volgt uit de kamer zelf: organisator of
--    deelnemer in rooms.state -> 'players'. De tabel seats wordt niet meer
--    gebruikt (blijft leeg bestaan; kan later worden opgeruimd).
-- 4. Trekkingen: 0-0 t/m 6-6 + OVERIG (50 uitslagen), deelnemer 0–11 (vast
--    speler-id), rondes 1–4 of 'veiling'.
--
-- Ongewijzigd: commit_room_state (versiecontrole met PT409, status + trekking
-- in één transactie), unieke uitslag per kamer, trekkingen onveranderlijk.
-- Aanmelden en starten (D8) zijn beide een commit op dezelfde kamerrij met
-- versiecontrole en worden daardoor door Postgres geserialiseerd.

-- ---------------------------------------------------------------------------
-- 1. Geen directe leesrechten meer voor deelnemers op de speltabellen
-- ---------------------------------------------------------------------------
drop policy if exists rooms_select_members on public.rooms;
drop policy if exists seats_select_members on public.seats;
drop policy if exists draws_select_members on public.draws;
revoke all on public.rooms, public.seats, public.draws from anon, authenticated;
alter publication supabase_realtime drop table public.rooms, public.seats;

-- ---------------------------------------------------------------------------
-- 2. Trekkingen: instelbaar spel
-- ---------------------------------------------------------------------------
alter table public.draws drop constraint draws_result_id_check;
alter table public.draws add constraint draws_result_id_check check (
  result_id = 'OVERIG' or result_id ~ '^[0-6]-[0-6]$'
);
alter table public.draws drop constraint draws_participant_check;
alter table public.draws add constraint draws_participant_check check (participant between 0 and 11);
alter table public.draws drop constraint draws_round_check;
alter table public.draws add constraint draws_round_check check (round in ('1', '2', '3', '4', 'veiling'));

-- ---------------------------------------------------------------------------
-- 3. Lidmaatschap uit de kamer zelf
-- ---------------------------------------------------------------------------
create or replace function private.is_room_member(p_room_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
     where r.id = p_room_id
       and ((select auth.uid()) is not null)
       and (r.organizer_id = (select auth.uid())
            or (r.state -> 'players') @> jsonb_build_array(jsonb_build_object('userId', (select auth.uid())::text)))
  );
$$;

revoke all on function private.is_room_member(uuid) from public, anon;
grant execute on function private.is_room_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Realtime-signaal per kamer
-- ---------------------------------------------------------------------------
create table public.room_pulses (
  room_id    uuid primary key references public.rooms (id) on delete cascade,
  version    integer not null,
  updated_at timestamptz not null default now()
);

comment on table public.room_pulses is 'Realtime-signaal: versie van een kamer. Geen spelgegevens; alleen leesbaar voor leden.';

alter table public.room_pulses enable row level security;
revoke all on public.room_pulses from anon, authenticated;
grant select on public.room_pulses to authenticated;
grant select, insert, update, delete on public.room_pulses to service_role;

create policy room_pulses_select_members on public.room_pulses
  for select to authenticated using ((select private.is_room_member(room_id)));

create function private.pulse_room() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.room_pulses (room_id, version, updated_at)
  values (new.id, new.version, now())
  on conflict (room_id) do update set version = excluded.version, updated_at = excluded.updated_at;
  return null;
end $$;

revoke all on function private.pulse_room() from public, anon, authenticated;

create trigger rooms_pulse after insert or update of version on public.rooms
  for each row execute function private.pulse_room();

alter publication supabase_realtime add table public.room_pulses;
