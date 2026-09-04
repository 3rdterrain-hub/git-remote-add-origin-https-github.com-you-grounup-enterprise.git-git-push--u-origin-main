/**
 * Scheduling governance, against real PostgreSQL.
 *
 * The engine half proves the critical path arithmetic. This half proves the
 * database will not let the result be faked: float cannot be written without
 * naming the calculation that produced it, a calendar cannot say a date is
 * both a holiday and a working day, a baseline cannot be edited after the
 * fact, and none of it crosses a tenant boundary.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('scheduling governance', () => {
  let h: Harness;
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  let ridgeline = '';
  let kesler = '';
  let project = '';
  let keslerProject = '';
  let calculation = '';
  let activity = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'a@r.test'), ($2,'b@k.test')`, [alice, bob]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'a@r.test'), ($2,'b@k.test')`, [alice, bob]);
    ridgeline = (await h.asUser(alice, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    kesler = (await h.asUser(bob, () =>
      h.sql<{ id: string }>(`select app.provision_company('Kesler','kesler','enterprise') as id`)))[0]!.id;

    await h.asUser(alice, async () => {
      project = (await h.sql<{ id: string }>(
        `insert into projects (company_id, number, name) values ($1,'PRJ-900','Schedule test')
         returning id`, [ridgeline]))[0]!.id;
      calculation = (await h.sql<{ id: string }>(
        `insert into schedule_calculations
           (company_id, project_id, data_date, engine_version, project_start, project_finish,
            duration_working_days, calculated_by)
         values ($1,$2,'2026-05-04','1.0.0','2026-05-04','2026-05-20',13,$3) returning id`,
        [ridgeline, project, alice]))[0]!.id;
      activity = (await h.sql<{ id: string }>(
        `insert into schedule_activities
           (company_id, project_id, name, planned_start, planned_finish, duration_days)
         values ($1,$2,'Deep sanitary sewer','2026-05-04','2026-05-08',5) returning id`,
        [ridgeline, project]))[0]!.id;
    });

    await h.asUser(bob, async () => {
      keslerProject = (await h.sql<{ id: string }>(
        `insert into projects (company_id, number, name) values ($1,'PRJ-901','Other company')
         returning id`, [kesler]))[0]!.id;
    });
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  // --------------------------------------------------------------- calendars
  describe('a calendar has to mean one thing', () => {
    const calendar = (over: Record<string, unknown> = {}) => {
      const c = {
        code: 'STD', name: 'Standard week', weekdays: '{1,2,3,4,5}', ...over,
      } as { code: string; name: string; weekdays: string };
      return h.asUser(alice, () => h.sql<{ id: string }>(
        `insert into work_calendars (company_id, code, name, working_weekdays)
         values ($1,$2,$3,$4::smallint[]) returning id`,
        [ridgeline, c.code, c.name, c.weekdays]));
    };

    it('accepts a normal working week', async () => {
      const [row] = await calendar({ code: 'FIVE' });
      expect(row!.id).toBeTruthy();
    });

    it('refuses a calendar nobody could work on', async () => {
      // A schedule on an empty calendar would search forever for the next
      // working day.
      await expect(calendar({ code: 'NONE', weekdays: '{}' }))
        .rejects.toThrow(/work_calendars_working_weekdays_check|cardinality/);
    });

    it('refuses a weekday that is not a weekday', async () => {
      await expect(calendar({ code: 'BAD', weekdays: '{1,2,9}' }))
        .rejects.toThrow(/work_calendars_weekdays_valid/);
    });

    it('refuses a repeated day, which would read as a longer week', async () => {
      await expect(calendar({ code: 'DUP', weekdays: '{1,1,2}' }))
        .rejects.toThrow(/work_calendars_weekdays_valid/);
    });

    it('allows only one default calendar per company', async () => {
      await h.asUser(alice, () => h.sql(
        `insert into work_calendars (company_id, code, name, working_weekdays, is_default)
         values ($1,'DEF1','Default','{1,2,3,4,5}'::smallint[], true)`, [ridgeline]));
      await expect(h.asUser(alice, () => h.sql(
        `insert into work_calendars (company_id, code, name, working_weekdays, is_default)
         values ($1,'DEF2','Also default','{1,2,3,4,5}'::smallint[], true)`, [ridgeline])))
        .rejects.toThrow(/work_calendars_one_default|duplicate key/);
    });

    it('refuses a date that is both a holiday and a working day', async () => {
      // The engine refuses this input; the database should not be able to
      // produce it.
      const [cal] = await calendar({ code: 'EXC' });
      await h.asUser(alice, () => h.sql(
        `insert into work_calendar_exceptions (company_id, calendar_id, exception_date, kind, name)
         values ($1,$2,'2026-05-25','holiday','Memorial Day')`, [ridgeline, cal!.id]));
      await expect(h.asUser(alice, () => h.sql(
        `insert into work_calendar_exceptions (company_id, calendar_id, exception_date, kind, name)
         values ($1,$2,'2026-05-25','working','Catch-up Saturday')`, [ridgeline, cal!.id])))
        .rejects.toThrow(/duplicate key|work_calendar_exceptions/);
    });

    it('refuses an exception attached to another company calendar', async () => {
      const [cal] = await calendar({ code: 'TEN' });
      await expect(h.asUser(bob, () => h.sql(
        `insert into work_calendar_exceptions (company_id, calendar_id, exception_date, kind, name)
         values ($1,$2,'2026-07-03','holiday','Independence Day')`, [kesler, cal!.id])))
        .rejects.toThrow();
    });
  });

  // ------------------------------------------------------- float's provenance
  describe('float cannot be asserted, only computed', () => {
    it('refuses float with no calculation behind it', async () => {
      // This is the defect this migration exists to close: the column was
      // writable by anyone and the interface displayed it as a computed figure.
      await expect(h.asUser(alice, () => h.sql(
        `insert into schedule_activities
           (company_id, project_id, name, planned_start, planned_finish, duration_days, total_float_days, is_critical)
         values ($1,$2,'Invented float','2026-05-04','2026-05-08',5,0,true)`, [ridgeline, project])))
        .rejects.toThrow(/schedule_activities_float_is_calculated/);
    });

    it('accepts float that names the calculation that produced it', async () => {
      const rows = await h.asUser(alice, () => h.sql<{ id: string }>(
        `insert into schedule_activities
           (company_id, project_id, name, planned_start, planned_finish, duration_days,
            calculation_id, early_start, early_finish, late_start, late_finish,
            total_float_days, free_float_days, is_critical)
         values ($1,$2,'Computed','2026-05-04','2026-05-08',5,$3,
                 '2026-05-04','2026-05-08','2026-05-04','2026-05-08',0,0,true)
         returning id`, [ridgeline, project, calculation]));
      expect(rows[0]!.id).toBeTruthy();
    });

    it('refuses free float with no calculation either', async () => {
      await expect(h.asUser(alice, () => h.sql(
        `insert into schedule_activities
           (company_id, project_id, name, planned_start, planned_finish, duration_days, free_float_days)
         values ($1,$2,'Invented free float','2026-05-04','2026-05-08',5,3)`, [ridgeline, project])))
        .rejects.toThrow(/schedule_activities_free_float_is_calculated/);
    });

    it('still requires float and criticality to agree', async () => {
      // The constraint that was already there, now standing on a number that
      // something computed.
      await expect(h.asUser(alice, () => h.sql(
        `insert into schedule_activities
           (company_id, project_id, name, planned_start, planned_finish, duration_days,
            calculation_id, total_float_days, is_critical)
         values ($1,$2,'Disagrees','2026-05-04','2026-05-08',5,$3,4,true)`,
        [ridgeline, project, calculation])))
        .rejects.toThrow(/schedule_activities_critical/);
    });

    it('refuses early dates that run backwards', async () => {
      await expect(h.asUser(alice, () => h.sql(
        `insert into schedule_activities
           (company_id, project_id, name, planned_start, planned_finish, duration_days,
            calculation_id, early_start, early_finish)
         values ($1,$2,'Backwards','2026-05-04','2026-05-08',5,$3,'2026-05-08','2026-05-04')`,
        [ridgeline, project, calculation])))
        .rejects.toThrow(/schedule_activities_early_dates/);
    });
  });

  // ------------------------------------------------------------ calculations
  describe('a calculation is a record of a run', () => {
    it('cannot be edited afterwards', async () => {
      // Somebody acted on the dates this produced. Rewriting it rewrites what
      // the schedule said at the moment they acted.
      await expect(h.asUser(alice, () => h.sql(
        `update schedule_calculations set project_finish = '2026-06-01' where id = $1`, [calculation])))
        .rejects.toThrow(/append-only/);
    });

    it('refuses a finish before its own start', async () => {
      await expect(h.asUser(alice, () => h.sql(
        `insert into schedule_calculations
           (company_id, project_id, data_date, engine_version, project_start, project_finish, duration_working_days)
         values ($1,$2,'2026-05-04','1.0.0','2026-05-20','2026-05-04',13)`, [ridgeline, project])))
        .rejects.toThrow(/schedule_calculations_span/);
    });

    it('refuses a run against another company project', async () => {
      await expect(h.asUser(alice, () => h.sql(
        `insert into schedule_calculations
           (company_id, project_id, data_date, engine_version, project_start, project_finish, duration_working_days)
         values ($1,$2,'2026-05-04','1.0.0','2026-05-04','2026-05-20',13)`, [ridgeline, keslerProject])))
        .rejects.toThrow();
    });

    it('keeps the warnings the run produced', async () => {
      const [row] = await h.asUser(alice, () => h.sql<{ warnings: string[] }>(
        `insert into schedule_calculations
           (company_id, project_id, data_date, engine_version, project_start, project_finish,
            duration_working_days, required_finish, finish_float_days, warnings)
         values ($1,$2,'2026-05-04','1.0.0','2026-05-04','2026-05-20',13,'2026-05-15',-3,
                 array['The schedule finishes 2026-05-20, 3 working days after the required finish of 2026-05-15.'])
         returning warnings`, [ridgeline, project]));
      expect(row!.warnings[0]).toContain('3 working days after the required finish');
    });
  });

  // ---------------------------------------------------------------- baselines
  describe('baselines', () => {
    let baseline = '';

    it('records an approved schedule', async () => {
      const rows = await h.asUser(alice, () => h.sql<{ id: string }>(
        `insert into schedule_baselines (company_id, project_id, name, taken_on, reason, calculation_id, approved_by)
         values ($1,$2,'Original award','2026-04-20','Contract award schedule',$3,$4) returning id`,
        [ridgeline, project, calculation, alice]));
      baseline = rows[0]!.id;
      expect(baseline).toBeTruthy();
    });

    it('requires a reason worth reading', async () => {
      await expect(h.asUser(alice, () => h.sql(
        `insert into schedule_baselines (company_id, project_id, name, taken_on, reason)
         values ($1,$2,'Thin','2026-04-20','n/a')`, [ridgeline, project])))
        .rejects.toThrow(/reason/);
    });

    it('cannot be edited once taken', async () => {
      await expect(h.asUser(alice, () => h.sql(
        `update schedule_baselines set taken_on = '2026-05-01' where id = $1`, [baseline])))
        .rejects.toThrow(/append-only/);
    });

    it('captures an activity as it stood', async () => {
      const rows = await h.asUser(alice, () => h.sql<{ id: string }>(
        `insert into schedule_baseline_activities
           (company_id, baseline_id, schedule_activity_id, name, planned_start, planned_finish, duration_days)
         values ($1,$2,$3,'Deep sanitary sewer','2026-05-04','2026-05-08',5) returning id`,
        [ridgeline, baseline, activity]));
      expect(rows[0]!.id).toBeTruthy();
    });

    it('refuses to baseline an activity that does not exist', async () => {
      // The column carries no foreign key so the baseline survives deletion;
      // insert-time validation has to do the work the constraint would have.
      await expect(h.asUser(alice, () => h.sql(
        `insert into schedule_baseline_activities
           (company_id, baseline_id, schedule_activity_id, name, planned_start, planned_finish, duration_days)
         values ($1,$2,'33333333-3333-4333-8333-333333333333','Ghost','2026-05-04','2026-05-08',5)`,
        [ridgeline, baseline])))
        .rejects.toThrow(/does not exist/);
    });

    it('refuses to baseline another company activity', async () => {
      const [other] = await h.asUser(bob, () => h.sql<{ id: string }>(
        `insert into schedule_activities (company_id, project_id, name, planned_start, planned_finish, duration_days)
         values ($1,$2,'Their work','2026-05-04','2026-05-08',5) returning id`, [kesler, keslerProject]));
      await expect(h.asUser(alice, () => h.sql(
        `insert into schedule_baseline_activities
           (company_id, baseline_id, schedule_activity_id, name, planned_start, planned_finish, duration_days)
         values ($1,$2,$3,'Not mine','2026-05-04','2026-05-08',5)`, [ridgeline, baseline, other!.id])))
        .rejects.toThrow(/cannot cross a tenant boundary/);
    });

    it('captures each activity once per baseline', async () => {
      await expect(h.asUser(alice, () => h.sql(
        `insert into schedule_baseline_activities
           (company_id, baseline_id, schedule_activity_id, name, planned_start, planned_finish, duration_days)
         values ($1,$2,$3,'Again','2026-05-04','2026-05-08',5)`, [ridgeline, baseline, activity])))
        .rejects.toThrow(/duplicate key/);
    });

    it('survives the deletion of the activity it recorded', async () => {
      // An activity dropped from the schedule has to show as removed work, not
      // disappear from the variance report.
      const [temp] = await h.asUser(alice, () => h.sql<{ id: string }>(
        `insert into schedule_activities (company_id, project_id, name, planned_start, planned_finish, duration_days)
         values ($1,$2,'Since deleted','2026-05-11','2026-05-15',5) returning id`, [ridgeline, project]));
      await h.asUser(alice, () => h.sql(
        `insert into schedule_baseline_activities
           (company_id, baseline_id, schedule_activity_id, name, planned_start, planned_finish, duration_days)
         values ($1,$2,$3,'Since deleted','2026-05-11','2026-05-15',5)`, [ridgeline, baseline, temp!.id]));
      await h.asUser(alice, () => h.sql(`delete from schedule_activities where id = $1`, [temp!.id]));
      const rows = await h.asUser(alice, () => h.sql<{ name: string }>(
        `select name from schedule_baseline_activities where schedule_activity_id = $1`, [temp!.id]));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.name).toBe('Since deleted');
    });

    it('derives the current baseline rather than flagging it', async () => {
      // An append-only table cannot carry a maintained current flag; the most
      // recent one is the current one, computed on read.
      await h.asUser(alice, () => h.sql(
        `insert into schedule_baselines (company_id, project_id, name, taken_on, reason)
         values ($1,$2,'Recovery schedule','2026-07-01','Owner-directed acceleration')`,
        [ridgeline, project]));
      const [row] = await h.asUser(alice, () => h.sql<{ name: string }>(
        `select b.name from schedule_baselines b
         where b.id = app.current_schedule_baseline($1)`, [project]));
      expect(row!.name).toBe('Recovery schedule');
    });

    it('shows another company nothing through the same function', async () => {
      const rows = await h.asUser(bob, () => h.sql(
        `select app.current_schedule_baseline($1) as id`, [project]));
      expect((rows[0] as { id: string | null }).id).toBeNull();
    });
  });

  // ----------------------------------------------------------------- tenancy
  describe('tenancy', () => {
    it('forces row level security on every new table', async () => {
      const rows = await h.sql<{ relname: string; rls: boolean; forced: boolean }>(`
        select relname, relrowsecurity as rls, relforcerowsecurity as forced
        from pg_class
        where relname in ('work_calendars','work_calendar_exceptions','schedule_calculations',
                          'schedule_baselines','schedule_baseline_activities')`);
      expect(rows).toHaveLength(5);
      for (const r of rows) {
        expect(r.rls, r.relname).toBe(true);
        expect(r.forced, r.relname).toBe(true);
      }
    });

    it('never shows one company another company calculations', async () => {
      const rows = await h.asUser(bob, () => h.sql(
        `select id from schedule_calculations where project_id = $1`, [project]));
      expect(rows).toEqual([]);
    });

    it('shows an anonymous caller nothing', async () => {
      // The anon role holds no privilege on these tables at all, so it is
      // refused before row level security is even consulted.
      await expect(h.asAnon(() => h.sql(`select id from schedule_baselines`))).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------- variance
  describe('the variance report', () => {
    it('runs as the caller, not as its owner', async () => {
      // A reporting view without security_invoker is how a well-isolated
      // system grows a way around its own row level security.
      const [row] = await h.sql<{ options: string[] | null }>(`
        select c.reloptions as options from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'reporting_schedule_variance'`);
      expect(row!.options).toContain('security_invoker=true');
    });

    it('reports an activity against the current baseline', async () => {
      const rows = await h.asUser(alice, () => h.sql<{ status: string; finish_variance_days: number }>(
        `select status, finish_variance_days from reporting_schedule_variance
         where schedule_activity_id = $1`, [activity]));
      // The current baseline is the recovery schedule, which never captured
      // this activity, so it reads as work added since.
      expect(rows[0]!.status).toBe('not_in_baseline');
    });

    it('shows another company nothing', async () => {
      const rows = await h.asUser(bob, () => h.sql(
        `select * from reporting_schedule_variance where project_id = $1`, [project]));
      expect(rows).toEqual([]);
    });
  });
});
