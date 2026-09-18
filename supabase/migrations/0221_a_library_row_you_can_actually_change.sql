-- =============================================================================
-- 0221 — A library row you can actually change
--
-- The owner, going through Master Libraries tab by tab: "you can't change the
-- prices in labor rates… we need to be able to set a base wage, a burden…
-- materials, yes I can change the cost, but I can't change the unit… equipment,
-- we need hourly, daily, weekly, monthly… fuel, mobilization, the class, the
-- name… you need to make it editable, clickable, customizable."
--
-- Two cost cells were editable and nothing else was. Every table already
-- carried the INSERT and UPDATE policies, so nothing was being *refused* —
-- there was simply no door, on either side.
--
-- One judgment this migration makes, and it is the only interesting one:
--
--   **A material's unit cannot be changed without restating its cost.**
--   A unit cost is a price *per unit*. Change TON to CY and leave $12.40 sitting
--   there and the number is no longer anybody's price — it is a figure that
--   looks exactly as authoritative as it did a moment ago and means nothing.
--   That is the invented-number rule with a different hat on, so
--   `set_material_unit` takes both or refuses.
--
-- Everything else is an ordinary edit. `burdened_cost_per_hour` is a generated
-- column, so a changed wage or burden recomputes the loaded rate and cannot
-- drift from it.
--
-- LIBRARY.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Labor
-- -----------------------------------------------------------------------------

create or replace function app.set_labor_rate(
  p_rate            uuid,
  p_classification  text default null,
  p_base_wage       numeric default null,
  p_burden_percent  numeric default null,
  p_labor_group     text default null,
  p_fringe_per_hour numeric default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_row labor_rates%rowtype;
begin
  select * into v_row from labor_rates where id = p_rate;
  if v_row.id is null then
    raise exception 'No such labor rate' using errcode = 'no_data_found';
  end if;
  if v_row.company_id is null then
    raise exception 'That rate is shipped with GrounUp and is shared by every company'
      using errcode = 'insufficient_privilege',
            hint = 'Make your own copy of it first, then change the copy.';
  end if;
  perform app.company_for_write(v_row.company_id, 'libraries.write');

  if p_base_wage is not null and p_base_wage < 0 then
    raise exception 'A wage cannot be negative' using errcode = 'check_violation';
  end if;
  /* A burden is a share of the wage. Above 3 is somebody typing 150 for 150%. */
  if p_burden_percent is not null and (p_burden_percent < 0 or p_burden_percent > 3) then
    raise exception 'A burden is a share of the wage, between 0 and 3'
      using errcode = 'check_violation',
            hint = 'Thirty-five percent is 0.35, not 35.';
  end if;

  update labor_rates
     set classification     = coalesce(nullif(btrim(coalesce(p_classification, '')), ''), classification),
         base_wage_per_hour = coalesce(p_base_wage, base_wage_per_hour),
         burden_percent     = coalesce(p_burden_percent, burden_percent),
         labor_group        = coalesce(nullif(btrim(coalesce(p_labor_group, '')), ''), labor_group),
         fringe_per_hour    = coalesce(p_fringe_per_hour, fringe_per_hour),
         updated_at         = now()
   where id = p_rate;
end;
$$;

create or replace function app.create_labor_rate(
  p_company         uuid,
  p_classification  text,
  p_base_wage       numeric,
  p_burden_percent  numeric default 0.35,
  p_labor_group     text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'libraries.write');
  v_name    text := nullif(btrim(coalesce(p_classification, '')), '');
  v_code    text;
  v_id      uuid;
begin
  if v_name is null then
    raise exception 'A labor rate needs a classification'
      using errcode = 'check_violation', hint = 'Operator, Laborer, Teamster.';
  end if;
  if p_base_wage is null or p_base_wage < 0 then
    raise exception 'A labor rate needs a base wage' using errcode = 'check_violation';
  end if;
  if coalesce(p_burden_percent, 0) < 0 or coalesce(p_burden_percent, 0) > 3 then
    raise exception 'A burden is a share of the wage, between 0 and 3'
      using errcode = 'check_violation', hint = 'Thirty-five percent is 0.35, not 35.';
  end if;

  /* Codes are per company, so a collision is with their own rows only. */
  v_code := 'LR-' || upper(substring(regexp_replace(v_name, '[^A-Za-z0-9]', '', 'g') from 1 for 6))
         || '-' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6);

  insert into labor_rates (
    company_id, code, classification, base_wage_per_hour, burden_percent,
    labor_group, status, approved_by, approved_at)
  values (
    v_company, v_code, v_name, p_base_wage, coalesce(p_burden_percent, 0.35),
    nullif(btrim(coalesce(p_labor_group, '')), ''), 'active', auth.uid(), now())
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Equipment, and what it costs by the hour, day, week and month
-- -----------------------------------------------------------------------------

