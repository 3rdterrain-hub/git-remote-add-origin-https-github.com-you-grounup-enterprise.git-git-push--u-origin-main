-- =============================================================================
-- 0225 — A rate somebody judged says so
--
-- `app.create_production_rate` from 0224 wrote `company_standard` into
-- `production_rates.source_type`, which is not one of the values
-- `app.production_source` allows:
--
--     company_actual, company_historical, regional_benchmark,
--     seed_benchmark, manufacturer, estimator_judgment
--
-- The enum caught it immediately, and the right answer was already in the list.
-- A rate somebody types into the library screen is `estimator_judgment`: a
-- person's opinion, offered as such.
--
-- It is specifically *not* `company_actual`. That value means the field
-- measured it, and `production_actuals` is what earns it — a day's production
-- reported against a budgeted task. Labeling a typed figure as measured would
-- make it outrank a regional benchmark in every comparison that reads the
-- source, and would quietly raise the confidence of an estimate priced from it.
-- The difference between what somebody thinks and what somebody counted is the
-- whole point of the column.
-- =============================================================================

create or replace function app.create_production_rate(
  p_company     uuid,
  p_task        uuid,
  p_per_hour    numeric,
  p_rate_unit   text,
  p_utilization numeric default 0.83,
  p_shift_hours numeric default 8)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'libraries.write');
  v_code    text;
  v_id      uuid;
begin
  if p_per_hour is null or p_per_hour <= 0 then
    raise exception 'A production rate is greater than zero'
      using errcode = 'check_violation', hint = 'A rate of zero is work that never finishes.';
  end if;
  if p_rate_unit is null or btrim(p_rate_unit) = '' then
    raise exception 'Say what the rate is measured in'
      using errcode = 'check_violation',
            hint = 'A hundred and twenty of what, an hour. Without the unit the figure cannot be checked against the quantity it is meant to produce.';
  end if;
  if coalesce(p_utilization, 0) <= 0 or coalesce(p_utilization, 0) > 1 then
    raise exception 'Utilization is a share of the hour, above 0 and at most 1'
      using errcode = 'check_violation', hint = 'Fifty minutes in the hour is 0.83.';
  end if;
  if coalesce(p_shift_hours, 0) <= 0 or coalesce(p_shift_hours, 0) > 24 then
    raise exception 'A shift is between 0 and 24 hours' using errcode = 'check_violation';
  end if;
  if p_task is not null and not exists (select 1 from tasks t where t.id = p_task) then
    raise exception 'No such task' using errcode = 'no_data_found';
  end if;

  v_code := 'PR-' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 10);

  insert into production_rates (
    company_id, task_id, code, rate_per_hour, rate_unit, utilization_factor,
    shift_hours, source_type, status, approved_by, approved_at)
  values (
    v_company, p_task, v_code, p_per_hour, p_rate_unit::app.unit_code,
    coalesce(p_utilization, 0.83), coalesce(p_shift_hours, 8),
    /* What it is: a person's judgment. `company_actual` would say the field
       measured it, and only `production_actuals` earns that. */
    'estimator_judgment', 'active', auth.uid(), now())
  returning id into v_id;
  return v_id;
end;
$$;
