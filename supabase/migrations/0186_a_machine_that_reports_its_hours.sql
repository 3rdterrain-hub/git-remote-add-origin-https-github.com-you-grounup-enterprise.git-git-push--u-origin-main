-- =============================================================================
-- 0186 — A machine that reports its hours
--
-- Fleet is the same shape as Schedule was this morning: the machinery is built,
-- the triggers are written, the alerts are wired, and the table at the bottom
-- of it has no writer.
--
-- `meter_readings` is the keystone. Migration 0015 wrote `apply_meter_reading`,
-- which pushes a reading onto `assets.current_hours`, refuses a reading below
-- the current meter unless the unit was replaced, and stamps
-- `last_telemetry_at`. 0015 wrote `close_maintenance_schedule`, which closes a
-- service out when a work order completes. 0038 wrote `notify_maintenance_due`,
-- which raises the alert when a machine passes its interval. All of it hangs
-- off a table nothing could insert into, so:
--
--   * every machine's hours stayed at whatever they were entered as, forever
--   * "hours run in the last thirty days" on the asset list was always zero,
--     because it is computed from readings inside the window and there were none
--   * no maintenance interval could ever come due, on any machine, ever
--   * `notify_maintenance_due` has never fired
--
-- `fuel_transactions` is the second. 0038 wrote `post_fuel_to_job_cost`, which
-- posts a fuel purchase into `project_costs` under its own bucket — RULE-001
-- keeps fuel separate from the equipment rate precisely so it can be seen — and
-- the fuel bucket has been empty on every job since the platform was built.
-- The four exception flags the column allows are set by nothing, so the Fuel
-- tab's "exceptions" count was structurally zero.
--
-- What is added:
--
--   * `record_meter_reading`, and a meter reading taken from a fuel ticket or
--     a work order rather than asked for twice
--   * `record_fuel`, which detects the four exceptions the schema already names
--   * `set_maintenance_schedule`, so a company can say "service every 250 hours"
--   * the work order's life after it is opened: start, wait for parts,
--     complete with a resolution, cancel
--   * `update_asset` and `set_asset_status`, because a machine that goes down
--     is the single most time-critical fact in this section and there was no
--     way to say it
--
-- WORKFLOW.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The meter
-- -----------------------------------------------------------------------------

/**
 * Record what the meter says.
 *
 * Everything in maintenance is measured from this. The trigger from 0015 does
 * the work — pushing the reading onto the asset, refusing a backwards reading
 * unless the unit was replaced — so this function's job is permission, tenancy
 * and saying plainly what a caller got wrong.
 *
 * `p_is_replacement` is the one way a reading may go down, and it is deliberate
 * rather than inferred: a machine whose meter was changed reads lower, and
 * guessing which of those a low reading is would eventually write off a
 * thousand hours of service history.
 */
create or replace function app.record_meter_reading(
  p_asset        uuid,
  p_hours        numeric default null,
  p_miles        numeric default null,
  p_reading_at   timestamptz default now(),
  p_source       text default 'manual',
  p_is_replacement boolean default false)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_meter   text;
  v_id      uuid;
