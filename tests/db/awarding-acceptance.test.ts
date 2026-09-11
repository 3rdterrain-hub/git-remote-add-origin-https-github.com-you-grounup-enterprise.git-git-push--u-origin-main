/**
 * Award to project: the two acceptance scenarios, both required.
 *
 * The workflow was driven end to end against a live workspace and stopped at
 * the last step with "Project management is not included in Starter." That is
 * the platform being right, not a defect — so it is written down here as a
 * scenario that must keep passing, beside the entitled one that must also pass.
 * A build where either changes is a build that has moved something it should
 * not have.
 *
 *   * **Scenario A — Starter.** A tenant whose plan does not include `projects`
 *     cannot award, the refusal happens in the database rather than in a
 *     screen, the reason names the module and the plan, and nothing at all is
 *     written: no project, no tasks, no status change on the estimate.
 *   * **Scenario B — an entitled plan.** A tenant on a plan that includes
 *     `projects` awards successfully, and every claim the workflow makes is
 *     checked: the project carries the bid, every priced line becomes a
 *     budgeted task, the other tenant sees none of it, the entitlement is
 *     rechecked server-side rather than trusted from the client, and the action
 *     leaves an audit record naming who did it and to what.
 *
 * Neither scenario touches a plan or an entitlement to make itself pass. Each
 * tenant is provisioned on the plan its scenario is about, which is what a
 * controlled test tenant means.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/** The entitled tenant's owner. */
const PRO = '11111111-1111-4111-8111-111111111111';
/** The Starter tenant's owner — the live workspace's situation, reproduced. */
const STARTER = '22222222-2222-4222-8222-222222222222';
/** A third company, so isolation is checked against somebody real. */
const RIVAL = '33333333-3333-4333-8333-333333333333';

