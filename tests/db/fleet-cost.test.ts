/**
 * Fleet cost reaching the job, and fleet exceptions reaching a person.
 *
 * `fuel_transactions` carried a project, gallons, a price and a generated
 * total. `project_costs` carried a cost_type of `fuel`, a source of
 * `fuel_card`, an `equipment_id` and a `reference` for where a row came from.
 * Both sides of the posting were designed and nothing wrote it: a machine
 * burned $400 of diesel on a job and the job's cost did not know.
 *
 * Nothing surfaced a fleet exception either. The notification table did not
 * carry a fleet category at all.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('fleet cost and exceptions', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let project = '';
  let asset = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test')`, [owner]);
    company = (await h.asUser(owner, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    project = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name) values ($1,'PRJ-FL','Fleet cost')
       returning id`, [company])))[0]!.id;
    asset = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into assets (company_id, asset_number, name, current_hours, home_location)
       values ($1,'EX-4412','Excavator 20-25 ton',4000,'Maumee Commerce Park') returning id`,
      [company])))[0]!.id;
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  const fuel = (gallons: number, price: number, projectId: string | null = project,
                source = 'fuel_card', when = '2026-06-10T08:00:00Z') =>
    h.asUser(owner, () => h.sql<{ id: string; total_cost: string }>(
      `insert into fuel_transactions (company_id, asset_id, project_id, source, transacted_at,
         gallons, price_per_gallon)
       values ($1,$2,$3,$4,$5::timestamptz,$6,$7) returning id, total_cost`,
      [company, asset, projectId, source, when, gallons, price]));

  const costsFor = (ref: string) => h.asUser(owner, () => h.sql<{
    cost_type: string; amount: string; quantity: string; unit: string; source: string;
    description: string; equipment_id: string | null;
  }>(`select cost_type, amount, quantity, unit, source, description, equipment_id
      from project_costs where company_id=$1 and reference=$2`, [company, ref]));

  describe('fuel reaches job cost', () => {
    let txn = '';

    it('posts a fuel transaction to the job it was burned on', async () => {
      const [t] = await fuel(120, 3.85);
      txn = t!.id;
      const rows = await costsFor(`fuel_transaction:${txn}`);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.cost_type).toBe('fuel');
      expect(Number(rows[0]!.amount)).toBe(462);
      expect(Number(rows[0]!.quantity)).toBe(120);
      expect(rows[0]!.unit).toBe('GAL');
    });

    it('carries the source through rather than calling everything manual', async () => {
      const rows = await costsFor(`fuel_transaction:${txn}`);
      expect(rows[0]!.source).toBe('fuel_card');
    });

    it('names the machine, so a job cost line can be read', async () => {
      const rows = await costsFor(`fuel_transaction:${txn}`);
      expect(rows[0]!.description).toContain('EX-4412');
    });

    it('corrects the job cost when the transaction is corrected', async () => {
      // A mistyped gallon count has to correct the job, not leave the first
      // figure standing beside a new one.
      await h.asUser(owner, () => h.sql(
        `update fuel_transactions set gallons = 100 where id=$1`, [txn]));
      const rows = await costsFor(`fuel_transaction:${txn}`);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.amount)).toBe(385);
    });

    it('removes the job cost when the transaction is deleted', async () => {
      const [t] = await fuel(50, 4.0);
      expect(await costsFor(`fuel_transaction:${t!.id}`)).toHaveLength(1);
      await h.asUser(owner, () => h.sql(`delete from fuel_transactions where id=$1`, [t!.id]));
      expect(await costsFor(`fuel_transaction:${t!.id}`)).toEqual([]);
    });

    it('posts nothing for fuel with no project', async () => {
      // Equipment overhead. The platform does not guess which job to charge.
      const [t] = await fuel(80, 3.9, null);
      expect(await costsFor(`fuel_transaction:${t!.id}`)).toEqual([]);
    });

    it('rolls the posted cost into the project total', async () => {
      const [row] = await h.asUser(owner, () => h.sql<{ total: string }>(
        `select coalesce(sum(amount),0) as total from project_costs
         where project_id=$1 and cost_type='fuel'`, [project]));
      expect(Number(row!.total)).toBe(385);
    });

    it('respects the financial period cutoff', async () => {
      // The posting is a job cost like any other, so a closed period refuses
      // it — the fleet record cannot route around the accounting control.
      const [p] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into financial_periods (company_id, period_start, period_end, name)
         values ($1,'2026-05-01','2026-05-31','May 2026') returning id`, [company]));
      await h.asUser(owner, () => h.sql(`select app.close_financial_period($1)`, [p!.id]));
      await expect(fuel(60, 4.1, project, 'fuel_card', '2026-05-15T08:00:00Z'))
        .rejects.toThrow(/period containing 2026-05-15 is closed/);
    });
  });

  describe('exceptions reach a person', () => {
    it('accepts fleet as a notification category', async () => {
      // A machine going down is not a 'system' notice.
      const rows = await h.asUser(owner, () => h.sql(
        `insert into notifications (company_id, category, title) values ($1,'fleet','Probe')
         returning id`, [company]));
      expect(rows).toHaveLength(1);
      await h.asUser(owner, () => h.sql(
        `delete from notifications where company_id=$1 and title='Probe'`, [company]));
    });

    it('notifies when a machine goes down', async () => {
      await h.asUser(owner, () => h.sql(
        `update assets set status='down' where id=$1`, [asset]));
      const rows = await h.asUser(owner, () => h.sql<{ severity: string; title: string; body: string }>(
        `select severity, title, body from notifications
         where entity_table='public.assets' and entity_id=$1`, [asset]));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.severity).toBe('critical');
      expect(rows[0]!.title).toContain('EX-4412 is down');
      expect(rows[0]!.body).toContain('Maumee Commerce Park');
    });

    it('does not re-announce a machine that is already down', async () => {
      await h.asUser(owner, () => h.sql(
        `update assets set home_location='Toledo shop' where id=$1`, [asset]));
      const rows = await h.asUser(owner, () => h.sql(
        `select 1 from notifications where entity_table='public.assets' and entity_id=$1`, [asset]));
      expect(rows).toHaveLength(1);
    });

    it('notifies on the meter reading that crosses a service interval', async () => {
      await h.asUser(owner, () => h.sql(
        `update assets set status='available' where id=$1`, [asset]));
      const [sched] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into maintenance_schedules (company_id, asset_id, name, interval_hours, last_performed_hours)
         values ($1,$2,'500-hour service',500,4000) returning id`, [company, asset]));
      // 4400 is short of the 4500 due point.
      await h.asUser(owner, () => h.sql(
        `insert into meter_readings (company_id, asset_id, hours) values ($1,$2,4400)`, [company, asset]));
      expect(await h.asUser(owner, () => h.sql(
        `select 1 from notifications where entity_id=$1`, [sched!.id]))).toEqual([]);

      await h.asUser(owner, () => h.sql(
        `insert into meter_readings (company_id, asset_id, hours) values ($1,$2,4520)`, [company, asset]));
      const rows = await h.asUser(owner, () => h.sql<{ severity: string; body: string }>(
        `select severity, body from notifications where entity_id=$1`, [sched!.id]));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.severity).toBe('warning');
      expect(rows[0]!.body).toContain('due at 4500');
    });

    it('announces the crossing once, not on every reading afterwards', async () => {
      await h.asUser(owner, () => h.sql(
        `insert into meter_readings (company_id, asset_id, hours) values ($1,$2,4600)`, [company, asset]));
      const [sched] = await h.sql<{ id: string }>(
        `select id from maintenance_schedules where asset_id=$1`, [asset]);
      const rows = await h.asUser(owner, () => h.sql(
        `select 1 from notifications where entity_id=$1`, [sched!.id]));
      expect(rows).toHaveLength(1);
    });
  });

  describe('what is deliberately not posted', () => {
    it('does not charge maintenance to whichever job the machine was on', async () => {
      // Maintenance is an ownership cost recovered through the equipment rate.
      // Posting it to the job would double-count against that rate and put a
      // worn undercarriage on the last project to use the machine.
      const [wo] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into work_orders (company_id, asset_id, number, title, labor_cost, parts_cost)
         values ($1,$2,'WO-1','500-hour service',640,1180) returning id`, [company, asset]));
      await h.asUser(owner, () => h.sql(
        `update work_orders set status='complete', completed_at=now(), resolution='Oil and filters'
         where id=$1`, [wo!.id]));
      const rows = await h.asUser(owner, () => h.sql(
        `select 1 from project_costs where company_id=$1 and cost_type='equipment'`, [company]));
      expect(rows).toEqual([]);
    });
  });

  describe('tenancy', () => {
    it('posts the cost to the fuel transaction own company', async () => {
      const [row] = await h.asUser(owner, () => h.sql<{ n: string }>(
        `select count(*) as n from project_costs where company_id <> $1`, [company]));
      expect(Number(row!.n)).toBe(0);
    });
  });
});
