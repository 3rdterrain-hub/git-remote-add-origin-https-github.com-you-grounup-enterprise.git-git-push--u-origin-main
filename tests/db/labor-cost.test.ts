/**
 * Labor reaching the job, against real PostgreSQL.
 *
 * `project_costs` has always carried a `cost_type` of `labor` and
 * `labor_burden`, an `hours` column and a `source` of `timecard`, and the
 * financial view sums the two labor types together while reasoning at length
 * about why burden belongs with wages. Nothing ever wrote a labor row: before
 * migration 0044 the only insert into `project_costs` anywhere in the schema
 * was the fuel posting.
 *
 * So `labor_cost` was always zero, `actual_cost` omitted the largest cost
 * category on a construction job, and `gross_profit_to_date` — contract value
 * minus actual cost — was overstated by exactly the payroll of the crew.
 *
 * These tests hold the posting, its arithmetic, its reversal, and the deliberate
 * limits: unapproved time posts nothing, and the accounting period cutoff
 * applies to a timecard like it applies to everything else.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('labor reaches the job', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let project = '';
  let operator = '';
  let laborer = '';

  const costs = (ref?: string) =>
    h.asUser(owner, () => h.sql<{
      cost_type: string; amount: string; hours: string; quantity: string;
      unit: string; unit_cost: string; source: string; description: string }>(
      `select cost_type, amount, hours, quantity, unit::text as unit, unit_cost,
              source, description
       from project_costs
       where project_id = $1 ${ref ? 'and reference = $2' : ''}
       order by cost_type, unit`, ref ? [project, ref] : [project]));

  const financials = () =>
    h.asUser(owner, () => h.sql<{
      labor_cost: string; actual_cost: string; gross_profit_to_date: string }>(
      `select labor_cost, actual_cost, gross_profit_to_date
       from reporting_project_financials where project_id = $1`, [project]))
      .then(([r]) => r!);

  const time = (employee: string, opts: Partial<{
    straight: number; ot: number; dt: number; perDiem: number;
    date: string; approved: boolean }> = {}) =>
    h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into time_entries (company_id, employee_id, project_id, work_date,
         straight_hours, overtime_hours, doubletime_hours, per_diem,
         approval_state, approved_by, approved_at)
       values ($1,$2,$3,$4::date,$5,$6,$7,$8,
               $9::app.approval_state,
               case when $9 = 'approved' then $10::uuid end,
               case when $9 = 'approved' then now() end)
       returning id`,
      [company, employee, project, opts.date ?? '2026-04-06',
       opts.straight ?? 0, opts.ot ?? 0, opts.dt ?? 0, opts.perDiem ?? 0,
       opts.approved === false ? 'pending' : 'approved', owner]));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test') on conflict (id) do nothing`, [owner]);
    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;

    project = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, status, contract_value)
       values ($1,'PRJ-L1','Ridge Cut','active',100000) returning id`, [company])))[0]!.id;

    // A governed labor rate: $40 base, 35% burden, time and a half, double time.
    const rate = (await h.asUser(owner, () => h.sql<{ id: string }>(
      // An active company rate needs an approver — library governance, and it
      // applies to the rate a job is costed at like it applies to everything.
      `insert into labor_rates (company_id, code, classification, base_wage_per_hour,
         burden_percent, overtime_multiplier, doubletime_multiplier,
         approval_state, approved_by, approved_at)
       values ($1,'OP-1','Equipment Operator',40,0.35,1.5,2.0,'approved',$2,now())
       returning id`,
      [company, owner])))[0]!.id;

    operator = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into employees (company_id, employee_number, first_name, last_name, labor_rate_id)
       values ($1,'EMP-1','Kayla','Moss',$2) returning id`, [company, rate])))[0]!.id;

    // No governed rate: priced from the employee record instead.
    laborer = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into employees (company_id, employee_number, first_name, last_name,
         hourly_rate, burden_percent)
       values ($1,'EMP-2','Sam','Ortiz',25,0.20) returning id`, [company])))[0]!.id;
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('the posting', () => {
    it('posts wages and burden as separate rows from one timecard', async () => {
      await time(operator, { straight: 8 });
      const rows = await costs();
      expect(rows.map((r) => r.cost_type)).toEqual(['labor', 'labor_burden']);

      // 8 hours at $40 = $320 wages; 35% burden = $112.
      expect(Number(rows[0]!.amount)).toBe(320);
      expect(Number(rows[1]!.amount)).toBe(112);
      expect(rows[0]!.source).toBe('timecard');
      expect(Number(rows[0]!.hours)).toBe(8);
      expect(rows[0]!.unit).toBe('HR');
      expect(Number(rows[0]!.unit_cost)).toBe(40);
    });

    it('counts the hours once, on the wage row only', async () => {
      // Burden carries the cost and not the hours. Counting them on both rows
      // would double every hours-based figure in the platform.
      const rows = await costs();
      expect(rows.reduce((n, r) => n + Number(r.hours), 0)).toBe(8);
    });

    it('prices overtime and double time at the governed multipliers', async () => {
      const [entry] = await time(operator, { straight: 8, ot: 2, dt: 1, date: '2026-04-07' });
      const rows = await costs(`time_entry:${entry!.id}`);
      // 8×40 + 2×60 + 1×80 = 320 + 120 + 80 = 520.
      expect(Number(rows[0]!.amount)).toBe(520);
      expect(Number(rows[1]!.amount)).toBe(182);      // 35% of 520
      // The blended rate is the one an hour actually cost, not the base wage.
      expect(Number(rows[0]!.unit_cost)).toBeCloseTo(520 / 11, 4);
    });

    it('falls back to the employee record when no rate is assigned', async () => {
      const [entry] = await time(laborer, { straight: 10, date: '2026-04-08' });
      const rows = await costs(`time_entry:${entry!.id}`);
      expect(Number(rows[0]!.amount)).toBe(250);   // 10 × 25
      expect(Number(rows[1]!.amount)).toBe(50);    // 20% burden
    });

    it('posts per diem, unburdened, as its own day', async () => {
      const [entry] = await time(laborer, { straight: 8, perDiem: 75, date: '2026-04-09' });
      const rows = await costs(`time_entry:${entry!.id}`);
      const diem = rows.find((r) => r.unit === 'DAY')!;
      expect(Number(diem.amount)).toBe(75);
      expect(diem.cost_type).toBe('labor');
      // Burden is 20% of the 200 in wages, not of the 275 including per diem:
      // a reimbursement is not a wage and carries no payroll tax.
      expect(Number(rows.find((r) => r.cost_type === 'labor_burden')!.amount)).toBe(40);
    });

    it('names the person on the cost, which auth.users could not', async () => {
      // The column referenced auth.users, so it could only name somebody with a
      // login — and field staff mostly have none.
      const [row] = await h.asUser(owner, () => h.sql<{ full_name: string }>(
        `select e.full_name from project_costs pc
         join employees e on e.id = pc.employee_id
         where pc.project_id = $1 and pc.cost_type = 'labor' limit 1`, [project]));
      expect(row!.full_name).toBeTruthy();
    });
  });

  describe('what it refuses to post', () => {
    it('posts nothing for time nobody has approved', async () => {
      const [entry] = await time(laborer, { straight: 12, date: '2026-04-10', approved: false });
      expect(await costs(`time_entry:${entry!.id}`)).toEqual([]);
    });

    it('posts it the moment it is approved, and takes it back if withdrawn', async () => {
      const [entry] = await time(operator, { straight: 4, date: '2026-04-11', approved: false });
      expect(await costs(`time_entry:${entry!.id}`)).toEqual([]);

      await h.asUser(owner, () => h.sql(
        `update time_entries set approval_state='approved', approved_by=$1, approved_at=now()
         where id=$2`, [owner, entry!.id]));
      expect(Number((await costs(`time_entry:${entry!.id}`))[0]!.amount)).toBe(160);

      await h.asUser(owner, () => h.sql(
        `update time_entries set approval_state='rejected' where id=$1`, [entry!.id]));
      expect(await costs(`time_entry:${entry!.id}`)).toEqual([]);
    });

    it('posts nothing for time with no project to charge', async () => {
      const before = (await costs()).length;
      await h.asUser(owner, () => h.sql(
        `insert into time_entries (company_id, employee_id, work_date, straight_hours,
           approval_state, approved_by, approved_at)
         values ($1,$2,'2026-04-12',8,'approved',$3,now())`, [company, operator, owner]));
      expect((await costs()).length).toBe(before);
    });
  });

  describe('corrections keep the job cost in step', () => {
    it('corrects the cost when the hours are corrected', async () => {
      const [entry] = await time(operator, { straight: 8, date: '2026-04-13' });
      expect(Number((await costs(`time_entry:${entry!.id}`))[0]!.amount)).toBe(320);
      await h.asUser(owner, () => h.sql(
        `update time_entries set straight_hours = 6 where id=$1`, [entry!.id]));
      const rows = await costs(`time_entry:${entry!.id}`);
      expect(Number(rows[0]!.amount)).toBe(240);
      expect(Number(rows[1]!.amount)).toBe(84);
      // Corrected, not appended: one wage row, not two.
      expect(rows.filter((r) => r.cost_type === 'labor')).toHaveLength(1);
    });

    it('removes the cost when the entry is deleted', async () => {
      const [entry] = await time(laborer, { straight: 8, date: '2026-04-14' });
      expect((await costs(`time_entry:${entry!.id}`)).length).toBeGreaterThan(0);
      await h.asUser(owner, () => h.sql(`delete from time_entries where id=$1`, [entry!.id]));
      expect(await costs(`time_entry:${entry!.id}`)).toEqual([]);
    });

    it('leaves nothing behind on a project the time was moved off', async () => {
      const other = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into projects (company_id, number, name, status)
         values ($1,'PRJ-L2','Other','active') returning id`, [company])))[0]!.id;
      const [entry] = await time(operator, { straight: 8, date: '2026-04-15' });
      await h.asUser(owner, () => h.sql(
        `update time_entries set project_id=$1 where id=$2`, [other, entry!.id]));
      expect(await costs(`time_entry:${entry!.id}`)).toEqual([]);
      const moved = await h.asUser(owner, () => h.sql(
        `select 1 from project_costs where project_id=$1 and reference=$2`,
        [other, `time_entry:${entry!.id}`]));
      expect(moved.length).toBeGreaterThan(0);
    });
  });

  describe('what the financial report now says', () => {
    it('reports labor cost that is no longer zero', async () => {
      const f = await financials();
      expect(Number(f.labor_cost)).toBeGreaterThan(0);
    });

    it('counts labor inside actual cost, so margin stops being overstated', async () => {
      // The defect in one assertion: before 0044 actual_cost excluded every
      // hour anybody worked, and gross profit was the contract value minus
      // almost nothing.
      const f = await financials();
      expect(Number(f.actual_cost)).toBeGreaterThanOrEqual(Number(f.labor_cost));
      expect(Number(f.gross_profit_to_date))
        .toBe(100000 - Number(f.actual_cost));
      expect(Number(f.gross_profit_to_date)).toBeLessThan(100000);
    });

    it('makes the labor cost ratio metric answerable', async () => {
      // A governed metric that could only ever return zero.
      const [row] = await h.asUser(owner, () => h.sql<{ value: string | null }>(
        `select value from reporting_metric_values
         where company_id = $1 and key = 'labor_cost_ratio'`, [company]));
      expect(Number(row!.value)).toBeGreaterThan(0);
    });
  });

  /*
   * The same day's hours, recorded twice.
   *
   * The foreman writes crew hours on the daily report; the timecards are
   * entered separately. `time_entries.daily_report_id` existed to tie them
   * together and nothing ever compared the totals.
   */
  describe('daily report against timecard', () => {
    let recProject = '';

    const reconcile = () =>
      h.asUser(owner, () => h.sql<{
        daily_report_hours: string; timecard_hours: string;
        variance_hours: string; finding: string }>(
        `select daily_report_hours, timecard_hours, variance_hours, finding
         from reporting_labor_reconciliation
         where project_id = $1 order by work_date`, [recProject]));

    beforeAll(async () => {
      recProject = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into projects (company_id, number, name, status)
         values ($1,'PRJ-R1','Reconcile','active') returning id`, [company])))[0]!.id;

      // Day one: the foreman reports 24 hours; the timecards say 24.
      const day1 = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into daily_reports (company_id, project_id, report_date)
         values ($1,$2,'2026-05-04') returning id`, [company, recProject])))[0]!.id;
      await h.asUser(owner, () => h.sql(
        `insert into daily_report_labor (company_id, daily_report_id, classification,
           headcount, straight_hours)
         values ($1,$2,'Laborer',3,24)`, [company, day1]));
      for (const e of [operator, laborer]) {
        await h.asUser(owner, () => h.sql(
          `insert into time_entries (company_id, employee_id, project_id, work_date,
             straight_hours, approval_state, approved_by, approved_at)
           values ($1,$2,$3,'2026-05-04',12,'approved',$4,now())`,
          [company, e, recProject, owner]));
      }

      // Day two: the foreman reports 16 hours and only 8 are on a timecard.
      const day2 = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into daily_reports (company_id, project_id, report_date)
         values ($1,$2,'2026-05-05') returning id`, [company, recProject])))[0]!.id;
      await h.asUser(owner, () => h.sql(
        `insert into daily_report_labor (company_id, daily_report_id, classification,
           headcount, straight_hours)
         values ($1,$2,'Laborer',2,16)`, [company, day2]));
      await h.asUser(owner, () => h.sql(
        `insert into time_entries (company_id, employee_id, project_id, work_date,
           straight_hours, approval_state, approved_by, approved_at)
         values ($1,$2,$3,'2026-05-05',8,'approved',$4,now())`,
        [company, operator, recProject, owner]));
    }, 60_000);

    it('says nothing is wrong when the two agree', async () => {
      const [day1] = await reconcile();
      expect(Number(day1!.daily_report_hours)).toBe(24);
      expect(Number(day1!.timecard_hours)).toBe(24);
      expect(day1!.finding).toBe('agreed');
    });

    it('names hours reported but never put on a timecard', async () => {
      // Eight hours somebody worked and nobody is being paid for.
      const day2 = (await reconcile())[1]!;
      expect(Number(day2.variance_hours)).toBe(8);
      expect(day2.finding).toBe('hours reported not on a timecard');
    });

    it('names timecard hours with no daily report behind them', async () => {
      await h.asUser(owner, () => h.sql(
        `insert into time_entries (company_id, employee_id, project_id, work_date,
           straight_hours, approval_state, approved_by, approved_at)
         values ($1,$2,$3,'2026-05-06',10,'approved',$4,now())`,
        [company, laborer, recProject, owner]));
      const day3 = (await reconcile()).find((r) => Number(r.timecard_hours) === 10)!;
      expect(day3.finding).toBe('no daily report');
    });

    it('counts only approved time, like every other labor figure', async () => {
      const before = (await reconcile())[0]!;
      await h.asUser(owner, () => h.sql(
        `insert into time_entries (company_id, employee_id, project_id, work_date,
           straight_hours, approval_state)
         values ($1,$2,$3,'2026-05-04',9,'pending')`, [company, laborer, recProject]));
      expect((await reconcile())[0]!.timecard_hours).toBe(before.timecard_hours);
    });
  });

  describe('the accounting control still wins', () => {
    it('refuses a timecard dated into a closed period', async () => {
      await h.asUser(owner, () => h.sql(
        `insert into financial_periods (company_id, name, period_start, period_end,
           status, closed_by, closed_at)
         values ($1,'January 2026','2026-01-01','2026-01-31','closed',$2,now())`,
        [company, owner]));
      // A timesheet must not be a way around the period cutoff.
      await expect(time(operator, { straight: 8, date: '2026-01-15' }))
        .rejects.toThrow(/period/i);
    });
  });
});
