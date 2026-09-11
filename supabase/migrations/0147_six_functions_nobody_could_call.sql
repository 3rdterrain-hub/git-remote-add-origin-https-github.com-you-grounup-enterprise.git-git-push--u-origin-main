-- =============================================================================
-- 0147 — Six functions nobody could call
--
-- The door inventory learned in 0145 to spot an `app.*` function granted to
-- `authenticated` that no other SQL calls: granted on purpose, invisible to
-- PostgREST, reachable by nobody. It found six, and they turned out to be two
-- different mistakes wearing the same shape.
--
-- **Three are helpers whose one caller inlines them instead.** Each states a
-- rule, and the place that should ask it re-implements the rule alongside.
-- That is not a performance decision, it is two definitions of one fact, and
-- this repository has been bitten by that often enough to know how it ends.
--
--   * `assert_line_open` was written in 0111 to give the takeoff path its own
--     message — "a measurement cannot change a quantity that has been signed
--     off" — instead of the frozen-version trigger's message about a table.
--     `apply_takeoff_to_line` never called it, so the better message has never
--     been seen by anybody.
--   * `estimate_is_expired` is the predicate; `assert_not_expired` is the
--     guard, and it compared `expires_at <= now()` itself. They agree today.
--   * `current_metric_version` says which calculation is published;
--     `publish_metric_version` sorted by version itself to find out.
--
-- **Three are features with no door at all.** Granted to `authenticated`
-- because somebody meant them to be called from a browser, and a browser can
-- only reach `public`:
--
--   * `haul_cost` — its own comment says the arithmetic is duplicated from the
--     engine so "a company comparing quotes on a screen should not need an Edge
--     Function round trip per row". There was no screen.
--   * `search_document_text` — written because `document_sheets.extracted_text`
--     carried a trigram index and a comment saying it was for search, and
--     "nothing queried it". Then nothing queried the fix either.
--   * `close_financial_period` — closing the books, with the check that refuses
--     to close over a pay application still open.
--
-- Engine, Entity and Workflow respectively; each wrapper is the door.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- One definition of "expired"
-- -----------------------------------------------------------------------------
create or replace function app.assert_not_expired(p_version uuid)
returns void
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  v_estimate uuid;
  v_expires  timestamptz;
begin
  select v.estimate_id, e.expires_at into v_estimate, v_expires
  from estimate_versions v join estimates e on e.id = v.estimate_id
  where v.id = p_version;

  /*
   * Asked of `app.estimate_is_expired` rather than compared here. The
   * predicate and this guard were two statements of the same rule, and the
   * date is still read for the message — what is not duplicated is the
   * decision.
   */
  if v_estimate is not null and app.estimate_is_expired(v_estimate) then
    raise exception 'This estimate expired on %', to_char(v_expires, 'FMMonth FMDD, YYYY')
      using errcode = 'check_violation',
            hint = 'Move the expiry out, or price it again against today''s rates.';
  end if;
end;
$$;

comment on function app.assert_not_expired(uuid) is
  'Refuses work on an estimate whose price has stopped being good. Asks app.estimate_is_expired rather than repeating the comparison, so there is one definition of expired and not two that happen to agree.';

-- -----------------------------------------------------------------------------
-- The takeoff path says what it was actually trying to do
-- -----------------------------------------------------------------------------
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

  /*
   * `app.assert_line_open` was written in 0111 for exactly this call and never
   * called. Without it the frozen-version trigger refuses the write with a
   * message about a table; with it the person is told that a measurement
   * cannot change a quantity that has been signed off, and that revising the
   * estimate is the way forward.
   *
   * It goes *after* the two checks above and not in place of them, because it
   * is `security definer`: it can see a line in another company, so using it as
   * the existence check would answer a foreign line with "that estimate is
   * issued" instead of "not found" — telling a stranger the row exists and
   * what state it is in. The checks that decide visibility stay under the
   * caller's own row level security; this one only explains a refusal the
   * caller was always going to get.
   */
  perform app.assert_line_open(p_line_item);

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

-- -----------------------------------------------------------------------------
-- One definition of "the current calculation"
-- -----------------------------------------------------------------------------
create or replace function app.publish_metric_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_latest metric_definition_versions%rowtype;
  v_next   int;
begin
  -- Through `app.current_metric_version` rather than inlining the same
  -- `order by version desc limit 1`. Two definitions of which version is
  -- current is one more than a platform can keep honest.
  select * into v_latest from metric_definition_versions
  where id = app.current_metric_version(new.id);

  if found
     and v_latest.expression = new.expression
     and v_latest.unit = new.unit
     and v_latest.grain = new.grain
     and v_latest.source_view is not distinct from new.source_view
  then
    return new;
  end if;

  v_next := coalesce(v_latest.version, 0) + 1;

  insert into metric_definition_versions (
    metric_id, company_id, version, key, name, unit, expression, grain,
    source_view, higher_is_better, target_value, published_by)
  values (
    new.id, new.company_id, v_next, new.key, new.name, new.unit, new.expression,
    new.grain, new.source_view, new.higher_is_better, new.target_value, auth.uid());

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- The three doors
-- -----------------------------------------------------------------------------

/** What a haul costs on its own pricing basis, for a screen comparing quotes. */
create or replace function public.haul_cost(p_rate_id uuid, p_quantity numeric)
returns table (
  pricing_basis text,
  trips_paid numeric,
  cost numeric,
  effective_rate_per_unit numeric,
  unused_capacity numeric
)
language sql stable security invoker set search_path = public, pg_catalog
as $$ select * from app.haul_cost(p_rate_id, p_quantity); $$;

comment on function public.haul_cost(uuid, numeric) is
  'Prices a quantity against one haul rate on that rate''s own basis — per trip, per unit, or refused for a cycle-priced haul that has no cycle analysis. The browser-reachable wrapper the original function was written for and never got.';

revoke all on function public.haul_cost(uuid, numeric) from public, anon;
grant execute on function public.haul_cost(uuid, numeric) to authenticated;

/** What the drawings say, not only what they are called. */
create or replace function public.search_document_text(p_query text, p_limit int default 25)
returns table (
  document_id uuid,
  document_name text,
  version_number int,
  page_number int,
  sheet_number text,
  snippet text,
  rank real
)
language sql stable security invoker set search_path = public, pg_catalog
as $$ select * from app.search_document_text(p_query, p_limit); $$;

comment on function public.search_document_text(text, int) is
  'Searches the extracted text of every sheet the caller may read, superseded documents excluded. SECURITY INVOKER all the way down, so "permission-filtered" means row level security rather than a filter somebody remembered to write.';

revoke all on function public.search_document_text(text, int) from public, anon;
grant execute on function public.search_document_text(text, int) to authenticated;

/** Close the books on a period, refusing to close over work still open. */
create or replace function public.close_financial_period(p_period uuid, p_note text default null)
returns financial_periods
language plpgsql security invoker set search_path = public, pg_catalog
as $$
begin
  return app.close_financial_period(p_period, p_note);
end;
$$;

comment on function public.close_financial_period(uuid, text) is
  'Closes a financial period after checking nothing inside it is still open. SECURITY INVOKER, so the caller''s own permissions still decide whether they may write the row.';

revoke all on function public.close_financial_period(uuid, text) from public, anon;
grant execute on function public.close_financial_period(uuid, text) to authenticated;

select app.assert_security_gates();
