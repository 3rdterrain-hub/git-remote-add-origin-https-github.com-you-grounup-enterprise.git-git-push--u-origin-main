import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Tenant isolation, proven against real PostgreSQL row level security.
 *
 * The fixture builds two unrelated companies plus a third user who legitimately
 * belongs to both, because that third case is where naive isolation designs
 * break: RLS alone happily lets a dual-member attach company A's child row to
 * company B's parent.
 */
describe('row level security', () => {
  let h: Harness;

  // Fixture identifiers.
  const alice = '11111111-1111-4111-8111-111111111111'; // owner of Ridgeline
  const bob   = '22222222-2222-4222-8222-222222222222'; // owner of Kesler
  const dana  = '33333333-3333-4333-8333-333333333333'; // member of BOTH
  const vic   = '44444444-4444-4444-8444-444444444444'; // viewer at Ridgeline
  let ridgeline = '';
  let kesler = '';
  let ridgelineEstimate = '';
  let ridgelineVersion = '';
  let keslerVersion = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });

    // Setup runs as superuser, which bypasses RLS — this is fixture creation,
    // not the behavior under test.
    await h.sql(`insert into auth.users (id, email) values
      ($1,'alice@ridgeline.test'), ($2,'bob@kesler.test'), ($3,'dana@shared.test'), ($4,'vic@ridgeline.test')`,
      [alice, bob, dana, vic]);
    await h.sql(`insert into user_profiles (id, email, full_name) values
      ($1,'alice@ridgeline.test','Alice Okafor'), ($2,'bob@kesler.test','Bob Ferreira'),
      ($3,'dana@shared.test','Dana Whitfield'), ($4,'vic@ridgeline.test','Vic Nakamura')`,
      [alice, bob, dana, vic]);

    ridgeline = (await h.asUser(alice, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline Excavating','ridgeline','professional') as id`),
    ))[0]!.id;
    kesler = (await h.asUser(bob, () =>
      h.sql<{ id: string }>(`select app.provision_company('Kesler Site Works','kesler','professional') as id`),
    ))[0]!.id;

    const estimatorRole = (await h.sql<{ id: string }>(`select id from roles where key='estimator' and company_id is null`))[0]!.id;
    const viewerRole = (await h.sql<{ id: string }>(`select id from roles where key='viewer' and company_id is null`))[0]!.id;

    // Dana genuinely works for both companies.
    await h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status, joined_at)
       values ($1,$2,$3,'active',now()), ($4,$2,$3,'active',now())`,
      [ridgeline, dana, estimatorRole, kesler]);
    await h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status, joined_at)
       values ($1,$2,$3,'active',now())`, [ridgeline, vic, viewerRole]);

    // One estimate per company.
    await h.asUser(alice, async () => {
      const est = await h.sql<{ id: string }>(
        `insert into estimates (company_id, number, name) values ($1,'EST-1001','Ridgeline mass grading') returning id`,
        [ridgeline]);
      ridgelineEstimate = est[0]!.id;
      const v = await h.sql<{ id: string }>(
        `insert into estimate_versions (company_id, estimate_id, version_number) values ($1,$2,1) returning id`,
        [ridgeline, ridgelineEstimate]);
      ridgelineVersion = v[0]!.id;
      await h.sql(`insert into customers (company_id, code, name) values ($1,'CUST-001','Toledo Development Group')`, [ridgeline]);
    });

    await h.asUser(bob, async () => {
      const est = await h.sql<{ id: string }>(
        `insert into estimates (company_id, number, name) values ($1,'EST-9001','Kesler utilities') returning id`,
        [kesler]);
      const v = await h.sql<{ id: string }>(
        `insert into estimate_versions (company_id, estimate_id, version_number) values ($1,$2,1) returning id`,
        [kesler, est[0]!.id]);
      keslerVersion = v[0]!.id;
      await h.sql(`insert into customers (company_id, code, name) values ($1,'CUST-900','Kesler Client LLC')`, [kesler]);
    });
  });

  afterAll(async () => { await h?.db.close(); });

  // ---------------------------------------------------------------------------
  describe('every public table is protected', () => {
    it('has a security gate that actually fails when a table is left open', async () => {
      // The gate is the safety net for the whole isolation design, so it is
      // tested directly rather than trusted. Adding an unprotected table must
      // break the deployment.
      await h.sql(`create table gate_probe (id int primary key, company_id uuid)`);
      await expect(h.sql(`select app.assert_security_gates()`))
        .rejects.toThrow(/RLS coverage gate failed.*gate_probe/s);

      await h.sql(`alter table gate_probe enable row level security`);
      await h.sql(`alter table gate_probe force row level security`);
      await expect(h.sql(`select app.assert_security_gates()`)).resolves.toBeDefined();

      // And it catches a table exposed to the anonymous role.
      await h.sql(`grant select on gate_probe to anon`);
      await expect(h.sql(`select app.assert_security_gates()`))
        .rejects.toThrow(/Privilege gate failed.*gate_probe/s);

      await h.sql(`drop table gate_probe`);
      await expect(h.sql(`select app.assert_security_gates()`)).resolves.toBeDefined();
    });

    it('enables and forces RLS on every table without exception', async () => {
      const rows = await h.sql<{ table_name: string; rls_enabled: boolean; rls_forced: boolean }>(
        `select * from rls_coverage`);
      expect(rows.length).toBeGreaterThan(50);
      const unprotected = rows.filter((r) => !r.rls_enabled || !r.rls_forced);
      expect(unprotected).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  describe('cross-tenant reads', () => {
    it('shows a company only its own estimates', async () => {
      const mine = await h.asUser(alice, () => h.sql<{ number: string }>(`select number from estimates`));
      expect(mine.map((r) => r.number)).toEqual(['EST-1001']);

      const theirs = await h.asUser(bob, () => h.sql<{ number: string }>(`select number from estimates`));
      expect(theirs.map((r) => r.number)).toEqual(['EST-9001']);
    });

    it('returns nothing when one company queries another by primary key', async () => {
      // The row exists; RLS makes it invisible rather than erroring, which is
      // what stops an attacker from probing for valid ids.
      const probe = await h.asUser(bob, () =>
        h.sql(`select id from estimates where id = $1`, [ridgelineEstimate]));
      expect(probe).toEqual([]);
    });

    it('isolates customers, versions, documents and projects the same way', async () => {
      const counts = await h.asUser(bob, () => h.sql<{ c: number }>(`
        select (select count(*) from customers where company_id = $1)
             + (select count(*) from estimate_versions where company_id = $1)
             + (select count(*) from estimates where company_id = $1) as c`, [ridgeline]));
      expect(counts[0]!.c).toBe(0);
    });

    it('denies an anonymous request at the privilege layer, before RLS is even consulted', async () => {
      // Two independent controls: anon holds no GRANT on business tables, so
      // the request is refused outright rather than returning an empty set that
      // depended on a policy being correct.
      await expect(h.asAnon(() => h.sql(`select id from estimates`)))
        .rejects.toThrow(/permission denied for table estimates/);
      await expect(h.asAnon(() => h.sql(`select id from customers`)))
        .rejects.toThrow(/permission denied for table customers/);
      await expect(h.asAnon(() => h.sql(`select id from audit_events`)))
        .rejects.toThrow(/permission denied/);
    });

    it('still lets an anonymous visitor read the public plan catalog', async () => {
      const plans = await h.asAnon(() => h.sql<{ id: string }>(`select id from plans order by sort_order`));
      expect(plans.map((p) => p.id)).toEqual(['starter', 'professional', 'business', 'enterprise']);
      // The non-public partner plan is not exposed.
      expect(plans.map((p) => p.id)).not.toContain('partner_white_label');
    });
  });

  // ---------------------------------------------------------------------------
  describe('cross-tenant writes', () => {
    it('refuses to insert a row into a company the user does not belong to', async () => {
      await expect(
        h.asUser(bob, () =>
          h.sql(`insert into customers (company_id, code, name) values ($1,'HACK','Injected')`, [ridgeline])),
      ).rejects.toThrow(/row-level security/i);
    });

    it('refuses to move a row to another tenant by updating company_id', async () => {
      // The USING clause hides the row, so the update matches nothing rather
      // than succeeding — either outcome is safe, but zero rows is the truth.
      const before = await h.sql<{ c: number }>(
        `select count(*)::int c from customers where company_id = $1`, [kesler]);
      await h.asUser(alice, () =>
        h.sql(`update customers set company_id = $1 where code = 'CUST-001'`, [kesler]),
      ).catch(() => undefined);
      const after = await h.sql<{ c: number }>(
        `select count(*)::int c from customers where company_id = $1`, [kesler]);
      expect(after[0]!.c).toBe(before[0]!.c);
    });

    it('refuses to delete another tenant\'s row', async () => {
      await h.asUser(bob, () => h.sql(`delete from estimates where id = $1`, [ridgelineEstimate]));
      const stillThere = await h.sql<{ c: number }>(
        `select count(*)::int c from estimates where id = $1`, [ridgelineEstimate]);
      expect(stillThere[0]!.c).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  describe('the dual-member case', () => {
    it('lets a legitimate dual member see both companies', async () => {
      const rows = await h.asUser(dana, () => h.sql<{ number: string }>(`select number from estimates order by number`));
      expect(rows.map((r) => r.number)).toEqual(['EST-1001', 'EST-9001']);
    });

    it('blocks a dual member from attaching one company\'s line to the other\'s estimate', async () => {
      // Both company ids pass RLS for Dana, so only the structural tenant-parent
      // guard catches this. Without it the line would be created successfully.
      await expect(
        h.asUser(dana, () =>
          h.sql(
            `insert into estimate_line_items (company_id, estimate_version_id, description, measured_quantity, unit)
             values ($1, $2, 'Cross-tenant line', 100, 'CY')`,
            [kesler, ridgelineVersion]),
        ),
      ).rejects.toThrow(/Tenant boundary violation/);
    });

    it('allows the same insert when the parent really does belong to that company', async () => {
      const rows = await h.asUser(dana, () =>
        h.sql<{ id: string }>(
          `insert into estimate_line_items (company_id, estimate_version_id, description, measured_quantity, unit)
           values ($1, $2, 'Legitimate line', 100, 'CY') returning id`,
          [kesler, keslerVersion]));
      expect(rows).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  describe('permissions inside a company', () => {
    it('lets a viewer read', async () => {
      const rows = await h.asUser(vic, () => h.sql<{ number: string }>(`select number from estimates`));
      expect(rows.map((r) => r.number)).toEqual(['EST-1001']);
    });

    it('stops a viewer from writing an estimate', async () => {
      await expect(
        h.asUser(vic, () =>
          h.sql(`insert into estimates (company_id, number, name) values ($1,'EST-BAD','Viewer wrote this')`, [ridgeline])),
      ).rejects.toThrow(/row-level security/i);
    });

    it('stops a viewer from editing the master library', async () => {
      await expect(
        h.asUser(vic, () =>
          h.sql(`insert into labor_rates (company_id, code, classification, base_wage_per_hour)
                 values ($1,'LAB-X','Invented',1)`, [ridgeline])),
      ).rejects.toThrow(/row-level security/i);
    });

    it('reports the approval tier each role actually holds', async () => {
      expect((await h.asUser(alice, () => h.sql<{ t: number }>(`select app.approval_tier($1) t`, [ridgeline])))[0]!.t).toBe(4);
      expect((await h.asUser(dana, () => h.sql<{ t: number }>(`select app.approval_tier($1) t`, [ridgeline])))[0]!.t).toBe(1);
      expect((await h.asUser(vic, () => h.sql<{ t: number }>(`select app.approval_tier($1) t`, [ridgeline])))[0]!.t).toBe(0);
      // A user with no membership in a company holds no tier there.
      expect((await h.asUser(bob, () => h.sql<{ t: number }>(`select app.approval_tier($1) t`, [ridgeline])))[0]!.t).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('three-tier library scope', () => {
    it('lets every tenant read the GrounUp global seed', async () => {
      const a = await h.asUser(alice, () => h.sql<{ c: number }>(`select count(*)::int c from services where company_id is null`));
      const b = await h.asUser(bob, () => h.sql<{ c: number }>(`select count(*)::int c from services where company_id is null`));
      expect(a[0]!.c).toBe(188);
      expect(b[0]!.c).toBe(188);
    });

    it('stops a tenant from editing the global seed', async () => {
      await h.asUser(alice, () =>
        h.sql(`update production_rates set rate_per_hour = 9999 where company_id is null and code = 'PR-000001'`));
      const [row] = await h.sql<{ r: string }>(`select rate_per_hour r from production_rates where code = 'PR-000001'`);
      expect(Number(row!.r)).not.toBe(9999);
    });

    it('stops a tenant from inserting a global-scope library row', async () => {
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into services (code, name, default_unit, supported_units)
                 values ('SVC-FAKE','Injected global service','LS', array['LS']::app.unit_code[])`)),
      ).rejects.toThrow(/row-level security/i);
    });

    it('lets a company create and edit its own override', async () => {
      const rows = await h.asUser(alice, () =>
        h.sql<{ id: string }>(
          // Created as a draft: a live company row must name who approved it
          // (migration 0028), and this test is about tenant scope, not approval.
          `insert into production_rates (company_id, code, rate_per_hour, rate_unit, source_type, sample_size, status)
           values ($1,'PR-RIDGE-01', 165, 'CY', 'company_actual', 12, 'draft') returning id`, [ridgeline]));
      expect(rows).toHaveLength(1);
      // And the other tenant cannot see it.
      const seen = await h.asUser(bob, () =>
        h.sql(`select id from production_rates where code = 'PR-RIDGE-01'`));
      expect(seen).toEqual([]);
    });

    it('refuses a company_actual rate with no measured sample behind it', async () => {
      await expect(
        h.asUser(alice, () =>
          // Draft, so the provenance rule is the one under test rather than
          // the approval rule preempting it.
          h.sql(`insert into production_rates (company_id, code, rate_per_hour, rate_unit, source_type, sample_size, status)
                 values ($1,'PR-RIDGE-02', 800, 'CY', 'company_actual', 0, 'draft')`, [ridgeline])),
      ).rejects.toThrow(/production_rates_provenance/);
    });
  });

  // ---------------------------------------------------------------------------
  describe('billing state cannot be granted from the browser', () => {
    it('gives no tenant role any way to insert a subscription', async () => {
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into subscriptions (company_id, plan_id, stripe_customer_id, status)
                 values ($1,'enterprise','cus_forged','active')`, [ridgeline])),
      ).rejects.toThrow(/row-level security/i);
    });

    it('gives no tenant role any way to grant itself an entitlement', async () => {
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into entitlements (company_id, plan_id, is_active, features, source)
                 values ($1,'enterprise',true,array['*'],'stripe_webhook')`, [ridgeline])),
      ).rejects.toThrow(/row-level security/i);
    });

    it('gives no tenant role any way to upgrade an existing entitlement', async () => {
      await h.asUser(alice, () =>
        h.sql(`update entitlements set features = array['*'], plan_id = 'enterprise' where company_id = $1`, [ridgeline]));
      const [row] = await h.sql<{ plan_id: string }>(`select plan_id from entitlements where company_id = $1`, [ridgeline]);
      expect(row!.plan_id).toBe('professional');
    });

    it('hides raw Stripe payloads from every tenant role', async () => {
      await h.sql(`insert into stripe_events (id, type, payload) values ('evt_test','customer.subscription.updated','{}'::jsonb)`);
      const rows = await h.asUser(alice, () => h.sql(`select id from stripe_events`));
      expect(rows).toEqual([]);
    });

    it('rejects a duplicate Stripe event id, which is what makes replay safe', async () => {
      await expect(
        h.sql(`insert into stripe_events (id, type, payload) values ('evt_test','customer.subscription.updated','{}'::jsonb)`),
      ).rejects.toThrow(/duplicate key/);
    });

    it('separates entitlement from authorization', async () => {
      // Vic's company is entitled to projects, but Vic personally is not
      // permitted to write them. Paying for a feature is never a permission.
      const [ent] = await h.asUser(vic, () =>
        h.sql<{ e: boolean }>(`select app.has_entitlement($1,'projects') e`, [ridgeline]));
      const [can] = await h.asUser(vic, () =>
        h.sql<{ c: boolean }>(`select app.can_use($1,'projects','projects.write') c`, [ridgeline]));
      expect(ent!.e).toBe(true);
      expect(can!.c).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  describe('the audit ledger', () => {
    it('records every governed write automatically', async () => {
      const rows = await h.sql<{ c: number }>(
        `select count(*)::int c from audit_events where company_id = $1 and entity_table = 'public.estimates'`,
        [ridgeline]);
      expect(rows[0]!.c).toBeGreaterThan(0);
    });

    it('captures the prior and new state of an update', async () => {
      await h.asUser(alice, () =>
        h.sql(`update estimates set name = 'Ridgeline mass grading — rev A' where id = $1`, [ridgelineEstimate]));
      const [ev] = await h.sql<{ prior_state: any; new_state: any; action: string }>(
        `select action, prior_state, new_state from audit_events
         where entity_id = $1 and action = 'update' order by id desc limit 1`, [ridgelineEstimate]);
      expect(ev!.prior_state.name).toBe('Ridgeline mass grading');
      expect(ev!.new_state.name).toBe('Ridgeline mass grading — rev A');
    });

    it('does not record an update that changed nothing', async () => {
      const before = await h.sql<{ c: number }>(
        `select count(*)::int c from audit_events where entity_id = $1`, [ridgelineEstimate]);
      await h.asUser(alice, () =>
        h.sql(`update estimates set name = name where id = $1`, [ridgelineEstimate]));
      const after = await h.sql<{ c: number }>(
        `select count(*)::int c from audit_events where entity_id = $1`, [ridgelineEstimate]);
      expect(after[0]!.c).toBe(before[0]!.c);
    });

    it('cannot be rewritten, even by a superuser', async () => {
      await expect(h.sql(`update audit_events set reason = 'tampered' where id = (select min(id) from audit_events)`))
        .rejects.toThrow(/append-only/);
      await expect(h.sql(`delete from audit_events where id = (select min(id) from audit_events)`))
        .rejects.toThrow(/append-only/);
    });

    it('is not readable across tenants', async () => {
      const rows = await h.asUser(bob, () =>
        h.sql(`select id from audit_events where company_id = $1`, [ridgeline]));
      expect(rows).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  describe('estimate version immutability (RULE-009)', () => {
    it('allows edits while the version is a draft', async () => {
      await h.asUser(alice, () =>
        h.sql(`update estimate_versions set direct_cost = 12500 where id = $1`, [ridgelineVersion]));
      const [v] = await h.sql<{ direct_cost: string }>(`select direct_cost from estimate_versions where id = $1`, [ridgelineVersion]);
      expect(Number(v!.direct_cost)).toBe(12500);
    });

    it('freezes the priced content once the version is issued', async () => {
      // Issuing now requires the library snapshot that priced it: an issued
      // price the platform cannot reproduce is not a record of anything.
      await h.asUser(alice, async () => {
        const snap = (await h.sql<{ id: string }>(
          `insert into library_snapshots (company_id, estimate_version_id, engine_version, entry_count, digest)
           values ((select company_id from estimate_versions where id = $1), $1, '1.0.0', 0, '0000000000000000')
           returning id`, [ridgelineVersion]))[0]!.id;
        await h.sql(`update estimate_versions set library_snapshot_id = $2 where id = $1`,
          [ridgelineVersion, snap]);
      });
      await h.asUser(alice, () =>
        h.sql(`update estimate_versions set status = 'issued', issued_at = now(), blocked_from_issue = false where id = $1`,
          [ridgelineVersion]));
      await expect(
        h.asUser(alice, () =>
          h.sql(`update estimate_versions set direct_cost = 1 where id = $1`, [ridgelineVersion])),
      ).rejects.toThrow(/immutable \(RULE-009\)/);
    });

    it('still allows the commercial outcome to be recorded', async () => {
      await h.asUser(alice, () =>
        h.sql(`update estimate_versions set status = 'awarded' where id = $1`, [ridgelineVersion]));
      const [v] = await h.sql<{ status: string }>(`select status from estimate_versions where id = $1`, [ridgelineVersion]);
      expect(v!.status).toBe('awarded');
    });

    it('refuses to walk an issued version back to draft', async () => {
      await expect(
        h.asUser(alice, () =>
          h.sql(`update estimate_versions set status = 'draft' where id = $1`, [ridgelineVersion])),
      ).rejects.toThrow(/cannot move from/);
    });

    it('creates a new version instead, carrying the lines across', async () => {
      await h.asUser(alice, async () => {
        await h.sql(`insert into estimate_line_items (company_id, estimate_version_id, description, measured_quantity, unit, sort_order)
                     values ($1,$2,'Mass excavation',10000,'CY',1)`, [ridgeline, ridgelineVersion]);
      });
      const [rev] = await h.asUser(alice, () =>
        h.sql<{ id: string }>(`select app.revise_estimate_version($1, 'Addendum 2 changed the grading limits') as id`,
          [ridgelineVersion]));
      const [v] = await h.sql<{ version_number: number; revision_reason: string; status: string }>(
        `select version_number, revision_reason, status from estimate_versions where id = $1`, [rev!.id]);
      expect(v!.version_number).toBe(2);
      expect(v!.status).toBe('draft');
      expect(v!.revision_reason).toContain('Addendum 2');

      const lines = await h.sql<{ description: string; origin: string }>(
        `select description, origin from estimate_line_items where estimate_version_id = $1`, [rev!.id]);
      expect(lines).toHaveLength(1);
      expect(lines[0]!.description).toBe('Mass excavation');
      expect(lines[0]!.origin).toBe('copied');
    });

    it('requires a revision to state why it exists', async () => {
      await expect(
        h.asUser(alice, () => h.sql(`select app.revise_estimate_version($1, 'x')`, [ridgelineVersion])),
      ).rejects.toThrow(/must state why it exists/);
    });
  });

  // ---------------------------------------------------------------------------
  describe('AI governance (RULE-008)', () => {
    let findingId = '';

    it('accepts an AI finding only in the proposed state', async () => {
      const rows = await h.asUser(dana, () =>
        h.sql<{ id: string }>(
          `insert into ai_findings (company_id, agent_id, finding_type, title, description, citations, confidence)
           values ($1,'AGT-TAKEOFF','quantity_candidate','Mass excavation quantity',
                   'Cut volume derived from the C-210 cross sections.',
                   '[{"sheet":"C-210","note":"Sta. 10+00-18+50"}]'::jsonb, 88)
           returning id`, [ridgeline]));
      findingId = rows[0]!.id;
      expect(findingId).toBeTruthy();
    });

    it('refuses a factual finding with no citation', async () => {
      await expect(
        h.asUser(dana, () =>
          h.sql(`insert into ai_findings (company_id, agent_id, finding_type, title, description, confidence)
                 values ($1,'AGT-TAKEOFF','quantity_candidate','Uncited','No source', 95)`, [ridgeline])),
      ).rejects.toThrow(/ai_findings_citations/);
    });

    it('refuses a finding that tries to be born accepted', async () => {
      await expect(
        h.asUser(dana, () =>
          h.sql(`insert into ai_findings (company_id, agent_id, finding_type, title, description, state, citations)
                 values ($1,'AGT-EST','scope_item','Pre-accepted','x','accepted','[{"sheet":"C-1"}]'::jsonb)`, [ridgeline])),
      ).rejects.toThrow(/row-level security|ai_findings_acceptance/);
    });

    it('blocks acceptance by a user without the ai.accept_findings permission', async () => {
      // The UPDATE policy's USING clause hides the row from Vic entirely, so
      // the statement matches nothing rather than raising. Silently affecting
      // zero rows is the correct RLS outcome; what matters is that the finding
      // did not move.
      const affected = await h.asUser(vic, () =>
        h.sql(`update ai_findings set state='accepted', reviewed_by=$1, reviewed_at=now()
               where id=$2 returning id`, [vic, findingId]));
      expect(affected).toEqual([]);
      const [f] = await h.sql<{ state: string }>(`select state from ai_findings where id = $1`, [findingId]);
      expect(f!.state).toBe('proposed');
    });

    it('blocks acceptance attributed to someone other than the acting user', async () => {
      await expect(
        h.asUser(dana, () =>
          h.sql(`update ai_findings set state='accepted', reviewed_by=$1, reviewed_at=now() where id=$2`, [alice, findingId])),
      ).rejects.toThrow(/must be the authenticated user/);
    });

    it('allows acceptance by a permitted human, and records who', async () => {
      await h.asUser(dana, () =>
        h.sql(`update ai_findings set state='accepted', reviewed_by=$1, reviewed_at=now(),
               review_note='Verified against C-210 before accepting' where id=$2`, [dana, findingId]));
      const [f] = await h.sql<{ state: string; reviewed_by: string }>(
        `select state, reviewed_by from ai_findings where id = $1`, [findingId]);
      expect(f!.state).toBe('accepted');
      expect(f!.reviewed_by).toBe(dana);
    });
  });

  // ---------------------------------------------------------------------------
  describe('approval segregation of duties', () => {
    it('stops a requester approving their own request', async () => {
      const [req] = await h.asUser(dana, () =>
        h.sql<{ id: string }>(
          `insert into approval_requests (company_id, entity_table, entity_id, requested_change, gate, required_tier, reason, requested_by)
           values ($1,'public.production_rates',gen_random_uuid()::text,'{"rate_per_hour":150}'::jsonb,
                   'senior_review',2,'Calibrated from three completed jobs',$2)
           returning id`, [ridgeline, dana]));
      await expect(
        h.asUser(dana, () =>
          h.sql(`update approval_requests set state='approved', decided_by=$1, decided_at=now() where id=$2`, [dana, req!.id])),
      ).rejects.toThrow(/cannot approve their own request/);
    });

    it('stops approval by someone below the required tier', async () => {
      const [req] = await h.asUser(alice, () =>
        h.sql<{ id: string }>(
          `insert into approval_requests (company_id, entity_table, entity_id, requested_change, gate, required_tier, reason, requested_by)
           values ($1,'public.production_rates',gen_random_uuid()::text,'{"rate_per_hour":150}'::jsonb,
                   'senior_review',3,'Needs chief estimator sign-off',$2)
           returning id`, [ridgeline, alice]));
      // Dana is tier 1; the request needs tier 3.
      await expect(
        h.asUser(dana, () =>
          h.sql(`update approval_requests set state='approved', decided_by=$1, decided_at=now() where id=$2`, [dana, req!.id])),
      ).rejects.toThrow(/Approval requires tier 3/);
    });

    it('allows approval by a different user holding the tier', async () => {
      const [req] = await h.asUser(dana, () =>
        h.sql<{ id: string }>(
          `insert into approval_requests (company_id, entity_table, entity_id, requested_change, gate, required_tier, reason, requested_by)
           values ($1,'public.production_rates',gen_random_uuid()::text,'{"rate_per_hour":150}'::jsonb,
                   'senior_review',2,'Calibrated from three completed jobs',$2)
           returning id`, [ridgeline, dana]));
      await h.asUser(alice, () =>
        h.sql(`update approval_requests set state='approved', decided_by=$1, decided_at=now(),
               decision_note='Reviewed the three jobs' where id=$2`, [alice, req!.id]));
      const [r] = await h.sql<{ state: string }>(`select state from approval_requests where id = $1`, [req!.id]);
      expect(r!.state).toBe('approved');
    });
  });

  // ---------------------------------------------------------------------------
  describe('company integrity', () => {
    it('refuses to remove the last owner', async () => {
      await expect(
        h.sql(`update company_memberships set is_owner = false where company_id = $1 and user_id = $2`, [ridgeline, alice]),
      ).rejects.toThrow(/must retain at least one active owner/);
    });

    it('refuses to delete the last owner', async () => {
      await expect(
        h.sql(`delete from company_memberships where company_id = $1 and user_id = $2`, [ridgeline, alice]),
      ).rejects.toThrow(/must retain at least one active owner/);
    });

    it('provisions a company with a default pricing profile ready to price', async () => {
      const rows = await h.asUser(alice, () =>
        h.sql<{ code: string; components: number }>(
          `select p.code, (select count(*)::int from markup_components m where m.pricing_profile_id = p.id) components
           from pricing_profiles p where p.company_id = $1`, [ridgeline]));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.code).toBe('PP-DEFAULT');
      expect(rows[0]!.components).toBe(3);
    });
  });
});