begin
  select company_id, meter_type into v_company, v_meter from assets where id = p_asset;
  if v_company is null then
    raise exception 'No such machine' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'fleet.write') then
    raise exception 'You do not have permission to record meter readings'
      using errcode = 'insufficient_privilege';
  end if;
  if p_hours is null and p_miles is null then
    raise exception 'A reading needs hours or miles'
      using errcode = 'check_violation';
  end if;
  if p_source not in ('manual','telematics','fuel_card','inspection','work_order') then
    raise exception 'Unknown source %', p_source using errcode = 'check_violation';
  end if;
  /*
   * Named here rather than left to read oddly later: a machine measured in
   * hours has no odometer, and a mile reading on one is a number nobody can
   * act on that would still sit in the history looking authoritative.
   */
  if v_meter = 'none' then
    raise exception 'This machine has no meter'
      using errcode = 'check_violation',
            hint = 'Change its meter type if it does.';
  end if;
  if v_meter = 'hours' and p_miles is not null then
    raise exception 'This machine is measured in hours, not miles'
      using errcode = 'check_violation';
  end if;
  if v_meter = 'miles' and p_hours is not null then
    raise exception 'This machine is measured in miles, not hours'
      using errcode = 'check_violation';
  end if;

  insert into meter_readings (
    company_id, asset_id, reading_at, hours, miles, source,
    is_meter_replacement, recorded_by)
  values (v_company, p_asset, coalesce(p_reading_at, now()), p_hours, p_miles,
          p_source, coalesce(p_is_replacement, false), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.record_meter_reading(uuid, numeric, numeric, timestamptz, text, boolean) is
  'Records what the meter says. The first writer of meter_readings, on which every maintenance interval, every utilization figure and app.notify_maintenance_due all depend — so before this, no interval on any machine could ever come due. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- Fuel
-- -----------------------------------------------------------------------------

/**
 * Record a fuel purchase, and say what looks wrong with it.
 *
 * `fuel_transactions.exception_flag` allows four values and nothing has ever
 * set one. They are not decoration: a fuel card charge against no machine is
 * cost nobody can attribute, a meter that went backwards on the ticket means
 * the wrong unit number was keyed, an outlier volume is usually a truck filling
 * something that is not the machine on the ticket, and a duplicate is a double
 * charge.
 *
 * Flagged, never refused. A fuel transaction happened whether or not it makes
 * sense, and a platform that refuses the row loses the money; a platform that
 * accepts it silently loses the question. So the row is written and the
 * exception is stated.
 *
 * An odometer on the ticket also records a meter reading, because it is the
 * same fact and asking for it twice is how two answers start disagreeing. That
 * reading goes in as `fuel_card` and never as a replacement, so it cannot be
 * the route by which a machine's hours are quietly reduced.
 */
create or replace function app.record_fuel(
  p_company       uuid,
  p_gallons       numeric,
  p_price         numeric,
  p_transacted_at timestamptz default now(),
  p_asset         uuid default null,
  p_employee      uuid default null,
  p_project       uuid default null,
  p_fuel_type     text default 'diesel',
  p_odometer_hours numeric default null,
  p_odometer_miles numeric default null,
  p_card_last4    text default null,
  p_vendor_name   text default null,
  p_location      text default null,
  p_source        text default 'manual')
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company   uuid := app.company_for_write(p_company, 'fleet.write');
  v_at        timestamptz := coalesce(p_transacted_at, now());
  v_flag      text;
  v_current   numeric;
  v_meter     text;
  v_median    numeric;
  v_id        uuid;
begin
  if p_gallons is null or p_gallons <= 0 then
    raise exception 'A fuel ticket needs a volume' using errcode = 'check_violation';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'A fuel ticket needs a price per gallon' using errcode = 'check_violation';
  end if;
  if p_source not in ('manual','fuel_card','onsite_tank','import') then
    raise exception 'Unknown source %', p_source using errcode = 'check_violation';
  end if;

  if p_asset is not null then
    select current_hours, meter_type into v_current, v_meter
      from assets where id = p_asset and company_id = v_company;
    if v_meter is null then
      raise exception 'No such machine' using errcode = 'no_data_found';
    end if;
  end if;

  /* The flags, in the order they matter. Cost nobody can attribute comes first. */
  if p_asset is null then
    v_flag := 'no_asset';

  elsif exists (
    select 1 from fuel_transactions f
     where f.asset_id = p_asset
       and f.gallons = p_gallons
       and f.transacted_at = v_at) then
    v_flag := 'duplicate';

  elsif p_odometer_hours is not null and v_current is not null
        and p_odometer_hours < v_current then
    /* The ticket reads below the machine: usually the wrong unit number keyed. */
    v_flag := 'meter_regression';

  else
    /*
     * An outlier against this machine's own history, not against a number
     * somebody picked. Three times the median of its last twenty fills — a
     * machine that takes 40 gallons taking 140 is a truck filling something
     * else. Under five fills there is no history to judge against, and a guess
     * dressed as a finding is worse than no finding.
     */
    select percentile_cont(0.5) within group (order by gallons) into v_median
      from (select gallons from fuel_transactions
             where asset_id = p_asset order by transacted_at desc limit 20) recent
     having count(*) >= 5;

    if v_median is not null and v_median > 0 and p_gallons > v_median * 3 then
      v_flag := 'volume_outlier';
    end if;
  end if;

  insert into fuel_transactions (
    company_id, asset_id, employee_id, project_id, transacted_at, gallons,
    price_per_gallon, fuel_type, odometer_hours, odometer_miles, card_last4,
    vendor_name, location, source, exception_flag)
  values (
    v_company, p_asset, p_employee, p_project, v_at, p_gallons, p_price,
    coalesce(nullif(btrim(coalesce(p_fuel_type,'')),''), 'diesel'),
    p_odometer_hours, p_odometer_miles,
    nullif(btrim(coalesce(p_card_last4,'')),'')::char(4),
    nullif(btrim(coalesce(p_vendor_name,'')),''),
    nullif(btrim(coalesce(p_location,'')),''),
    coalesce(p_source, 'manual'), v_flag)
  returning id into v_id;

  /*
   * The same fact, recorded once. A forward reading only: a fuel ticket is not
   * where a meter replacement is declared, and `meter_regression` above has
   * already said so when it reads low.
   */
  if p_asset is not null and v_flag is distinct from 'meter_regression'
     and (p_odometer_hours is not null or p_odometer_miles is not null) then
    insert into meter_readings (
      company_id, asset_id, reading_at, hours, miles, source, recorded_by)
    values (v_company, p_asset, v_at,
            case when v_meter in ('hours','both') then p_odometer_hours end,
            case when v_meter in ('miles','both') then p_odometer_miles end,
            'fuel_card', auth.uid());
  end if;

  return v_id;
end;
$$;

comment on function app.record_fuel(uuid, numeric, numeric, timestamptz, uuid, uuid, uuid, text, numeric, numeric, text, text, text, text) is
  'Records a fuel purchase and flags what looks wrong with it. The first writer of fuel_transactions, so the fuel bucket that RULE-001 keeps separate has been empty on every job since the platform was built. Flags, never refuses: the money was spent either way. WORKFLOW.';

/** Clear or set an exception by hand, once somebody has looked at it. */
create or replace function app.resolve_fuel_exception(
  p_transaction uuid,
  p_asset       uuid default null,
  p_clear       boolean default true)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from fuel_transactions where id = p_transaction;
  if v_company is null then
    raise exception 'No such fuel transaction' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'fleet.write') then
    raise exception 'You do not have permission to change fuel records'
      using errcode = 'insufficient_privilege';
  end if;
  if p_asset is not null and not exists (
       select 1 from assets where id = p_asset and company_id = v_company) then
    raise exception 'No such machine' using errcode = 'no_data_found';
  end if;

  update fuel_transactions
     set asset_id = coalesce(p_asset, asset_id),
         exception_flag = case when p_clear then null else exception_flag end,
         updated_at = now()
   where id = p_transaction;
