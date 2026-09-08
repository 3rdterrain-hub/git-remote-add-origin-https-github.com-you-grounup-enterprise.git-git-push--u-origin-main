-- =============================================================================
-- 0134 — A rate sheet from your dealer
--
-- Seed 0011 gives every machine in the platform catalog a published hourly rate
-- somebody can check. It is deliberately the weakest thing in RULE-003's
-- hierarchy — `global_seed`, under regional, under tenant_approved, under a
-- project quote — because it is a national figure for owning and operating a
-- machine and it is nobody's actual cost.
--
-- The rate that should win is the one on the sheet a dealer sent you, and until
-- now there was no way to get it in. Equipment rates were seed-only: they
-- arrived when the catalog was built and could not be added to afterwards
-- except by editing a row at a time. A company with a four-hundred-line rental
-- rate sheet had four hundred afternoons of typing ahead of them, which means
-- in practice the sheet stays in the inbox and the estimates keep pricing at
-- the national number.
--
-- So the same door the materials got in 0127: a file goes in, a report comes
-- back, and every judgment stays in the database where it was tested.
--
-- **Four things it refuses, and each of them for the same reason** — a number
-- that arrives wrong is worse than a number that does not arrive, because only
-- one of them is visible:
--
--   * A rate with no hourly figure. A rental sheet often prices by the day, and
--     a day is not eight hours of work — it is a calendar day, whatever the
--     weather did. Dividing it would put an assumption nobody stated at the
--     bottom of every estimate that used the machine, so the row is refused and
--     says what to do about it.
--   * A machine it cannot find *and* cannot name. A rate line with no equipment
--     on it is not a rate.
--   * A negative rate.
--   * A rate for another company's machine.
--
-- **What it creates, and what it admits it does not know.** A dealer's sheet
-- lists machines you may not have in the catalog, so it makes them — a rate
-- sheet is a perfectly good source for "this machine exists and costs this".
-- What a rate sheet never says is how much fuel the machine burns or whether it
-- carries an operator, and both of those change what an estimate costs. So a
-- created machine goes on the review list naming exactly those two gaps rather
-- than shipping a guess at them.
-- =============================================================================

/**
 * Import a rate sheet into a company's equipment library.
 *
 * The rate lands as `tenant_approved`, which is the company's own rate and
 * outranks both the regional and the seeded figure under RULE-003. It does not
 * outrank a quote on a specific project, which is correct: a number somebody
 * got for this job beats a number the company uses generally.
 *
 * Re-running the same sheet updates rather than duplicates. Migration 0056 made
 * one rate per machine per source per effective date a unique index, so a
 * second import on the same date is the same row.
 */