describe('award to project', () => {
  let h: Harness;
  let entitled = '';
  let starter = '';
  let rival = '';

  /**
   * A priced, approved version ready to award.
   *
   * Priced through `app.record_engine_result` because migration 0058 makes it
   * the only writer of an engine output, and the insert trigger forces
   * `blocked_from_issue` back to its default of `true` — so a version becomes
   * issuable only by being priced. A fixture that set the column directly would
   * describe a state the product cannot reach.
   */
  async function readyVersion(who: string, company: string, number: string) {
    return h.asUser(who, async () => {
      const customer = (await h.sql<{ id: string }>(
        `insert into customers (company_id, code, name)
         values ($1, $2, 'Wood County Engineering') returning id`,
        [company, `CUS-${number}`]))[0]!.id;
      const est = (await h.sql<{ id: string }>(
        `insert into estimates (company_id, customer_id, number, name,
                                site_address, site_city, site_state)
         values ($1,$2,$3,'Sandusky transfer station — site grading',
                 '1400 Venice Rd','Sandusky','OH') returning id`,
        [company, customer, number]))[0]!.id;
      const v = (await h.sql<{ id: string }>(
        `insert into estimate_versions (company_id, estimate_id, version_number, status)
         values ($1,$2,1,'draft') returning id`, [company, est]))[0]!.id;
      const line = (await h.sql<{ id: string }>(
        `insert into estimate_line_items
           (company_id, estimate_version_id, description, measured_quantity,
            adjusted_quantity, unit, sort_order)
         values ($1,$2,'Mass excavation',12500,12500,'CY',10) returning id`,
        [company, v]))[0]!.id;

      await h.asService(() => h.sql(
        `select app.record_engine_result($1, 'engine-test', $2::jsonb, $3::jsonb)`,
        [v,
          JSON.stringify({
            direct_cost: 44728.91, indirect_cost: 0,
            total_price: 56805.72, bid_price: 56805.72, blocked_from_issue: false,
          }),
          /*
           * `adjusted_quantity` is written here because it is an engine output
           * like every other: the insert trigger forced it back to 0, and it is
           * what `award_estimate_version` copies into `budgeted_quantity`. A
           * fixture that skipped it produced a project task budgeted for
           * nothing — and checking the live row is what showed that to be the
           * fixture's gap rather than the product's.
           */
          JSON.stringify([{
            id: line, adjusted_quantity: 12500, gross_quantity: 12500,
            total_direct_cost: 44728.91, total_price: 56805.72,
            labor_hours: 201, blocks_issue: false,
          }])]));

      const snap = (await h.sql<{ id: string }>(
        `insert into library_snapshots (company_id, estimate_version_id, engine_version,
                                        entry_count, digest)
         values ($1,$2,'1.0.0',0,'0000000000000000') returning id`, [company, v]))[0]!.id;
      await h.sql(
        `update estimate_versions set library_snapshot_id = $2, status = 'approved'
          where id = $1`, [v, snap]);
      return { versionId: v, estimateId: est, lineId: line, customerId: customer };
    });
  }

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [
      [PRO, 'pro@ridge.test'], [STARTER, 'starter@small.test'], [RIVAL, 'rival@other.test'],
    ] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, email]);
    }
    entitled = (await h.asUser(PRO, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline Excavating','ridgeline','grounup') as id`)))[0]!.id;
    starter = (await h.asUser(STARTER, () => h.sql<{ id: string }>(
      `select app.provision_company('Small Shop','small-shop','starter') as id`)))[0]!.id;
    rival = (await h.asUser(RIVAL, () => h.sql<{ id: string }>(
      `select app.provision_company('Other Co','other-co','grounup') as id`)))[0]!.id;
  });

  afterAll(async () => { await h?.db.close(); });

  // ==========================================================================
  // Scenario A — Starter. Blocked, and blocked for the right reason.
  // ==========================================================================
  describe('a plan without project management', () => {
    let version = '';
    let estimate = '';

    beforeAll(async () => {
      const ready = await readyVersion(STARTER, starter, 'EST-STARTER');
      version = ready.versionId;
      estimate = ready.estimateId;
    });

    it('is not entitled to projects, which is the premise of this scenario', async () => {
      const [e] = await h.asUser(STARTER, () => h.sql<{ ok: boolean }>(
        `select app.has_entitlement($1, 'projects') as ok`, [starter]));
      expect(e!.ok).toBe(false);
      // And it *is* entitled to the estimating half, so the block is specific
      // rather than a tenant with no entitlement at all.
      const [est] = await h.asUser(STARTER, () => h.sql<{ ok: boolean }>(
        `select app.has_entitlement($1, 'estimating') as ok`, [starter]));
      expect(est!.ok).toBe(true);
    });

    it('refuses the award in the database, not in a screen', async () => {
      /*
       * Called through the same `public` function the browser calls. A gate
       * that only lived in the UI would be no gate: the wrapper is reachable by
       * anybody with a session and a fetch.
       */
      await expect(h.asUser(STARTER, () => h.sql(
        `select public.award_estimate_version($1,'PRJ-0001','Sandusky transfer station')`,
        [version]))).rejects.toThrow(/Project management is not included/);
    });

    it('names the module and the plan, so the reason is actionable', async () => {
      await expect(h.asUser(STARTER, () => h.sql(
        `select public.award_estimate_version($1,'PRJ-0001','Sandusky')`, [version])))
        .rejects.toThrow(/Project management is not included in Starter\./);
    });

    it('writes nothing at all — no project, no tasks', async () => {
      /*
       * The whole transaction fails, so a refusal cannot leave a project number
       * consumed or a half-built budget behind.
       */
      const [p] = await h.asUser(STARTER, () => h.sql<{ n: string }>(
        `select count(*)::text as n from projects where company_id = $1`, [starter]));
      expect(Number(p!.n)).toBe(0);
      const [t] = await h.asUser(STARTER, () => h.sql<{ n: string }>(
        `select count(*)::text as n from project_tasks where company_id = $1`, [starter]));
      expect(Number(t!.n)).toBe(0);
    });

    it('leaves the estimate approved and still winnable', async () => {
      // A refused award is not a lost bid. The version keeps its status so the
      // moment the plan includes projects the same button works.
      const [row] = await h.asUser(STARTER, () => h.sql<{ v: string; e: string }>(
        `select ev.status::text as v, e.status::text as e
           from estimate_versions ev join estimates e on e.id = ev.estimate_id
          where ev.id = $1`, [version]));
      expect(row!.v).toBe('approved');
      expect(row!.e).not.toBe('awarded');
      expect(estimate).toBeTruthy();
    });

    it('keeps everything the company already built readable', async () => {
      // 0077's gate is INSERT-only on purpose: a module you do not pay for is
      // one you cannot start something new in, never one that hides your work.
      const rows = await h.asUser(STARTER, () => h.sql<{ n: string }>(
        `select count(*)::text as n from estimate_line_items where company_id = $1`, [starter]));
      expect(Number(rows[0]!.n)).toBe(1);
    });
  });

  // ==========================================================================
  // Scenario B — a plan that includes project management.
  // ==========================================================================
  describe('a plan with project management', () => {
    let version = '';
    let estimate = '';
    let lineId = '';
    let customerId = '';
    let projectId = '';

    beforeAll(async () => {
      const ready = await readyVersion(PRO, entitled, 'EST-PRO');
      version = ready.versionId;
      estimate = ready.estimateId;
      lineId = ready.lineId;
      customerId = ready.customerId;
      const [r] = await h.asUser(PRO, () => h.sql<{ id: string }>(
        `select public.award_estimate_version($1,'PRJ-2026-0003',
                 'Sandusky transfer station — site grading') as id`, [version]));
      projectId = r!.id;
    });

    it('creates the project', async () => {
      expect(projectId).toBeTruthy();
      const [p] = await h.asUser(PRO, () => h.sql<Record<string, unknown>>(
        `select number, name, status, company_id from projects where id = $1`, [projectId]));
      expect(p!.number).toBe('PRJ-2026-0003');
      expect(p!.status).toBe('preconstruction');
      expect(p!.company_id).toBe(entitled);
    });

    it('carries the approved estimate across without re-entry', async () => {
      /*
       * Every figure the project is measured against comes from the version
       * that was approved, not from anything typed again. `bid_price` becomes
       * the contract value; direct plus indirect becomes the budget; the site
       * and the customer come forward so the project knows where it is and who
       * it is for.
       */
      const [p] = await h.asUser(PRO, () => h.sql<Record<string, unknown>>(
        `select contract_value, original_budget, approved_budget, customer_id,
                site_address, site_city, site_state, source_estimate_version_id
           from projects where id = $1`, [projectId]));
      expect(Number(p!.contract_value)).toBeCloseTo(56805.72, 2);
      expect(Number(p!.original_budget)).toBeCloseTo(44728.91, 2);
      expect(Number(p!.approved_budget)).toBeCloseTo(44728.91, 2);
      expect(p!.customer_id).toBe(customerId);
      expect(p!.site_address).toBe('1400 Venice Rd');
      expect(p!.site_city).toBe('Sandusky');
      expect(p!.site_state).toBe('OH');
      // Which priced version this job came from, so "what did we bid this at"
      // has one answer rather than a search.
      expect(p!.source_estimate_version_id).toBe(version);
    });

    it('turns every priced line into a budgeted task keyed back to its source', async () => {
      const rows = await h.asUser(PRO, () => h.sql<Record<string, unknown>>(
        `select name, budgeted_quantity, unit, budgeted_hours, budgeted_cost,
                source_line_item_id, sort_order, percent_complete, status
           from project_tasks where project_id = $1 order by sort_order`, [projectId]));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.name).toBe('Mass excavation');
      expect(Number(rows[0]!.budgeted_quantity)).toBeCloseTo(12500, 4);
      expect(rows[0]!.unit).toBe('CY');
      expect(Number(rows[0]!.budgeted_hours)).toBeCloseTo(201, 2);
      expect(Number(rows[0]!.budgeted_cost)).toBeCloseTo(44728.91, 2);
      expect(rows[0]!.source_line_item_id).toBe(lineId);
      // Nothing is claimed as started by the act of winning the job.
      expect(Number(rows[0]!.percent_complete)).toBe(0);
      expect(rows[0]!.status).toBe('not_started');
    });

    it('gives the project a budget the earned-value view can read on day one', async () => {
      const [ev] = await h.asUser(PRO, () => h.sql<Record<string, unknown>>(
        `select tasks, budgeted_cost, budgeted_hours, percent_complete,
                cost_performance_index
           from reporting_project_earned_value where project_id = $1`, [projectId]));
      expect(Number(ev!.tasks)).toBe(1);
      expect(Number(ev!.budgeted_cost)).toBeCloseTo(44728.91, 2);
      expect(Number(ev!.budgeted_hours)).toBeCloseTo(201, 2);
      // 0% complete, not "nobody has broken this down" — the denominator exists.
      expect(Number(ev!.percent_complete)).toBe(0);
      // Nothing spent yet, so CPI has no denominator and is null rather than 0.
      expect(ev!.cost_performance_index).toBeNull();
    });

    it('marks the estimate and the version awarded', async () => {
      const [row] = await h.asUser(PRO, () => h.sql<{ v: string; e: string }>(
        `select ev.status::text as v, e.status::text as e
           from estimate_versions ev join estimates e on e.id = ev.estimate_id
          where ev.id = $1`, [version]));
      expect(row!.v).toBe('awarded');
      expect(row!.e).toBe('awarded');
      expect(estimate).toBeTruthy();
    });

    // ------------------------------------------------------------- isolation
    it('shows the other company none of it', async () => {
      const projects = await h.asUser(RIVAL, () => h.sql<{ id: string }>(
        `select id from projects`));
      expect(projects.map((p) => p.id)).not.toContain(projectId);

      const tasks = await h.asUser(RIVAL, () => h.sql<{ n: string }>(
        `select count(*)::text as n from project_tasks`));
      expect(Number(tasks[0]!.n)).toBe(0);

      const mine = await h.asUser(RIVAL, () => h.sql<{ id: string }>(
        `select id from my_project`));
      expect(mine.map((p) => p.id)).not.toContain(projectId);
    });

    it('refuses the other company awarding this version, entitled or not', async () => {
      /*
       * `other-co` is on the same entitled plan, so a refusal here is tenancy
       * and nothing else: row level security hides the version, and a function
       * that cannot see a row cannot award it.
       */
      const [e] = await h.asUser(RIVAL, () => h.sql<{ ok: boolean }>(
        `select app.has_entitlement($1, 'projects') as ok`, [rival]));
      expect(e!.ok).toBe(true);
      await expect(h.asUser(RIVAL, () => h.sql(
        `select public.award_estimate_version($1,'PRJ-9999','Not theirs')`, [version])))
        .rejects.toThrow();
      const [n] = await h.asUser(RIVAL, () => h.sql<{ n: string }>(
        `select count(*)::text as n from projects where company_id = $1`, [rival]));
      expect(Number(n!.n)).toBe(0);
    });

    it('refuses an anonymous caller outright', async () => {
      await expect(h.asAnon(() => h.sql(
        `select public.award_estimate_version($1,'PRJ-0000','Nobody')`, [version])))
        .rejects.toThrow();
    });

    // ------------------------------------------------------------- the audit
    it('records who awarded what, and to which project', async () => {
      const [a] = await h.asUser(PRO, () => h.sql<Record<string, unknown>>(
        `select actor_id, action, entity_table, entity_id, new_state, reason, company_id
           from audit_events where entity_id = $1 and action = 'award'`, [version]));
      expect(a).toBeDefined();
      expect(a!.actor_id).toBe(PRO);
      expect(a!.company_id).toBe(entitled);
      expect(a!.entity_table).toBe('public.estimate_versions');
      expect(String(a!.reason)).toMatch(/awarded and converted to a project/);
      const state = a!.new_state as Record<string, unknown>;
      expect(state.project_id).toBe(projectId);
      expect(state.project_number).toBe('PRJ-2026-0003');
    });

    it('keeps the audit record out of the other company’s reach', async () => {
      const rows = await h.asUser(RIVAL, () => h.sql<{ id: string }>(
        `select entity_id as id from audit_events where action = 'award'`));
      expect(rows.map((r) => r.id)).not.toContain(version);
    });
  });

  // ==========================================================================
  // The entitlement is rechecked where it cannot be bypassed.
  // ==========================================================================
  describe('the entitlement is checked server-side', () => {
    it('refuses even when nothing in a browser was involved', async () => {
      /*
       * The Starter tenant never sees a Mark as won button, but a button is not
       * a control. This is the same refusal reached by SQL with no application
       * between, which is the only version of the check that means anything.
       */
      const ready = await readyVersion(STARTER, starter, 'EST-STARTER-2');
      await expect(h.asUser(STARTER, () => h.sql(
        `select public.award_estimate_version($1,'PRJ-DIRECT','Straight at the database')`,
        [ready.versionId]))).rejects.toThrow(/not included in/);
    });

    it('refuses an INSERT into projects made by hand, which is the same door', async () => {
      // Awarding is gated because `projects` is gated. Somebody who skipped the
      // function entirely meets the same trigger.
      await expect(h.asUser(STARTER, () => h.sql(
        `insert into projects (company_id, number, name) values ($1,'PRJ-BYHAND','Sneaking in')`,
        [starter]))).rejects.toThrow(/Project management is not included/);
    });

    it('lets the entitled tenant do exactly that, so the gate is the entitlement', async () => {
      const [p] = await h.asUser(PRO, () => h.sql<{ id: string }>(
        `insert into projects (company_id, number, name)
         values ($1,'PRJ-BYHAND','Allowed here') returning id`, [entitled]));
      expect(p!.id).toBeTruthy();
    });
  });
});
