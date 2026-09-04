import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/** Governance on the fleet, workforce and scheduling tables (migration 0015). */
describe('fleet, workforce and scheduling', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  const foreman = '66666666-6666-4666-8666-666666666666';
  let company = '';
  let project = '';
  let asset = '';
  let employee = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test'), ($2,'f@r.test')`, [owner, foreman]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test'), ($2,'f@r.test') on conflict (id) do nothing`, [owner, foreman]);
    company = (await h.asUser(owner, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','business') as id`)))[0]!.id;

    const foremanRole = (await h.sql<{ id: string }>(
      `select id from roles where key='foreman' and company_id is null`))[0]!.id;
    await h.sql(`insert into company_memberships (company_id, user_id, role_id, status, joined_at)
                 values ($1,$2,$3,'active',now())`, [company, foreman, foremanRole]);

    await h.asUser(owner, async () => {
      project = (await h.sql<{ id: string }>(
        `insert into projects (company_id, number, name) values ($1,'PRJ-1','Test') returning id`, [company]))[0]!.id;
      asset = (await h.sql<{ id: string }>(
        `insert into assets (company_id, asset_number, name, current_hours) values ($1,'EX-1','Excavator',4000)
         returning id`, [company]))[0]!.id;
      employee = (await h.sql<{ id: string }>(
        `insert into employees (company_id, employee_number, first_name, last_name, hourly_rate)
         values ($1,'EMP-1','Ray','Delgado',48) returning id`, [company]))[0]!.id;
    });
  });

  afterAll(async () => { await h?.db.close(); });

  describe('meter readings', () => {
    it('advances the asset meter on a forward reading', async () => {
      await h.asUser(owner, () =>
        h.sql(`insert into meter_readings (company_id, asset_id, hours, source)
               values ($1,$2,4180,'telematics')`, [company, asset]));
      const [a] = await h.sql<{ current_hours: string; last_telemetry_at: string }>(
        `select current_hours, last_telemetry_at from assets where id = $1`, [asset]);
      expect(Number(a!.current_hours)).toBe(4180);
      expect(a!.last_telemetry_at).toBeTruthy();
    });

    it('refuses a reading that runs the meter backwards', async () => {
      // A mistyped reading would otherwise silently reset the machine's life
      // and reset every maintenance interval with it.
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into meter_readings (company_id, asset_id, hours) values ($1,$2,3000)`, [company, asset])),
      ).rejects.toThrow(/below the asset's current/);
    });

    it('accepts a lower reading when the meter was genuinely replaced', async () => {
      await h.asUser(owner, () =>
        h.sql(`insert into meter_readings (company_id, asset_id, hours, is_meter_replacement)
               values ($1,$2,12,true)`, [company, asset]));
      const [a] = await h.sql<{ current_hours: string }>(`select current_hours from assets where id=$1`, [asset]);
      expect(Number(a!.current_hours)).toBe(12);
    });
  });

  describe('work orders', () => {
    it('refuses to complete a work order with no resolution', async () => {
      const [wo] = await h.asUser(owner, () =>
        h.sql<{ id: string }>(
          `insert into work_orders (company_id, asset_id, number, title) values ($1,$2,'WO-1','Service') returning id`,
          [company, asset]));
      await expect(
        h.asUser(owner, () =>
          h.sql(`update work_orders set status='complete', completed_at=now() where id=$1`, [wo!.id])),
      ).rejects.toThrow(/work_orders_complete/);
    });

    it('resets the maintenance schedule when a preventive order completes', async () => {
      const [sched] = await h.asUser(owner, () =>
        h.sql<{ id: string }>(
          `insert into maintenance_schedules (company_id, asset_id, name, interval_hours)
           values ($1,$2,'250-hour',250) returning id`, [company, asset]));
      const [wo] = await h.asUser(owner, () =>
        h.sql<{ id: string }>(
          `insert into work_orders (company_id, asset_id, schedule_id, number, title)
           values ($1,$2,$3,'WO-2','250-hour service') returning id`, [company, asset, sched!.id]));
      await h.asUser(owner, () =>
        h.sql(`update work_orders set status='complete', completed_at=now(), resolution='Oil and filters'
               where id=$1`, [wo!.id]));
      const [s] = await h.sql<{ last_performed_at: string; last_performed_hours: string }>(
        `select last_performed_at, last_performed_hours from maintenance_schedules where id=$1`, [sched!.id]);
      expect(s!.last_performed_at).toBeTruthy();
      expect(Number(s!.last_performed_hours)).toBe(12);
    });

    it('computes total cost from its parts', async () => {
      const [wo] = await h.asUser(owner, () =>
        h.sql<{ total_cost: string }>(
          `insert into work_orders (company_id, asset_id, number, title, labor_cost, parts_cost, outside_cost)
           values ($1,$2,'WO-3','Repair',640,1180,450) returning total_cost`, [company, asset]));
      expect(Number(wo!.total_cost)).toBe(2270);
    });
  });

  describe('credentials', () => {
    it('reports an expired credential as expired, with nothing to submit instead', async () => {
      // This used to be a stored column a trigger overwrote on write. It is now
      // derived on read, so there is no value anybody could submit and no state
      // that could go stale between writes — which is what let an expired
      // license pass the assignment gate before migration 0043.
      const [c] = await h.asUser(owner, () =>
        h.sql<{ standing: string }>(
          `insert into credentials (company_id, employee_id, credential_type, name, expires_on)
           values ($1,$2,'medical','DOT Medical Card', current_date - 5)
           returning app.credential_standing(lifecycle, expires_on) as standing`,
          [company, employee]));
      expect(c!.standing).toBe('expired');
    });

    it('reports a credential expiring within 30 days as expiring', async () => {
      const [c] = await h.asUser(owner, () =>
        h.sql<{ standing: string }>(
          `insert into credentials (company_id, employee_id, credential_type, name, expires_on)
           values ($1,$2,'license','CDL Class A', current_date + 12)
           returning app.credential_standing(lifecycle, expires_on) as standing`,
          [company, employee]));
      expect(c!.standing).toBe('expiring');
    });

    it('leaves a revoked credential revoked however long it had left', async () => {
      // Revocation is an administrative decision, so it is stored — it is the
      // one part of a credential's standing no date can decide.
      const [c] = await h.asUser(owner, () =>
        h.sql<{ standing: string }>(
          `insert into credentials (company_id, employee_id, credential_type, name,
             expires_on, lifecycle)
           values ($1,$2,'license','Revoked license', current_date + 400, 'revoked')
           returning app.credential_standing(lifecycle, expires_on) as standing`,
          [company, employee]));
      expect(c!.standing).toBe('revoked');
    });

    it('hides employee compensation from a role without hr.read', async () => {
      // A foreman legitimately belongs to the company but must not see wages.
      const seen = await h.asUser(foreman, () => h.sql(`select id from employees`));
      expect(seen).toEqual([]);
    });
  });

  describe('time entries', () => {
    let entry = '';
    it('computes total hours and accepts a normal day', async () => {
      const [t] = await h.asUser(owner, () =>
        h.sql<{ id: string; total_hours: string }>(
          `insert into time_entries (company_id, employee_id, project_id, work_date, straight_hours, overtime_hours)
           values ($1,$2,$3,'2026-09-01',8,1.5) returning id, total_hours`, [company, employee, project]));
      entry = t!.id;
      expect(Number(t!.total_hours)).toBe(9.5);
    });

    it('refuses more than 24 hours in a day', async () => {
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into time_entries (company_id, employee_id, work_date, straight_hours, overtime_hours)
                 values ($1,$2,'2026-09-02',20,10)`, [company, employee])),
      ).rejects.toThrow(/time_entries_day_total/);
    });

    it('requires an approver to be recorded on approval', async () => {
      await expect(
        h.asUser(owner, () =>
          h.sql(`update time_entries set approval_state='approved' where id=$1`, [entry])),
      ).rejects.toThrow(/time_entries_approved/);
    });

    it('locks a timecard once exported to payroll', async () => {
      await h.asUser(owner, () =>
        h.sql(`update time_entries set approval_state='approved', approved_by=$1, approved_at=now(),
               exported_at=now(), payroll_batch='PR-2026-36' where id=$2`, [owner, entry]));
      await expect(
        h.asUser(owner, () => h.sql(`update time_entries set straight_hours=12 where id=$1`, [entry])),
      ).rejects.toThrow(/exported to payroll batch PR-2026-36/);
    });
  });

  describe('scheduling', () => {
    // Since 0029 a float figure has to name the calculation that produced it,
    // so these rows carry one. Without it they would fail on provenance and
    // never reach the constraint each test is actually about.
    let calculation = '';
    beforeAll(async () => {
      calculation = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into schedule_calculations
           (company_id, project_id, data_date, engine_version, project_start, project_finish, duration_working_days)
         values ($1,$2,'2026-09-01','1.0.0','2026-09-01','2026-09-30',22) returning id`,
        [company, project])))[0]!.id;
    });

    it('keeps float and criticality consistent', async () => {
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into schedule_activities
                 (company_id, project_id, name, planned_start, planned_finish, duration_days,
                  calculation_id, total_float_days, is_critical)
                 values ($1,$2,'Inconsistent','2026-09-01','2026-09-10',10,$3,5,true)`,
            [company, project, calculation])),
      ).rejects.toThrow(/schedule_activities_critical/);
    });

    it('refuses a finish before its start', async () => {
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into schedule_activities
                 (company_id, project_id, name, planned_start, planned_finish, duration_days)
                 values ($1,$2,'Backwards','2026-09-10','2026-09-01',10)`, [company, project])),
      ).rejects.toThrow(/schedule_activities_dates/);
    });

    it('accepts a well-formed critical activity', async () => {
      const rows = await h.asUser(owner, () =>
        h.sql<{ id: string }>(
          `insert into schedule_activities
           (company_id, project_id, name, planned_start, planned_finish, duration_days,
            calculation_id, total_float_days, is_critical)
           values ($1,$2,'Sanitary main','2026-09-01','2026-09-30',22,$3,0,true) returning id`,
          [company, project, calculation]));
      expect(rows).toHaveLength(1);
    });
  });

  describe('resource assignments', () => {
    it('refuses to book one machine to overlapping dates', async () => {
      await h.asUser(owner, () =>
        h.sql(`insert into resource_assignments (company_id, project_id, resource_kind, asset_id, starts_on, ends_on)
               values ($1,$2,'asset',$3,'2026-09-01','2026-09-15')`, [company, project, asset]));
      // The same excavator cannot also be on another job that fortnight.
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into resource_assignments (company_id, project_id, resource_kind, asset_id, starts_on, ends_on)
                 values ($1,$2,'asset',$3,'2026-09-10','2026-09-20')`, [company, project, asset])),
      ).rejects.toThrow(/resource_assignments_asset_no_overlap|conflicting key/);
    });

    it('allows the same machine on a later, non-overlapping window', async () => {
      const rows = await h.asUser(owner, () =>
        h.sql<{ id: string }>(
          `insert into resource_assignments (company_id, project_id, resource_kind, asset_id, starts_on, ends_on)
           values ($1,$2,'asset',$3,'2026-09-16','2026-09-30') returning id`, [company, project, asset]));
      expect(rows).toHaveLength(1);
    });

    it('requires the reference that matches the resource kind', async () => {
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into resource_assignments (company_id, project_id, resource_kind, starts_on, ends_on)
                 values ($1,$2,'asset','2026-10-01','2026-10-05')`, [company, project])),
      ).rejects.toThrow(/resource_assignments_reference/);
    });
  });

  describe('employees', () => {
    it('requires a termination date when terminated', async () => {
      await expect(
        h.asUser(owner, () =>
          h.sql(`update employees set status='terminated' where id=$1`, [employee])),
      ).rejects.toThrow(/employees_terminated_date/);
    });

    it('generates the full name from its parts', async () => {
      const [e] = await h.sql<{ full_name: string }>(`select full_name from employees where id=$1`, [employee]);
      expect(e!.full_name).toBe('Ray Delgado');
    });
  });
});
