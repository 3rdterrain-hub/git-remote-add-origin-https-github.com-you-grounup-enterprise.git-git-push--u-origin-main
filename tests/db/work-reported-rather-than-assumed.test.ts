/**
 * Work reported, rather than work assumed.
 *
 * `project_tasks.percent_complete` is `not null default 0` and nothing has ever
 * written it. The earned-value view guarded on `sum(budgeted_cost) > 0`, true
 * of every awarded project from the moment it is awarded — so it answered
 * "zero" to a question nobody had the information to answer, and the project
 * page raised a permanent margin-fade alarm on every job the company won.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '8a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';

describe('progress on a project', () => {
  let h: Harness;
  let company = '';
  let project = '';
  let task = '';
  let report = '';
  let n = 0;

  const earned = async () => (await h.asUser(OWNER, () => h.sql<{
    earned_value: string | null; percent_complete: string | null;
    cost_performance_index: string | null; tasks_reported: number;
  }>(`select earned_value, percent_complete, cost_performance_index, tasks_reported
        from reporting_project_earned_value where project_id = $1`, [project])))[0]!;

  const reportProduction = (qty: number, hours = 8) => h.asUser(OWNER, () => h.sql(
    `insert into production_actuals (company_id, project_id, project_task_id,
       daily_report_id, work_date, quantity_installed, unit, crew_hours)
     values ($1,$2,$3,$4, current_date - $5::int, $6, 'CY'::app.unit_code, $7)`,
    [company, project, task, report, ++n, qty, hours]));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@prg.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@prg.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Progress Civil','progress-civil','enterprise') as id`)))[0]!.id;

    project = (await h.asService(() => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, contract_value, approved_budget)
       values ($1,'PRJ-2026-0001','Kingsway', 480000, 400000) returning id`,
      [company])))[0]!.id;
    /* A task as an award makes one: budgeted, nothing reported. */
    task = (await h.asService(() => h.sql<{ id: string }>(
      `insert into project_tasks (company_id, project_id, name, unit,
         budgeted_quantity, budgeted_hours, budgeted_cost)
       values ($1,$2,'Mass excavation','CY'::app.unit_code, 1000, 80, 100000)
       returning id`, [company, project])))[0]!.id;
    report = (await h.asService(() => h.sql<{ id: string }>(
      `insert into daily_reports (company_id, project_id, report_date)
       values ($1,$2,current_date) returning id`, [company, project])))[0]!.id;
  });

  it('says nothing rather than zero before anybody has reported', async () => {
    /*
     * The whole defect. A budget exists, so the old guard passed and the view
     * answered zero — which became a red alarm saying the job was losing money
     * on work nobody had said a word about.
     */
    const e = await earned();
    expect(e.earned_value).toBeNull();
    expect(e.percent_complete).toBeNull();
    expect(e.cost_performance_index).toBeNull();
    expect(e.tasks_reported).toBe(0);
  });

  it('will not raise a cost alarm on a job with costs and no reports', async () => {
    /* Costs post from timesheets and fuel long before the first quantity. */
    await h.asService(() => h.sql(
      `update project_tasks set actual_cost = 42000 where id = $1`, [task]));
    const e = await earned();
    expect(e.cost_performance_index).toBeNull();
  });

  it('fills the task in when the field reports production', async () => {
    await reportProduction(250, 20);
    const [t] = await h.asUser(OWNER, () => h.sql<{
      installed_quantity: string; percent_complete: string; actual_hours: string;
      status: string; actual_start: string | null;
    }>(`select installed_quantity, percent_complete, actual_hours, status, actual_start
          from project_tasks where id = $1`, [task]));
    expect(Number(t!.installed_quantity)).toBe(250);
    expect(Number(t!.percent_complete)).toBeCloseTo(0.25, 6);
    expect(Number(t!.actual_hours)).toBe(20);
    expect(t!.status).toBe('in_progress');
    expect(t!.actual_start).not.toBeNull();
  });

  it('adds the next day to the last, rather than replacing it', async () => {
    await reportProduction(250, 20);
    const [t] = await h.asUser(OWNER, () => h.sql<{
      installed_quantity: string; percent_complete: string; actual_hours: string;
    }>(`select installed_quantity, percent_complete, actual_hours
          from project_tasks where id = $1`, [task]));
    expect(Number(t!.installed_quantity)).toBe(500);
    expect(Number(t!.percent_complete)).toBeCloseTo(0.5, 6);
    expect(Number(t!.actual_hours)).toBe(40);
  });

  it('answers once there is something to answer with', async () => {
    const e = await earned();
    /* Half of a 100,000 budget is earned. */
    expect(Number(e.earned_value)).toBe(50000);
    expect(Number(e.percent_complete)).toBeCloseTo(0.5, 6);
    /* 50,000 earned against 42,000 spent is ahead, not behind. */
    expect(Number(e.cost_performance_index)).toBeGreaterThan(1);
    expect(e.tasks_reported).toBe(1);
  });

  it('corrects the task when a report is deleted', async () => {
    /* Recomputed, never incremented: a bad day's report can be taken back. */
    await h.asUser(OWNER, () => h.sql(
      `delete from production_actuals where project_task_id = $1
        and work_date = current_date - 2`, [task]));
    const [t] = await h.asUser(OWNER, () => h.sql<{ installed_quantity: string }>(
      `select installed_quantity from project_tasks where id = $1`, [task]));
    expect(Number(t!.installed_quantity)).toBe(250);
  });

  it('calls it complete when the whole budgeted quantity is in', async () => {
    await reportProduction(750, 60);
    const [t] = await h.asUser(OWNER, () => h.sql<{
      status: string; percent_complete: string;
    }>(`select status, percent_complete from project_tasks where id = $1`, [task]));
    expect(t!.status).toBe('complete');
    expect(Number(t!.percent_complete)).toBe(1);
  });

  it('never reports more than finished, however much is installed', async () => {
    await reportProduction(500, 40);
    const [t] = await h.asUser(OWNER, () => h.sql<{
      percent_complete: string; installed_quantity: string;
    }>(`select percent_complete, installed_quantity from project_tasks where id = $1`,
      [task]));
    /* The quantity is what it is; the percentage is capped at finished. */
    expect(Number(t!.installed_quantity)).toBe(1500);
    expect(Number(t!.percent_complete)).toBe(1);
  });

  it('does not overrule a status somebody set on purpose', async () => {
    /* "We did 40 feet" is not "carry on". */
    const [t2] = await h.asService(() => h.sql<{ id: string }>(
      `insert into project_tasks (company_id, project_id, name, unit,
         budgeted_quantity, budgeted_cost, status)
       values ($1,$2,'Held task','CY'::app.unit_code, 100, 5000, 'blocked') returning id`,
      [company, project]));
    await h.asUser(OWNER, () => h.sql(
      `insert into production_actuals (company_id, project_id, project_task_id,
         work_date, quantity_installed, unit, crew_hours)
       values ($1,$2,$3,current_date,10,'CY'::app.unit_code,4)`,
      [company, project, t2!.id]));
    const [t] = await h.asUser(OWNER, () => h.sql<{ status: string; percent_complete: string }>(
      `select status, percent_complete from project_tasks where id = $1`, [t2!.id]));
    expect(t!.status).toBe('blocked');
    /* The quantity still counts — only the status is left alone. */
    expect(Number(t!.percent_complete)).toBeCloseTo(0.1, 6);
  });

  it('lists the budgeted work an award carried across', async () => {
    const rows = await h.asUser(OWNER, () => h.sql<{
      name: string; budgeted_quantity: string; installed_quantity: string;
      reported: boolean; last_reported_on: string | null;
    }>(`select name, budgeted_quantity, installed_quantity, reported, last_reported_on
          from my_project_task_progress where project_id = $1 order by name`, [project]));
    expect(rows.map((r) => r.name)).toContain('Mass excavation');
    const excavation = rows.find((r) => r.name === 'Mass excavation')!;
    expect(Number(excavation.budgeted_quantity)).toBe(1000);
    expect(excavation.reported).toBe(true);
    expect(excavation.last_reported_on).not.toBeNull();
  });
});
