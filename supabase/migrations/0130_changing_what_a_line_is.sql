-- =============================================================================
-- 0130 — Changing what a line is
--
-- A line's description has been read-only since the workspace was built. An
-- estimator could add a line, delete a line, reorder lines, change the quantity,
-- the unit, the crew, the rate and the markup — and could not fix a typo in
-- what the line says, or swap a line onto the right library item once they
-- found it.
--
-- Both are the same gesture from where the estimator sits: they click the words
-- and type. What happens underneath is two different things, and the difference
-- matters enough to be two functions rather than one that guesses.
--
-- **Changing the words** is already `app.update_estimate_line`, and it always
-- was — the screen simply never offered it.
--
-- **Changing what the line *is*** repoints it at a different library service,
-- and that has consequences: the unit, the cost code and the production rate
-- all belong to the service, not to the line. `app.set_line_service` brings
-- them across, and says so, rather than leaving a line labeled "Storm sewer
-- installation" priced at the excavation rate it had before.
--
-- Two refusals worth stating.
--
-- The unit only follows if the line has not been priced yet. Changing CY to LF
-- underneath a quantity somebody measured would silently rescale the line;
-- where resources are already on it the unit stays and the caller is told.
--
-- And clearing the service — going back to a line of your own words — keeps the
-- description that was on screen. A line that lost its name when it lost its
-- library link would be an empty row an estimator has to remember the meaning
-- of.
-- =============================================================================

/**
 * Point an existing line at a different library service.
 *
 * `p_service` null clears the link and leaves the line as typed words, which is
 * how an estimator takes a line back off the library without deleting it.
 */
create or replace function public.set_line_service(
  p_line    uuid,
  p_service uuid,
  p_keep_description boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_company  uuid;
  v_status   app.estimate_status;
  v_line     estimate_line_items;
  v_svc      services;
  v_priced   int;
  v_unit     app.unit_code;
  v_rate     uuid;
  v_changed  text[] := '{}';
begin
  /* A row variable takes the whole row on its own; the version's two fields
     come separately, which PL/pgSQL requires. */
  select * into v_line from estimate_line_items where id = p_line;
  select v.status, v.company_id into v_status, v_company
  from estimate_versions v where v.id = v_line.estimate_version_id;

  if v_line.id is null then
    raise exception 'No such estimate line' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation',
            hint = 'app.revise_estimate_version copies it forward with a reason.';
  end if;

  select count(*) into v_priced from estimate_line_resources where line_item_id = p_line;

  if p_service is null then
    update estimate_line_items
       set service_id = null,
           description = coalesce(nullif(btrim(v_line.description), ''), description),
           updated_at = now()
     where id = p_line;
    return jsonb_build_object('service', null, 'changed', to_jsonb(array['link']::text[]));
  end if;

  select * into v_svc from services s
  where s.id = p_service
    and (s.company_id is null or s.company_id = v_company)
    and s.status = 'active';
  if v_svc.id is null then
    raise exception 'No such service in your library, or it is not active.'
      using errcode = 'no_data_found';
  end if;

  /*
   * The unit belongs to the service, and follows it — unless resources are
   * already priced against the old one, in which case rescaling silently is the
   * worst available outcome and the caller is told the unit stayed.
   */
  v_unit := v_line.unit;
  if v_priced = 0 and v_svc.default_unit is not null and v_svc.default_unit <> v_line.unit then
    v_unit := v_svc.default_unit;
    v_changed := array_append(v_changed, 'unit');
  end if;

  /* The rate the new service's assembly offers, ranked the way a new line ranks it. */
  select rate_id into v_rate
  from app.production_rate_candidates(p_service, v_unit, v_company)
  order by rank limit 1;

  update estimate_line_items
     set service_id   = v_svc.id,
         description  = case when p_keep_description then description else v_svc.name end,
         unit         = v_unit,
         cost_code_id = coalesce(v_svc.cost_code_id, cost_code_id),
         production_rate_id = coalesce(v_rate, production_rate_id),
         updated_at   = now()
   where id = p_line;

  v_changed := array_append(v_changed, 'link');
  if not p_keep_description then v_changed := array_append(v_changed, 'description'); end if;
  if v_svc.cost_code_id is not null then v_changed := array_append(v_changed, 'cost_code'); end if;
  if v_rate is not null then v_changed := array_append(v_changed, 'production_rate'); end if;

  return jsonb_build_object(
    'service',  v_svc.name,
    'unit',     v_unit::text,
    'unit_held', v_priced > 0 and v_svc.default_unit <> v_line.unit,
    'priced_resources', v_priced,
    'changed',  to_jsonb(v_changed));
end;
$$;

comment on function public.set_line_service(uuid, uuid, boolean) is
  'Repoints an estimate line at a different library service, bringing the unit, cost code and production rate with it. WORKFLOW: the unit is held back when resources are already priced on the line, because rescaling a measured quantity underneath somebody is worse than leaving the unit alone and saying so.';

revoke all on function public.set_line_service(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_line_service(uuid, uuid, boolean) to authenticated;
