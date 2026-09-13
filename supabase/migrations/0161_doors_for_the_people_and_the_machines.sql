-- =============================================================================
-- 0161 — Doors for the people and the machines
--
-- Fleet shipped with "Add asset" and "Work order" in its header and Workforce
-- with "Add employee", and none of the three had an `onClick`. They were
-- painted on. A company signing up could therefore not record a single machine
-- or a single member of staff, which is not a gap in one screen — it is the
-- reason the clock could not be used at all. `punch_in` matches on
-- `employees.user_id = auth.uid()` (0122), so an owner with no employee row has
-- nothing to punch, and the dashboard says so: "You have no employee record in
-- this company."
--
-- The tables have been governed since 0015 and 0016 — tenant RLS with
-- `hr.write` on employees and `fleet.write` on assets and work orders. What was
-- missing was a writer that generates the number safely.
--
-- Four rules each of these follows, the same four as 0157:
--
--   * **Membership and permission are checked against the named company**, and
--     the check is the same one the insert policy would apply. Passing the
--     company is safe only because it is verified, never trusted.
--   * **The number is generated here.** `employees`, `assets` and `work_orders`
--     are each unique on (company_id, number), so two people adding a machine
--     at the same moment would otherwise collide on an index.
--   * **A work order reads its company off the asset**, never from the caller,
--     because there is a parent row to read it from.
--   * **Nothing starts in a state that ends a workflow.** An employee starts
--     `active` because that is what adding somebody means; an asset starts
--     `available` rather than assigned, because assigning it is a decision
--     somebody makes about a project that may not exist yet.
--
-- Entity: the people and the machines a contractor owns.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Numbers that do not collide
-- -----------------------------------------------------------------------------