create or replace function public.import_equipment_rates(p_company uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r            jsonb;
  v_name       text;
  v_code       text;
  v_class      text;
  v_hourly     numeric;
  v_daily      numeric;
  v_weekly     numeric;
  v_monthly    numeric;
  v_region     text;
  v_reference  text;
  v_effective  date;
  v_equipment  equipment;
  v_created    int := 0;
  v_priced     int := 0;
  v_repriced   int := 0;
  v_is_new     boolean;
  v_rejected   jsonb := '[]'::jsonb;
  v_review     jsonb := '[]'::jsonb;
  v_approve    boolean;
  v_state      app.approval_state;
begin
  if not app.has_permission(p_company, 'libraries.write') then
    raise exception 'Importing equipment rates needs the libraries.write permission.'
      using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'A rate sheet is a list of rows.' using errcode = 'invalid_parameter_value';
  end if;

  v_approve := app.has_permission(p_company, 'libraries.approve');
  v_state   := (case when v_approve then 'approved' else 'pending' end)::app.approval_state;

  /*
   * Classes first, the way `import_materials` does its categories:
   * `equipment.equipment_class` is governed by `library_categories`, so
   * importing them one row at a time would be refused one row at a time.
   */
  for r in select distinct on (lower(btrim(x->>'equipment_class')))
                  x from jsonb_array_elements(p_rows) x
           where coalesce(btrim(x->>'equipment_class'), '') <> ''
  loop
    v_class := btrim(r->>'equipment_class');
    if not exists (
      select 1 from library_categories c
       where c.kind = 'equipment_class' and c.status = 'active'
         and lower(btrim(c.name)) = lower(v_class)
         and (c.company_id is null or c.company_id = p_company))
    then
      perform app.add_library_category('equipment_class', v_class, null, p_company);
    end if;
  end loop;

  for r in select x from jsonb_array_elements(p_rows) x loop
    v_name      := nullif(btrim(coalesce(r->>'equipment', r->>'name', '')), '');
    v_code      := nullif(btrim(coalesce(r->>'code', '')), '');
    v_class     := nullif(btrim(coalesce(r->>'equipment_class', '')), '');
    v_hourly    := nullif(btrim(coalesce(r->>'hourly_rate', '')), '')::numeric;
    v_daily     := nullif(btrim(coalesce(r->>'daily_rate', '')), '')::numeric;
    v_weekly    := nullif(btrim(coalesce(r->>'weekly_rate', '')), '')::numeric;
    v_monthly   := nullif(btrim(coalesce(r->>'monthly_rate', '')), '')::numeric;
    v_region    := nullif(btrim(coalesce(r->>'region', '')), '');
    v_reference := nullif(btrim(coalesce(r->>'reference', '')), '');
    v_effective := coalesce(
      nullif(btrim(coalesce(r->>'effective_date', '')), '')::date, current_date);

    if v_name is null and v_code is null then
      v_rejected := v_rejected || jsonb_build_object(
        'name', '(no machine named)',
        'reason', 'A rate with no equipment on it is not a rate. Give a code or a name.');
      continue;
    end if;

    if v_hourly is null then
      v_rejected := v_rejected || jsonb_build_object(
        'name', coalesce(v_name, v_code),
        'reason', 'No hourly rate. A rental day is a calendar day rather than eight hours of work, so dividing the daily rate would put an assumption nobody stated into every estimate using this machine. State the hourly rate you want the engine to use.');
      continue;
    end if;

    if v_hourly < 0 then
      v_rejected := v_rejected || jsonb_build_object(
        'name', coalesce(v_name, v_code),
        'reason', 'An hourly rate is zero or more.');
      continue;
    end if;

    /*
     * Theirs first, then the platform catalog. A company that has made its own
     * "Excavator 336" means that one, not the shipped row of the same name.
     */
    select * into v_equipment from equipment e
     where e.company_id = p_company
       and ((v_code is not null and e.code = v_code)
         or (v_code is null and lower(btrim(e.name)) = lower(v_name)))
     limit 1;

    if v_equipment.id is null then
      select * into v_equipment from equipment e
       where e.company_id is null and e.enterprise_group_id is null
         and ((v_code is not null and e.code = v_code)
           or (v_code is null and lower(btrim(e.name)) = lower(v_name)))
       limit 1;
    end if;

    if v_equipment.id is null then
      if v_name is null then
        v_rejected := v_rejected || jsonb_build_object(
          'name', v_code,
          'reason', format('No machine with the code %s, and no name given to make one.', v_code));
        continue;
      end if;

      insert into equipment (company_id, code, name, equipment_class, ownership_type,
                             planned_hours_per_day, fuel_gallons_per_hour,
                             def_percent_of_fuel, operator_required,
                             mobilization_required, status, origin, source,
                             approved_by, approved_at)
      values (p_company,
              coalesce(v_code, 'EQ-' || upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 10))),
              v_name, v_class, 'rented',
              8, 0, 0, true, false,
              (case when v_approve then 'active' else 'draft' end)::app.record_status,
              'imported', 'Rate sheet import',
              case when v_approve then auth.uid() end,
              case when v_approve then now() end)
      returning * into v_equipment;

      v_created := v_created + 1;
      v_review := v_review || jsonb_build_object(
        'name', v_name,
        'why', 'New machine. The sheet priced it but did not say how much fuel it burns or whether it carries an operator, and both change what a line costs.');
    end if;

    if v_equipment.company_id is not null and v_equipment.company_id <> p_company then
      v_rejected := v_rejected || jsonb_build_object(
        'name', coalesce(v_name, v_code),
        'reason', 'That machine belongs to another company.');
      continue;
    end if;

    insert into equipment_rates (company_id, equipment_id, source, hourly_rate,
                                 daily_rate, weekly_rate, monthly_rate,
                                 region, reference, effective_date, approval_state)
    values (p_company, v_equipment.id, 'tenant_approved', v_hourly,
            v_daily, v_weekly, v_monthly, v_region,
            coalesce(v_reference, 'Rate sheet import'), v_effective, v_state)
    on conflict (company_id, equipment_id, source, effective_date)
      where company_id is not null
      do update set hourly_rate    = excluded.hourly_rate,
                    daily_rate     = excluded.daily_rate,
                    weekly_rate    = excluded.weekly_rate,
                    monthly_rate   = excluded.monthly_rate,
                    region         = excluded.region,
                    reference      = excluded.reference,
                    approval_state = excluded.approval_state,
                    updated_at     = now()
    /*
     * `found` is true for both halves of an upsert, so it cannot tell a new
     * rate from a replaced one. `xmax = 0` on the returned row can: a row
     * inserted in this statement has no update transaction stamped on it.
     */
    returning (xmax = 0) into v_is_new;

    if v_is_new then
      v_priced := v_priced + 1;
    else
      v_repriced := v_repriced + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'priced',           v_priced,
    'machines_created', v_created,
    'rejected',         v_rejected,
    'needs_review',     v_review,
    'approved',         v_approve);
end;
$$;

comment on function public.import_equipment_rates(uuid, jsonb) is
  'Imports a dealer rate sheet into a company equipment library. WORKFLOW: creates the equipment classes first because equipment_class is governed, refuses a row with no hourly rate rather than dividing a rental day by a shift length nobody stated, and names every machine it had to create so the two things a rate sheet never says — fuel burn and whether it carries an operator — are somebody decision rather than a default.';

revoke all on function public.import_equipment_rates(uuid, jsonb) from public, anon;
grant execute on function public.import_equipment_rates(uuid, jsonb) to authenticated;

select app.assert_security_gates();