end;
$$;

comment on function app.resolve_fuel_exception(uuid, uuid, boolean) is
  'Attributes an unmatched fuel ticket to a machine, or marks an exception looked at. The trigger from 0038 reposts the job cost. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- Maintenance intervals
-- -----------------------------------------------------------------------------

/**
 * Say what service a machine is due for, and how often.
 *
 * One of hours, miles or days must be given — the table says so — because a
 * schedule with no interval can never come due, which is the state every
 * machine in this platform was already in for want of this function.
 *
 * The baseline for the first service is the meter now, unless one is given.
 * Otherwise a machine with 4,000 hours on it is instantly overdue for its
 * 250-hour service sixteen times over.
 */
create or replace function app.set_maintenance_schedule(
  p_asset      uuid,
  p_name       text,
  p_hours      numeric default null,
  p_miles      numeric default null,
  p_days       int default null,
  p_last_hours numeric default null,
  p_schedule   uuid default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_current numeric;
  v_id      uuid;
begin
  select company_id, current_hours into v_company, v_current
    from assets where id = p_asset;
  if v_company is null then
    raise exception 'No such machine' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'fleet.write') then
    raise exception 'You do not have permission to change maintenance'
      using errcode = 'insufficient_privilege';
  end if;
  if btrim(coalesce(p_name,'')) = '' then
    raise exception 'A service needs a name'
      using errcode = 'check_violation',
            hint = 'What it is: 250-hour service, annual DOT inspection.';
  end if;
  if coalesce(p_hours, 0) <= 0 and coalesce(p_miles, 0) <= 0 and coalesce(p_days, 0) <= 0 then
    raise exception 'Say how often: hours, miles or days'
      using errcode = 'check_violation',
            hint = 'A schedule with no interval can never come due.';
  end if;

  if p_schedule is not null then
    update maintenance_schedules
       set name = btrim(p_name),
           interval_hours = p_hours, interval_miles = p_miles, interval_days = p_days,
           last_performed_hours = coalesce(p_last_hours, last_performed_hours),
           updated_at = now()
     where id = p_schedule and asset_id = p_asset
     returning id into v_id;
    if v_id is null then
      raise exception 'No such service on this machine' using errcode = 'no_data_found';
    end if;
    return v_id;
  end if;

  insert into maintenance_schedules (
    company_id, asset_id, name, interval_hours, interval_miles, interval_days,
    last_performed_hours, last_performed_at)
  values (v_company, p_asset, btrim(p_name), p_hours, p_miles, p_days,
          coalesce(p_last_hours, v_current), now())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.set_maintenance_schedule(uuid, text, numeric, numeric, int, numeric, uuid) is
  'Creates or edits a service interval. The first writer of maintenance_schedules, which notify_maintenance_due (0038) has watched since it was written with nothing ever in it. WORKFLOW.';