create or replace function app.set_equipment(
  p_equipment    uuid,
  p_name         text default null,
  p_class        text default null,
  p_fuel_gph     numeric default null,
  p_mobilization numeric default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_row equipment%rowtype;
begin
  select * into v_row from equipment where id = p_equipment;
  if v_row.id is null then
    raise exception 'No such machine' using errcode = 'no_data_found';
  end if;
  if v_row.company_id is null then
    raise exception 'That machine is shipped with GrounUp and is shared by every company'
      using errcode = 'insufficient_privilege',
            hint = 'Make your own copy of it first, then change the copy.';
  end if;
  perform app.company_for_write(v_row.company_id, 'libraries.write');

  if p_fuel_gph is not null and p_fuel_gph < 0 then
    raise exception 'Fuel burn cannot be negative' using errcode = 'check_violation';
  end if;
  if p_mobilization is not null and p_mobilization < 0 then
    raise exception 'A mobilization cost cannot be negative' using errcode = 'check_violation';
  end if;

  update equipment
     set name                  = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
         equipment_class       = coalesce(nullif(btrim(coalesce(p_class, '')), ''), equipment_class),
         fuel_gallons_per_hour = coalesce(p_fuel_gph, fuel_gallons_per_hour),
         mobilization_cost     = coalesce(p_mobilization, mobilization_cost),
         updated_at            = now()
   where id = p_equipment;
end;
$$;

/**
 * What a machine costs, by the period somebody actually rents or owns it in.
 *
 * Four figures rather than one because a week is not seven days of the daily
 * rate and never has been. Any of them may be left null — a machine quoted only
 * by the hour is a normal thing and inventing the other three from it would be
 * three numbers nobody could check.
 */
create or replace function app.set_equipment_rate(
  p_equipment uuid,
  p_hourly    numeric default null,
  p_daily     numeric default null,
  p_weekly    numeric default null,
  p_monthly   numeric default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_rate    uuid;
begin
  select company_id into v_company from equipment where id = p_equipment;
  if not found then
    raise exception 'No such machine' using errcode = 'no_data_found';
  end if;
  if v_company is null then
    raise exception 'That machine is shipped with GrounUp and is shared by every company'
      using errcode = 'insufficient_privilege',
            hint = 'Make your own copy of it first, then price the copy.';
  end if;
  perform app.company_for_write(v_company, 'libraries.write');

  if coalesce(p_hourly, 0) < 0 or coalesce(p_daily, 0) < 0
     or coalesce(p_weekly, 0) < 0 or coalesce(p_monthly, 0) < 0 then
    raise exception 'A rate cannot be negative' using errcode = 'check_violation';
  end if;

  /*
   * The company's own rate for this machine, one row, updated in place.
   * `tenant_approved` is where RULE-003 puts a rate a company set for itself:
   * above a regional or shipped figure, below a quote for a specific project.
   */
  select id into v_rate from equipment_rates
   where equipment_id = p_equipment and company_id = v_company
     and source = 'tenant_approved'
   order by effective_date desc limit 1;

  if v_rate is null then
    insert into equipment_rates (
      company_id, equipment_id, source, hourly_rate, daily_rate,
      weekly_rate, monthly_rate, effective_date)
    values (
      v_company, p_equipment, 'tenant_approved', p_hourly, p_daily,
      p_weekly, p_monthly, current_date)
    returning id into v_rate;
  else
    update equipment_rates
       set hourly_rate  = coalesce(p_hourly, hourly_rate),
           daily_rate   = coalesce(p_daily, daily_rate),
           weekly_rate  = coalesce(p_weekly, weekly_rate),
           monthly_rate = coalesce(p_monthly, monthly_rate),
           updated_at   = now()
     where id = v_rate;
  end if;
  return v_rate;
end;
$$;

-- -----------------------------------------------------------------------------
-- Materials
-- -----------------------------------------------------------------------------

create or replace function app.set_material(
  p_material      uuid,
  p_name          text default null,
  p_category      text default null,
  p_specification text default null,
  p_waste_percent numeric default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_row materials%rowtype;
begin
  select * into v_row from materials where id = p_material;
  if v_row.id is null then
    raise exception 'No such material' using errcode = 'no_data_found';
  end if;
  if v_row.company_id is null then
    raise exception 'That material is shipped with GrounUp and is shared by every company'
      using errcode = 'insufficient_privilege',
            hint = 'Make your own copy of it first, then change the copy.';
  end if;
  perform app.company_for_write(v_row.company_id, 'libraries.write');

  if p_waste_percent is not null and (p_waste_percent < 0 or p_waste_percent > 1) then
    raise exception 'Waste is a share, between 0 and 1'
      using errcode = 'check_violation', hint = 'Ten percent is 0.10, not 10.';
  end if;

  update materials
     set name                  = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
         category              = coalesce(nullif(btrim(coalesce(p_category, '')), ''), category),
         specification         = coalesce(nullif(btrim(coalesce(p_specification, '')), ''), specification),
         default_waste_percent = coalesce(p_waste_percent, default_waste_percent),
         updated_at            = now()
   where id = p_material;
end;
$$;

/**
 * Change what a material is measured in, and what it costs in that unit.
 *
 * Both together or neither. A unit cost is a price *per unit*: change TON to CY
 * and leave $12.40 where it is, and the figure is no longer anybody's price —
 * it is a number that looks exactly as authoritative as it did a moment ago and
 * means nothing. Every line that ever prices from it inherits that.
 */
create or replace function app.set_material_unit(
  p_material  uuid,
  p_unit      text,
  p_unit_cost numeric)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_row materials%rowtype;
begin
  select * into v_row from materials where id = p_material;
  if v_row.id is null then
    raise exception 'No such material' using errcode = 'no_data_found';
  end if;
  if v_row.company_id is null then
    raise exception 'That material is shipped with GrounUp and is shared by every company'
      using errcode = 'insufficient_privilege',
            hint = 'Make your own copy of it first, then change the copy.';
  end if;
  perform app.company_for_write(v_row.company_id, 'libraries.write');

  if p_unit is null or btrim(p_unit) = '' then
    raise exception 'Say which unit it is measured in' using errcode = 'check_violation';
  end if;
  if p_unit_cost is null then
    raise exception 'Changing the unit means restating the cost in that unit'
      using errcode = 'check_violation',
            hint = 'A cost is per unit. Left alone it would be a price for a quantity nobody measured.';
  end if;
  if p_unit_cost < 0 then
    raise exception 'A cost cannot be negative' using errcode = 'check_violation';
  end if;

  update materials
     set unit       = p_unit::app.unit_code,
         unit_cost  = p_unit_cost,
         cost_state = 'quoted',
         updated_at = now()
   where id = p_material;
end;
$$;

-- -----------------------------------------------------------------------------
-- Production rates
-- -----------------------------------------------------------------------------

create or replace function app.set_production_rate(
  p_rate        uuid,
  p_per_hour    numeric default null,
  p_utilization numeric default null,
  p_shift_hours numeric default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_row production_rates%rowtype;
begin
  select * into v_row from production_rates where id = p_rate;
  if v_row.id is null then
    raise exception 'No such production rate' using errcode = 'no_data_found';
  end if;
  if v_row.company_id is null then
    raise exception 'That rate is shipped with GrounUp and is shared by every company'
      using errcode = 'insufficient_privilege',
            hint = 'Make your own copy of it first, then change the copy.';
  end if;
  perform app.company_for_write(v_row.company_id, 'libraries.write');

  if p_per_hour is not null and p_per_hour <= 0 then
    raise exception 'A production rate is greater than zero'
      using errcode = 'check_violation',
            hint = 'A rate of zero is work that never finishes.';
  end if;
  if p_utilization is not null and (p_utilization <= 0 or p_utilization > 1) then
    raise exception 'Utilization is a share of the hour, above 0 and at most 1'
      using errcode = 'check_violation', hint = 'Fifty minutes in the hour is 0.83.';
  end if;
  if p_shift_hours is not null and (p_shift_hours <= 0 or p_shift_hours > 24) then
    raise exception 'A shift is between 0 and 24 hours' using errcode = 'check_violation';
  end if;

  update production_rates
     set rate_per_hour       = coalesce(p_per_hour, rate_per_hour),
         utilization_factor  = coalesce(p_utilization, utilization_factor),
         shift_hours         = coalesce(p_shift_hours, shift_hours),
         updated_at          = now()
   where id = p_rate;
end;
$$;

-- -----------------------------------------------------------------------------
-- The doors
-- -----------------------------------------------------------------------------

create or replace function public.set_labor_rate(
  p_rate uuid, p_classification text default null, p_base_wage numeric default null,
  p_burden_percent numeric default null, p_labor_group text default null,
  p_fringe_per_hour numeric default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_labor_rate(p_rate, p_classification, p_base_wage, p_burden_percent,
       p_labor_group, p_fringe_per_hour); $$;

create or replace function public.create_labor_rate(
  p_company uuid, p_classification text, p_base_wage numeric,
  p_burden_percent numeric default 0.35, p_labor_group text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_labor_rate(p_company, p_classification, p_base_wage,
       p_burden_percent, p_labor_group); $$;

create or replace function public.set_equipment(
  p_equipment uuid, p_name text default null, p_class text default null,
  p_fuel_gph numeric default null, p_mobilization numeric default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_equipment(p_equipment, p_name, p_class, p_fuel_gph, p_mobilization); $$;

create or replace function public.set_equipment_rate(
  p_equipment uuid, p_hourly numeric default null, p_daily numeric default null,
  p_weekly numeric default null, p_monthly numeric default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_equipment_rate(p_equipment, p_hourly, p_daily, p_weekly, p_monthly); $$;

create or replace function public.set_material(
  p_material uuid, p_name text default null, p_category text default null,
  p_specification text default null, p_waste_percent numeric default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_material(p_material, p_name, p_category, p_specification, p_waste_percent); $$;

create or replace function public.set_material_unit(
  p_material uuid, p_unit text, p_unit_cost numeric)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_material_unit(p_material, p_unit, p_unit_cost); $$;

create or replace function public.set_production_rate(
  p_rate uuid, p_per_hour numeric default null, p_utilization numeric default null,
  p_shift_hours numeric default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_production_rate(p_rate, p_per_hour, p_utilization, p_shift_hours); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.set_labor_rate(uuid, text, numeric, numeric, text, numeric)',
    'public.create_labor_rate(uuid, text, numeric, numeric, text)',
    'public.set_equipment(uuid, text, text, numeric, numeric)',
    'public.set_equipment_rate(uuid, numeric, numeric, numeric, numeric)',
    'public.set_material(uuid, text, text, text, numeric)',
    'public.set_material_unit(uuid, text, numeric)',
    'public.set_production_rate(uuid, numeric, numeric, numeric)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
