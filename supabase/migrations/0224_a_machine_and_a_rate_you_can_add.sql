-- =============================================================================
-- 0224 — A machine and a rate you can add
--
-- The owner, after the editing pass: "equipment, tasks and production rates
-- still have no way to create one."
--
-- Tasks turned out to be fine — `createTask` and `TaskForm` have been wired
-- since the library screen was built. Equipment and production rates were not:
-- 709 machines and 2,190 rates shipped, and a company whose yard holds
-- something the seed does not list had nowhere to put it.
--
-- Two judgments here, both about refusing rather than guessing:
--
--   * **A machine is added without a rate, and says so.** Somebody adding an
--     excavator at eight in the morning may not know what it costs an hour
--     until they look it up. Inventing an hourly figure from nothing would put
--     a number into an estimate that nobody chose; leaving it null means the
--     screen says "No rate yet" until somebody sets one, which is the honest
--     state and already how the equipment tab renders it.
--   * **A production rate needs the unit it is measured in.** 120 of what, an
--     hour. A rate with no unit is a number that cannot be checked against the
--     quantity it is supposed to produce.
--
-- LIBRARY.
-- =============================================================================

create or replace function app.create_equipment(
  p_company      uuid,
  p_name         text,
  p_class        text default null,
  p_fuel_gph     numeric default 0,
  p_mobilization numeric default 0)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'libraries.write');
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_code    text;
  v_id      uuid;
begin
  if v_name is null then
    raise exception 'A machine needs a name'
      using errcode = 'check_violation', hint = 'Excavator 210, Dozer D6, Tandem dump.';
  end if;
  if coalesce(p_fuel_gph, 0) < 0 then
    raise exception 'Fuel burn cannot be negative' using errcode = 'check_violation';
  end if;
  if coalesce(p_mobilization, 0) < 0 then
    raise exception 'A mobilization cost cannot be negative' using errcode = 'check_violation';
  end if;

  v_code := 'EQ-' || upper(substring(regexp_replace(v_name, '[^A-Za-z0-9]', '', 'g') from 1 for 6))
         || '-' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6);

  insert into equipment (
    company_id, code, name, equipment_class, fuel_gallons_per_hour,
    mobilization_cost, status, approved_by, approved_at)
  values (
    v_company, v_code, v_name, nullif(btrim(coalesce(p_class, '')), ''),
    coalesce(p_fuel_gph, 0), coalesce(p_mobilization, 0), 'active', auth.uid(), now())
  returning id into v_id;

  /*
   * No rate row. A machine with no price says "No rate yet" on the screen,
   * which is true; a machine with an invented one says a number, which is not.
   * `set_equipment_rate` is one click away on the same row.
   */
  return v_id;
end;
$$;

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
  if p_task is not null and not exists (
    select 1 from tasks t where t.id = p_task) then
    raise exception 'No such task' using errcode = 'no_data_found';
  end if;

  v_code := 'PR-' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 10);

  insert into production_rates (
    company_id, task_id, code, rate_per_hour, rate_unit, utilization_factor,
    shift_hours, source_type, status, approved_by, approved_at)
  values (
    v_company, p_task, v_code, p_per_hour, p_rate_unit::app.unit_code,
    coalesce(p_utilization, 0.83), coalesce(p_shift_hours, 8),
    /* Somebody in this company said so. Not a seed benchmark, and not
       measured from the field — `production_actuals` is what earns that. */
    'company_standard', 'active', auth.uid(), now())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.create_equipment(
  p_company uuid, p_name text, p_class text default null,
  p_fuel_gph numeric default 0, p_mobilization numeric default 0)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_equipment(p_company, p_name, p_class, p_fuel_gph, p_mobilization); $$;

create or replace function public.create_production_rate(
  p_company uuid, p_task uuid, p_per_hour numeric, p_rate_unit text,
  p_utilization numeric default 0.83, p_shift_hours numeric default 8)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_production_rate(p_company, p_task, p_per_hour, p_rate_unit,
       p_utilization, p_shift_hours); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_equipment(uuid, text, text, numeric, numeric)',
    'public.create_production_rate(uuid, uuid, numeric, text, numeric, numeric)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