/** Stop watching a service without erasing that it was ever watched. */
create or replace function app.retire_maintenance_schedule(p_schedule uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from maintenance_schedules where id = p_schedule;
  if v_company is null then
    raise exception 'No such service' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'fleet.write') then
    raise exception 'You do not have permission to change maintenance'
      using errcode = 'insufficient_privilege';
  end if;
  update maintenance_schedules set is_active = false, updated_at = now()
   where id = p_schedule;
end;
$$;

comment on function app.retire_maintenance_schedule(uuid) is
  'Deactivates a service interval. Kept rather than deleted, because the work orders that closed against it still point at it. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- The rest of a work order's life
-- -----------------------------------------------------------------------------

/**
 * Change a work order that is open.
 *
 * `create_work_order` (0161) opens one, and that was the whole of it: a machine
 * could be reported broken and never reported fixed. Every work order raised on
 * this platform was open forever, so `open work orders` on the Fleet page
 * counted every one ever created and downtime was zero on every machine.
 *
 * Completion is separate, below, because completing is not editing: it needs a
 * resolution, and the schema says so.
 */
create or replace function app.update_work_order(
  p_work_order   uuid,
  p_title        text default null,
  p_status       text default null,
  p_priority     text default null,
  p_description  text default null,
  p_failure_code text default null,
  p_scheduled_for date default null,
  p_assigned_to  uuid default null,
  p_vendor       uuid default null,
  p_schedule     uuid default null,
  p_labor_hours  numeric default null,
  p_labor_cost   numeric default null,
  p_parts_cost   numeric default null,
  p_outside_cost numeric default null,
  p_downtime_hours numeric default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_w work_orders%rowtype;
begin
  select * into v_w from work_orders where id = p_work_order;
  if v_w.id is null then
    raise exception 'No such work order' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_w.company_id, 'fleet.write') then
    raise exception 'You do not have permission to change work orders'
      using errcode = 'insufficient_privilege';
  end if;
  if v_w.status in ('complete', 'canceled') then
    raise exception 'That work order is already %', v_w.status
      using errcode = 'check_violation',
            hint = 'Raise a new one rather than reopening a closed record.';
  end if;
  /*
   * Completing and canceling have their own doors, because each has a
   * requirement this function does not enforce and would silently skip.
   */
  if p_status is not null and p_status not in
     ('open','scheduled','in_progress','awaiting_parts') then
    raise exception 'Complete or cancel a work order through its own action, not by setting a status'
      using errcode = 'check_violation';
  end if;
  if p_priority is not null and p_priority not in ('low','normal','high','critical') then
    raise exception 'Unknown priority %', p_priority using errcode = 'check_violation';
  end if;
  if p_schedule is not null and not exists (
       select 1 from maintenance_schedules s
        where s.id = p_schedule and s.asset_id = v_w.asset_id) then
    raise exception 'That service is not on this machine' using errcode = 'check_violation';
  end if;

  update work_orders
     set title        = coalesce(nullif(btrim(coalesce(p_title,'')),''), title),
         status       = coalesce(p_status, status),
         priority     = coalesce(p_priority, priority),
         description  = coalesce(p_description, description),
         failure_code = coalesce(nullif(btrim(coalesce(p_failure_code,'')),''), failure_code),
         scheduled_for = coalesce(p_scheduled_for, scheduled_for),
         assigned_to  = coalesce(p_assigned_to, assigned_to),
         vendor_id    = coalesce(p_vendor, vendor_id),
         schedule_id  = coalesce(p_schedule, schedule_id),
         labor_hours  = coalesce(p_labor_hours, labor_hours),
         labor_cost   = coalesce(p_labor_cost, labor_cost),
         parts_cost   = coalesce(p_parts_cost, parts_cost),
         outside_cost = coalesce(p_outside_cost, outside_cost),
         downtime_hours = coalesce(p_downtime_hours, downtime_hours),
         /* Work starting is a fact with a time on it, recorded once. */
         started_at   = case when p_status = 'in_progress' and started_at is null
                             then now() else started_at end,
         updated_at   = now()
   where id = p_work_order;
end;
$$;

comment on function app.update_work_order(uuid, text, text, text, text, text, date, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric) is
  'Changes an open work order. Before this one could be opened and never anything else, so every work order ever raised stayed open and every machine showed zero downtime. WORKFLOW.';

/**
 * Complete a work order.
 *
 * The resolution is required, and not only because the constraint from 0015
 * says so: "complete" with no resolution tells the next mechanic nothing, and
 * the next mechanic is the reason the record exists.
 *
 * Completing a preventive order resets its interval from the machine's meter —
 * `close_maintenance_schedule` (0015) does that, and has never once run, having
 * waited since it was written for a status to change to complete.
 *
 * The meter at completion is recorded when it is given, because a mechanic
 * standing at the machine is the person best placed to read it, and the
 * interval that resets a moment later is measured from exactly that number.
 */