/** EMP-0001 for this company. Per company, because that is where the index is. */
create or replace function app.next_company_employee_number(p_company uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select 'EMP-' || lpad((coalesce(max(substring(e.employee_number from '^EMP-(\d+)$')::int), 0) + 1)::text, 4, '0')
  from employees e
  where e.company_id = p_company and e.employee_number ~ '^EMP-\d+$';
$$;

comment on function app.next_company_employee_number(uuid) is
  'The next unused EMP-0000 for one company. ENTITY support: employees is unique on (company_id, employee_number), so a screen must not pick this itself.';

/** EQ-0001 for this company. */
create or replace function app.next_company_asset_number(p_company uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select 'EQ-' || lpad((coalesce(max(substring(a.asset_number from '^EQ-(\d+)$')::int), 0) + 1)::text, 4, '0')
  from assets a
  where a.company_id = p_company and a.asset_number ~ '^EQ-\d+$';
$$;

comment on function app.next_company_asset_number(uuid) is
  'The next unused EQ-0000 for one company. ENTITY support: assets is unique on (company_id, asset_number).';

/** WO-0001 for this company. Per company rather than per asset, matching the index. */
create or replace function app.next_work_order_number(p_company uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select 'WO-' || lpad((coalesce(max(substring(w.number from '^WO-(\d+)$')::int), 0) + 1)::text, 4, '0')
  from work_orders w
  where w.company_id = p_company and w.number ~ '^WO-\d+$';
$$;

comment on function app.next_work_order_number(uuid) is
  'The next unused WO-0000 for one company. ENTITY support: work_orders is unique on (company_id, number).';

-- -----------------------------------------------------------------------------
-- Whether you may write to the company you named
-- -----------------------------------------------------------------------------

/**
 * Verify a company the caller named, and one permission on it.
 *
 * Unlike a project, a company has no parent row to read the tenant off, so the
 * caller does have to name it. That is safe only because this says the same
 * thing the insert policy says — membership plus the permission 0016 chose for
 * the table — and refuses in the same words whether the company does not exist
 * or simply is not theirs. Which of the two it is would tell a stranger that a
 * company id is real.
 */
create or replace function app.company_for_write(p_company uuid, p_permission text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_company is null or not app.is_member(p_company) then
    raise exception 'No such company' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(p_company, p_permission) then
    raise exception 'You do not have permission to change this company'
      using errcode = 'insufficient_privilege';
  end if;
  return p_company;
end;
$$;

comment on function app.company_for_write(uuid, text) is
  'A company the caller is shown to be a member of, holding a stated permission. ENTITY support: the writers for company-owned rows verify the tenant rather than trusting it.';

-- -----------------------------------------------------------------------------
-- Somebody who works here
-- -----------------------------------------------------------------------------

/**
 * Add an employee.
 *
 * `p_link_me` is the answer to the problem an owner hits on their first day:
 * the clock records time against an employee and matches it to a login through
 * `employees.user_id`, so the person who created the company has no way to
 * punch until somebody adds them. Setting it links this new row to the caller's
 * own login. It refuses if the caller already has one, because two employee
 * rows for one login makes `punch_in` ambiguous — 0122 matches on that column
 * and would find both.
 *
 * Starting status is `active`. There is an `applicant` and an `onboarding`
 * state, and both are real, but somebody being added by hand on the Workforce
 * screen is somebody who already works here.
 */
create or replace function app.create_employee(
  p_company uuid,
  p_first_name text,
  p_last_name text,
  p_email text default null,
  p_phone text default null,
  p_employment_type text default 'full_time',
  p_classification text default null,
  p_hourly_rate numeric default null,
  p_hire_date date default null,
  p_link_me boolean default false)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'hr.write');
  v_first   text := nullif(trim(coalesce(p_first_name, '')), '');
  v_last    text := nullif(trim(coalesce(p_last_name, '')), '');
  v_id      uuid;
begin
  if v_first is null or v_last is null then
    raise exception 'An employee needs a first and a last name'
      using errcode = 'check_violation';
  end if;
  if p_link_me and exists (
    select 1 from employees
    where company_id = v_company and user_id = auth.uid()) then
    raise exception 'You already have an employee record in this company'
      using errcode = 'unique_violation',
            hint = 'Add this person without linking them to your login.';
  end if;

  insert into employees (
    company_id, employee_number, first_name, last_name, email, phone,
    employment_type, classification, hourly_rate, hire_date, status, user_id)
  values (
    v_company,
    app.next_company_employee_number(v_company),
    v_first, v_last,
    nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    coalesce(nullif(trim(coalesce(p_employment_type, '')), ''), 'full_time'),
    nullif(trim(coalesce(p_classification, '')), ''),
    p_hourly_rate,
    p_hire_date,
    'active',
    case when p_link_me then auth.uid() else null end)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.create_employee(uuid, text, text, text, text, text, text, numeric, date, boolean) is
  'Adds somebody who works here, numbered per company. ENTITY: p_link_me attaches the row to the callers own login, which is what the clock matches on.';

-- -----------------------------------------------------------------------------
-- A machine you own
-- -----------------------------------------------------------------------------

/**
 * Add an asset.
 *
 * `p_equipment_id` is the link to the catalog rate the machine is estimated at,
 * and it is optional on purpose: a company records the machine it just bought
 * before anybody decides which rate class prices it. Fleet reads utilization
 * against that rate when it is set and says so when it is not, which is more
 * honest than defaulting it to whatever rate happens to sort first.
 *
 * Starting status is `available`, never `assigned` — a machine is assigned to a
 * project, and the project may not exist yet.
 */
create or replace function app.create_asset(
  p_company uuid,
  p_name text,
  p_asset_class text default null,
  p_make text default null,
  p_model text default null,
  p_model_year int default null,
  p_serial_number text default null,
  p_ownership text default 'owned',
  p_meter_type text default 'hours',
  p_fuel_type text default null,
  p_acquisition_cost numeric default null,
  p_acquired_on date default null,
  p_equipment_id uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'fleet.write');
  v_name    text := nullif(trim(coalesce(p_name, '')), '');
  v_id      uuid;
begin
  if v_name is null then
    raise exception 'A machine needs a name' using errcode = 'check_violation';
  end if;
  -- Named rather than left to a foreign key violation, because the message a
  -- key gives names a constraint instead of the thing that is wrong.
  if p_equipment_id is not null and not exists (
    select 1 from equipment where id = p_equipment_id) then
    raise exception 'That catalog rate does not exist' using errcode = 'no_data_found';
  end if;

  insert into assets (
    company_id, asset_number, name, asset_class, make, model, model_year,
    serial_number, ownership, meter_type, fuel_type, acquisition_cost,
    acquired_on, equipment_id, status)
  values (
    v_company,
    app.next_company_asset_number(v_company),
    v_name,
    nullif(trim(coalesce(p_asset_class, '')), ''),
    nullif(trim(coalesce(p_make, '')), ''),
    nullif(trim(coalesce(p_model, '')), ''),
    p_model_year,
    nullif(trim(coalesce(p_serial_number, '')), ''),
    coalesce(nullif(trim(coalesce(p_ownership, '')), ''), 'owned'),
    coalesce(nullif(trim(coalesce(p_meter_type, '')), ''), 'hours'),
    nullif(trim(coalesce(p_fuel_type, '')), ''),
    p_acquisition_cost,
    p_acquired_on,
    p_equipment_id,
    'available')
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.create_asset(uuid, text, text, text, text, int, text, text, text, text, numeric, date, uuid) is
  'Adds a machine the company owns, numbered per company and starting available. ENTITY: the catalog rate link is optional because it is a later decision.';

-- -----------------------------------------------------------------------------
-- Something wrong with a machine
-- -----------------------------------------------------------------------------

/**
 * Raise a work order against an asset.
 *
 * The company comes off the asset, which is the whole reason this takes an
 * asset rather than a company: a work order that is not about a specific
 * machine is not a work order. It starts `open` and records no costs — labor,
 * parts and outside cost are what the work turns out to have taken, and a
 * number typed when it is raised would be a guess nobody can reproduce.
 */
create or replace function app.create_work_order(
  p_asset uuid,
  p_title text,
  p_work_order_type text default 'corrective',
  p_priority text default 'normal',
  p_description text default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_title   text := nullif(trim(coalesce(p_title, '')), '');
  v_id      uuid;
begin
  select company_id into v_company from assets where id = p_asset;
  if v_company is null then
    raise exception 'No such machine' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_company, 'fleet.write');
  if v_title is null then
    raise exception 'A work order needs a title saying what is wrong'
      using errcode = 'check_violation';
  end if;

  insert into work_orders (
    company_id, asset_id, number, title, work_order_type, priority,
    description, status)
  values (
    v_company, p_asset,
    app.next_work_order_number(v_company),
    v_title,
    coalesce(nullif(trim(coalesce(p_work_order_type, '')), ''), 'corrective'),
    coalesce(nullif(trim(coalesce(p_priority, '')), ''), 'normal'),
    nullif(trim(coalesce(p_description, '')), ''),
    'open')
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.create_work_order(uuid, text, text, text, text) is
  'Raises a work order against one machine, numbered per company and left open. ENTITY: the company is read off the asset, never taken from the caller.';

-- -----------------------------------------------------------------------------
-- The doors a browser uses
-- -----------------------------------------------------------------------------

create or replace function public.create_employee(
  p_company uuid, p_first_name text, p_last_name text,
  p_email text default null, p_phone text default null,
  p_employment_type text default 'full_time', p_classification text default null,
  p_hourly_rate numeric default null, p_hire_date date default null,
  p_link_me boolean default false)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_employee(p_company, p_first_name, p_last_name, p_email,
                                 p_phone, p_employment_type, p_classification,
                                 p_hourly_rate, p_hire_date, p_link_me); $$;

create or replace function public.create_asset(
  p_company uuid, p_name text, p_asset_class text default null,
  p_make text default null, p_model text default null, p_model_year int default null,
  p_serial_number text default null, p_ownership text default 'owned',
  p_meter_type text default 'hours', p_fuel_type text default null,
  p_acquisition_cost numeric default null, p_acquired_on date default null,
  p_equipment_id uuid default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_asset(p_company, p_name, p_asset_class, p_make, p_model,
                              p_model_year, p_serial_number, p_ownership,
                              p_meter_type, p_fuel_type, p_acquisition_cost,
                              p_acquired_on, p_equipment_id); $$;

create or replace function public.create_work_order(
  p_asset uuid, p_title text, p_work_order_type text default 'corrective',
  p_priority text default 'normal', p_description text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_work_order(p_asset, p_title, p_work_order_type,
                                   p_priority, p_description); $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'app.next_company_employee_number(uuid)',
    'app.next_company_asset_number(uuid)',
    'app.next_work_order_number(uuid)',
    'app.company_for_write(uuid, text)',
    'app.create_employee(uuid, text, text, text, text, text, text, numeric, date, boolean)',
    'app.create_asset(uuid, text, text, text, text, int, text, text, text, text, numeric, date, uuid)',
    'app.create_work_order(uuid, text, text, text, text)',
    'public.create_employee(uuid, text, text, text, text, text, text, numeric, date, boolean)',
    'public.create_asset(uuid, text, text, text, text, int, text, text, text, text, numeric, date, uuid)',
    'public.create_work_order(uuid, text, text, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

select app.assert_security_gates();
