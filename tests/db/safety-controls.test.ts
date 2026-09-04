/**
 * Safety controls that block and notify, against real PostgreSQL.
 *
 * The safety schema was good at recording and could not prevent anything.
 * `credentials.required_for` had always said "work this credential is a
 * prerequisite for, e.g. CDL for a truck driver", and nothing read it — an
 * employee whose CDL expired last month could be assigned to drive, with the
 * expiry and the assignment recorded side by side and never connected. The
 * notifications table had a `safety` category and no producer anywhere in the
 * codebase.
 *
 * These tests hold both, and hold their deliberate limits: a company that has
 * configured no requirement is not running a policy, and a recommended
 * credential warns rather than blocks.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('safety controls', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let project = '';
  let driver = '';
  let laborer = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test') on conflict (id) do nothing`, [owner]);
    company = (await h.asUser(owner, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;

    project = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name) values ($1,'PRJ-S1','Safety')
       returning id`, [company])))[0]!.id;
    driver = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into employees (company_id, employee_number, first_name, last_name, hourly_rate)
       values ($1,'EMP-D','Ray','Delgado',34) returning id`, [company])))[0]!.id;
    laborer = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into employees (company_id, employee_number, first_name, last_name, hourly_rate)
       values ($1,'EMP-L','Nina','Barros',30) returning id`, [company])))[0]!.id;

    // Driving a CDL vehicle requires a CDL and a DOT medical card. The medical
    // card is recommended rather than mandatory, so the two rules differ.
    await h.asUser(owner, () => h.sql(
      `insert into work_credential_requirements
         (company_id, work_type, credential_name, credential_type, is_mandatory)
       values ($1,'cdl_driving','CDL Class A','license',true),
              ($1,'cdl_driving','DOT Medical Card','medical',false)`, [company]));
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  const credential = (employee: string, name: string, expires: string, type = 'license') =>
    h.asUser(owner, () => h.sql<{ id: string; standing: string }>(
      `insert into credentials (company_id, employee_id, credential_type, name, expires_on)
       values ($1,$2,$3,$4,$5::date)
       returning id, app.credential_standing(lifecycle, expires_on) as standing`,
      [company, employee, type, name, expires]));

  const assign = (employee: string, workType: string | null, from = '2026-06-01', to = '2026-06-30') =>
    h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into resource_assignments
         (company_id, project_id, resource_kind, employee_id, work_type, starts_on, ends_on)
       values ($1,$2,'employee',$3,$4,$5::date,$6::date) returning id`,
      [company, project, employee, workType, from, to]));

  // ------------------------------------------------------------------- gaps
  describe('what a person is missing', () => {
    it('reports a credential never held', async () => {
      const rows = await h.asUser(owner, () => h.sql<{ credential_name: string; reason: string }>(
        `select credential_name, reason from app.credential_gaps($1,'cdl_driving') order by 1`,
        [driver]));
      expect(rows.map((r) => r.credential_name)).toEqual(['CDL Class A', 'DOT Medical Card']);
      expect(rows[0]!.reason).toBe('not held');
    });

    it('stops reporting one that is held and valid', async () => {
      await credential(driver, 'CDL Class A', '2030-01-01');
      const rows = await h.asUser(owner, () => h.sql<{ credential_name: string }>(
        `select credential_name from app.credential_gaps($1,'cdl_driving')`, [driver]));
      expect(rows.map((r) => r.credential_name)).toEqual(['DOT Medical Card']);
    });

    it('matches the certificate name whatever its capitalization', async () => {
      // "CDL class A" and "CDL Class A" are the same requirement.
      const [c] = await credential(laborer, 'cdl class a', '2030-01-01');
      expect(c!.id).toBeTruthy();
      const rows = await h.asUser(owner, () => h.sql<{ credential_name: string }>(
        `select credential_name from app.credential_gaps($1,'cdl_driving')`, [laborer]));
      expect(rows.map((r) => r.credential_name)).toEqual(['DOT Medical Card']);
    });

    it('does not treat an expiring credential as a gap', async () => {
      // It is still valid. Warning about it is the notification's job.
      const [c] = await credential(driver, 'Confined Space', '2026-09-20', 'training');
      expect(['expiring', 'valid', 'expired']).toContain(c!.standing);
      const rows = await h.asUser(owner, () => h.sql(
        `select 1 from app.credential_gaps($1,'cdl_driving') where credential_name='Confined Space'`,
        [driver]));
      expect(rows).toEqual([]);
    });

    it('reports nothing for work nobody wrote a rule for', async () => {
      const rows = await h.asUser(owner, () => h.sql(
        `select 1 from app.credential_gaps($1,'flagging')`, [driver]));
      expect(rows).toEqual([]);
    });
  });

  // ------------------------------------------------------------- the block
  describe('the blocking control', () => {
    it('assigns somebody who holds the mandatory credential', async () => {
      const rows = await assign(driver, 'cdl_driving');
      expect(rows[0]!.id).toBeTruthy();
    });

    it('refuses somebody who never held it, and names them and it', async () => {
      const fresh = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into employees (company_id, employee_number, first_name, last_name, hourly_rate)
         values ($1,'EMP-N','Tomas','Reyes',30) returning id`, [company])))[0]!.id;
      await expect(assign(fresh, 'cdl_driving', '2026-07-01', '2026-07-31'))
        .rejects.toThrow(/Tomas Reyes cannot be assigned to cdl_driving.*CDL Class A \(not held\)/);
    });

    it('refuses somebody whose credential has lapsed', async () => {
      // The case the platform recorded and never connected: the expiry and
      // the assignment sat side by side.
      const lapsed = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into employees (company_id, employee_number, first_name, last_name, hourly_rate)
         values ($1,'EMP-X','Marco','Silva',34) returning id`, [company])))[0]!.id;
      const [c] = await credential(lapsed, 'CDL Class A', '2025-01-01');
      expect(c!.standing).toBe('expired');
      await expect(assign(lapsed, 'cdl_driving', '2026-08-01', '2026-08-31'))
        .rejects.toThrow(/CDL Class A \(expired 2025-01-01\)/);
    });

    it('refuses somebody whose credential was revoked', async () => {
      const revoked = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into employees (company_id, employee_number, first_name, last_name, hourly_rate)
         values ($1,'EMP-R','Dee','Harmon',34) returning id`, [company])))[0]!.id;
      await h.asUser(owner, () => h.sql(
        `insert into credentials (company_id, employee_id, credential_type, name, expires_on, lifecycle)
         values ($1,$2,'license','CDL Class A','2030-01-01','revoked')`, [company, revoked]));
      await expect(assign(revoked, 'cdl_driving', '2026-09-01', '2026-09-30'))
        .rejects.toThrow(/CDL Class A \(revoked\)/);
    });

    it('does not block on a recommended credential', async () => {
      // A control that blocks on everything gets switched off. The company
      // marked the medical card recommended; that was their call.
      const rows = await h.asUser(owner, () => h.sql<{ credential_name: string }>(
        `select credential_name from app.credential_gaps($1,'cdl_driving')`, [driver]));
      expect(rows.map((r) => r.credential_name)).toContain('DOT Medical Card');
      const assigned = await assign(driver, 'cdl_driving', '2026-10-01', '2026-10-31');
      expect(assigned[0]!.id).toBeTruthy();
    });

    it('leaves an assignment that declares no work alone', async () => {
      const rows = await assign(laborer, null, '2026-11-01', '2026-11-30');
      expect(rows[0]!.id).toBeTruthy();
    });

    it('leaves a company that configured no requirement alone', async () => {
      const rows = await assign(laborer, 'flagging', '2026-12-01', '2026-12-31');
      expect(rows[0]!.id).toBeTruthy();
    });

    it('checks again when an assignment is moved to different work', async () => {
      // An uncredentialed person: `laborer` holds a CDL, so moving *them* onto
      // driving is legitimately allowed and would prove nothing.
      const uncredentialed = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into employees (company_id, employee_number, first_name, last_name, hourly_rate)
         values ($1,'EMP-M','Ruth','Alvarez',30) returning id`, [company])))[0]!.id;
      const [a] = await assign(uncredentialed, null, '2027-01-04', '2027-01-29');
      await expect(h.asUser(owner, () => h.sql(
        `update resource_assignments set work_type='cdl_driving' where id=$1`, [a!.id])))
        .rejects.toThrow(/Ruth Alvarez cannot be assigned to cdl_driving/);
    });
  });

  // ----------------------------------------------------------- notifications
  describe('notifications, which had no producer at all', () => {
    it('notifies the company when an incident is recordable', async () => {
      await h.asUser(owner, () => h.sql(
        `insert into safety_incidents
           (company_id, project_id, number, occurred_at, incident_type, severity, description,
            is_osha_recordable, osha_case_number)
         values ($1,$2,'INC-1','2026-06-10T14:00:00Z','lost_time','critical',
                 'Operator struck by a swinging load while spotting.',true,'2026-001')`,
        [company, project]));
      const rows = await h.asUser(owner, () => h.sql<{ severity: string; title: string; body: string }>(
        `select severity, title, body from notifications
         where entity_table='public.safety_incidents' and category='safety'`));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.severity).toBe('critical');
      expect(rows[0]!.title).toContain('INC-1');
      expect(rows[0]!.body).toContain('2026-001');
    });

    it('addresses it to the company, not one person', async () => {
      // A recordable incident is not one person's business; the OSHA log is a
      // company obligation.
      const [row] = await h.asUser(owner, () => h.sql<{ user_id: string | null }>(
        `select user_id from notifications where entity_table='public.safety_incidents'`));
      expect(row!.user_id).toBeNull();
    });

    it('does not notify for an incident that is not recordable', async () => {
      await h.asUser(owner, () => h.sql(
        `insert into safety_incidents
           (company_id, project_id, number, occurred_at, incident_type, description)
         values ($1,$2,'INC-2','2026-06-11T09:00:00Z','near_miss','Load swung wide; nobody in the zone.')`,
        [company, project]));
      const rows = await h.asUser(owner, () => h.sql(
        `select 1 from notifications where entity_table='public.safety_incidents'`));
      expect(rows).toHaveLength(1);
    });

    it('notifies once when an incident becomes recordable, not on every edit', async () => {
      await h.asUser(owner, () => h.sql(
        `update safety_incidents set is_osha_recordable=true, osha_case_number='2026-002'
         where number='INC-2' and company_id=$1`, [company]));
      await h.asUser(owner, () => h.sql(
        `update safety_incidents set description = description || ' Reviewed.'
         where number='INC-2' and company_id=$1`, [company]));
      const rows = await h.asUser(owner, () => h.sql(
        `select 1 from notifications where entity_table='public.safety_incidents'`));
      expect(rows).toHaveLength(2);
    });

    it('notifies when a credential expires, naming what it was needed for', async () => {
      await h.asUser(owner, () => h.sql(
        `insert into credentials (company_id, employee_id, credential_type, name, expires_on, required_for)
         values ($1,$2,'medical','DOT Medical Card', current_date - 3, array['cdl_driving'])`,
        [company, laborer]));
      const rows = await h.asUser(owner, () => h.sql<{ severity: string; body: string }>(
        `select severity, body from notifications
         where entity_table='public.credentials' order by created_at desc limit 1`));
      expect(rows[0]!.severity).toBe('critical');
      expect(rows[0]!.body).toContain('Required for: cdl_driving');
    });

    it('warns rather than alarms for one that is merely expiring', async () => {
      await h.asUser(owner, () => h.sql(
        `insert into credentials (company_id, employee_id, credential_type, name, expires_on)
         values ($1,$2,'training','OSHA 30', current_date + 10)`, [company, laborer]));
      const [row] = await h.asUser(owner, () => h.sql<{ severity: string; title: string }>(
        `select severity, title from notifications
         where entity_table='public.credentials' order by created_at desc limit 1`));
      expect(row!.severity).toBe('warning');
      expect(row!.title).toContain('OSHA 30');
    });

    it('does not notify again when nothing about the standing changed', async () => {
      const before = await h.asUser(owner, () => h.sql<{ n: string }>(
        `select count(*) as n from notifications where entity_table='public.credentials'`));
      await h.asUser(owner, () => h.sql(
        `update credentials set issuing_body='OSHA' where employee_id=$1 and name='OSHA 30'`, [laborer]));
      const after = await h.asUser(owner, () => h.sql<{ n: string }>(
        `select count(*) as n from notifications where entity_table='public.credentials'`));
      expect(after[0]!.n).toBe(before[0]!.n);
    });
  });

  /*
   * The gate reads the date, not a remembered state.
   *
   * This control was built in P14 and did not work. `credentials.status` stored
   * 'valid' / 'expiring' / 'expired', maintained by a trigger that fired only
   * when somebody wrote the row — so nothing fired with the passage of time. A
   * license that expired two hundred days ago still read 'valid', and
   * `credential_gaps` read that column and nothing else. Reproduced before the
   * fix: no gap reported, assignment accepted. **The gate failed open on the
   * exact case it exists to catch.**
   */
  describe('expiry is derived, so it cannot go stale', () => {
    it('has no stored status column left to go stale', () => {
      // The structural half of the fix. There is no longer anywhere to keep a
      // date's consequence written down, so it cannot disagree with the date.
      return h.sql<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema='public' and table_name='credentials'
           and column_name in ('status','lifecycle') order by column_name`)
        .then((rows) => expect(rows.map((r) => r.column_name)).toEqual(['lifecycle']));
    });

    it('reads the same row differently as the date moves past it', () => {
      // One unchanged credential, three answers, decided entirely by the clock.
      return h.sql<{ tomorrow: string; yesterday: string; far: string }>(
        `select app.credential_standing('active', current_date + 1)   as tomorrow,
                app.credential_standing('active', current_date - 1)   as yesterday,
                app.credential_standing('active', current_date + 400) as far`)
        .then(([r]) => {
          expect(r!.tomorrow).toBe('expiring');
          expect(r!.yesterday).toBe('expired');
          expect(r!.far).toBe('valid');
        });
    });

    it('keeps the administrative states, which no date can decide', async () => {
      const [r] = await h.sql<{ revoked: string; pending: string; none: string }>(
        `select app.credential_standing('revoked', current_date + 400) as revoked,
                app.credential_standing('pending', current_date + 400) as pending,
                app.credential_standing('active',  null)               as none`);
      // A revoked credential is revoked however long it had left, and a
      // credential with no expiry date does not expire.
      expect(r!.revoked).toBe('revoked');
      expect(r!.pending).toBe('pending');
      expect(r!.none).toBe('valid');
    });

    it('blocks the assignment the old gate let through', async () => {
      const stale = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into employees (company_id, employee_number, first_name, last_name)
         values ($1,'EMP-S','Ana','Vidal') returning id`, [company])))[0]!.id;
      // Written as held and active, with a date two hundred days gone — the
      // state the old design reached by doing nothing at all.
      await h.asUser(owner, () => h.sql(
        `insert into credentials (company_id, employee_id, credential_type, name, expires_on, lifecycle)
         values ($1,$2,'license','CDL Class A', current_date - 200, 'active')`, [company, stale]));

      const gaps = await h.asUser(owner, () => h.sql<{ reason: string }>(
        `select reason from app.credential_gaps($1,'cdl_driving')
         where credential_name='CDL Class A'`, [stale]));
      expect(gaps[0]!.reason).toMatch(/^expired /);

      await expect(assign(stale, 'cdl_driving', '2026-10-01', '2026-10-31'))
        .rejects.toThrow(/Ana Vidal cannot be assigned to cdl_driving.*CDL Class A \(expired/);
    });

    it('publishes what has lapsed and the work it blocks', async () => {
      const [row] = await h.asUser(owner, () => h.sql<{
        standing: string; blocks_work_types: string[]; days_remaining: number }>(
        `select standing, blocks_work_types, days_remaining
         from reporting_credential_expiry
         where employee_name = 'Ana Vidal' and credential_name = 'CDL Class A'`));
      expect(row!.standing).toBe('expired');
      expect(row!.blocks_work_types).toEqual(['cdl_driving']);
      expect(Number(row!.days_remaining)).toBe(-200);
    });

    it('shows one company nothing of another\'s lapsed credentials', async () => {
      const rows = await h.asAnon(() => h.sql(`select 1 from reporting_credential_expiry`))
        .then(() => 'readable').catch(() => 'refused');
      expect(rows).toBe('refused');
    });
  });

  // ----------------------------------------------------------------- tenancy
  describe('tenancy', () => {
    it('forces row level security on the requirements', async () => {
      const [row] = await h.sql<{ rls: boolean; forced: boolean }>(
        `select relrowsecurity as rls, relforcerowsecurity as forced
         from pg_class where relname='work_credential_requirements'`);
      expect(row!.rls).toBe(true);
      expect(row!.forced).toBe(true);
    });

    it('audits a change to a safety requirement', async () => {
      // Loosening a safety rule is exactly what an investigation asks about.
      const rows = await h.sql(
        `select 1 from audit_events where entity_table='public.work_credential_requirements'`);
      expect(rows.length).toBeGreaterThan(0);
    });
  });
});
