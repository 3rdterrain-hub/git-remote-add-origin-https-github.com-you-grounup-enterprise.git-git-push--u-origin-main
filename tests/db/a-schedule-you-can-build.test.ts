/**
 * A schedule you can build.
 *
 * Migration 0183 gives the scheduling section its first writers. The engine,
 * the governance and the screen were all finished; `work_calendars`,
 * `schedule_activities`, `schedule_dependencies` and `resource_assignments` had
 * no writer anywhere, so the critical path method had never run on a real job
 * and every crew's phone was permanently empty.
 *
 * The test that matters most is the last one: a hand edit must not be able to
 * clear the float. 0158 guards those columns, and the temptation while writing
 * 0183 was to blank them on an edit so the screen would not show stale numbers.
 * That would have been a function talking its way past the guard.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '9c2c2c2c-2c2c-4c2c-9c2c-2c2c2c2c2c2c';

describe('building a schedule', () => {
  let h: Harness;
  let company = '';
  let project = '';
  let taskA = '';
  let taskB = '';

  const activities = () => h.asUser(OWNER, () => h.sql<{
    id: string; name: string; planned_start: string; planned_finish: string;
    duration_days: string; project_task_id: string | null; sort_order: number;
    calendar_id: string | null; is_critical: boolean;
  }>(`select id, name, to_char(planned_start,'YYYY-MM-DD') as planned_start,
             to_char(planned_finish,'YYYY-MM-DD') as planned_finish, duration_days,
             project_task_id, sort_order, calendar_id, is_critical
        from schedule_activities where project_id = $1
       order by sort_order`, [project]));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@sched.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@sched.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Sched Civil','sched-civil','enterprise') as id`)))[0]!.id;
    project = (await h.asService(() => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, planned_start,
         contract_value, approved_budget)
       values ($1,'PRJ-2026-0090','Airport apron','2026-04-06',900000,760000)
       returning id`, [company])))[0]!.id;
    /* Sixteen hours is two days on an eight-hour calendar; forty is five. */
    taskA = (await h.asService(() => h.sql<{ id: string }>(
      `insert into project_tasks (company_id, project_id, name, unit, sort_order,
         budgeted_quantity, budgeted_hours, budgeted_cost)
       values ($1,$2,'Strip topsoil','CY'::app.unit_code,0,2000,16,42000) returning id`,
      [company, project])))[0]!.id;
    taskB = (await h.asService(() => h.sql<{ id: string }>(
      `insert into project_tasks (company_id, project_id, name, unit, sort_order,
         budgeted_quantity, budgeted_hours, budgeted_cost)
       values ($1,$2,'Place aggregate base','TON'::app.unit_code,1,5400,40,310000) returning id`,
      [company, project])))[0]!.id;
  });

  it('gives the company a working week, because the engine refuses without one', async () => {
    const made = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.ensure_work_calendar($1) as id`, [company])))[0]!.id;
    const [cal] = await h.asUser(OWNER, () => h.sql<{
      id: string; code: string; working_weekdays: number[]; hours_per_day: string;
      is_default: boolean;
    }>(`select id, code, working_weekdays, hours_per_day, is_default
          from work_calendars where id = $1`, [made]));
    expect(cal!.code).toBe('STANDARD');
    expect(cal!.working_weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(Number(cal!.hours_per_day)).toBe(8);
    expect(cal!.is_default).toBe(true);
  });

  it('does not make a second one', async () => {
    const first = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.ensure_work_calendar($1) as id`, [company])))[0]!.id;
    const again = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.ensure_work_calendar($1) as id`, [company])))[0]!.id;
    expect(again).toBe(first);
    const [{ n }] = await h.asUser(OWNER, () => h.sql<{ n: string }>(
      `select count(*) as n from work_calendars where company_id = $1`, [company]));
    expect(Number(n)).toBe(1);
  });

  it('builds one activity per task, with a duration from the hours the estimate priced', async () => {
    const [{ made }] = await h.asUser(OWNER, () => h.sql<{ made: number }>(
      `select public.build_schedule_from_tasks($1) as made`, [project]));
    expect(made).toBe(2);

    const rows = await activities();
    expect(rows.map((r) => r.name)).toEqual(['Strip topsoil', 'Place aggregate base']);
    /* 16h / 8h = 2 days; 40h / 8h = 5 days. */
    expect(Number(rows[0]!.duration_days)).toBe(2);
    expect(Number(rows[1]!.duration_days)).toBe(5);
    /* Laid end to end from the project's own start. */
    expect(rows[0]!.planned_start).toBe('2026-04-06');
    expect(rows[0]!.planned_finish).toBe('2026-04-07');
    expect(rows[1]!.planned_start).toBe('2026-04-08');
    expect(rows[1]!.planned_finish).toBe('2026-04-12');
  });

  it('fills in the link to the task, which has existed since 0015 and was never used', async () => {
    const rows = await activities();
    expect(rows.map((r) => r.project_task_id).sort()).toEqual([taskA, taskB].sort());
    expect(rows.every((r) => r.calendar_id !== null)).toBe(true);
  });

  it('adds nothing the second time, so a change order adds only what is new', async () => {
    const [{ made }] = await h.asUser(OWNER, () => h.sql<{ made: number }>(
      `select public.build_schedule_from_tasks($1) as made`, [project]));
    expect(made).toBe(0);

    await h.asService(() => h.sql(
      `insert into project_tasks (company_id, project_id, name, sort_order,
         budgeted_hours) values ($1,$2,'Added: curb line',2,24)`, [company, project]));
    const [{ made: second }] = await h.asUser(OWNER, () => h.sql<{ made: number }>(
      `select public.build_schedule_from_tasks($1) as made`, [project]));
    expect(second).toBe(1);
    expect((await activities()).length).toBe(3);
  });

  it('says how much work is waiting to be scheduled', async () => {
    const [row] = await h.asUser(OWNER, () => h.sql<{
      task_count: string; unscheduled_task_count: string; activity_count: string;
    }>(`select task_count, unscheduled_task_count, activity_count
          from my_schedulable_projects where project_id = $1`, [project]));
    expect(Number(row!.task_count)).toBe(3);
    expect(Number(row!.unscheduled_task_count)).toBe(0);
    expect(Number(row!.activity_count)).toBe(3);
  });

  it('holds a milestone that came from no priced line', async () => {
    const [{ id }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.add_schedule_activity($1,'Substantial completion','2026-06-01',
         1, true) as id`, [project]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      is_milestone: boolean; duration_days: string; project_task_id: string | null;
    }>(`select is_milestone, duration_days, project_task_id
          from schedule_activities where id = $1`, [id]));
    expect(row!.is_milestone).toBe(true);
    expect(Number(row!.duration_days)).toBe(1);
    expect(row!.project_task_id).toBeNull();
  });

  it('moves a bar without stretching it', async () => {
    const before = (await activities())[1]!;
    await h.asUser(OWNER, () => h.sql(
      `select public.update_schedule_activity($1, p_start => $2::date)`,
      [before.id, '2026-04-20']));
    const [after] = await h.asUser(OWNER, () => h.sql<{
      planned_start: string; planned_finish: string; duration_days: string;
    }>(`select to_char(planned_start,'YYYY-MM-DD') as planned_start,
               to_char(planned_finish,'YYYY-MM-DD') as planned_finish, duration_days
          from schedule_activities where id = $1`, [before.id]));
    expect(after!.planned_start).toBe('2026-04-20');
    expect(after!.planned_finish).toBe('2026-04-24');
    expect(Number(after!.duration_days)).toBe(Number(before.duration_days));
  });

  it('refuses a finish before a start', async () => {
    const a = (await activities())[0]!;
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.update_schedule_activity($1, p_finish => $2::date)`,
      [a.id, '2020-01-01']))).rejects.toThrow(/cannot finish before it starts/i);
  });

  it('links one activity to another, and refuses a link to itself', async () => {
    const rows = await activities();
    const [{ id }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.add_schedule_dependency($1,$2,'finish_to_start',2) as id`,
      [rows[0]!.id, rows[1]!.id]));
    const [dep] = await h.asUser(OWNER, () => h.sql<{
      dependency_type: string; lag_days: string;
    }>(`select dependency_type, lag_days from schedule_dependencies where id = $1`, [id]));
    expect(dep!.dependency_type).toBe('finish_to_start');
    expect(Number(dep!.lag_days)).toBe(2);

    await expect(h.asUser(OWNER, () => h.sql(
      `select public.add_schedule_dependency($1,$1)`, [rows[0]!.id])))
      .rejects.toThrow(/cannot follow itself/i);
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.add_schedule_dependency($1,$2)`, [rows[0]!.id, rows[1]!.id])))
      .rejects.toThrow(/already linked/i);
  });

  it('refuses to link activities on two different projects', async () => {
    const other = (await h.asService(() => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name) values ($1,'PRJ-2026-0091','Ramp B')
       returning id`, [company])))[0]!.id;
    const foreign = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.add_schedule_activity($1,'Mobilize','2026-05-01') as id`, [other])))[0]!.id;
    const mine = (await activities())[0]!.id;
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.add_schedule_dependency($1,$2)`, [mine, foreign])))
      .rejects.toThrow(/different projects/i);
  });

  it('puts a crew on an activity, taking the activity’s own dates', async () => {
    const crew = (await h.asService(() => h.sql<{ id: string }>(
      `insert into crews (company_id, code, name, status, approved_by, approved_at)
       values ($1,'C1','Dirt crew','active',$2, now()) returning id`,
      [company, OWNER])))[0]!.id;
    const a = (await activities())[0]!;
    const [{ id }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.assign_resource($1,'crew', p_crew => $2) as id`, [a.id, crew]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      starts_on: string; ends_on: string; allocation: string; project_id: string;
    }>(`select to_char(starts_on,'YYYY-MM-DD') as starts_on,
               to_char(ends_on,'YYYY-MM-DD') as ends_on, allocation, project_id
          from resource_assignments where id = $1`, [id]));
    expect(row!.starts_on).toBe(a.planned_start);
    expect(row!.ends_on).toBe(a.planned_finish);
    expect(Number(row!.allocation)).toBe(1);
    expect(row!.project_id).toBe(project);
  });

  it('refuses an assignment whose kind and reference disagree', async () => {
    const a = (await activities())[0]!;
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.assign_resource($1,'employee')`, [a.id])))
      .rejects.toThrow(/needs a employee to be chosen/i);
  });

  it('will not let a hand edit clear the float, because 0158 owns it', async () => {
    const a = (await activities())[0]!;
    await expect(h.asUser(OWNER, () => h.sql(
      `update schedule_activities set total_float_days = null, is_critical = true
        where id = $1`, [a.id])))
      .rejects.toThrow(/may not be written by hand/i);
  });

  it('refuses a working week with no working days', async () => {
    const cal = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.ensure_work_calendar($1) as id`, [company])))[0]!.id;
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.update_work_calendar($1, p_weekdays => '{}'::smallint[])`, [cal])))
      .rejects.toThrow(/at least one working day/i);
  });

  it('changes the hours in a day, which changes what every duration means', async () => {
    const cal = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.ensure_work_calendar($1) as id`, [company])))[0]!.id;
    await h.asUser(OWNER, () => h.sql(
      `select public.update_work_calendar($1, p_hours => 10,
         p_weekdays => '{1,2,3,4,5,6}'::smallint[])`, [cal]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      hours_per_day: string; working_weekdays: number[]; activity_count: string;
    }>(`select hours_per_day, working_weekdays, activity_count
          from my_work_calendars where id = $1`, [cal]));
    expect(Number(row!.hours_per_day)).toBe(10);
    expect(row!.working_weekdays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Number(row!.activity_count)).toBeGreaterThan(0);
  });

  it('removes an activity and the logic tied to it, and leaves the task alone', async () => {
    const rows = await activities();
    const victim = rows[0]!;
    await h.asUser(OWNER, () => h.sql(
      `select public.remove_schedule_activity($1)`, [victim.id]));
    const [{ n }] = await h.asUser(OWNER, () => h.sql<{ n: string }>(
      `select count(*) as n from schedule_dependencies
        where predecessor_id = $1 or successor_id = $1`, [victim.id]));
    expect(Number(n)).toBe(0);
    const [{ t }] = await h.asUser(OWNER, () => h.sql<{ t: string }>(
      `select count(*) as t from project_tasks where id = $1`, [victim.project_task_id]));
    expect(Number(t)).toBe(1);
  });
});