create or replace function app.complete_work_order(
  p_work_order uuid,
  p_resolution text,
  p_downtime_hours numeric default null,
  p_labor_hours numeric default null,
  p_labor_cost numeric default null,
  p_parts_cost numeric default null,
  p_outside_cost numeric default null,
  p_meter_hours numeric default null,
  p_completed_at timestamptz default now())
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_w work_orders%rowtype;
begin
  select * into v_w from work_orders where id = p_work_order;
  if v_w.id is null then
    raise exception 'No such work order' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_w.company_id, 'fleet.write') then
    raise exception 'You do not have permission to change work orders'
      using errcode = 'insufficient_privilege';
  end if;
  if v_w.status = 'complete' then
    raise exception 'That work order is already complete' using errcode = 'check_violation';
  end if;
  if v_w.status = 'canceled' then
    raise exception 'That work order was canceled' using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_resolution, ''))) < 3 then
    raise exception 'Say what was done'
      using errcode = 'check_violation',
            hint = 'The next person to open this machine reads this and nothing else.';
  end if;

  /* The meter first, so the interval resets from the reading, not from before it. */
  if p_meter_hours is not null then
    perform app.record_meter_reading(v_w.asset_id, p_meter_hours, null,
                                     coalesce(p_completed_at, now()), 'work_order');
  end if;

  update work_orders
     set status       = 'complete',
         resolution   = btrim(p_resolution),
         completed_at = coalesce(p_completed_at, now()),
         downtime_hours = coalesce(p_downtime_hours, downtime_hours),
         labor_hours  = coalesce(p_labor_hours, labor_hours),
         labor_cost   = coalesce(p_labor_cost, labor_cost),
         parts_cost   = coalesce(p_parts_cost, parts_cost),
         outside_cost = coalesce(p_outside_cost, outside_cost),
         started_at   = coalesce(started_at, opened_at),
         updated_at   = now()
   where id = p_work_order;

  /*
   * A machine held down by this work order is available again. Only where the
   * work order is what put it down: a machine down for something else stays
   * down, and a machine that was never down is not "made" available.
   */
  if v_w.status in ('open','scheduled','in_progress','awaiting_parts')
     and not exists (
       select 1 from work_orders w
        where w.asset_id = v_w.asset_id and w.id <> p_work_order
          and w.status in ('open','scheduled','in_progress','awaiting_parts')
          and w.priority = 'critical') then
    update assets set status = 'available', updated_at = now()
     where id = v_w.asset_id and status = 'in_maintenance';
  end if;
end;
$$;

comment on function app.complete_work_order(uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, timestamptz) is
  'Closes a work order with what was actually done. Completing a preventive one resets its interval through close_maintenance_schedule (0015), which had never run because no status could ever change to complete. WORKFLOW.';

/** Cancel a work order that should not have been raised. Says why. */
create or replace function app.cancel_work_order(p_work_order uuid, p_reason text)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid; v_status text;
begin
  select company_id, status into v_company, v_status
    from work_orders where id = p_work_order;
  if v_company is null then
    raise exception 'No such work order' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'fleet.write') then
    raise exception 'You do not have permission to change work orders'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status = 'complete' then
    raise exception 'A completed work order cannot be canceled'
      using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why it is being canceled' using errcode = 'check_violation';
  end if;

  update work_orders
     set status = 'canceled', resolution = btrim(p_reason), updated_at = now()
   where id = p_work_order;
end;
$$;

comment on function app.cancel_work_order(uuid, text) is
  'Cancels a work order, with the reason kept in the resolution. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- The machine itself
-- -----------------------------------------------------------------------------

/**
 * Change a machine.
 *
 * `create_asset` (0161) could make one and nothing could correct it — a typed
 * serial number, a machine that moved yards, a rate class attached to the wrong
 * unit. Status is deliberately not settable here; it has its own door below,
 * because putting a machine down is an event rather than an edit.
 */
