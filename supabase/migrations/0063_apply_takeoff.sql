-- =============================================================================
-- 0063 — A measurement reaching an estimate line
--
-- Migration 0061 built the measuring. This is the step that makes it worth
-- anything: the traced shape becoming a quantity on a line somebody bids.
--
-- Earthwork already had this path — `surface_comparisons.applied_line_item_id`
-- puts a cut or fill volume onto a line. Measurements use the same one, so
-- however a quantity was arrived at, it arrives the same way.
--
-- Three things travel with the number, and the third is the reason this is a
-- function rather than two updates from a browser:
--
--   * **The quantity**, onto `measured_quantity`.
--   * **The provenance**, onto `source_references`, so the line says which
--     sheet and which measurement it came from rather than leaving somebody to
--     remember.
--   * **How it was measured**, onto `measurement_method`, taken from the
--     calibration and never from the caller. This is the whole governance
--     chain: a scale calibrated against a printed dimension carries
--     `verified_scale` and one taken off the title block carries
--     `approximate_scale`, the confidence engine scores them differently, and
--     the approval gate routes on the result. If an application could pass this
--     value in, the generated column on `takeoff_calibrations` that computes it
--     honestly would be decoration.
--
-- All three land in one transaction. A line carrying a takeoff quantity with no
-- record of where it came from is worse than a line somebody typed, because it
-- looks sourced.
--
-- What this deliberately does NOT do is recompute the quantity in SQL. The
-- arithmetic belongs to the estimating engine, and a second implementation here
-- would be a second opinion about what a measurement comes to. The geometry is
-- stored, so any figure can be re-derived and checked; and
-- `reporting_takeoff_status` reports a measurement retraced after it was
-- applied, which is the case that actually goes wrong over time.
-- =============================================================================

create or replace function app.apply_takeoff_to_line(
  p_measurement uuid,
  p_line_item   uuid,
  p_quantity    numeric,
  p_engine_version text
)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_m         takeoff_measurements%rowtype;
  v_method    text;
  v_sheet     text;
  v_reference text;
begin
  if p_quantity is null or p_quantity < 0 then
    raise exception 'A takeoff quantity must be zero or more'
      using errcode = 'check_violation';
  end if;
  if p_engine_version is null or length(trim(p_engine_version)) = 0 then
    raise exception 'An applied measurement must record which engine measured it'
      using errcode = 'check_violation';
  end if;

  -- Row level security decides visibility: a measurement or a line the caller
  -- cannot see simply is not found here.
  select * into v_m from takeoff_measurements where id = p_measurement;
  if not found then
    raise exception 'Measurement % not found', p_measurement using errcode = 'no_data_found';
  end if;

  if not exists (select 1 from estimate_line_items where id = p_line_item) then
    raise exception 'Estimate line % not found', p_line_item using errcode = 'no_data_found';
  end if;

  /*
   * A measurement and the line it feeds must belong to the same company. Row
   * level security already prevents reaching across a tenant boundary, and this
   * says so explicitly rather than relying on the reader to work it out.
   */
  if not exists (
    select 1 from estimate_line_items l
    where l.id = p_line_item and l.company_id = v_m.company_id
  ) then
    raise exception 'That measurement and that estimate line belong to different companies'
      using errcode = 'insufficient_privilege';
  end if;

  -- How it was measured comes from the calibration, never from the caller.
  -- A count is derived: it does not depend on the scale being right.
  if v_m.kind = 'count' then
    v_method := 'derived';
  else
    select c.measurement_method into v_method
    from takeoff_calibrations c where c.id = v_m.calibration_id;
    if v_method is null then
      raise exception 'That measurement has no scale, so there is nothing to say about how it was measured'
        using errcode = 'check_violation';
    end if;
  end if;

  select coalesce(s.sheet_number, 'p.' || s.page_number) into v_sheet
  from document_sheets s where s.id = v_m.document_sheet_id;

  v_reference := format('Takeoff %s on %s (%s)', v_m.name, v_sheet, v_method);

  update estimate_line_items
     set measured_quantity  = p_quantity,
         unit               = v_m.unit,
         measurement_method = v_method::app.measurement_method,
         -- Appended rather than replaced: a line may be supported by more than
         -- one measurement, and dropping the others would lose the argument.
         source_references  = (
           select array_agg(distinct r)
           from unnest(source_references || array[v_reference]) r),
         updated_at         = now()
   where id = p_line_item;

  update takeoff_measurements
     set applied_line_item_id   = p_line_item,
         applied_quantity       = p_quantity,
         applied_at             = now(),
         applied_by             = auth.uid(),
         applied_engine_version = p_engine_version,
         updated_at             = now()
   where id = p_measurement;
end;
$$;

comment on function app.apply_takeoff_to_line(uuid, uuid, numeric, text) is
  'Puts a measured quantity onto an estimate line with its provenance and how it was measured, in one transaction. measurement_method is read from the calibration and never accepted from the caller, because that value decides the line confidence and the approval gate.';

-- Reachable over PostgREST, like everything the browser calls.
create or replace function public.apply_takeoff_to_line(
  p_measurement uuid, p_line_item uuid, p_quantity numeric, p_engine_version text)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  perform app.apply_takeoff_to_line(p_measurement, p_line_item, p_quantity, p_engine_version);
end;
$$;

revoke all on function public.apply_takeoff_to_line(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.apply_takeoff_to_line(uuid, uuid, numeric, text) to authenticated;
grant execute on function app.apply_takeoff_to_line(uuid, uuid, numeric, text) to authenticated;

select app.assert_security_gates();
