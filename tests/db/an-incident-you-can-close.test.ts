/**
 * An incident you can close, a near miss you can record, a test that counts.
 *
 * Safety records are legal records, and this section had the worst version of
 * the defect in the repository:
 *
 *   * an incident could be opened and never closed — `investigation_state`
 *     started at 'open' and nothing could move it, so every incident, including
 *     every recordable `notify_recordable_incident` told the company about,
 *     stayed open forever;
 *   * `safety_observations` had no writer, so near misses and good catches —
 *     the leading indicators — could not be captured at all;
 *   * `inspections` had no writer, so no compaction test, concrete break, pipe
 *     test or proof roll could be recorded, while the table carried
 *     `retest_of_id` and a rule that a failed test must say why.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '8e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e';

describe('an incident you can close', () => {
  let h: Harness;
  let company = '';
  let project = '';
  let incident = '';

  const row = async () => (await h.asUser(OWNER, () => h.sql<{
    investigation_state: string; is_open: boolean; days_open: string | null;
    root_cause: string | null; corrective_action: string | null;
  }>(`select investigation_state, is_open, days_open, root_cause, corrective_action
        from my_safety_incidents where id = $1`, [incident])))[0]!;

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@saf.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@saf.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Saf Civil','saf-civil','enterprise') as id`)))[0]!.id;
    project = (await h.asService(() => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name) values ($1,'PRJ-2026-0500','Trench job')
       returning id`, [company])))[0]!.id;
    incident = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_safety_incident($1, now(), 'near_miss',
        'Trench box shifted while a laborer was in the trench', 'low', $2) as id`,
      [company, project])))[0]!.id;
  });

  it('starts open, which used to be permanent', async () => {
    const r = await row();
    expect(r.investigation_state).toBe('open');
    expect(r.is_open).toBe(true);
  });

  it('moves the investigation along', async () => {
    await h.asUser(OWNER, () => h.sql(
      `select public.update_safety_incident($1,'investigating')`, [incident]));
    expect((await row()).investigation_state).toBe('investigating');
  });

  it('refuses to close without a cause and an action', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.close_safety_incident($1,'oops','fixed it')`, [incident])))
      .rejects.toThrow(/Say what actually caused it/i);
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.close_safety_incident($1,
        'The trench box was never pinned and the spoil pile was too close to the edge','no')`,
      [incident]))).rejects.toThrow(/Say what was changed/i);
  });

  it('refuses to close a recordable with no OSHA case number', async () => {
    const rec = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_safety_incident($1, now(), 'medical_treatment',
        'Laborer struck by a swinging bucket', 'high', $2) as id`,
      [company, project])))[0]!.id;
    /* The constraint refuses a recordable with no case number; the function
       says so in words rather than naming a constraint. */
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.update_safety_incident($1, null, null, null, null, null, true)`,
      [rec]))).rejects.toThrow(/needs its OSHA case number/i);
  });

  it('closes with the cause and the action, and stops being open', async () => {
    await h.asUser(OWNER, () => h.sql(
      `select public.close_safety_incident($1,
        'The trench box was never pinned and the spoil pile sat inside the zone of influence',
        'Boxes pinned before entry and spoil set back six feet; added to the daily briefing')`,
      [incident]));
    const r = await row();
    expect(r.investigation_state).toBe('closed');
    expect(r.is_open).toBe(false);
    expect(r.days_open).toBeNull();
    expect(r.root_cause).toMatch(/zone of influence/);
  });

  it('will not reopen a closed investigation', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.update_safety_incident($1,'investigating')`, [incident])))
      .rejects.toThrow(/investigation is closed/i);
  });

  it('records a near miss, which nothing could do', async () => {
    const id = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.record_safety_observation($1,'excavation',
        'Spoil pile within three feet of the trench edge', false, true) as id`,
      [company])))[0]!.id;
    const [o] = await h.asUser(OWNER, () => h.sql<{
      category: string; corrected_on_site: boolean; is_positive: boolean;
    }>(`select category, corrected_on_site, is_positive
          from my_safety_observations where id = $1`, [id]));
    expect(o!.category).toBe('excavation');
    expect(o!.corrected_on_site).toBe(true);
    expect(o!.is_positive).toBe(false);
  });

  it('refuses a hazard written down and left', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.record_safety_observation($1,'fall_protection',
        'Nobody tied off on the second lift')`, [company])))
      .rejects.toThrow(/needs a fix on the spot or an action/i);
  });

  it('records a good catch without needing a corrective action', async () => {
    const id = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.record_safety_observation($1,'ppe',
        'Whole crew in hard hats and vests before the pre-task briefing', true) as id`,
      [company])))[0]!.id;
    const [o] = await h.asUser(OWNER, () => h.sql<{ is_positive: boolean }>(
      `select is_positive from my_safety_observations where id = $1`, [id]));
    expect(o!.is_positive).toBe(true);
  });
});

describe('a test that counts', () => {
  let h: Harness;
  let company = '';
  let project = '';
  let failed = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@qc.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@qc.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Qc Civil','qc-civil','enterprise') as id`)))[0]!.id;
    project = (await h.asService(() => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name) values ($1,'PRJ-2026-0501','Pad')
       returning id`, [company])))[0]!.id;
  });

  it('records a compaction test with what it measured', async () => {
    const id = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.record_inspection($1,'compaction','Subgrade density, station 12+50',
        'pass', '{"dry_density_pcf": 121.4, "percent_compaction": 96.2}'::jsonb,
        'Section 203.06', null, '12+50','Ohio Testing','OTL') as id`,
      [project])))[0]!.id;
    const [row] = await h.asUser(OWNER, () => h.sql<{
      number: string; result: string; result_values: Record<string, number>;
      inspecting_agency: string;
    }>(`select number, result, result_values, inspecting_agency
          from my_inspections where id = $1`, [id]));
    expect(row!.number).toMatch(/^INS-\d{4}-0001$/);
    expect(row!.result).toBe('pass');
    /* A pass with no numbers behind it is a word; the numbers are what an
       owner's engineer asks for. */
    expect(row!.result_values.percent_compaction).toBe(96.2);
    expect(row!.inspecting_agency).toBe('OTL');
  });

  it('refuses a failing test that does not say why', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.record_inspection($1,'compaction','Subgrade, station 13+00','fail')`,
      [project]))).rejects.toThrow(/failing test has to say why/i);
  });

  it('shows a failure nothing has retested, which leaves the work unaccepted', async () => {
    failed = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.record_inspection($1,'compaction','Subgrade, station 13+00','fail',
        '{"percent_compaction": 91.0}'::jsonb, null, null,'13+00', null, null, null,
        'Ninety-one percent against a ninety-five percent spec') as id`,
      [project])))[0]!.id;
    const [row] = await h.asUser(OWNER, () => h.sql<{
      failed_and_not_retested: boolean; retested_by: string | null;
    }>(`select failed_and_not_retested, retested_by from my_inspections where id = $1`,
      [failed]));
    expect(row!.failed_and_not_retested).toBe(true);
    expect(row!.retested_by).toBeNull();
  });

  it('a retest names the test it replaces, and clears the outstanding failure', async () => {
    await h.asUser(OWNER, () => h.sql(
      `select public.record_inspection($1,'compaction','Subgrade retest, station 13+00','pass',
        '{"percent_compaction": 97.1}'::jsonb, null, null,'13+00', null, null, null, null,
        now(), $2)`, [project, failed]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      failed_and_not_retested: boolean; retested_by: string;
    }>(`select failed_and_not_retested, retested_by from my_inspections where id = $1`,
      [failed]));
    expect(row!.failed_and_not_retested).toBe(false);
    expect(row!.retested_by).toMatch(/^INS-/);
  });

  it('records the result of a test that was pending', async () => {
    const id = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.record_inspection($1,'concrete','Footing break, 7 day') as id`,
      [project])))[0]!.id;
    await h.asUser(OWNER, () => h.sql(
      `select public.set_inspection_result($1,'pass','{"psi_7day": 3140}'::jsonb)`, [id]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      result: string; result_values: Record<string, number>;
    }>(`select result, result_values from my_inspections where id = $1`, [id]));
    expect(row!.result).toBe('pass');
    expect(row!.result_values.psi_7day).toBe(3140);
  });
});
