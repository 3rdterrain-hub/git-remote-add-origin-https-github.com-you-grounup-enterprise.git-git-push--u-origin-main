/**
 * The field says what it did.
 *
 * Migration 0179 made a task's progress real — `production_actuals` rolls up
 * onto `project_tasks`. It left the loop open at the top: nothing anywhere
 * inserted a `production_actuals` row, so the rollup had no source and every
 * project stayed unreported forever.
 *
 * `record_production_actual` (0115) looks like the writer and is not. Despite
 * the name it records a production *rate* into the library, which is a
 * different act by a different person for a different purpose.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '8b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b';

describe('reporting a day of work', () => {
  let h: Harness;
  let company = '';
  let project = '';
  let task = '';

  const report = (qty: number, hours: number, day = 0) =>
    h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.report_production($1,$2,$3, current_date - $4::int) as id`,
      [task, qty, hours, day]));

  const taskRow = async () => (await h.asUser(OWNER, () => h.sql<{
    installed_quantity: string; actual_hours: string; percent_complete: string;
    status: string;
  }>(`select installed_quantity, actual_hours, percent_complete, status
        from project_tasks where id = $1`, [task])))[0]!;

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@fld.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@fld.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Field Civil','field-civil','enterprise') as id`)))[0]!.id;
    project = (await h.asService(() => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, contract_value, approved_budget)
       values ($1,'PRJ-2026-0002','Kingsway',480000,400000) returning id`,
      [company])))[0]!.id;
    task = (await h.asService(() => h.sql<{ id: string }>(
      `insert into project_tasks (company_id, project_id, name, unit,
         budgeted_quantity, budgeted_hours, budgeted_cost)
       values ($1,$2,'Mass excavation','CY'::app.unit_code,1000,80,100000) returning id`,
      [company, project])))[0]!.id;
  });

  it('records what was installed and the hours it took', async () => {
    await report(250, 20, 3);
    const [row] = await h.asUser(OWNER, () => h.sql<{
      quantity_installed: string; crew_hours: string; unit: string;
      actual_per_hour: string; task_name: string;
    }>(`select quantity_installed, crew_hours, unit, actual_per_hour, task_name
          from my_production_reports where project_task_id = $1`, [task]));
    expect(Number(row!.quantity_installed)).toBe(250);
    expect(Number(row!.crew_hours)).toBe(20);
    /* The rate the crew actually hit, generated so it cannot disagree. */
    expect(Number(row!.actual_per_hour)).toBeCloseTo(12.5, 6);
    expect(row!.task_name).toBe('Mass excavation');
  });

  it('takes the unit from the task, not from whoever is typing', async () => {
    const [row] = await h.asUser(OWNER, () => h.sql<{ unit: string }>(
      `select unit from my_production_reports where project_task_id = $1`, [task]));
    expect(row!.unit).toBe('CY');
  });

  it('moves the task it was reported against', async () => {
    const t = await taskRow();
    expect(Number(t.installed_quantity)).toBe(250);
    expect(Number(t.actual_hours)).toBe(20);
    expect(Number(t.percent_complete)).toBeCloseTo(0.25, 6);
    expect(t.status).toBe('in_progress');
  });

  it('adds the next day to the last', async () => {
    await report(300, 24, 2);
    const t = await taskRow();
    expect(Number(t.installed_quantity)).toBe(550);
    expect(Number(t.actual_hours)).toBe(44);
  });

  it('amends a day rather than reporting it twice', async () => {
    /*
     * Somebody remembering another forty yards at five o'clock is correcting
     * the day, not having a second one.
     */
    await report(340, 26, 2);
    const t = await taskRow();
    expect(Number(t.installed_quantity)).toBe(590);
    expect(Number(t.actual_hours)).toBe(46);

    const [n] = await h.asUser(OWNER, () => h.sql<{ n: string }>(
      `select count(*) as n from production_actuals
        where project_task_id = $1 and work_date = current_date - 2`, [task]));
    expect(Number(n!.n)).toBe(1);
  });

  it('compares the rate achieved with the rate budgeted', async () => {
    const [row] = await h.asUser(OWNER, () => h.sql<{
      actual_per_hour: string; budgeted_per_hour: string;
    }>(`select actual_per_hour, budgeted_per_hour from my_production_reports
          where project_task_id = $1 and work_date = current_date - 3`, [task]));
    /* 1000 CY budgeted in 80 hours is 12.5 an hour. */
    expect(Number(row!.budgeted_per_hour)).toBeCloseTo(12.5, 4);
    expect(Number(row!.actual_per_hour)).toBeCloseTo(12.5, 4);
  });

  it('takes a day back, and the task falls with it', async () => {
    const [r] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from production_actuals
        where project_task_id = $1 and work_date = current_date - 3`, [task]));
    await h.asUser(OWNER, () => h.sql(
      `select public.withdraw_production_report($1)`, [r!.id]));
    const t = await taskRow();
    expect(Number(t.installed_quantity)).toBe(340);
  });

  it('refuses a day that has not happened', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.report_production($1,10,4, current_date + 1)`, [task])))
      .rejects.toThrow(/has not happened yet/i);
  });

  it('refuses a quantity with no hours against it', async () => {
    /* A quantity with no hours cannot become a production rate. */
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.report_production($1,10,null)`, [task])))
      .rejects.toThrow(/how many crew hours/i);
  });

  it('refuses a negative quantity', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.report_production($1,-5,4)`, [task])))
      .rejects.toThrow(/zero or more/i);
  });

  it('refuses a task that was canceled', async () => {
    const [t2] = await h.asService(() => h.sql<{ id: string }>(
      `insert into project_tasks (company_id, project_id, name, unit,
         budgeted_quantity, status)
       values ($1,$2,'Dropped scope','CY'::app.unit_code,100,'canceled') returning id`,
      [company, project]));
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.report_production($1,10,4)`, [t2!.id])))
      .rejects.toThrow(/was canceled/i);
  });

  it('refuses somebody from another company', async () => {
    const STRANGER = '8b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
    await h.sql(`insert into auth.users (id, email) values ($1,'s@fld.test')`, [STRANGER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'s@fld.test')
                 on conflict (id) do nothing`, [STRANGER]);
    await expect(h.asUser(STRANGER, () => h.sql(
      `select public.report_production($1,10,4)`, [task]))).rejects.toThrow();
  });
});
