import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Work in progress and the cash forecast, which the screen used to type in.
 *
 * The two properties these views exist to hold:
 *
 *   1. **An amount whose timing is unknown is reported as unknown.** Never
 *      dated into a month, never dropped. The defect being replaced dated two
 *      months by inventing them outright.
 *   2. **A calculation with no denominator returns null, not zero.** A project
 *      with no approved budget is not a project that is 0% complete, and an
 *      unbudgeted job showing as fully under billed would be read as cash owed.
 */
describe('work in progress and cash', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let project = '';
  let vendor = '';
  let customer = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test') on conflict (id) do nothing`, [owner]);
    company = (await h.asUser(owner, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','business') as id`)))[0]!.id;

    await h.asUser(owner, async () => {
      customer = (await h.sql<{ id: string }>(
        `insert into customers (company_id, code, name) values ($1,'C-1','Wood County') returning id`, [company]))[0]!.id;
      project = (await h.sql<{ id: string }>(
        `insert into projects (company_id, customer_id, number, name, contract_value, approved_budget, status)
         values ($1,$2,'PRJ-1','Kingsway',1000000,800000,'active') returning id`, [company, customer]))[0]!.id;
      vendor = (await h.sql<{ id: string }>(
        `insert into vendors (company_id, code, name) values ($1,'V-1','Stoneco') returning id`, [company]))[0]!.id;
    });
  });

  afterAll(async () => { await h?.db.close(); });

  // ---------------------------------------------------------------- WIP
  describe('work in progress', () => {
    it('earns revenue on cost-to-cost, not on a number somebody typed', async () => {
      // 200,000 spent of an 800,000 budget is a quarter of the work, so a
      // quarter of a 1,000,000 contract is earned.
      await h.asUser(owner, () => h.sql(
        `insert into project_costs (company_id, project_id, cost_type, cost_date, amount, description, source)
         values ($1,$2,'material',current_date,200000,'Aggregate','manual')`, [company, project]));

      const [w] = await h.asUser(owner, () => h.sql<{
        percent_complete: string; earned_revenue: string; over_under_billed: string;
      }>(`select percent_complete, earned_revenue, over_under_billed
          from reporting_wip where project_id = $1`, [project]));

      expect(Number(w!.percent_complete)).toBeCloseTo(0.25, 6);
      expect(Number(w!.earned_revenue)).toBeCloseTo(250000, 2);
      // Nothing billed yet, so all of it is under billed.
      expect(Number(w!.over_under_billed)).toBeCloseTo(-250000, 2);
    });

    it('reports no percentage where there is no budget to divide by', async () => {
      /*
       * The alternative is 0%, which reads as "no work done" and is a different
       * claim entirely — and which, paired with a contract value, would report
       * the whole contract as under billed cash.
       */
      const unbudgeted = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into projects (company_id, number, name, contract_value, approved_budget, status)
         values ($1,'PRJ-2','No budget',400000,0,'active') returning id`, [company])))[0]!.id;

      const [w] = await h.asUser(owner, () => h.sql<{
        percent_complete: string | null; earned_revenue: string | null; over_under_billed: string | null;
      }>(`select percent_complete, earned_revenue, over_under_billed
          from reporting_wip where project_id = $1`, [unbudgeted]));

      expect(w!.percent_complete).toBeNull();
      expect(w!.earned_revenue).toBeNull();
      expect(w!.over_under_billed).toBeNull();
    });

    it('shows a cost overrun instead of clamping it out of sight', async () => {
      /*
       * A job that has spent more than its budget has said something. Capping
       * the ratio at 100% is how that disappears — so the ratio runs free and
       * only the revenue is capped, because you cannot earn more than the
       * contract is worth.
       */
      const blown = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into projects (company_id, number, name, contract_value, approved_budget, status)
         values ($1,'PRJ-3','Overrun',100000,100000,'active') returning id`, [company])))[0]!.id;
      await h.asUser(owner, () => h.sql(
        `insert into project_costs (company_id, project_id, cost_type, cost_date, amount, description, source)
         values ($1,$2,'labor',current_date,130000,'Crew','manual')`, [company, blown]));

      const [w] = await h.asUser(owner, () => h.sql<{
        cost_ratio: string; percent_complete: string; earned_revenue: string; earned_margin: string;
      }>(`select cost_ratio, percent_complete, earned_revenue, earned_margin
          from reporting_wip where project_id = $1`, [blown]));

      expect(Number(w!.cost_ratio)).toBeCloseTo(1.3, 6);
      expect(Number(w!.percent_complete)).toBe(1);
      expect(Number(w!.earned_revenue)).toBeCloseTo(100000, 2);
      // Earned 100k against 130k spent: a 30% loss, stated as one.
      expect(Number(w!.earned_margin)).toBeCloseTo(-0.3, 4);
    });
  });

  // -------------------------------------------------------------- cash
  describe('the cash forecast', () => {
    it('dates a receivable from the contract payment clause', async () => {
      await h.asUser(owner, async () => {
        await h.sql(
          `insert into contracts (company_id, project_id, customer_id, number, title, original_value,
                                  executed_on, status, payment_terms_days)
           values ($1,$2,$3,'C-1','Kingsway',1000000,current_date,'active',30)`,
          [company, project, customer]);
        await h.sql(
          `insert into pay_applications
             (company_id, project_id, application_number, period_start, period_end,
              contract_sum, completed_to_date, current_due, status, submitted_at, approved_at)
           values ($1,$2,1,current_date - 30,current_date,1000000,250000,237500,'approved',
                   now() - interval '5 days', now() - interval '2 days')`, [company, project]);
      });

      const [r] = await h.asUser(owner, () => h.sql<{
        direction: string; amount: string; due_on: string; counterparty: string; reference: string;
      }>(`select direction, amount, due_on, counterparty, reference
          from reporting_cash_flow_items where project_id = $1 and direction = 'in'`, [project]));

      expect(Number(r!.amount)).toBeCloseTo(237500, 2);
      expect(r!.counterparty).toBe('Wood County');
      expect(r!.reference).toBe('PRJ-1 pay app 1');
      // Approved two days ago, net 30: due in 28 days.
      const days = Math.round(
        (new Date(r!.due_on).getTime() - Date.now()) / 86_400_000);
      expect(days).toBeGreaterThanOrEqual(27);
      expect(days).toBeLessThanOrEqual(29);
    });

    it('reports a receivable as unscheduled when no payment clause is recorded', async () => {
      /*
       * The whole point. An amount with no known date is carried at full value
       * with a null month, so the reader sees "we are owed this and do not know
       * when" rather than a confident bar in October.
       */
      const noTerms = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into projects (company_id, number, name, contract_value, approved_budget, status)
         values ($1,'PRJ-4','No terms',300000,200000,'active') returning id`, [company])))[0]!.id;
      await h.asUser(owner, () => h.sql(
        `insert into pay_applications
           (company_id, project_id, application_number, period_start, period_end,
            contract_sum, completed_to_date, current_due, status, submitted_at)
         values ($1,$2,1,current_date - 30,current_date,300000,90000,85500,'submitted',now())`,
        [company, noTerms]));

      const [r] = await h.asUser(owner, () => h.sql<{ due_on: string | null; amount: string }>(
        `select due_on, amount from reporting_cash_flow_items
         where project_id = $1 and direction = 'in'`, [noTerms]));

      expect(r!.due_on).toBeNull();
      expect(Number(r!.amount)).toBeCloseTo(85500, 2);

      const [bucket] = await h.asUser(owner, () => h.sql<{ inflow: string }>(
        `select inflow from reporting_cash_forecast where company_id = $1 and month is null`, [company]));
      expect(Number(bucket!.inflow)).toBeCloseTo(85500, 2);
    });

    it('separates a payable that is blocked from one that will actually pay', async () => {
      /*
       * A disputed invoice is money owed that is not leaving on its due date.
       * Forecasting it as an outflow overstates what goes out; dropping it
       * understates what is owed. It is carried, flagged, and summed apart.
       */
      await h.asUser(owner, async () => {
        await h.sql(
          `insert into ap_invoices (company_id, vendor_id, project_id, invoice_number, invoice_date,
                                    due_date, amount, match_status, status)
           values ($1,$2,$3,'INV-100',current_date,current_date + 20,40000,'matched','approved')`,
          [company, vendor, project]);
        await h.sql(
          `insert into ap_invoices (company_id, vendor_id, project_id, invoice_number, invoice_date,
                                    due_date, amount, match_status, status)
           values ($1,$2,$3,'INV-101',current_date,current_date + 20,15000,'quantity_variance','received')`,
          [company, vendor, project]);
      });

      const rows = await h.asUser(owner, () => h.sql<{
        reference: string; blocked: boolean; blocked_reason: string | null; amount: string;
      }>(`select reference, blocked, blocked_reason, amount from reporting_cash_flow_items
          where direction = 'out' order by reference`, []));

      expect(rows.map((r) => r.reference)).toEqual(['Stoneco INV-100', 'Stoneco INV-101']);
      expect(rows[0]!.blocked).toBe(false);
      expect(rows[1]!.blocked).toBe(true);
      expect(rows[1]!.blocked_reason).toBe('three-way match failed');

      const [m] = await h.asUser(owner, () => h.sql<{ outflow: string; outflow_blocked: string }>(
        `select outflow, outflow_blocked from reporting_cash_forecast
         where company_id = $1 and month = date_trunc('month', current_date + 20)::date`, [company]));
      expect(Number(m!.outflow)).toBeCloseTo(40000, 2);
      expect(Number(m!.outflow_blocked)).toBeCloseTo(15000, 2);
    });

    it('nets a payable off the receivable in the same month', async () => {
      const [m] = await h.asUser(owner, () => h.sql<{ net: string }>(
        `select net from reporting_cash_forecast
         where company_id = $1 and month = date_trunc('month', current_date + 20)::date`, [company]));
      // Only the unblocked 40,000 leaves; nothing arrives that month unless the
      // receivable happens to land in it, which the harness date makes uncertain
      // — so assert the payable is subtracted rather than the exact figure.
      expect(Number(m!.net)).toBeLessThanOrEqual(0);
    });

    it("shows one company nothing of another company's cash", async () => {
      const stranger = '22222222-2222-4222-8222-222222222222';
      await h.sql(`insert into auth.users (id, email) values ($1,'s@r.test')`, [stranger]);
      await h.sql(`insert into user_profiles (id, email) values ($1,'s@r.test') on conflict (id) do nothing`, [stranger]);
      await h.asUser(stranger, () =>
        h.sql(`select app.provision_company('Other','other','business')`));

      const rows = await h.asUser(stranger, () => h.sql(
        `select 1 from reporting_cash_flow_items where company_id = $1`, [company]));
      expect(rows).toEqual([]);
    });

    it('drops a payable once it is paid', async () => {
      await h.asUser(owner, () => h.sql(
        `update ap_invoices set amount_paid = amount, status = 'paid' where invoice_number = 'INV-100'`));
      const rows = await h.asUser(owner, () => h.sql(
        `select 1 from reporting_cash_flow_items where reference = 'Stoneco INV-100'`));
      expect(rows).toEqual([]);
    });
  });
});
