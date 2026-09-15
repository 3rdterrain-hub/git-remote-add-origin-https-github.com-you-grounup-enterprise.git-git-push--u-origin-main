/**
 * A field report you can fill in, and hand in.
 *
 * `create_daily_report` makes the header and says why it leaves it open —
 * "submitting is what freezes it, and a report created already frozen could
 * never be filled in." Nothing was ever built on that: no writer for the crews,
 * none for the machines, and nothing that could set `submitted_at`. A
 * superintendent could create a day and then do nothing else with it.
 *
 * `reporting_labor_reconciliation` (0044) compares reported hours against
 * approved timecards and is read by the Workforce screen. With no writer on the
 * report side it could only ever answer "no daily report" — a reconciliation
 * with one side permanently blank, presented as a finding.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '8d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d';

describe('filling in a day', () => {
  let h: Harness;
  let company = '';
  let project = '';
  let report = '';
  let day = 0;

  const newReport = async (): Promise<string> => {
    day += 1;
    return (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.create_daily_report($1, current_date - $2::int, 'Stripping topsoil') as id`,
      [project, day])))[0]!.id;
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@fr.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@fr.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Report Civil','report-civil','enterprise') as id`)))[0]!.id;
    project = (await h.asService(() => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name)
       values ($1,'PRJ-2026-0004','Kingsway') returning id`, [company])))[0]!.id;
    report = await newReport();
  });

  it('puts a crew on the day', async () => {
    await h.asUser(OWNER, () => h.sql(
      `select public.add_report_labor($1,'Operator',4,10,2)`, [report]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      classification: string; headcount: number;
      straight_hours: string; overtime_hours: string;
    }>(`select classification, headcount, straight_hours, overtime_hours
          from daily_report_labor where daily_report_id = $1`, [report]));
    expect(row!.classification).toBe('Operator');
    expect(row!.headcount).toBe(4);
    expect(Number(row!.straight_hours) + Number(row!.overtime_hours)).toBe(12);
  });

  it('puts a machine on the day, and keeps idle apart from operating', async () => {
    await h.asUser(OWNER, () => h.sql(
      `select public.add_report_equipment($1,'Excavator, 30 tonne',6,1,2,0,45)`, [report]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      description: string; operating_hours: string; idle_hours: string;
      fuel_gallons: string;
    }>(`select description, operating_hours, idle_hours, fuel_gallons
          from daily_report_equipment where daily_report_id = $1`, [report]));
    expect(row!.description).toBe('Excavator, 30 tonne');
    /* Six operating and two idle. A machine that idled cost money and moved nothing. */
    expect(Number(row!.operating_hours)).toBe(6);
    expect(Number(row!.idle_hours)).toBe(2);
    expect(Number(row!.fuel_gallons)).toBe(45);
  });

  it('gives the labor reconciliation a side it never had', async () => {
    /*
     * The view has compared reported hours against approved timecards since
     * 0044 and is read by the Workforce screen. Nothing wrote the report side,
     * so it could only ever answer "no daily report".
     */
    const [row] = await h.asUser(OWNER, () => h.sql<{
      finding: string; daily_report_hours: string; reported_headcount: number;
    }>(`select finding, daily_report_hours, reported_headcount
          from reporting_labor_reconciliation
         where project_id = $1 and work_date = current_date - 1`, [project]));
    expect(row!.finding).not.toBe('no daily report');
    expect(Number(row!.daily_report_hours)).toBe(12);
    expect(row!.reported_headcount).toBe(4);
    /* No timecards yet, so the finding names the direction of the gap. */
    expect(row!.finding).toBe('no approved timecards');
  });

  it('refuses a crew that was there for no hours', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.add_report_labor($1,'Laborer',2,0,0)`, [report])))
      .rejects.toThrow(/how many hours/i);
  });

  it('refuses a machine that did nothing at all', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.add_report_equipment($1,'Idle dozer',0,1,0,0)`, [report])))
      .rejects.toThrow(/how the machine spent the day/i);
  });

  it('takes a line back off before the day is handed in', async () => {
    const [l] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.add_report_labor($1,'Wrong trade',1,8) as id`, [report]));
    await h.asUser(OWNER, () => h.sql(
      `select public.remove_report_line($1,'labor')`, [l!.id]));
    const [n] = await h.asUser(OWNER, () => h.sql<{ n: string }>(
      `select count(*) as n from daily_report_labor where daily_report_id = $1`, [report]));
    expect(Number(n!.n)).toBe(1);
  });

  it('hands the day in', async () => {
    await h.asUser(OWNER, () => h.sql(`select public.submit_daily_report($1)`, [report]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      submitted_at: string | null; submitted_by: string | null;
    }>(`select submitted_at, submitted_by from daily_reports where id = $1`, [report]));
    expect(row!.submitted_at).not.toBeNull();
    expect(row!.submitted_by).toBe(OWNER);
  });

  it('will not change a day that has been handed in', async () => {
    /* After submission it is not a draft, it is what was reported. */
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.add_report_labor($1,'Late addition',2,8)`, [report])))
      .rejects.toThrow(/does not change/i);
  });

  it('will not hand the same day in twice', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.submit_daily_report($1)`, [report])))
      .rejects.toThrow(/already handed in/i);
  });

  it('will not hand in a day with nothing on it', async () => {
    const empty = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.create_daily_report($1, current_date - 20, null) as id`,
      [project])))[0]!.id;
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.submit_daily_report($1)`, [empty])))
      .rejects.toThrow(/nothing on this report/i);
  });

  it('refuses somebody from another company', async () => {
    const STRANGER = '8d4d4d4d-4d4d-4d4d-8d4d-4d4d4d4d4d4d';
    await h.sql(`insert into auth.users (id, email) values ($1,'s@fr.test')`, [STRANGER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'s@fr.test')
                 on conflict (id) do nothing`, [STRANGER]);
    const open = await newReport();
    await expect(h.asUser(STRANGER, () => h.sql(
      `select public.add_report_labor($1,'Not mine',1,8)`, [open]))).rejects.toThrow();
  });
});
