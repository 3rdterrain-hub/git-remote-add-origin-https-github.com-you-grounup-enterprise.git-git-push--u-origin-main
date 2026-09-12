/**
 * The door onto the schedule.
 *
 * Migration 0029 built the governance for critical path scheduling and built it
 * well — calendars with exceptions, an append-only `schedule_calculations` that
 * records one run with its engine version and warnings, and a constraint saying
 * float cannot exist on an activity that does not name the calculation which
 * produced it. Five tables, and not one had a reader or a writer anywhere.
 *
 * 0158 draws around float the boundary 0058 drew around a price. The tests that
 * matter here are the refusals: a person may plan, and may not assert what the
 * plan implies.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('the door onto the schedule', () => {
  let h: Harness;
  const chief = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let project = '';
  let calendar = '';
  let activityA = '';
  let activityB = '';

  const asChief = <T,>(q: string, p?: unknown[]) =>
    h.asUser(chief, () => h.sql<T extends object ? T : never>(q, p));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'c@r.test')`, [chief]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'c@r.test')
                 on conflict (id) do nothing`, [chief]);
    company = (await asChief<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id;

    project = (await asChief<{ id: string }>(
      `insert into projects (company_id, number, name, status)
       values ($1,'PRJ-2026-0001','Berm build','active') returning id`, [company]))[0]!.id;

    calendar = (await asChief<{ id: string }>(
      `insert into work_calendars (company_id, code, name, working_weekdays, is_default)
       values ($1,'FIELD','Field calendar','{1,2,3,4,5}'::smallint[], true) returning id`,
      [company]))[0]!.id;

    for (const [name, start, finish] of [
      ['Strip topsoil', '2026-05-04', '2026-05-08'],
      ['Mass excavation', '2026-05-11', '2026-05-22'],
    ] as const) {
      const [a] = await asChief<{ id: string }>(
        `insert into schedule_activities
           (company_id, project_id, name, planned_start, planned_finish, duration_days, calendar_id)
         values ($1,$2,$3,$4,$5,5,$6) returning id`,
        [company, project, name, start, finish, calendar]);
      if (name === 'Strip topsoil') activityA = a!.id; else activityB = a!.id;
    }
  }, 240_000);

  afterAll(async () => { await h?.db.close(); });

  describe('what a person may plan', () => {
    it('lets them write the plan: dates, duration, logic, calendars', async () => {
      /*
       * The inputs stay theirs. Guarding these would stop anyone scheduling
       * anything, which is the distinction the guard is drawn on.
       */
      await asChief(
        `update schedule_activities set planned_finish = '2026-05-09', duration_days = 6
          where id = $1`, [activityA]);
      const [r] = await asChief<{ duration_days: string }>(
        `select duration_days from schedule_activities where id = $1`, [activityA]);
      expect(Number(r!.duration_days)).toBe(6);
    });

    it('lets them tie one activity to another', async () => {
      const [d] = await asChief<{ id: string }>(
        `insert into schedule_dependencies
           (company_id, predecessor_id, successor_id, dependency_type, lag_days)
         values ($1,$2,$3,'finish_to_start',0) returning id`,
        [company, activityA, activityB]);
      expect(d!.id).toBeTruthy();
    });
  });

  describe('what only the method may say', () => {
    it('refuses float written by hand', async () => {
      await expect(asChief(
        `update schedule_activities set total_float_days = 0 where id = $1`, [activityA]))
        .rejects.toThrow(/may not be written by hand/i);
    });

    it('refuses a critical flag written by hand', async () => {
      await expect(asChief(
        `update schedule_activities set is_critical = true where id = $1`, [activityA]))
        .rejects.toThrow(/may not be written by hand/i);
    });

    it('refuses early and late dates written by hand', async () => {
      await expect(asChief(
        `update schedule_activities set early_start = '2026-05-04' where id = $1`, [activityA]))
        .rejects.toThrow(/may not be written by hand/i);
    });

    it('names the columns it refused, so the message is actionable', async () => {
      await expect(asChief(
        `update schedule_activities set total_float_days = 1, is_critical = false
          where id = $1`, [activityA]))
        .rejects.toThrow(/total_float_days/);
    });

    it('refuses float on a new activity, by the constraint 0029 already had', async () => {
      /*
       * The guard is on update only (0160). On insert, 0029's constraint
       * decides and it refuses by name — which is louder and more useful than
       * discarding, and it leaves intact the legitimate case of an activity
       * created already carrying a real calculation's results.
       */
      await expect(asChief(
        `insert into schedule_activities
           (company_id, project_id, name, planned_start, planned_finish, duration_days,
            is_critical, total_float_days)
         values ($1,$2,'Forged','2026-06-01','2026-06-05',5,true,0)`,
        [company, project])).rejects.toThrow(/float_is_calculated/);
    });

    it('accepts an activity created with the results of a real calculation', async () => {
      // What the insert guard was silently breaking: this is a legitimate path
      // and 0029 has its own test for it.
      const [calc] = await h.asService(() => h.sql<{ id: string }>(
        `select app.record_schedule_calculation(
           $1,$2,current_date,'e',$3,'2026-06-01'::date,'2026-06-05'::date,5,null,null,
           '{}'::uuid[], '{}'::text[], '[]'::jsonb) as id`, [company, project, calendar]));
      const [a] = await asChief<{ id: string }>(
        `insert into schedule_activities
           (company_id, project_id, name, planned_start, planned_finish, duration_days,
            calculation_id, total_float_days, is_critical)
         values ($1,$2,'Computed','2026-06-01','2026-06-05',5,$3,0,true) returning id`,
        [company, project, calc!.id]);
      const [r] = await asChief<{ total_float_days: string; calculation_id: string }>(
        `select total_float_days, calculation_id from schedule_activities where id = $1`, [a!.id]);
      expect(Number(r!.total_float_days)).toBe(0);
      expect(r!.calculation_id).toBe(calc!.id);
    });

    it('will not let a company write its own calculation row', async () => {
      // Otherwise 0029's constraint is satisfied by naming a row you invented a
      // moment earlier, and float has provenance in name only.
      await expect(asChief(
        `insert into schedule_calculations
           (company_id, project_id, data_date, engine_version, project_start,
            project_finish, duration_working_days)
         values ($1,$2,current_date,'made up','2026-05-04','2026-05-22',15)`,
        [company, project])).rejects.toThrow(/permission denied|denied/i);
    });

    it('keeps the calculation history readable', async () => {
      // Reading what was calculated, when and with which engine is exactly what
      // a company should be able to see.
      const rows = await asChief(`select * from schedule_calculations where project_id = $1`,
        [project]);
      expect(Array.isArray(rows)).toBe(true);
    });
  });

  describe('the one writer', () => {
    it('is granted to the service role and to nobody else', async () => {
      const [r] = await h.sql<{ acl: string }>(
        `select coalesce(array_to_string(p.proacl, ','), '') as acl
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'record_schedule_calculation'`);
      expect(r!.acl).toContain('service_role=X');
      expect(r!.acl).not.toContain('authenticated=X');
      expect(r!.acl).not.toContain('anon=X');
    });

    it('writes the run and points every activity at it', async () => {
      const [r] = await h.asService(() => h.sql<{ id: string }>(
        `select app.record_schedule_calculation(
           $1,$2,current_date,'grounup-engine/schedule@1',$3,
           '2026-05-04'::date,'2026-05-22'::date,15,null,null,
           array[$4]::uuid[], array['a warning']::text[],
           $5::jsonb) as id`,
        [company, project, calendar, activityA, JSON.stringify([
          { id: activityA, early_start: '2026-05-04', early_finish: '2026-05-08',
            late_start: '2026-05-04', late_finish: '2026-05-08',
            total_float_days: 0, free_float_days: 0, is_critical: true },
          { id: activityB, early_start: '2026-05-11', early_finish: '2026-05-22',
            late_start: '2026-05-13', late_finish: '2026-05-26',
            total_float_days: 2, free_float_days: 2, is_critical: false },
        ])]));
      expect(r!.id).toBeTruthy();

      const rows = await asChief<{ id: string; total_float_days: string; is_critical: boolean;
                                  calculation_id: string }>(
        /* The two this run named, not every calculated activity on the project
           — another test creates one of its own with a calculation behind it. */
        `select id, total_float_days, is_critical, calculation_id
           from schedule_activities where id = any($1::uuid[])
          order by planned_start`, [[activityA, activityB]]);
      expect(rows).toHaveLength(2);
      expect(rows.every((x) => x.calculation_id === r!.id)).toBe(true);
      expect(rows[0]!.is_critical).toBe(true);
      expect(Number(rows[1]!.total_float_days)).toBe(2);
    });

    it('refuses a field name it does not recognize', async () => {
      await expect(h.asService(() => h.sql(
        `select app.record_schedule_calculation(
           $1,$2,current_date,'e',$3,'2026-05-04'::date,'2026-05-22'::date,15,null,null,
           '{}'::uuid[], '{}'::text[], $4::jsonb)`,
        [company, project, calendar,
         JSON.stringify([{ id: activityA, totalFloatDays: 0 }])])))
        .rejects.toThrow(/no field called totalFloatDays/i);
    });

    it('refuses a run that names an activity on another project', async () => {
      /*
       * Every activity or none. A run that quietly skipped one would leave it
       * carrying the float of a calculation that no longer describes it.
       */
      await expect(h.asService(() => h.sql(
        `select app.record_schedule_calculation(
           $1,$2,current_date,'e',$3,'2026-05-04'::date,'2026-05-22'::date,15,null,null,
           '{}'::uuid[], '{}'::text[], $4::jsonb)`,
        [company, project, calendar, JSON.stringify([
          { id: '00000000-0000-4000-8000-000000000000', total_float_days: 0 },
        ])]))).rejects.toThrow(/named 1 activities and 0 of them/i);
    });

    it('refuses a project that is not that company', async () => {
      await expect(h.asService(() => h.sql(
        `select app.record_schedule_calculation(
           '00000000-0000-4000-8000-000000000000'::uuid,$1,current_date,'e',null,
           '2026-05-04'::date,'2026-05-22'::date,15,null,null,
           '{}'::uuid[], '{}'::text[], '[]'::jsonb)`, [project])))
        .rejects.toThrow(/does not belong to that company/i);
    });
  });

  describe('what a screen reads', () => {
    it('offers the latest calculation per project', async () => {
      /* `project_finish` is a date column and the driver hands back a Date, so
         the comparison is on the day rather than on how it was rendered. */
      const [r] = await asChief<{ project_finish: string; engine_version: string }>(
        `select project_finish::text, engine_version from my_latest_schedule_calculation
          where project_id = $1`, [project]);
      expect(r!.project_finish).toBe('2026-05-22');
      expect(r!.engine_version).toBe('grounup-engine/schedule@1');
    });

    it('shows the newest when there has been more than one', async () => {
      await h.asService(() => h.sql(
        `select app.record_schedule_calculation(
           $1,$2,current_date,'grounup-engine/schedule@2',$3,
           '2026-05-05'::date,'2026-05-25'::date,16,null,null,
           '{}'::uuid[], '{}'::text[], '[]'::jsonb)`, [company, project, calendar]));
      const [r] = await asChief<{ engine_version: string }>(
        `select engine_version from my_latest_schedule_calculation where project_id = $1`,
        [project]);
      expect(r!.engine_version).toBe('grounup-engine/schedule@2');
    });
  });
});