create or replace function app.update_asset(
  p_asset       uuid,
  p_name        text default null,
  p_asset_class text default null,
  p_make        text default null,
  p_model       text default null,
  p_model_year  int default null,
  p_serial_number text default null,
  p_vin         text default null,
  p_license_plate text default null,
  p_ownership   text default null,
  p_meter_type  text default null,
  p_fuel_type   text default null,
  p_home_location text default null,
  p_equipment   uuid default null,
  p_project     uuid default null,
  p_operator    uuid default null,
  p_notes       text default null,
  p_acquisition_cost numeric default null,
  p_acquired_on date default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from assets where id = p_asset;
  if v_company is null then
    raise exception 'No such machine' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'fleet.write') then
    raise exception 'You do not have permission to change machines'
      using errcode = 'insufficient_privilege';
  end if;
  if p_ownership is not null and p_ownership not in
     ('owned','leased','rented','subcontracted') then
    raise exception 'Unknown ownership %', p_ownership using errcode = 'check_violation';
  end if;
  if p_meter_type is not null and p_meter_type not in ('hours','miles','both','none') then
    raise exception 'Unknown meter type %', p_meter_type using errcode = 'check_violation';
  end if;
  if p_equipment is not null and not exists (select 1 from equipment where id = p_equipment) then
    raise exception 'That catalog rate does not exist' using errcode = 'no_data_found';
  end if;

  update assets
     set name        = coalesce(nullif(btrim(coalesce(p_name,'')),''), name),
         asset_class = coalesce(nullif(btrim(coalesce(p_asset_class,'')),''), asset_class),
         make        = coalesce(nullif(btrim(coalesce(p_make,'')),''), make),
         model       = coalesce(nullif(btrim(coalesce(p_model,'')),''), model),
         model_year  = coalesce(p_model_year, model_year),
         serial_number = coalesce(nullif(btrim(coalesce(p_serial_number,'')),''), serial_number),
         vin         = coalesce(nullif(btrim(coalesce(p_vin,'')),''), vin),
         license_plate = coalesce(nullif(btrim(coalesce(p_license_plate,'')),''), license_plate),
         ownership   = coalesce(p_ownership, ownership),
         meter_type  = coalesce(p_meter_type, meter_type),
         fuel_type   = coalesce(p_fuel_type, fuel_type),
         home_location = coalesce(nullif(btrim(coalesce(p_home_location,'')),''), home_location),
         equipment_id = coalesce(p_equipment, equipment_id),
         assigned_project_id = coalesce(p_project, assigned_project_id),
         assigned_employee_id = coalesce(p_operator, assigned_employee_id),
         notes       = coalesce(p_notes, notes),
         acquisition_cost = coalesce(p_acquisition_cost, acquisition_cost),
         acquired_on = coalesce(p_acquired_on, acquired_on),
         updated_at  = now()
   where id = p_asset;
end;
$$;

comment on function app.update_asset(uuid, text, text, text, text, int, text, text, text, text, text, text, text, uuid, uuid, uuid, text, numeric, date) is
  'Corrects a machine''s details and says where it is and who is on it. Status has its own door, because putting a machine down is an event rather than an edit. WORKFLOW.';

/**
 * Put a machine down, or back in service.
 *
 * The most time-critical fact in this section, and there was no way to say it.
 * `notify_asset_down` (0038) has watched `assets.status` since it was written
 * and could never fire, because the only writer of status was `create_asset`,
 * which starts every machine as available.
 *
 * Disposal is refused here. It needs a date and it takes a machine out of every
 * report at once, so it is a decision rather than a status change.
 */
create or replace function app.set_asset_status(
  p_asset  uuid,
  p_status text,
  p_note   text default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid; v_old text;
begin
  select company_id, status into v_company, v_old from assets where id = p_asset;
  if v_company is null then
    raise exception 'No such machine' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'fleet.write') then
    raise exception 'You do not have permission to change machines'
      using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('available','assigned','in_maintenance','down','rented_out') then
    raise exception 'Unknown status %', p_status
      using errcode = 'check_violation',
            hint = 'Disposing of a machine is its own action, because it needs a date.';
  end if;
  if v_old = 'disposed' then
    raise exception 'That machine has been disposed of' using errcode = 'check_violation';
  end if;

  update assets
     set status = p_status,
         notes  = case when btrim(coalesce(p_note,'')) = '' then notes
                       else btrim(p_note) end,
         updated_at = now()
   where id = p_asset;
end;
$$;

comment on function app.set_asset_status(uuid, text, text) is
  'Puts a machine down or back in service. app.notify_asset_down (0038) has watched this column since it was written and could never fire, because nothing could change a status. WORKFLOW.';

/** Take a machine off the books. Needs the date, because every report uses it. */
create or replace function app.dispose_asset(
  p_asset uuid, p_disposed_on date default current_date, p_note text default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid; v_open int;
begin
  select company_id into v_company from assets where id = p_asset;
  if v_company is null then
    raise exception 'No such machine' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'fleet.write') then
    raise exception 'You do not have permission to change machines'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_open from work_orders
   where asset_id = p_asset and status in ('open','scheduled','in_progress','awaiting_parts');
  if v_open > 0 then
    raise exception 'That machine has % open work %', v_open,
      case when v_open = 1 then 'order' else 'orders' end
      using errcode = 'check_violation',
            hint = 'Close or cancel them first, so the cost lands before the machine leaves.';
  end if;

  update assets
     set status = 'disposed',
         disposed_on = coalesce(p_disposed_on, current_date),
         assigned_project_id = null,
         assigned_employee_id = null,
         notes = case when btrim(coalesce(p_note,'')) = '' then notes else btrim(p_note) end,
         updated_at = now()
   where id = p_asset;
