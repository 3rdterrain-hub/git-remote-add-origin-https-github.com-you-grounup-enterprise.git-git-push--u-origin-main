/**
 * Awarding a bid, through the door a browser can actually reach.
 *
 * `app.award_estimate_version` has existed since migration 0007 and does the
 * whole job: it creates the project from the version, copies every priced line
 * into `project_tasks` with its budgeted hours and cost, moves the estimate and
 * the version to `awarded`, and writes an audit event. It is granted to
 * `authenticated`. It is tested.
 *
 * It had no `public.` wrapper, so PostgREST could not see it, so no browser
 * could call it, so nothing in the application ever had. The Projects screen
 * says "A project appears here when an estimate is awarded, or when somebody
 * creates one", and the first half of that sentence was not true of any
 * deployment — which is why every screen downstream of it was reachable only by
 * inserting a project by hand.
 *
 * These tests cover the wrapper and the joint behind it: that the project
 * carries the bid, that the tasks carry the budget the earned-value view reads,
 * and that the refusals still refuse.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const RIVAL = '22222222-2222-4222-8222-222222222222';

describe('the door onto awarding', () => {
  let h: Harness;
  let company = '';
  let theirs = '';

  /** A priced version that the engine has cleared, ready to award. */
  async function readyVersion(number: string, opts: { blocked?: boolean } = {}) {
    return h.asUser(OWNER, async () => {
      const est = (await h.sql<{ id: string }>(
        `insert into estimates (company_id, number, name, site_address, site_city, site_state)
         values ($1,$2,'Sandusky transfer station','1400 Venice Rd','Sandusky','OH')
         returning id`, [company, number]))[0]!.id;
      const v = (await h.sql<{ id: string }>(
        `insert into estimate_versions (company_id, estimate_id, version_number, status)
         values ($1,$2,1,'draft') returning id`, [company, est]))[0]!.id;
      const line = (await h.sql<{ id: string }>(
        `insert into estimate_line_items
           (company_id, estimate_version_id, description, measured_quantity, adjusted_quantity,
            unit, sort_order)
         values ($1,$2,'Mass excavation',12500,12500,'CY',10) returning id`,
        [company, v]))[0]!.id;

      /*
       * Priced through `app.record_engine_result`, because migration 0058 makes
       * that the only writer of an engine output — and that is not a formality
       * here. The insert trigger forces every engine output back to its column
       * default, and `blocked_from_issue` defaults to `true`, so a version
       * becomes issuable only by being priced. A fixture that set the column
       * directly would be describing a state the product cannot reach.
       */
      await h.asService(() => h.sql(
        `select app.record_engine_result($1, 'engine-test', $2::jsonb, $3::jsonb)`,
        [v,
          JSON.stringify({
            direct_cost: 44728.91, total_price: 56805.72, bid_price: 56805.72,
            blocked_from_issue: opts.blocked ?? false,
          }),
          JSON.stringify([{
            id: line, total_direct_cost: 44728.91, total_price: 56805.72,
            labor_hours: 201, blocks_issue: opts.blocked ?? false,
          }])]));

      const snap = (await h.sql<{ id: string }>(
        `insert into library_snapshots (company_id, estimate_version_id, engine_version,
                                        entry_count, digest)
         values ($1,$2,'1.0.0',0,'0000000000000000') returning id`, [company, v]))[0]!.id;
      await h.sql(
        `update estimate_versions set library_snapshot_id = $2, status = 'approved'
          where id = $1`, [v, snap]);
      return v;
    });
  }

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [[OWNER, 'owner@ridge.test'], [RIVAL, 'rival@other.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, email]);
    }
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','professional') as id`)))[0]!.id;
    theirs = (await h.asUser(RIVAL, () => h.sql<{ id: string }>(
      `select app.provision_company('Other Co','other-co','professional') as id`)))[0]!.id;
  });

  afterAll(async () => { await h?.db.close(); });

  it('is reachable through public, which is the whole point of 0145', async () => {
    /*
     * PostgREST can only call `public`. Before the wrapper this exact statement
     * was the one a browser could not make, and that is the entire defect.
     */
    const v = await readyVersion('EST-AWARD-1');
    const [r] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.award_estimate_version($1,'PRJ-0001','Sandusky transfer station') as id`,
      [v]));
    expect(r!.id).toBeTruthy();

    const [p] = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
      `select number, name, status, contract_value, approved_budget,
              site_address, site_city, site_state, source_estimate_version_id
         from projects where id = $1`, [r!.id]));
    expect(p!.number).toBe('PRJ-0001');
    expect(p!.status).toBe('preconstruction');
    expect(Number(p!.contract_value)).toBeCloseTo(56805.72, 2);
    // The site comes forward from the estimate, which is what lets a project
    // have weather at the job rather than at the yard.
    expect(p!.site_city).toBe('Sandusky');
    expect(p!.source_estimate_version_id).toBe(v);
  });

  it('copies every priced line into the budget the earned-value view reads', async () => {
    const v = await readyVersion('EST-AWARD-2');
    const [r] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.award_estimate_version($1,'PRJ-0002','Second one') as id`, [v]));

    const [t] = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
      `select name, budgeted_quantity, unit, budgeted_hours, budgeted_cost, source_line_item_id
         from project_tasks where project_id = $1`, [r!.id]));
    expect(t!.name).toBe('Mass excavation');
    expect(Number(t!.budgeted_hours)).toBeCloseTo(201, 2);
    expect(Number(t!.budgeted_cost)).toBeCloseTo(44728.91, 2);
    expect(t!.source_line_item_id).toBeTruthy();

    /*
     * And the joint: `reporting_project_earned_value` reads exactly these
     * columns, so a freshly awarded project has a budget to earn against on the
     * day it is created rather than reading "nobody has broken this down".
     */
    const [ev] = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
      `select tasks, budgeted_cost, percent_complete
         from reporting_project_earned_value where project_id = $1`, [r!.id]));
    expect(Number(ev!.tasks)).toBe(1);
    expect(Number(ev!.budgeted_cost)).toBeCloseTo(44728.91, 2);
    // Nothing done yet, and the view says 0 rather than null: the denominator exists.
    expect(Number(ev!.percent_complete)).toBe(0);
  });

  it('marks the estimate and the version awarded, so the bid stops being live', async () => {
    const v = await readyVersion('EST-AWARD-3');
    await h.asUser(OWNER, () => h.sql(
      `select public.award_estimate_version($1,'PRJ-0003','Third one')`, [v]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ v: string; e: string }>(
      `select ev.status::text as v, e.status::text as e
         from estimate_versions ev join estimates e on e.id = ev.estimate_id
        where ev.id = $1`, [v]));
    expect(row!.v).toBe('awarded');
    expect(row!.e).toBe('awarded');
  });

  it('leaves a record of who won what', async () => {
    const v = await readyVersion('EST-AWARD-4');
    await h.asUser(OWNER, () => h.sql(
      `select public.award_estimate_version($1,'PRJ-0004','Fourth one')`, [v]));
    const [a] = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
      `select action, entity_table, reason from audit_events
        where entity_id = $1 and action = 'award'`, [v]));
    expect(a!.entity_table).toBe('public.estimate_versions');
    expect(String(a!.reason)).toMatch(/awarded and converted to a project/);
  });

  it('refuses a version the engine has not cleared', async () => {
    /*
     * The confidence gate reaches all the way here: a line nobody can price
     * with confidence cannot become a budget somebody is measured against.
     */
    const v = await readyVersion('EST-AWARD-5', { blocked: true });
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.award_estimate_version($1,'PRJ-0005','Blocked one')`, [v])))
      .rejects.toThrow(/blocking issue/);
  });

  it('refuses a draft, because a bid nobody approved is not a job', async () => {
    const v = await h.asUser(OWNER, async () => {
      const est = (await h.sql<{ id: string }>(
        `insert into estimates (company_id, number, name) values ($1,'EST-AWARD-6','Draft')
         returning id`, [company]))[0]!.id;
      return (await h.sql<{ id: string }>(
        `insert into estimate_versions (company_id, estimate_id, version_number, status)
         values ($1,$2,1,'draft') returning id`, [company, est]))[0]!.id;
    });
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.award_estimate_version($1,'PRJ-0006','Draft one')`, [v])))
      .rejects.toThrow(/only an approved or issued version may be awarded/);
  });

  it('shows another company nothing to award', async () => {
    const v = await readyVersion('EST-AWARD-7');
    // Row level security hides the version, so the function cannot find it.
    await expect(h.asUser(RIVAL, () => h.sql(
      `select public.award_estimate_version($1,'PRJ-9999','Not theirs')`, [v])))
      .rejects.toThrow();
    const rows = await h.asUser(RIVAL, () => h.sql<{ n: string }>(
      `select count(*)::text as n from projects where company_id = $1`, [theirs]));
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('is granted to a signed-in person and to nobody else', async () => {
    const [g] = await h.sql<{ authenticated: boolean; anon: boolean }>(
      `select has_function_privilege('authenticated',
                'public.award_estimate_version(uuid, text, text)', 'execute') as authenticated,
              has_function_privilege('anon',
                'public.award_estimate_version(uuid, text, text)', 'execute') as anon`);
    expect(g!.authenticated).toBe(true);
    expect(g!.anon).toBe(false);
  });
});
