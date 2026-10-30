-- Football Score Machine — correctie: versieconflict met foutcode PT409.
--
-- Aanleiding (storing 30-10-2026): commit_room_state meldde een verouderde
-- versie met SQLSTATE 40001 (serialization_failure). PostgREST beschouwt die
-- code als tijdelijk en voert de transactie automatisch opnieuw uit. Omdat de
-- verwachte versie bij elke poging verouderd blijft, ontstond een eindeloze
-- lus die de verbindingspool vulde.
--
-- PT409 is een eigen foutcode die PostgREST niet opnieuw probeert en als
-- HTTP 409 teruggeeft. De Edge Function herkent hem als normaal versieconflict.
-- Alleen de foutcode verandert; gedrag en rechten blijven gelijk.

create or replace function public.commit_room_state(
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
    raise exception 'version_conflict' using errcode = 'PT409';
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

-- 'create or replace' behoudt de rechten; voor de zekerheid opnieuw vastgelegd.
revoke all on function public.commit_room_state(uuid, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.commit_room_state(uuid, integer, jsonb, jsonb) to service_role;