end;
$$;

comment on function app.dispose_asset(uuid, date, text) is
  'Takes a machine off the books, refusing while work orders are still open so their cost lands first. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- What a machine's hours are worth reading
-- -----------------------------------------------------------------------------

/**
 * Every machine with what its meter has actually done.
 *
 * Hours run in a window is the difference between the meter now and the
 * earliest reading still inside it — and a meter replacement resets the count,
 * so those readings are excluded rather than producing a negative. The asset
 * list computed this in the browser from two separate reads; doing it here
 * means utilization, the maintenance list and any report agree, because they
 * are reading one answer instead of three implementations of it.
 */
create or replace view my_asset_meters
with (security_invoker = true) as
select a.id                    as asset_id,
       a.company_id,
       a.asset_number,
       a.name,
       a.status,
       a.meter_type,
       a.current_hours,
       a.current_miles,
       a.last_telemetry_at,
       (select min(r.hours) from meter_readings r
         where r.asset_id = a.id
           and r.is_meter_replacement = false
           and r.hours is not null
           and r.reading_at >= now() - interval '30 days')     as hours_30_days_ago,
       (select count(*) from meter_readings r
         where r.asset_id = a.id)                              as reading_count,
       (select max(r.reading_at) from meter_readings r
         where r.asset_id = a.id)                              as last_reading_at,
       (select count(*) from work_orders w
         where w.asset_id = a.id
           and w.status in ('open','scheduled','in_progress','awaiting_parts'))
                                                               as open_work_orders,
       (select coalesce(sum(w.downtime_hours), 0) from work_orders w
         where w.asset_id = a.id and w.completed_at >= now() - interval '30 days')
                                                               as downtime_30_days
  from assets a
 where a.disposed_on is null;

comment on view my_asset_meters is
  'Each machine with the hours its meter has actually moved in the last thirty days, its open work orders and its recent downtime. ENTITY. One answer rather than three implementations of the same subtraction.';

revoke all on my_asset_meters from public, anon;
grant select on my_asset_meters to authenticated, service_role;

/**
 * The service intervals on a machine, and how close each is.
 *
 * `hours_remaining` is negative when a service is overdue, which is the number
 * a shop actually looks for. Null where the schedule is measured in something
 * the machine does not have a meter for — an honest gap rather than a zero that
 * reads as "due now".
 */
create or replace view my_maintenance_due
with (security_invoker = true) as
select s.id                        as schedule_id,
       s.company_id,
       s.asset_id,
       a.asset_number,
       a.name                      as asset_name,
       a.status                    as asset_status,
       s.name,
       s.interval_hours,
       s.interval_miles,
       s.interval_days,
       s.last_performed_at,
       s.last_performed_hours,
       a.current_hours,
       case when s.interval_hours is not null
            then (coalesce(s.last_performed_hours, 0) + s.interval_hours) - a.current_hours
       end                         as hours_remaining,
       case when s.interval_days is not null and s.last_performed_at is not null
            then s.interval_days - (current_date - s.last_performed_at::date)
       end                         as days_remaining,
       (select count(*) from work_orders w
         where w.schedule_id = s.id
           and w.status in ('open','scheduled','in_progress','awaiting_parts'))
                                   as open_work_orders
  from maintenance_schedules s
  join assets a on a.id = s.asset_id
 where s.is_active
   and a.disposed_on is null;

comment on view my_maintenance_due is
  'Each active service interval with how many hours or days remain, negative when overdue. ENTITY. Null where the interval is measured in something the machine has no meter for — a gap said out loud rather than a zero that reads as due now.';

revoke all on my_maintenance_due from public, anon;
grant select on my_maintenance_due to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The doors
-- -----------------------------------------------------------------------------

create or replace function public.record_meter_reading(
  p_asset uuid, p_hours numeric default null, p_miles numeric default null,
  p_reading_at timestamptz default now(), p_source text default 'manual',
  p_is_replacement boolean default false)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.record_meter_reading(p_asset, p_hours, p_miles, p_reading_at,
       p_source, p_is_replacement); $$;

