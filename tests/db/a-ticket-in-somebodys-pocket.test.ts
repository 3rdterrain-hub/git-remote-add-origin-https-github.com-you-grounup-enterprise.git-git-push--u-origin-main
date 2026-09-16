/**
 * A ticket in somebody's pocket.
 *
 * This is the most serious instance of this repository's defect, because it is
 * a safety control.
 *
 * `app.enforce_assignment_credentials` (0043) refuses to put somebody on
 * declared work without a mandatory credential — its own comment calls it "the
 * platform's first blocking safety control". It reads
 * `work_credential_requirements`, which had no writer, so no company could
 * state a requirement and the trigger had never fired. Underneath it,
 * `credentials` had no writer either, so nobody could record that a person
 * holds anything.
 *
 * The last two tests are the ones that matter: the control blocks when it
 * should, and lets through when it should. Both were unreachable before 0187.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '6f5f5f5f-5f5f-4f5f-8f5f-5f5f5f5f5f5f';

describe('a ticket in somebody’s pocket', () => {
  let h: Harness;
  let company = '';
  let driver = '';
  let project = '';
  let activity = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@crew.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@crew.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Crew Civil','crew-civil','enterprise') as id`)))[0]!.id;
    driver = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_employee($1,'Dale','Whitcomb','operator') as id`,
      [company])))[0]!.id;
    project = (await h.asService(() => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, planned_start)
       values ($1,'PRJ-2026-0300','Aggregate haul','2026-05-04') returning id`,
      [company])))[0]!.id;
    activity = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.add_schedule_activity($1,'Haul off','2026-05-04', 5) as id`,
      [project])))[0]!.id;
  });

  it('records a credential, which nothing could do before', async () => {
    const id = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.record_credential($1,'CDL Class A','license','Ohio BMV',
        'OH-4471','2024-03-01'::date,'2028-03-01'::date, array['truck_driving']) as id`,
      [driver])))[0]!.id;
    const [row] = await h.asUser(OWNER, () => h.sql<{
      status: string; days_remaining: string; full_name: string; required_for: string[];
    }>(`select status, days_remaining, full_name, required_for
          from my_employee_credentials where id = $1`, [id]));
    expect(row!.status).toBe('valid');
    expect(row!.full_name).toBe('Dale Whitcomb');
    expect(row!.required_for).toEqual(['truck_driving']);
    expect(Number(row!.days_remaining)).toBeGreaterThan(0);
  });

  it('computes standing from the expiry date rather than taking it on trust', async () => {
    const soon = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.record_credential($1,'MSHA Part 46','training', null, null,
        current_date - 300, current_date + 10) as id`, [driver])))[0]!.id;
    const gone = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.record_credential($1,'First Aid','training', null, null,
        current_date - 800, current_date - 5) as id`, [driver])))[0]!.id;
    const rows = await h.asUser(OWNER, () => h.sql<{ id: string; status: string }>(
      `select id, status from my_employee_credentials where id in ($1,$2)`, [soon, gone]));
    expect(rows.find((r) => r.id === soon)!.status).toBe('expiring');
    expect(rows.find((r) => r.id === gone)!.status).toBe('expired');
  });

  it('refuses a credential that expires before it was issued', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.record_credential($1,'Backwards','license', null, null,
        '2026-01-01'::date, '2025-01-01'::date)`, [driver])))
      .rejects.toThrow(/cannot expire before it was issued/i);
  });

  it('renews a ticket in place rather than leaving a lapsed one in the file', async () => {
    const [{ id }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from credentials where employee_id = $1 and name = 'First Aid'`, [driver]));
    await h.asUser(OWNER, () => h.sql(
      `select public.update_credential($1, p_issued_on => current_date - 1,
         p_expires_on => current_date + 700)`, [id]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ status: string }>(
      `select status from my_employee_credentials where id = $1`, [id]));
    expect(row!.status).toBe('valid');
    const [{ n }] = await h.asUser(OWNER, () => h.sql<{ n: string }>(
      `select count(*) as n from credentials where employee_id = $1 and name = 'First Aid'`,
      [driver]));
    expect(Number(n)).toBe(1);
  });

  it('revokes a ticket with the reason, and expiry does not overwrite it', async () => {
    const [{ id }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.record_credential($1,'Crane Operator','certification', null, null,
        current_date - 10, current_date + 900) as id`, [driver]));
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.revoke_credential($1,'')`, [id])))
      .rejects.toThrow(/Say why it was revoked/i);

    await h.asUser(OWNER, () => h.sql(
      `select public.revoke_credential($1,'Failed the medical')`, [id]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ status: string; name: string }>(
      `select status, name from my_employee_credentials where id = $1`, [id]));
    /*
     * Lapsed and taken away are different things. 0043 stores the
     * administrative state and derives the rest from the date every time.
     */
    expect(row!.status).toBe('revoked');
    expect(row!.name).toMatch(/Failed the medical/);
  });

  it('states what a kind of work requires, which nothing could do before', async () => {
    const id = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.set_work_credential_requirement($1,'truck_driving','CDL Class A') as id`,
      [company])))[0]!.id;
    const [row] = await h.asUser(OWNER, () => h.sql<{
      is_mandatory: boolean; people_who_hold_it: string;
    }>(`select is_mandatory, people_who_hold_it
          from my_work_credential_requirements where id = $1`, [id]));
    expect(row!.is_mandatory).toBe(true);
    /* The count is what tells a company whether a rule is one they can staff. */
    expect(Number(row!.people_who_hold_it)).toBe(1);
  });

  it('refuses a work type that is not named the way the requirement names it', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.set_work_credential_requirement($1,'Truck Driving!','CDL Class A')`,
      [company]))).rejects.toThrow(/lower case with underscores/i);
  });

  it('blocks an assignment where a mandatory credential is missing', async () => {
    const helper = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_employee($1,'Rae','Ellison','laborer') as id`,
      [company])))[0]!.id;
    /*
     * The whole reason this migration exists. Before it, this raise was
     * unreachable on every company, because no requirement could be stated.
     */
    await expect(h.asService(() => h.sql(
      `insert into resource_assignments (company_id, project_id, schedule_activity_id,
         resource_kind, employee_id, starts_on, ends_on, work_type)
       values ($1,$2,$3,'employee',$4,'2026-05-04','2026-05-08','truck_driving')`,
      [company, project, activity, helper])))
      .rejects.toThrow(/cannot be assigned to truck_driving/i);
  });

  it('lets through the person who holds it', async () => {
    await h.asService(() => h.sql(
      `insert into resource_assignments (company_id, project_id, schedule_activity_id,
         resource_kind, employee_id, starts_on, ends_on, work_type)
       values ($1,$2,$3,'employee',$4,'2026-05-04','2026-05-08','truck_driving')`,
      [company, project, activity, driver]));
    const [{ n }] = await h.asUser(OWNER, () => h.sql<{ n: string }>(
      `select count(*) as n from resource_assignments where employee_id = $1`, [driver]));
    expect(Number(n)).toBe(1);
  });

  it('does not block on a recommended credential, because a rule that blocks on everything gets turned off', async () => {
    await h.asUser(OWNER, () => h.sql(
      `select public.set_work_credential_requirement($1,'truck_driving','Defensive Driving',
        false)`, [company]));
    const other = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_employee($1,'Sam','Ortiz','driver') as id`, [company])))[0]!.id;
    await h.asUser(OWNER, () => h.sql(
      `select public.record_credential($1,'CDL Class A','license', null, null,
        current_date - 10, current_date + 900)`, [other]));
    await h.asService(() => h.sql(
      `insert into resource_assignments (company_id, project_id, schedule_activity_id,
         resource_kind, employee_id, starts_on, ends_on, work_type)
       values ($1,$2,$3,'employee',$4,'2026-06-01','2026-06-05','truck_driving')`,
      [company, project, activity, other]));
    const [{ n }] = await h.asUser(OWNER, () => h.sql<{ n: string }>(
      `select count(*) as n from resource_assignments where employee_id = $1`, [other]));
    expect(Number(n)).toBe(1);
  });

  it('corrects a person, and ends their employment with a date', async () => {
    await h.asUser(OWNER, () => h.sql(
      `select public.update_employee($1, p_classification => 'Operator II',
         p_hourly_rate => 38.5, p_status => 'on_leave')`, [driver]));
    let [row] = await h.asUser(OWNER, () => h.sql<{
      classification: string; hourly_rate: string; status: string;
    }>(`select classification, hourly_rate, status from employees where id = $1`, [driver]));
    expect(row!.classification).toBe('Operator II');
    expect(Number(row!.hourly_rate)).toBe(38.5);
    expect(row!.status).toBe('on_leave');

    /* Terminating is its own door, because the schema requires a date with it. */
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.update_employee($1, p_status => 'terminated')`, [driver])))
      .rejects.toThrow(/its own action, because it needs a date/i);

    await h.asUser(OWNER, () => h.sql(
      `select public.end_employment($1, '2026-05-06'::date)`, [driver]));
    [row] = await h.asUser(OWNER, () => h.sql<{
      classification: string; hourly_rate: string; status: string;
    }>(`select classification, hourly_rate, status from employees where id = $1`, [driver]));
    expect(row!.status).toBe('terminated');
  });

  it('ends the assignments that run past somebody’s last day', async () => {
    /* A schedule that still shows them is a schedule somebody staffs from. */
    const [row] = await h.asUser(OWNER, () => h.sql<{ ends_on: string }>(
      `select to_char(ends_on,'YYYY-MM-DD') as ends_on from resource_assignments
        where employee_id = $1`, [driver]));
    expect(row!.ends_on).toBe('2026-05-06');
  });

  it('builds a crew, which no function in this repository could do', async () => {
    const crew = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_crew($1,'Haul crew','earthwork', 10) as id`, [company])))[0]!.id;
    const [row] = await h.asUser(OWNER, () => h.sql<{
      code: string; cost_per_hour: string | null; headcount: string; is_own: boolean;
      status: string;
    }>(`select code, cost_per_hour, headcount, is_own, status from my_crews where id = $1`,
      [crew]));
    expect(row!.code).toBe('CRW-0001');
    expect(row!.is_own).toBe(true);
    expect(row!.status).toBe('active');
    /* Null, not zero: a crew nobody has built does not work for nothing. */
    expect(row!.cost_per_hour).toBeNull();
    expect(Number(row!.headcount)).toBe(0);
  });

  it('prices a crew from the classifications on it', async () => {
    const [{ id: crew }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from crews where company_id = $1 and code = 'CRW-0001'`, [company]));
    const rate = (await h.asService(() => h.sql<{ id: string }>(
      `insert into labor_rates (company_id, code, classification, base_wage_per_hour,
         burden_percent, status, origin, approved_by, approved_at)
       values ($1,'LR-OP1','Operator', 40, 0.45, 'active','company',$2, now())
       returning id`, [company, OWNER])))[0]!.id;
    await h.asUser(OWNER, () => h.sql(
      `select public.set_crew_member($1,$2, 2)`, [crew, rate]));

    const [row] = await h.asUser(OWNER, () => h.sql<{
      cost_per_hour: string; headcount: string; classification_count: string;
    }>(`select cost_per_hour, headcount, classification_count from my_crews where id = $1`,
      [crew]));
    expect(Number(row!.headcount)).toBe(2);
    expect(Number(row!.classification_count)).toBe(1);
    /* 40 at 45% burden is 58 an hour, two of them is 116. */
    expect(Number(row!.cost_per_hour)).toBeCloseTo(116, 2);

    const [m] = await h.asUser(OWNER, () => h.sql<{
      classification: string; rate_scope: string; cost_per_hour: string;
    }>(`select classification, rate_scope, cost_per_hour from my_crew_members
          where crew_id = $1`, [crew]));
    expect(m!.classification).toBe('Operator');
    /* RULE-003: the rate a screen shows must be the rate that prices. */
    expect(m!.rate_scope).toBe('company');
    expect(Number(m!.cost_per_hour)).toBeCloseTo(116, 2);
  });

  it('changes a headcount rather than adding the same classification twice', async () => {
    const [{ id: crew }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from crews where company_id = $1 and code = 'CRW-0001'`, [company]));
    const [{ id: rate }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select labor_rate_id as id from crew_members where crew_id = $1 limit 1`, [crew]));
    await h.asUser(OWNER, () => h.sql(
      `select public.set_crew_member($1,$2, 3)`, [crew, rate]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      headcount: string; classification_count: string;
    }>(`select headcount, classification_count from my_crews where id = $1`, [crew]));
    expect(Number(row!.headcount)).toBe(3);
    expect(Number(row!.classification_count)).toBe(1);
  });

  it('refuses to change a crew the catalog ships', async () => {
    const [{ id }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from crews where company_id is null limit 1`));
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.update_crew($1, p_name => 'Mine now')`, [id])))
      .rejects.toThrow(/not yours to change/i);
  });

  it('archives a crew rather than deleting what an old price points at', async () => {
    const [{ id: crew }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from crews where company_id = $1 and code = 'CRW-0001'`, [company]));
    await h.asUser(OWNER, () => h.sql(`select public.retire_crew($1)`, [crew]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ status: string }>(
      `select status from my_crews where id = $1`, [crew]));
    expect(row!.status).toBe('archived');
  });
});
