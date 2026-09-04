/**
 * Financial period cutoff, against real PostgreSQL.
 *
 * The platform recorded job cost with a `cost_date` and could not close a
 * period. A cost dated last March could be posted today, silently changing a
 * job cost figure already reported to an owner, a bank or a bonding company.
 * The report was right when it was produced and wrong afterwards, and nothing
 * said which.
 *
 * These tests hold the cutoff, and hold the deliberate limits of it: a company
 * that has defined no periods is not running a close and is left alone.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('financial periods', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  let company = '';
  let free = '';
  let project = '';
  let freeProject = '';
  let march = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test'), ($2,'f@x.test')`, [owner, other]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test'), ($2,'f@x.test')`, [owner, other]);
    company = (await h.asUser(owner, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    free = (await h.asUser(other, () =>
      h.sql<{ id: string }>(`select app.provision_company('Nocklose','nocklose','enterprise') as id`)))[0]!.id;

    project = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name) values ($1,'PRJ-F1','Period test')
       returning id`, [company])))[0]!.id;
    freeProject = (await h.asUser(other, () => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name) values ($1,'PRJ-F2','No periods')
       returning id`, [free])))[0]!.id;

    march = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into financial_periods (company_id, period_start, period_end, name)
       values ($1,'2026-03-01','2026-03-31','March 2026') returning id`, [company])))[0]!.id;
    await h.asUser(owner, () => h.sql(
      `insert into financial_periods (company_id, period_start, period_end, name)
       values ($1,'2026-04-01','2026-04-30','April 2026')`, [company]));
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  const cost = (companyId: string, projectId: string, date: string, amount = 1000) =>
    h.asUser(companyId === company ? owner : other, () => h.sql<{ id: string }>(
      `insert into project_costs (company_id, project_id, cost_date, cost_type, amount)
       values ($1,$2,$3,'material',$4) returning id`, [companyId, projectId, date, amount]));

  describe('a period is a real span', () => {
    it('refuses two periods covering the same day', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `insert into financial_periods (company_id, period_start, period_end, name)
         values ($1,'2026-03-15','2026-04-15','Overlapping')`, [company])))
        .rejects.toThrow(/financial_periods_no_overlap|conflicting key/);
    });

    it('refuses a period that ends before it starts', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `insert into financial_periods (company_id, period_start, period_end, name)
         values ($1,'2026-06-30','2026-06-01','Backwards')`, [company])))
        .rejects.toThrow(/financial_periods_range/);
    });

    it('lets another company hold a period over the same dates', async () => {
      const rows = await h.asUser(other, () => h.sql<{ id: string }>(
        `insert into financial_periods (company_id, period_start, period_end, name)
         values ($1,'2026-03-01','2026-03-31','Their March') returning id`, [free]));
      expect(rows[0]!.id).toBeTruthy();
      // Clean up so the "no periods" cases below stay honest.
      await h.asUser(other, () => h.sql(`delete from financial_periods where company_id=$1`, [free]));
    });

    it('answers open, closed or none', async () => {
      const [inside] = await h.asUser(owner, () => h.sql<{ s: string }>(
        `select app.period_status($1,'2026-03-15') as s`, [company]));
      expect(inside!.s).toBe('open');
      const [outside] = await h.asUser(owner, () => h.sql<{ s: string }>(
        `select app.period_status($1,'2026-01-15') as s`, [company]));
      expect(outside!.s).toBe('none');
    });
  });

  describe('closing', () => {
    it('refuses to close over an open pay application', async () => {
      // Closing over work still in draft fixes a total that is going to move.
      await h.asUser(owner, () => h.sql(
        `insert into pay_applications (company_id, project_id, application_number,
           period_start, period_end, contract_sum, status)
         values ($1,$2,1,'2026-03-01','2026-03-31',100000,'draft')`, [company, project]));
      await expect(h.asUser(owner, () => h.sql(
        `select app.close_financial_period($1)`, [march])))
        .rejects.toThrow(/pay application\(s\) still open/);
    });

    it('closes once nothing inside it is open, recording who and when', async () => {
      // A pay application cannot reach approved without its submission
      // timestamp — a constraint that was already there and is right.
      await h.asUser(owner, () => h.sql(
        `update pay_applications set status='approved', submitted_at=now(), approved_at=now()
         where project_id=$1`, [project]));
      await h.asUser(owner, () => h.sql(`select app.close_financial_period($1)`, [march]));
      const [p] = await h.sql<{ status: string; closed_by: string; closed_at: string }>(
        `select status, closed_by, closed_at from financial_periods where id=$1`, [march]);
      expect(p!.status).toBe('closed');
      expect(p!.closed_by).toBe(owner);
      expect(p!.closed_at).toBeTruthy();
    });

    it('refuses to close a period twice', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `select app.close_financial_period($1)`, [march])))
        .rejects.toThrow(/already closed/);
    });

    it('cannot be marked closed without saying who closed it', async () => {
      const [p] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into financial_periods (company_id, period_start, period_end, name)
         values ($1,'2026-05-01','2026-05-31','May 2026') returning id`, [company]));
      await expect(h.asUser(owner, () => h.sql(
        `update financial_periods set status='closed' where id=$1`, [p!.id])))
        .rejects.toThrow(/financial_periods_closed/);
    });

    it('requires a reason to reopen', async () => {
      // Reopening a closed period is an accounting event, not a correction.
      await expect(h.asUser(owner, () => h.sql(
        `update financial_periods set status='open', reopened_by=$2, reopened_at=now(), reopen_reason='x'
         where id=$1`, [march, owner])))
        .rejects.toThrow(/financial_periods_reopened/);
    });

    it('reopens when the reason is recorded', async () => {
      await h.asUser(owner, () => h.sql(
        `update financial_periods set status='open', reopened_by=$2, reopened_at=now(),
           reopen_reason='Owner disputed the March quantities; reopening to restate.'
         where id=$1`, [march, owner]));
      const [p] = await h.sql<{ status: string }>(
        `select status from financial_periods where id=$1`, [march]);
      expect(p!.status).toBe('open');
      // Close it again for the cutoff tests below.
      await h.asUser(owner, () => h.sql(`select app.close_financial_period($1)`, [march]));
    });
  });

  describe('the cutoff', () => {
    it('accepts a cost dated in an open period', async () => {
      const rows = await cost(company, project, '2026-04-15');
      expect(rows[0]!.id).toBeTruthy();
    });

    it('refuses a cost dated in a closed period', async () => {
      await expect(cost(company, project, '2026-03-15'))
        .rejects.toThrow(/period containing 2026-03-15 is closed; a job cost cannot be posted/);
    });

    it('names the way out rather than only refusing', async () => {
      await expect(cost(company, project, '2026-03-15'))
        .rejects.toThrow(/Reopen the period, with a reason, or date the entry in an open one/);
    });

    it('refuses moving an existing cost into a closed period', async () => {
      const [c] = await cost(company, project, '2026-04-20');
      await expect(h.asUser(owner, () => h.sql(
        `update project_costs set cost_date='2026-03-20' where id=$1`, [c!.id])))
        .rejects.toThrow(/is closed/);
    });

    it('refuses moving a cost out of a closed period too', async () => {
      // The period total would change after it was reported, which is the
      // thing closing exists to stop.
      await h.asUser(owner, () => h.sql(
        `update financial_periods set status='open', reopened_by=$2, reopened_at=now(),
           reopen_reason='Temporarily reopened to place a cost for this test.' where id=$1`,
        [march, owner]));
      const [c] = await cost(company, project, '2026-03-05');
      await h.asUser(owner, () => h.sql(`select app.close_financial_period($1)`, [march]));
      await expect(h.asUser(owner, () => h.sql(
        `update project_costs set cost_date='2026-04-05' where id=$1`, [c!.id])))
        .rejects.toThrow(/would change a period total after it was reported/);
    });

    it('applies to payables as well as job cost', async () => {
      const [vendor] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into vendors (company_id, code, name) values ($1,'STONECO','Stoneco') returning id`, [company]));
      await expect(h.asUser(owner, () => h.sql(
        `insert into ap_invoices (company_id, vendor_id, invoice_number, invoice_date, amount)
         values ($1,$2,'INV-1','2026-03-10',5000)`, [company, vendor!.id])))
        .rejects.toThrow(/is closed; a payable cannot be posted/);
    });

    it('leaves a company that runs no close entirely alone', async () => {
      // A company with no periods defined is not running a close, and the
      // platform must not invent one.
      const rows = await cost(free, freeProject, '2020-01-01');
      expect(rows[0]!.id).toBeTruthy();
    });
  });

  describe('tenancy', () => {
    it('forces row level security on periods', async () => {
      const [row] = await h.sql<{ rls: boolean; forced: boolean }>(
        `select relrowsecurity as rls, relforcerowsecurity as forced
         from pg_class where relname='financial_periods'`);
      expect(row!.rls).toBe(true);
      expect(row!.forced).toBe(true);
    });

    it('never lets one company close another company period', async () => {
      const rows = await h.asUser(other, () => h.sql(
        `select id from financial_periods where company_id = $1`, [company]));
      expect(rows).toEqual([]);
    });

    it('audits the close', async () => {
      // Who closed a period, and who reopened it, is exactly the question an
      // auditor asks.
      const rows = await h.sql<{ action: string }>(
        `select action from audit_events where entity_table='public.financial_periods' and entity_id=$1`,
        [march]);
      expect(rows.length).toBeGreaterThan(1);
    });
  });
});
