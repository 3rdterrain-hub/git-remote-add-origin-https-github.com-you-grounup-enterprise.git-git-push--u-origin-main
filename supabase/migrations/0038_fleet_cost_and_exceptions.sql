-- =============================================================================
-- 0038 — Fleet cost reaches the job, and fleet exceptions reach a person
--
-- Two things this phase's acceptance criterion asks for that the platform did
-- not do.
--
--   * **"financial and project links are preserved."** A fuel transaction
--     carries a project, gallons, a price per gallon and a generated total
--     cost. `project_costs` carries a `cost_type` of `fuel`, a `source` of
--     `fuel_card` or `telematics`, an `equipment_id`, and a `reference` for
--     where the row came from. The schema was designed for exactly this
--     posting on both sides, and **nothing wrote it**. A machine burned $400 of
--     diesel on a job and the job's cost did not know.
--
--   * **"exceptions are surfaced."** Nothing notified anybody that a machine
--     went down or that a service came due. The notification table did not
--     even carry a fleet category.
--
-- What is deliberately *not* posted: work order cost. Maintenance is an
-- ownership cost recovered through the equipment rate, not a direct charge to
-- whichever job the machine happened to be on when it broke. Posting it to the
-- job would double-count against the rate and would put the cost of a worn
-- undercarriage on the last project to use the machine. That distinction is
-- the reason equipment rates exist.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Fuel reaches job cost
-- -----------------------------------------------------------------------------

/**
 * Post a fuel transaction to the job it was burned on.
 *
 * Kept in sync rather than posted once: a corrected gallon count has to correct
 * the job cost, and a deleted transaction has to remove it. The link is carried
 * in `reference`, which is what that column is for.
 *
 * A transaction with no project is equipment overhead and posts nothing —
 * the platform does not guess which job to charge.
 */
create or replace function app.post_fuel_to_job_cost()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ref text;
  v_equipment uuid;
begin
  v_ref := 'fuel_transaction:' || coalesce(new.id, old.id)::text;

  if tg_op = 'DELETE' then
    delete from project_costs where company_id = old.company_id and reference = v_ref;
    return old;
  end if;

  delete from project_costs where company_id = new.company_id and reference = v_ref;

  if new.project_id is null then
    return new;
  end if;

  select a.equipment_id into v_equipment from assets a where a.id = new.asset_id;

  insert into project_costs (
    company_id, project_id, cost_date, cost_type, description,
    quantity, unit, unit_cost, amount, equipment_id, reference, source, posted_at)
  values (
    new.company_id, new.project_id, new.transacted_at::date, 'fuel',
    coalesce((select 'Fuel — ' || a.asset_number || ' ' || a.name from assets a where a.id = new.asset_id),
             'Fuel'),
    new.gallons, 'GAL', new.price_per_gallon, new.total_cost, v_equipment, v_ref,
    case new.source when 'fuel_card' then 'fuel_card'
                    when 'import' then 'accounting_import'
                    else 'manual' end,
    now());

  return new;
end;
$$;

create trigger fuel_transactions_post_cost
  after insert or update or delete on fuel_transactions
  for each row execute function app.post_fuel_to_job_cost();

comment on function app.post_fuel_to_job_cost() is
  'Posts fuel burned on a job to that job''s cost, and keeps the posting in step with corrections and deletions. Fuel with no project is equipment overhead and posts nothing, because the platform does not guess which job to charge.';

-- -----------------------------------------------------------------------------
-- Fleet exceptions reach a person
-- -----------------------------------------------------------------------------

-- The category list had no room for fleet. A machine going down is not a
-- 'system' notice.
alter table notifications
  drop constraint notifications_category_check;

alter table notifications
  add constraint notifications_category_check
  check (category in ('estimate', 'project', 'rfi', 'submittal', 'change_order',
                      'approval', 'ai_finding', 'calibration', 'billing',
                      'safety', 'schedule', 'fleet', 'system'));

/**
 * A machine going down notifies the company.
 *
 * On the transition into `down` only. A machine that is already down does not
 * need re-announcing every time somebody edits its record.
 */
create or replace function app.notify_asset_down()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.status <> 'down' or (tg_op = 'UPDATE' and old.status = 'down') then
    return new;
  end if;

  insert into notifications (company_id, category, severity, title, body,
                             action_path, action_label, entity_table, entity_id)
  values (
    new.company_id, 'fleet', 'critical',
    new.asset_number || ' is down',
    new.name || ' at ' || coalesce(new.home_location, 'an unrecorded location') ||
      '. Any schedule activity relying on it needs a replacement or a new date.',
    '/app/fleet', 'Open the asset', 'public.assets', new.id::text);

  return new;
end;
$$;

create trigger assets_notify_down
  after insert or update of status on assets
  for each row execute function app.notify_asset_down();

/**
 * A service coming due notifies the company.
 *
 * Driven by the meter rather than by a clock, because that is how heavy
 * equipment is actually serviced, and fired on the reading that crosses the
 * interval so it announces once rather than on every reading afterwards.
 */
create or replace function app.notify_maintenance_due()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  s record;
  v_asset record;
  v_due numeric;
  v_prior numeric;
begin
  select * into v_asset from assets where id = new.asset_id;
  if not found then return new; end if;

  -- The meter before this reading, so a crossing can be distinguished from a
  -- state that was already overdue.
  select coalesce(max(m.hours), 0) into v_prior
  from meter_readings m
  where m.asset_id = new.asset_id and m.id <> new.id and m.hours <= new.hours;

  for s in
    select * from maintenance_schedules
    where asset_id = new.asset_id and interval_hours is not null and is_active
  loop
    v_due := coalesce(s.last_performed_hours, 0) + s.interval_hours;
    if new.hours >= v_due and v_prior < v_due then
      insert into notifications (company_id, category, severity, title, body,
                                 action_path, action_label, entity_table, entity_id)
      values (
        v_asset.company_id, 'fleet', 'warning',
        v_asset.asset_number || ': ' || s.name || ' is due',
        v_asset.name || ' reached ' || new.hours || ' hours; ' || s.name ||
          ' was due at ' || v_due || '.',
        '/app/fleet', 'Open the schedule', 'public.maintenance_schedules', s.id::text);
    end if;
  end loop;

  return new;
end;
$$;

create trigger meter_readings_notify_due
  after insert on meter_readings
  for each row execute function app.notify_maintenance_due();

comment on function app.notify_maintenance_due() is
  'Announces a service on the meter reading that crosses its interval, once. Driven by the meter rather than a clock, because that is how heavy equipment is serviced.';

select app.assert_security_gates();
