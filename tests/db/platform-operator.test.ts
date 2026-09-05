import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * The operator of the platform.
 *
 * Everything in GrounUp is built so that no company can see another, which is
 * right for customers and left the person running the platform unable to see
 * their own business — no list of tenants, no view of who is paying, no way to
 * turn a feature on for a customer who asked.
 *
 * The dangerous version of this feature takes ten minutes: add
 * `or app.is_platform_admin()` to every policy and be done. That hands whoever
 * holds the flag every bid every customer has ever priced. So the tests that
 * matter most here are the ones asserting what an operator still **cannot**
 * see.
 */
describe('the platform operator', () => {
  let h: Harness;
  const admin    = '11111111-1111-4111-8111-111111111111';
  const customer = '22222222-2222-4222-8222-222222222222';
  let company = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [[admin, 'ops@grounup.test'], [customer, 'c@r.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2) on conflict (id) do nothing`,
        [id, email]);
    }
    /*
     * Granted with the service role: adding an operator is a deployment act.
     * Superadmin specifically — migration 0068 split the role in two, and
     * changing a customer's entitlement is the deciding half rather than the
     * selling one.
     */
    await h.sql(
      `insert into platform_admins (user_id, reason, role)
       values ($1,'Runs the platform','superadmin')`, [admin]);

    company = (await h.asUser(customer, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','business') as id`)))[0]!.id;

    await h.asUser(customer, async () => {
      await h.sql(
        `insert into estimates (company_id, number, name) values ($1,'EST-1','Secret bid')`,
        [company]);
      await h.sql(
        `insert into projects (company_id, number, name, contract_value)
         values ($1,'PRJ-1','Secret job',1000000)`, [company]);
    });
  });

  afterAll(async () => { await h?.db.close(); });

  // --------------------------------------------------- what they cannot see
  describe('cannot read customer business data', () => {
    for (const table of ['estimates', 'projects', 'project_costs', 'documents',
                         'estimate_line_items', 'customers', 'employees']) {
      it(`sees nothing in ${table}`, async () => {
        const rows = await h.asUser(admin, () => h.sql(`select 1 from ${table} limit 5`));
        expect(rows).toEqual([]);
      });
    }

    it('sees a company name and not what is inside it', async () => {
      /*
       * The line this feature is drawn on. An operator needs to know Ridgeline
       * exists and is paying. They have no business knowing what Ridgeline bid.
       */
      const [c] = await h.asUser(admin, () => h.sql<{
        name: string; estimate_count: string; project_count: string;
      }>(`select name, estimate_count, project_count from admin_companies
           where company_id = $1`, [company]));
      expect(c!.name).toBe('Ridgeline');
      expect(Number(c!.estimate_count)).toBe(1);
      // A count, not a title.
      const cols = await h.sql<{ column_name: string }>(
        `select column_name from information_schema.columns where table_name = 'admin_companies'`);
      const names = cols.map((x) => x.column_name);
      expect(names).not.toContain('estimate_name');
      expect(names).not.toContain('contract_value');
    });
  });

  // ----------------------------------------------------- what they can see
  describe('sees the business of running the platform', () => {
    it('lists every company, which no customer can', async () => {
      const asAdmin = await h.asUser(admin, () => h.sql(`select 1 from admin_companies`));
      expect(asAdmin.length).toBeGreaterThan(0);

      // The same view, to somebody who is not an operator, is empty.
      const asCustomer = await h.asUser(customer, () => h.sql(`select 1 from admin_companies`));
      expect(asCustomer).toEqual([]);
    });

    it('shows who owns a company and how many people are in it', async () => {
      const [c] = await h.asUser(admin, () => h.sql<{
        owner_email: string; member_count: string; plan_id: string;
      }>(`select owner_email, member_count, plan_id from admin_companies
           where company_id = $1`, [company]));
      expect(c!.owner_email).toBe('c@r.test');
      expect(Number(c!.member_count)).toBe(1);
      // The plan the company was provisioned on, which the harness sets.
      expect(c!.plan_id).toBe('business');
    });

    it('shows a webhook that arrived and never finished', async () => {
      /*
       * A subscription that silently failed to activate is a customer who paid
       * and cannot log in. Before this there was no way to see one.
       */
      await h.sql(
        `insert into stripe_events (id, type, payload, received_at)
         values ('evt_stuck','invoice.paid','{}'::jsonb, now())`);
      const [e] = await h.asUser(admin, () => h.sql<{ unprocessed: boolean }>(
        `select unprocessed from admin_webhook_health where event_id = 'evt_stuck'`));
      expect(e!.unprocessed).toBe(true);
    });

    it('shows a customer nothing of the webhook log', async () => {
      const rows = await h.asUser(customer, () => h.sql(`select 1 from admin_webhook_health`));
      expect(rows).toEqual([]);
    });
  });

  // --------------------------------------------------------- feature flags
  describe('turning a feature on and off', () => {
    it('grants a feature the plan does not include', async () => {
      const before = await h.asUser(customer, () => h.sql<{ has: boolean }>(
        `select app.has_entitlement($1,'white_label') as has`, [company]));
      expect(before[0]!.has).toBe(false);

      await h.asUser(admin, () => h.sql(
        `select app.set_feature_override($1,'white_label','grant',
           'Evaluating for an enterprise upgrade')`, [company]));

      const after = await h.asUser(customer, () => h.sql<{ has: boolean }>(
        `select app.has_entitlement($1,'white_label') as has`, [company]));
      expect(after[0]!.has).toBe(true);
    });

    it('survives the Stripe webhook rewriting the entitlement', async () => {
      /*
       * The reason overrides are a separate table. `entitlements` is unique on
       * company_id and the webhook upserts the whole row, so a grant written
       * there would work and then vanish on the next invoice — which is the
       * kind of failure nobody connects to its cause three weeks later.
       */
      await h.sql(
        `update entitlements set features = array['estimating'], plan_id = 'starter'
          where company_id = $1`, [company]);
      const [r] = await h.asUser(customer, () => h.sql<{ has: boolean }>(
        `select app.has_entitlement($1,'white_label') as has`, [company]));
      expect(r!.has).toBe(true);
    });

    it('lets a revoke beat a grant, because switching something off is urgent', async () => {
      await h.asUser(admin, () => h.sql(
        `select app.set_feature_override($1,'white_label','revoke',
           'Cost overrun on their account')`, [company]));
      const [r] = await h.asUser(customer, () => h.sql<{ has: boolean }>(
        `select app.has_entitlement($1,'white_label') as has`, [company]));
      expect(r!.has).toBe(false);
    });

    it('keeps the replaced override rather than deleting it', async () => {
      // What this customer was given, and when, has to survive being changed.
      const rows = await h.asUser(admin, () => h.sql<{ effect: string; revoked_at: string | null }>(
        `select effect, revoked_at from entitlement_overrides
          where company_id = $1 and feature = 'white_label'
          order by granted_at`, [company]));
      expect(rows).toHaveLength(2);
      expect(rows[0]!.effect).toBe('grant');
      expect(rows[0]!.revoked_at).not.toBeNull();
      expect(rows[1]!.revoked_at).toBeNull();
    });

    it('returns the company to its plan when the override is withdrawn', async () => {
      await h.sql(`update entitlements set features = array['white_label']
                    where company_id = $1`, [company]);
      await h.asUser(admin, () => h.sql(
        `select app.clear_feature_override($1,'white_label','Trial concluded')`, [company]));
      const [r] = await h.asUser(customer, () => h.sql<{ has: boolean }>(
        `select app.has_entitlement($1,'white_label') as has`, [company]));
      expect(r!.has).toBe(true);
    });

    it('expires an override that was given an end date', async () => {
      // An override with no end is a decision somebody has to remember.
      await h.asUser(admin, () => h.sql(
        `select app.set_feature_override($1,'beta_thing','grant','Two week trial',
           now() - interval '1 day')`, [company]));
      const [r] = await h.asUser(customer, () => h.sql<{ has: boolean }>(
        `select app.has_entitlement($1,'beta_thing') as has`, [company]));
      expect(r!.has).toBe(false);
    });

    it('refuses an override with no reason', async () => {
      await expect(h.asUser(admin, () => h.sql(
        `select app.set_feature_override($1,'x','grant','no')`, [company])))
        .rejects.toThrow(/must say why/);
    });

    it('refuses a customer trying to grant themselves a feature', async () => {
      await expect(h.asUser(customer, () => h.sql(
        `select app.set_feature_override($1,'white_label','grant','I would like it')`,
        [company]))).rejects.toThrow(/do not have permission/);
    });

    it('shows the customer what was done to their own account', async () => {
      /*
       * An operator action a customer cannot see is the shape of the problem
       * rather than the fix. The audit row is company-scoped, so it lands in
       * their ledger.
       */
      const rows = await h.asUser(customer, () => h.sql<{ reason: string }>(
        `select reason from audit_events
          where company_id = $1 and entity_table = 'public.entitlement_overrides'
          order by occurred_at`, [company]));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.map((r) => r.reason).join(' ')).toMatch(/Evaluating for an enterprise upgrade/);
    });
  });

  // ---------------------------------------------------------- the flag itself
  describe('the operator flag', () => {
    it('cannot be granted through the API', async () => {
      // Adding an operator is a deployment act, not a button. No insert policy
      // exists, so row level security refuses it.
      await expect(h.asUser(admin, () => h.sql(
        `insert into platform_admins (user_id, reason) values ($1,'Promoting myself')`,
        [customer]))).rejects.toThrow();
    });

    it('stops working the moment it is revoked', async () => {
      const temp = '33333333-3333-4333-8333-333333333333';
      await h.sql(`insert into auth.users (id, email) values ($1,'t@g.test')`, [temp]);
      await h.sql(`insert into user_profiles (id, email) values ($1,'t@g.test') on conflict (id) do nothing`, [temp]);
      await h.sql(`insert into platform_admins (user_id, reason, role)
                   values ($1,'Temporary cover','sales')`, [temp]);
      expect((await h.asUser(temp, () => h.sql(`select 1 from admin_companies`))).length)
        .toBeGreaterThan(0);

      await h.sql(`update platform_admins set revoked_at = now(), revoke_reason = 'Cover ended'
                    where user_id = $1`, [temp]);
      expect(await h.asUser(temp, () => h.sql(`select 1 from admin_companies`))).toEqual([]);
    });

    it('is invisible to a customer', async () => {
      const rows = await h.asUser(customer, () => h.sql(`select 1 from platform_admins`));
      expect(rows).toEqual([]);
    });
  });
});
