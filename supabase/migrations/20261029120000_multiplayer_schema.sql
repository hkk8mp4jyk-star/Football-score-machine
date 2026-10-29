-- Football Score Machine — multiplayer, fase 2: databaseschema en beveiliging.
--
-- Principe: deelnemers (anonieme Supabase-gebruikers, rol `authenticated`)
-- mogen alleen LEZEN wat bij hun eigen speelkamer hoort. Alle wijzigingen
-- (kamer aanmaken, naam claimen, SPIN, veiling) lopen via de server
-- (Edge Function met service_role), die de spelregels uit src/game/engine.js
-- toepast en het resultaat atomair vastlegt via public.commit_room_state.

-- ---------------------------------------------------------------------------
-- Afgeschermd schema voor hulpfuncties (niet bereikbaar via de API)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Speelkamers: één rij per spel, met de volledige spelstatus (engine-formaat)
-- ---------------------------------------------------------------------------
create table public.rooms (
  id           uuid primary key default gen_random_uuid(),
  -- Kamercode voor de uitnodiging: 6 tekens, zonder verwarrende I, O, 0 en 1.
  code         text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  organizer_id uuid not null,
  state        jsonb not null check (jsonb_typeof(state) = 'object' and octet_length(state::text) < 200000),
  -- Optimistische vergrendeling: elke wijziging verhoogt de versie. Twee
  -- gelijktijdige SPIN-verzoeken op dezelfde versie: precies één slaagt.
  version      integer not null default 0 check (version >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.rooms is 'Speelkamers. Alleen leesbaar voor leden; schrijven uitsluitend via de server.';

-- ---------------------------------------------------------------------------
-- Plaatsen: welke telefoon (anonieme gebruiker) welke deelnemer is
-- ---------------------------------------------------------------------------
create table public.seats (
  room_id      uuid not null references public.rooms (id) on delete cascade,
  participant  smallint not null check (participant between 0 and 8),
  user_id      uuid not null,
  is_organizer boolean not null default false,
  claimed_at   timestamptz not null default now(),
  primary key (room_id, participant),       -- een naam kan maar door één telefoon geclaimd worden
  unique (room_id, user_id)                  -- een telefoon heeft maar één naam per kamer
);

create unique index seats_one_organizer_per_room on public.seats (room_id) where is_organizer;

comment on table public.seats is 'Gekozen namen per kamer. Alleen leesbaar voor leden; schrijven uitsluitend via de server.';

-- ---------------------------------------------------------------------------
-- Trekkingen: definitief vastgelegd op het moment dat de server SPIN accepteert
-- ---------------------------------------------------------------------------
create table public.draws (
  id          bigint generated always as identity primary key,
  room_id     uuid not null references public.rooms (id) on delete cascade,
  spin_id     uuid not null unique,
  result_id   text not null check (result_id in (
                '0-0', '0-1', '0-2', '0-3', '0-4', '1-0', '1-1', '1-2', '1-3', '1-4',
                '2-0', '2-1', '2-2', '2-3', '2-4', '3-0', '3-1', '3-2', '3-3', '3-4',
                '4-0', '4-1', '4-2', '4-3', '4-4', 'OVERIG')),
  participant smallint not null check (participant between 0 and 8),
  round       text not null check (round in ('1', '2', 'veiling')),
  bid_cents   integer check (bid_cents >= 0),
  started_at  timestamptz not null,
  spun_by     uuid not null,                 -- telefoon die SPIN drukte
  on_behalf   boolean not null default false, -- noodfunctie: organisator draaide namens de deelnemer
  created_at  timestamptz not null default now(),
  -- Vangnet: een uitslag kan nooit twee keer in dezelfde kamer vallen.
  unique (room_id, result_id),
  -- Veiling heeft altijd een bod, vaste rondes nooit.
  check ((round = 'veiling') = (bid_cents is not null))
);

-- Vangnet: iedere deelnemer trekt precies één keer per vaste ronde.
create unique index draws_one_per_regular_round on public.draws (room_id, round, participant) where round <> 'veiling';
create index draws_room_idx on public.draws (room_id);

comment on table public.draws is 'Definitieve trekkingen. Uniek per kamer en uitslag; nooit te wijzigen.';

-- Trekkingen zijn onveranderlijk, ook voor de server.
create function private.forbid_draw_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'trekkingen zijn definitief en kunnen niet worden gewijzigd' using errcode = '42501';
end $$;

create trigger draws_immutable before update on public.draws
  for each row execute function private.forbid_draw_update();

-- ---------------------------------------------------------------------------
-- Lidmaatschap (voor de leesrechten). SECURITY DEFINER zodat de controle
-- niet zelf weer door de leesregels van seats/rooms loopt.
-- ---------------------------------------------------------------------------
create function private.is_room_member(p_room_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.seats s where s.room_id = p_room_id and s.user_id = (select auth.uid()))
      or exists (select 1 from public.rooms r where r.id = p_room_id and r.organizer_id = (select auth.uid()));
$$;

revoke all on function private.is_room_member(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_room_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security en rechten: deelnemers lezen, de server schrijft
-- ---------------------------------------------------------------------------
alter table public.rooms enable row level security;
alter table public.seats enable row level security;
alter table public.draws enable row level security;

revoke all on public.rooms, public.seats, public.draws from anon, authenticated;
grant select on public.rooms, public.seats, public.draws to authenticated;

-- De server (Edge Function met service_role) beheert alle gegevens.
grant select, insert, update, delete on public.rooms, public.seats, public.draws to service_role;
grant usage on all sequences in schema public to service_role;

create policy rooms_select_members on public.rooms
  for select to authenticated using ((select private.is_room_member(id)));

create policy seats_select_members on public.seats
  for select to authenticated using ((select private.is_room_member(room_id)));

create policy draws_select_members on public.draws
  for select to authenticated using ((select private.is_room_member(room_id)));

-- Bewust GEEN insert-, update- of delete-regels voor deelnemers.

-- ---------------------------------------------------------------------------
-- Serverfunctie: spelstatus en (optioneel) trekking atomair vastleggen
-- ---------------------------------------------------------------------------
-- p_expected_version: de versie waarop de server zijn berekening baseerde.
-- Klopt die niet meer (iemand anders was sneller), dan faalt de aanroep met
-- 'version_conflict' en verandert er niets. Faalt het vastleggen van de
-- trekking (bijv. dubbele uitslag), dan wordt ook de status niet gewijzigd.
create function public.commit_room_state(
  p_room_id uuid,
  p_expected_version integer,
  p_state jsonb,
  p_draw jsonb default null
) returns integer
language plpgsql set search_path = '' as $$
declare
  v_version integer;
begin
  update public.rooms
     set state = p_state, version = version + 1, updated_at = now()
   where id = p_room_id and version = p_expected_version
  returning version into v_version;

  if v_version is null then
    raise exception 'version_conflict' using errcode = '40001';
  end if;

  if p_draw is not null then
    insert into public.draws (room_id, spin_id, result_id, participant, round, bid_cents, started_at, spun_by, on_behalf)
    values (
      p_room_id,
      (p_draw ->> 'spin_id')::uuid,
      p_draw ->> 'result_id',
      (p_draw ->> 'participant')::smallint,
      p_draw ->> 'round',
      (p_draw ->> 'bid_cents')::integer,
      (p_draw ->> 'started_at')::timestamptz,
      (p_draw ->> 'spun_by')::uuid,
      coalesce((p_draw ->> 'on_behalf')::boolean, false)
    );
  end if;

  return v_version;
end $$;

revoke all on function public.commit_room_state(uuid, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.commit_room_state(uuid, integer, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Realtime: telefoons ontvangen wijzigingen van hun kamer (RLS geldt ook hier)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.rooms, public.seats;
