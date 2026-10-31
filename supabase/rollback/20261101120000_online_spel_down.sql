-- TERUGDRAAIEN van migratie 3 (online_spel). NIET automatisch uitvoeren;
-- alleen handmatig, na akkoord, als terugvaloptie (zie CLAUDE.md §7).
--
-- Volgorde bij terugvallen:
-- 1. Edge Function 'game' terugzetten naar de vorige versie (code van commit
--    90e0265 / F3). Die werkt met en zonder migratie 3 (gebruikt alleen
--    rooms, seats en commit_room_state, die blijven bestaan).
-- 2. Dit script uitvoeren. Voorwaarde: geen trekkingen met uitslagen of
--    rondes buiten het oude spel (anders faalt het terugzetten van de
--    controles; dan eerst die testkamers verwijderen).

begin;

alter publication supabase_realtime drop table public.room_pulses;
drop trigger if exists rooms_pulse on public.rooms;
drop function if exists private.pulse_room();
drop table if exists public.room_pulses;

-- Oud lidmaatschap (plaatsen of organisator).
create or replace function private.is_room_member(p_room_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.seats s where s.room_id = p_room_id and s.user_id = (select auth.uid()))
      or exists (select 1 from public.rooms r where r.id = p_room_id and r.organizer_id = (select auth.uid()));
$$;
revoke all on function private.is_room_member(uuid) from public, anon;
grant execute on function private.is_room_member(uuid) to authenticated;

-- Oude controles op trekkingen.
alter table public.draws drop constraint draws_result_id_check;
alter table public.draws add constraint draws_result_id_check check (result_id in (
  '0-0', '0-1', '0-2', '0-3', '0-4', '1-0', '1-1', '1-2', '1-3', '1-4',
  '2-0', '2-1', '2-2', '2-3', '2-4', '3-0', '3-1', '3-2', '3-3', '3-4',
  '4-0', '4-1', '4-2', '4-3', '4-4', 'OVERIG'));
alter table public.draws drop constraint draws_participant_check;
alter table public.draws add constraint draws_participant_check check (participant between 0 and 8);
alter table public.draws drop constraint draws_round_check;
alter table public.draws add constraint draws_round_check check (round in ('1', '2', 'veiling'));

-- Oude leesrechten en Realtime.
grant select on public.rooms, public.seats, public.draws to authenticated;
create policy rooms_select_members on public.rooms for select to authenticated using ((select private.is_room_member(id)));
create policy seats_select_members on public.seats for select to authenticated using ((select private.is_room_member(room_id)));
create policy draws_select_members on public.draws for select to authenticated using ((select private.is_room_member(room_id)));
alter publication supabase_realtime add table public.rooms, public.seats;

-- Registratie van de migratie verwijderen (zodat db:status klopt).
delete from supabase_migrations.schema_migrations where name = 'online_spel';

commit;
