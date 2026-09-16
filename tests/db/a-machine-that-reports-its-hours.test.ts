/**
 * A machine that reports its hours.
 *
 * Fleet was the same shape Schedule was: triggers written, alerts wired, and
 * nothing able to insert into the table they all hang off.
 *
 * `meter_readings` is the keystone. `apply_meter_reading` (0015) pushes a
 * reading onto the asset and refuses one below the current meter;
 * `close_maintenance_schedule` (0015) resets an interval when a work order
 * completes; `notify_maintenance_due` (0038) raises the alert when a machine
 * passes its interval. None of it could ever run, so no maintenance interval on
 * any machine in this platform could ever come due.
 *
 * The other half is `fuel_transactions`, whose four exception flags were set by
 * nothing, and whose `post_fuel_to_job_cost` trigger (0038) meant the fuel
 * bucket RULE-001 keeps separate was empty on every job.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '5e4e4e4e-4e4e-4e4e-8e4e-4e4e4e4e4e4e';

describe('a machine that reports its hours', () => {
  let h: Harness;
  let company = '';
  let asset = '';
  let project = '';

  const assetRow = async () => (await h.asUser(OWNER, () => h.sql<{
    current_hours: string; status: string; disposed_on: string | null;
  }>(`select current_hours, status, disposed_on from assets where id = $1`, [asset])))[0]!;

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@flt.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@flt.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Flt Civil','flt-civil','enterprise') as id`)))[0]!.id;
    project = (await h.asService(() => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name) values ($1,'PRJ-2026-0200','Quarry haul')
       returning id`, [company])))[0]!.id;
    asset = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_asset($1,'Excavator 349','Excavator','Caterpillar','349',
        2021,'CAT0349X','owned','hours','diesel') as id`, [company])))[0]!.id;
  });

  it('moves the meter, which nothing could do before', async () => {
    await h.asUser(OWNER, () => h.sql(
      `select public.record_meter_reading($1, 4200)`, [asset]));
    expect(Number((await assetRow()).current_hours)).toBe(4200);
  });

  it('refuses a reading below the meter unless the unit was replaced', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.record_meter_reading($1, 4100)`, [asset])))
      .rejects.toThrow(/below the asset's current/i);
    /* A replaced meter legitimately reads lower, and says so on purpose. */
    await h.asUser(OWNER, () => h.sql(
      `select public.record_meter_reading($1, 12, null, now(), 'manual', true)`, [asset]));
    expect(Number((await assetRow()).current_hours)).toBe(12);
    await h.asUser(OWNER, () => h.sql(
      `select public.record_meter_reading($1, 4200, null, now(), 'manual', true)`, [asset]));
  });

  it('refuses miles on a machine measured in hours', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.record_meter_reading($1, null, 900)`, [asset])))
      .rejects.toThrow(/measured in hours, not miles/i);
  });

  it('lets a service interval be set, and brings it due', async () => {
    const schedule = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.set_maintenance_schedule($1,'250-hour service', 250) as id`,
      [asset])))[0]!.id;
    let [row] = await h.asUser(OWNER, () => h.sql<{ hours_remaining: string }>(
      `select hours_remaining from my_maintenance_due where schedule_id = $1`, [schedule]));
    /* Baselined at the meter now, so a 4,200-hour machine is not instantly
       sixteen services overdue. */
    expect(Number(row!.hours_remaining)).toBe(250);

    await h.asUser(OWNER, () => h.sql(
      `select public.record_meter_reading($1, 4480)`, [asset]));
    [row] = await h.asUser(OWNER, () => h.sql<{ hours_remaining: string }>(
      `select hours_remaining from my_maintenance_due where schedule_id = $1`, [schedule]));
    /* Negative is overdue, which is the number a shop actually looks for. */
    expect(Number(row!.hours_remaining)).toBe(-30);
  });

  it('refuses a service with no interval, because it could never come due', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.set_maintenance_schedule($1,'Whenever')`, [asset])))
      .rejects.toThrow(/Say how often/i);
  });

  it('closes a work order, which resets the interval from the meter', async () => {
    const schedule = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from maintenance_schedules where asset_id = $1 and is_active
        order by created_at limit 1`, [asset])))[0]!.id;
    const wo = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_work_order($1,'250-hour service','preventive','normal') as id`,
      [asset])))[0]!.id;
    await h.asUser(OWNER, () => h.sql(
      `select public.update_work_order($1, p_status => 'in_progress', p_schedule => $2)`,
      [wo, schedule]));

    await h.asUser(OWNER, () => h.sql(
      `select public.complete_work_order($1,'Oil, filters and a hydraulic hose',
         6, 4, 520, 340, 0, 4500)`, [wo]));

    const [w] = await h.asUser(OWNER, () => h.sql<{
      status: string; total_cost: string; downtime_hours: string; started_at: string;
    }>(`select status, total_cost, downtime_hours, started_at from work_orders where id = $1`, [wo]));
    expect(w!.status).toBe('complete');
    expect(Number(w!.total_cost)).toBe(860);
    expect(Number(w!.downtime_hours)).toBe(6);

    /* close_maintenance_schedule (0015) has waited since it was written. */
    const [row] = await h.asUser(OWNER, () => h.sql<{ hours_remaining: string }>(
      `select hours_remaining from my_maintenance_due where schedule_id = $1`, [schedule]));
    expect(Number(row!.hours_remaining)).toBe(250);
  });

  it('will not complete a work order without saying what was done', async () => {
    const wo = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_work_order($1,'Track tension','corrective','high') as id`,
      [asset])))[0]!.id;
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.complete_work_order($1,'')`, [wo])))
      .rejects.toThrow(/Say what was done/i);
    await h.asUser(OWNER, () => h.sql(
      `select public.cancel_work_order($1,'Raised against the wrong machine')`, [wo]));
    const [w] = await h.asUser(OWNER, () => h.sql<{ status: string; resolution: string }>(
      `select status, resolution from work_orders where id = $1`, [wo]));
    expect(w!.status).toBe('canceled');
    expect(w!.resolution).toMatch(/wrong machine/);
  });

  it('will not edit a work order that is already closed', async () => {
    const wo = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from work_orders where asset_id = $1 and status = 'canceled' limit 1`,
      [asset])))[0]!.id;
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.update_work_order($1, p_title => 'Changed my mind')`, [wo])))
      .rejects.toThrow(/already canceled/i);
  });

  it('records fuel and posts it to job cost under its own bucket', async () => {
    await h.asUser(OWNER, () => h.sql(
      `select public.record_fuel($1, 85, 4.10, now(), $2, null, $3)`,
      [company, asset, project]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      total_cost: string; exception_flag: string | null;
    }>(`select total_cost, exception_flag from fuel_transactions
          where asset_id = $1 order by created_at desc limit 1`, [asset]));
    expect(Number(row!.total_cost)).toBeCloseTo(348.5, 2);
    expect(row!.exception_flag).toBeNull();

    /* RULE-001: fuel is its own bucket, never folded into an equipment rate. */
    const [cost] = await h.asUser(OWNER, () => h.sql<{ amount: string; cost_type: string }>(
      `select amount, cost_type from project_costs
        where project_id = $1 and cost_type = 'fuel' order by created_at desc limit 1`,
      [project]));
    expect(Number(cost!.amount)).toBeCloseTo(348.5, 2);
  });

  it('flags a fuel ticket that matches no machine rather than refusing it', async () => {
    const [{ id }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.record_fuel($1, 60, 4.05) as id`, [company]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ exception_flag: string }>(
      `select exception_flag from fuel_transactions where id = $1`, [id]));
    /* The money was spent either way. Refusing the row loses it. */
    expect(row!.exception_flag).toBe('no_asset');

    await h.asUser(OWNER, () => h.sql(
      `select public.resolve_fuel_exception($1, $2)`, [id, asset]));
    const [after] = await h.asUser(OWNER, () => h.sql<{
      exception_flag: string | null; asset_id: string;
    }>(`select exception_flag, asset_id from fuel_transactions where id = $1`, [id]));
    expect(after!.exception_flag).toBeNull();
    expect(after!.asset_id).toBe(asset);
  });

  it('flags a ticket whose meter reads below the machine', async () => {
    const [{ id }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.record_fuel($1, 70, 4.00, now(), $2, null, null, 'diesel', 900) as id`,
      [company, asset]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ exception_flag: string }>(
      `select exception_flag from fuel_transactions where id = $1`, [id]));
    expect(row!.exception_flag).toBe('meter_regression');
    /* And it does not become the route by which a machine's hours go down. */
    expect(Number((await assetRow()).current_hours)).toBeGreaterThan(900);
  });

  it('records the meter from the fuel ticket, so the same fact is entered once', async () => {
    const before = Number((await assetRow()).current_hours);
    await h.asUser(OWNER, () => h.sql(
      `select public.record_fuel($1, 78, 4.15, now(), $2, null, null, 'diesel', $3)`,
      [company, asset, before + 9]));
    expect(Number((await assetRow()).current_hours)).toBe(before + 9);
    const [r] = await h.asUser(OWNER, () => h.sql<{ source: string }>(
      `select source from meter_readings where asset_id = $1
        order by reading_at desc, created_at desc limit 1`, [asset]));
    expect(r!.source).toBe('fuel_card');
  });

  it('flags a fill far outside the machine’s own history', async () => {
    /* Five fills of history first: under that there is nothing to judge against,
       and a guess dressed as a finding is worse than no finding. */
    for (let i = 0; i < 5; i += 1) {
      await h.asUser(OWNER, () => h.sql(
        `select public.record_fuel($1, 80, 4.00, now() - ($4 || ' days')::interval, $2, null, $3)`,
        [company, asset, project, String(i + 1)]));
    }
    const [{ id }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.record_fuel($1, 400, 4.00, now(), $2) as id`, [company, asset]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ exception_flag: string }>(
      `select exception_flag from fuel_transactions where id = $1`, [id]));
    expect(row!.exception_flag).toBe('volume_outlier');
  });

  it('catches the same ticket keyed twice', async () => {
    const when = '2026-08-04T14:00:00Z';
    await h.asUser(OWNER, () => h.sql(
      `select public.record_fuel($1, 64, 4.20, $3::timestamptz, $2)`, [company, asset, when]));
    const [{ id }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.record_fuel($1, 64, 4.20, $3::timestamptz, $2) as id`,
      [company, asset, when]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ exception_flag: string }>(
      `select exception_flag from fuel_transactions where id = $1`, [id]));
    expect(row!.exception_flag).toBe('duplicate');
  });

  it('puts a machine down and back in service', async () => {
    await h.asUser(OWNER, () => h.sql(
      `select public.set_asset_status($1,'down','Final drive')`, [asset]));
    expect((await assetRow()).status).toBe('down');
    await h.asUser(OWNER, () => h.sql(
      `select public.set_asset_status($1,'available')`, [asset]));
    expect((await assetRow()).status).toBe('available');
  });

  it('corrects a machine that was entered wrong', async () => {
    await h.asUser(OWNER, () => h.sql(
      `select public.update_asset($1, p_serial_number => 'CAT0349Z',
         p_home_location => 'Toledo yard', p_project => $2)`, [asset, project]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      serial_number: string; home_location: string; assigned_project_id: string;
    }>(`select serial_number, home_location, assigned_project_id from assets where id = $1`,
      [asset]));
    expect(row!.serial_number).toBe('CAT0349Z');
    expect(row!.home_location).toBe('Toledo yard');
    expect(row!.assigned_project_id).toBe(project);
  });

  it('says how far the meter has actually moved', async () => {
    const [row] = await h.asUser(OWNER, () => h.sql<{
      current_hours: string; hours_30_days_ago: string; reading_count: string;
      open_work_orders: string; downtime_30_days: string;
    }>(`select current_hours, hours_30_days_ago, reading_count, open_work_orders,
               downtime_30_days from my_asset_meters where asset_id = $1`, [asset]));
    expect(Number(row!.reading_count)).toBeGreaterThan(3);
    /* Meter replacements are excluded, or the subtraction goes negative. */
    expect(Number(row!.hours_30_days_ago)).toBeGreaterThan(4000);
    expect(Number(row!.downtime_30_days)).toBe(6);
    expect(Number(row!.open_work_orders)).toBe(0);
  });

  it('refuses to dispose of a machine with a work order still open', async () => {
    const wo = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_work_order($1,'Annual inspection','inspection','normal') as id`,
      [asset])))[0]!.id;
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.dispose_asset($1)`, [asset])))
      .rejects.toThrow(/open work order/i);

    await h.asUser(OWNER, () => h.sql(
      `select public.complete_work_order($1,'Passed, sticker applied')`, [wo]));
    await h.asUser(OWNER, () => h.sql(
      `select public.dispose_asset($1, '2026-09-30'::date,'Sold at auction')`, [asset]));
    const row = await assetRow();
    expect(row.status).toBe('disposed');
    expect(row.disposed_on).not.toBeNull();
  });
});
