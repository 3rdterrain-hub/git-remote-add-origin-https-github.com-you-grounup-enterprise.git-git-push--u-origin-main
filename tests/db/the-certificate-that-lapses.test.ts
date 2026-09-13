/**
 * The certificate that lapses while somebody is still on the job.
 *
 * Every fixture here sets a date and a lifecycle and never a standing, because
 * 0043 dropped the stored one: 'valid' kept saying valid the day after a
 * license lapsed, and the gate failed open on exactly the case it existed to
 * catch. Standing is derived from the expiry each time it is asked for.
 *
 * Migration 0035 refuses to assign a person to work they are not credentialed
 * for, and it asks that question once, on the day the assignment is made. A CDL
 * expiring three weeks into a six week assignment passes that check and lapses
 * in the middle of the work with nothing to notice. So does one revoked
 * afterwards.
 *
 * Recruitment was considered for this and rejected: the question a contractor
 * actually has is "who is short of what, and when", and the schedule and the
 * credentials to answer it were both already here.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '33333333-3333-4333-8333-333333333333';

describe('assignments whose credentials run out before the work does', () => {
  let h: Harness;
  let company = '';
  let project = '';
  let employee = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@quarry.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@quarry.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Quarry Road','quarry-road','grounup') as id`)))[0]!.id;

    project = (await h.asService(() => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, status)
       values ($1,'PRJ-2026-0100','Kilburn widening','active') returning id`, [company])))[0]!.id;

    employee = (await h.asService(() => h.sql<{ id: string }>(
      `insert into employees (company_id, employee_number, first_name, last_name, status)
       values ($1,'E-100','Dana','Whitfield','active') returning id`, [company])))[0]!.id;

    await h.asService(() => h.sql(
      `insert into work_credential_requirements (company_id, work_type, credential_name, is_mandatory)
       values ($1,'haul_operation','CDL Class A', true)`, [company]));
  });

  it('says nothing while the credential outlasts the work', async () => {
    await h.asService(() => h.sql(
      `insert into credentials (company_id, employee_id, credential_type, name, expires_on, lifecycle)
       values ($1,$2,'license','CDL Class A', current_date + 400, 'active')`, [company, employee]));
    await h.asService(() => h.sql(
      `insert into resource_assignments
         (company_id, project_id, resource_kind, employee_id, work_type, starts_on, ends_on)
       values ($1,$2,'employee',$3,'haul_operation', current_date, current_date + 40)`,
      [company, project, employee]));

    const rows = await h.asUser(OWNER, () => h.sql(`select * from app.staffing_gaps()`));
    expect(rows).toHaveLength(0);
  });

  it('names the day cover runs out inside an assignment', async () => {
    /*
     * The whole point. The assignment trigger passed on the day it was made —
     * the credential was valid then — and the work outlives it by three weeks.
     */
    await h.asService(() => h.sql(
      `update credentials set expires_on = current_date + 20 where employee_id = $1`, [employee]));

    const rows = await h.asUser(OWNER, () => h.sql<{
      employee_name: string; uncovered_from: string; already_lapsed: boolean; reason: string;
    }>(`select * from app.staffing_gaps()`));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.employee_name).toBe('Dana Whitfield');
    expect(rows[0]!.already_lapsed).toBe(false);
    expect(rows[0]!.reason).toMatch(/20 days before the work ends/);
  });

  it('separates a credential that has already failed from one that will', async () => {
    await h.asService(() => h.sql(
      `update credentials set lifecycle = 'revoked' where employee_id = $1`, [employee]));
    const rows = await h.asUser(OWNER, () => h.sql<{ already_lapsed: boolean; reason: string }>(
      `select * from app.staffing_gaps()`));
    expect(rows[0]!.already_lapsed).toBe(true);
    expect(rows[0]!.reason).toBe('revoked');
  });

  it('answers who is qualified for the work and how committed they are', async () => {
    const rows = await h.asUser(OWNER, () => h.sql<{
      employee_name: string; fully_qualified: boolean; missing: string[]; committed_days: number;
    }>(`select * from app.qualified_and_available('haul_operation')`));

    expect(rows).toHaveLength(1);
    // The credential is revoked, so they hold nothing that counts.
    expect(rows[0]!.fully_qualified).toBe(false);
    expect(rows[0]!.missing).toContain('CDL Class A');
    // Forty one days of a ninety one day window are already spoken for.
    expect(rows[0]!.committed_days).toBe(41);
  });

  it('counts a credential as cover only if it lasts the whole window', async () => {
    /*
     * Valid today is not the question. Somebody whose ticket expires inside the
     * window cannot be planned against it, and reporting them as available is
     * how a crew turns up short in week six.
     */
    await h.asService(() => h.sql(
      `update credentials set lifecycle = 'active', expires_on = current_date + 30 where employee_id = $1`,
      [employee]));
    const near = await h.asUser(OWNER, () => h.sql<{ fully_qualified: boolean }>(
      `select * from app.qualified_and_available('haul_operation', current_date, current_date + 90)`));
    expect(near[0]!.fully_qualified).toBe(false);

    const far = await h.asUser(OWNER, () => h.sql<{ fully_qualified: boolean }>(
      `select * from app.qualified_and_available('haul_operation', current_date, current_date + 10)`));
    expect(far[0]!.fully_qualified).toBe(true);
  });

  it('has a door', async () => {
    const rows = await h.asUser(OWNER, () => h.sql(`select * from my_staffing_gaps`));
    expect(Array.isArray(rows)).toBe(true);
  });
});