create or replace function public.record_fuel(
  p_company uuid, p_gallons numeric, p_price numeric,
  p_transacted_at timestamptz default now(), p_asset uuid default null,
  p_employee uuid default null, p_project uuid default null,
  p_fuel_type text default 'diesel', p_odometer_hours numeric default null,
  p_odometer_miles numeric default null, p_card_last4 text default null,
  p_vendor_name text default null, p_location text default null,
  p_source text default 'manual')
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.record_fuel(p_company, p_gallons, p_price, p_transacted_at, p_asset,
       p_employee, p_project, p_fuel_type, p_odometer_hours, p_odometer_miles,
       p_card_last4, p_vendor_name, p_location, p_source); $$;

create or replace function public.resolve_fuel_exception(
  p_transaction uuid, p_asset uuid default null, p_clear boolean default true)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.resolve_fuel_exception(p_transaction, p_asset, p_clear); $$;

create or replace function public.set_maintenance_schedule(
  p_asset uuid, p_name text, p_hours numeric default null,
  p_miles numeric default null, p_days int default null,
  p_last_hours numeric default null, p_schedule uuid default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_maintenance_schedule(p_asset, p_name, p_hours, p_miles,
       p_days, p_last_hours, p_schedule); $$;

create or replace function public.retire_maintenance_schedule(p_schedule uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.retire_maintenance_schedule(p_schedule); $$;

create or replace function public.update_work_order(
  p_work_order uuid, p_title text default null, p_status text default null,
  p_priority text default null, p_description text default null,
  p_failure_code text default null, p_scheduled_for date default null,
  p_assigned_to uuid default null, p_vendor uuid default null,
  p_schedule uuid default null, p_labor_hours numeric default null,
  p_labor_cost numeric default null, p_parts_cost numeric default null,
  p_outside_cost numeric default null, p_downtime_hours numeric default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_work_order(p_work_order, p_title, p_status, p_priority,
       p_description, p_failure_code, p_scheduled_for, p_assigned_to, p_vendor,
       p_schedule, p_labor_hours, p_labor_cost, p_parts_cost, p_outside_cost,
       p_downtime_hours); $$;

create or replace function public.complete_work_order(
  p_work_order uuid, p_resolution text, p_downtime_hours numeric default null,
  p_labor_hours numeric default null, p_labor_cost numeric default null,
  p_parts_cost numeric default null, p_outside_cost numeric default null,
  p_meter_hours numeric default null, p_completed_at timestamptz default now())
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.complete_work_order(p_work_order, p_resolution, p_downtime_hours,
       p_labor_hours, p_labor_cost, p_parts_cost, p_outside_cost, p_meter_hours,
       p_completed_at); $$;

create or replace function public.cancel_work_order(p_work_order uuid, p_reason text)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.cancel_work_order(p_work_order, p_reason); $$;

create or replace function public.update_asset(
  p_asset uuid, p_name text default null, p_asset_class text default null,
  p_make text default null, p_model text default null, p_model_year int default null,
  p_serial_number text default null, p_vin text default null,
  p_license_plate text default null, p_ownership text default null,
  p_meter_type text default null, p_fuel_type text default null,
  p_home_location text default null, p_equipment uuid default null,
  p_project uuid default null, p_operator uuid default null,
  p_notes text default null, p_acquisition_cost numeric default null,
  p_acquired_on date default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_asset(p_asset, p_name, p_asset_class, p_make, p_model,
       p_model_year, p_serial_number, p_vin, p_license_plate, p_ownership,
       p_meter_type, p_fuel_type, p_home_location, p_equipment, p_project,
       p_operator, p_notes, p_acquisition_cost, p_acquired_on); $$;

create or replace function public.set_asset_status(
  p_asset uuid, p_status text, p_note text default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_asset_status(p_asset, p_status, p_note); $$;

create or replace function public.dispose_asset(
  p_asset uuid, p_disposed_on date default current_date, p_note text default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.dispose_asset(p_asset, p_disposed_on, p_note); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.record_meter_reading(uuid, numeric, numeric, timestamptz, text, boolean)',
    'public.record_fuel(uuid, numeric, numeric, timestamptz, uuid, uuid, uuid, text, numeric, numeric, text, text, text, text)',
    'public.resolve_fuel_exception(uuid, uuid, boolean)',
    'public.set_maintenance_schedule(uuid, text, numeric, numeric, int, numeric, uuid)',
    'public.retire_maintenance_schedule(uuid)',
    'public.update_work_order(uuid, text, text, text, text, text, date, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric)',
    'public.complete_work_order(uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, timestamptz)',
    'public.cancel_work_order(uuid, text)',
    'public.update_asset(uuid, text, text, text, text, int, text, text, text, text, text, text, text, uuid, uuid, uuid, text, numeric, date)',
    'public.set_asset_status(uuid, text, text)',
    'public.dispose_asset(uuid, date, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
