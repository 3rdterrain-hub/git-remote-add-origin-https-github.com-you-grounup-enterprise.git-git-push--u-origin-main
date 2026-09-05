import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Free forever, and the arrangements a business makes with the customers who
 * are not on the list price.
 *
 * The tests worth writing here are the ones that would catch the platform
 * *saying* something it does not do: a free tier that quietly locks people out
 * when a trial ends, a feature boundary nothing enforces, a discount that never
 * reaches an invoice, and a comped account that stays free after somebody
 * ended the arrangement.
 */
describe('free forever, and terms', () => {
  let h: Harness;
  const boss  = 'aaaaaaaa-0000-4000-8000-000000000001';
  const rep   = 'aaaaaaaa-0000-4000-8000-000000000002';
  const owner = 'aaaaaaaa-0000-4000-8000-000000000003';
  const books = 'aaaaaaaa-0000-4000-8000-000000000004';
  let company = '';

  const account = async (id: string, email: string) => {
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [id, email]);
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await account(boss, 'boss@grounup.test');
    await account(rep, 'rep@grounup.test');
    await account(owner, 'owner@ridge.test');
    await account(books, 'books@grounup.test');
    await h.sql(`insert into platform_admins (user_id, reason, role)
                 values ($1,'Runs the platform','superadmin')`, [boss]);
    await h.sql(`insert into platform_admins (user_id, reason, role, role_key)
                 values ($1,'Sells the platform','sales','sales')`, [rep]);
  });

  afterAll(async () => { await h?.db.close(); });

  describe('creating a company by hand', () => {
    it('is refused to an operator without the permission', async () => {
      await expect(h.asUser(rep, () => h.sql(
        `select app.create_company_for('owner@ridge.test','Ridgeline','Signed on a call')`)))
        .rejects.toThrow(/do not have permission/);
    });

    it('refuses an owner who has no account rather than inventing one', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.create_company_for('ghost@nowhere.test','Ghost Co','Signed on a call')`)))
        .rejects.toThrow(/No account here uses/);
    });

    it('refuses to create one without saying why', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.create_company_for('owner@ridge.test','Ridgeline','')`)))
        .rejects.toThrow(/why/);
    });

    it('creates the company and makes the named person its owner', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{ id: string }>(
        `select app.create_company_for('owner@ridge.test','Ridgeline Excavating',
                                       'Signed on a call, migrating from spreadsheets') as id`));
      company = r!.id;

      const [m] = await h.sql<{ is_owner: boolean; status: string }>(
        `select is_owner, status from company_memberships
          where company_id = $1 and user_id = $2`, [company, owner]);
      expect(m!.is_owner).toBe(true);
      expect(m!.status).toBe('active');
    });

    it('gives it the same setup a self-serve signup gets', async () => {
      // A company created by hand that is missing its default pricing profile
      // is one whose first estimate cannot be priced.
      const [c] = await h.sql<{ profile: string | null }>(
        `select default_pricing_profile_id as profile from companies where id = $1`, [company]);
      expect(c!.profile).not.toBeNull();
      const markups = await h.sql(
        `select code from markup_components where company_id = $1`, [company]);
      expect(markups.map((x) => (x as { code: string }).code).sort())
        .toEqual(['CONT', 'OH', 'PROFIT']);
    });

    it('does not make the operator a member of the customer company', async () => {
      const seen = await h.sql(
        `select user_id from company_memberships where company_id = $1`, [company]);
      expect(seen).toHaveLength(1);
    });

    it('leaves a record naming who created it and why', async () => {
      const [a] = await h.sql<{ reason: string; actor: string }>(
        `select reason, actor_id as actor from audit_events
          where entity_table = 'public.companies' and entity_id = $1
            and reason is not null
          order by occurred_at limit 1`, [company]);
      expect(a!.reason).toMatch(/Signed on a call/);
      expect(a!.actor).toBe(boss);
    });
  });

  describe('what a lapsed trial falls back to', () => {
    it('is the free plan, not nothing', async () => {
      await h.sql(`update entitlements set valid_until = now() - interval '1 day'
                    where company_id = $1`, [company]);
      const [p] = await h.sql<{ plan: string }>(
        `select app.effective_plan($1) as plan`, [company]);
      expect(p!.plan).toBe('free');
    });

    it('keeps estimating working after the trial ends', async () => {
      // The whole point. A customer who did not convert still has the half of
      // the product they were getting value from.
      const [e] = await h.sql<{ ok: boolean }>(
        `select app.has_entitlement($1,'estimating') as ok`, [company]);
      expect(e!.ok).toBe(true);
    });

    it('does not keep the paid modules working', async () => {
      const [e] = await h.sql<{ ok: boolean }>(
        `select app.has_entitlement($1,'projects') as ok`, [company]);
      expect(e!.ok).toBe(false);
    });

    it('applies the free plan allowance rather than treating a lapse as unlimited', async () => {
      /*
       * The defect this replaces: `plan_limit` returned NULL when no
       * entitlement was live, and NULL means unlimited — so letting a
       * subscription lapse used to remove every cap it was meant to impose.
       */
      const [l] = await h.sql<{ seats: number; estimates: number }>(
        `select app.plan_limit($1,'max_seats') as seats,
                app.plan_limit($1,'max_active_estimates') as estimates`, [company]);
      expect(Number(l!.seats)).toBe(2);
      expect(Number(l!.estimates)).toBe(5);
    });
  });

  describe('the gates hold in the database', () => {
    it('refuses a new project on the free plan', async () => {
      await expect(h.sql(
        `insert into projects (company_id, number, name, status)
         values ($1,'P-1','First job','preconstruction')`, [company]))
        .rejects.toThrow(/Project management is not included/);
    });

    it('names the plan the company is actually on', async () => {
      await expect(h.sql(
        `insert into equipment (company_id, code, name)
         values ($1,'EX-1','Excavator')`, [company]))
        .rejects.toThrow(/GrounUp Free/);
    });

    it('still allows the work the free plan includes', async () => {
      const [e] = await h.sql<{ id: string }>(
        `insert into estimates (company_id, number, name, status)
         values ($1,'E-1','Site work','draft') returning id`, [company]);
      expect(e!.id).toBeTruthy();
    });

    it('never hides work a lapsed customer already did', async () => {
      /*
       * A gate on INSERT and not on SELECT is a deliberate choice: a customer
       * whose subscription ended can read and export everything they built.
       */
      await h.sql(`update entitlements set valid_until = now() + interval '30 days'
                    where company_id = $1`, [company]);
      const [p] = await h.sql<{ id: string }>(
        `insert into projects (company_id, number, name, status)
         values ($1,'P-2','Paid job','preconstruction') returning id`, [company]);
      await h.sql(`update entitlements set valid_until = now() - interval '1 day'
                    where company_id = $1`, [company]);

      const still = await h.sql(`select id from projects where id = $1`, [p!.id]);
      expect(still).toHaveLength(1);
      // And it can still be corrected — only starting something new is refused.
      await h.sql(`update projects set name = 'Paid job, renamed' where id = $1`, [p!.id]);
    });
  });

  describe('giving an account away', () => {
    it('is refused to somebody who only reads billing', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.hire_operator('books@grounup.test','Handles invoicing','finance')`));
      await expect(h.asUser(books, () => h.sql(
        `select app.set_billing_terms($1,'free','Friend of the business')`, [company])))
        .rejects.toThrow(/do not have permission/);
    });

    it('turns access back on and says who gave it and why', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.set_billing_terms($1,'free','Founding customer, comped for a year',
                                      null, null, now() + interval '1 year')`, [company]));
      const [e] = await h.sql<{ active: boolean; source: string; reason: string }>(
        `select is_active as active, source, grant_reason as reason
           from entitlements where company_id = $1`, [company]);
      expect(e!.active).toBe(true);
      expect(e!.source).toBe('manual_grant');
      expect(e!.reason).toMatch(/Founding customer/);
    });

    it('makes a seat cost nothing', async () => {
      const [p] = await h.sql<{ cents: number }>(
        `select app.seat_price_cents($1,'month') as cents`, [company]);
      expect(Number(p!.cents)).toBe(0);
    });

    it('ends on its own rather than running forever', async () => {
      // The comp carries the same end date onto the entitlement, so a pilot
      // nobody remembered to close expires by itself.
      const [e] = await h.sql<{ until: string | null }>(
        `select valid_until as until from entitlements where company_id = $1`, [company]);
      expect(e!.until).not.toBeNull();
    });

    it('hands access back to Stripe when the arrangement ends', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.clear_billing_terms($1,'Year is up, moving to a paid plan')`, [company]));
      const [e] = await h.sql<{ active: boolean; source: string }>(
        `select is_active as active, source from entitlements where company_id = $1`, [company]);
      // No subscription, so access does not silently stay on.
      expect(e!.active).toBe(false);
      expect(e!.source).toBe('stripe_webhook');
    });
  });

  describe('discounting an account', () => {
    it('takes a percentage off the published price', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.set_plan_price('grounup','month',19900,'price_live_monthly')`));
      await h.asUser(boss, () => h.sql(
        `select app.set_billing_terms($1,'percent_off','Referred two other contractors', 25)`,
        [company]));
      const [p] = await h.sql<{ cents: number }>(
        `select app.seat_price_cents($1,'month') as cents`, [company]);
      expect(Number(p!.cents)).toBe(14925);
    });

    it('follows a price change rather than freezing what it was worth', async () => {
      // Derived, not stored: raising the list price raises what the discounted
      // customer pays, which is what "25% off" means.
      await h.asUser(boss, () => h.sql(
        `select app.set_plan_price('grounup','month',24900,'price_live_monthly')`));
      const [p] = await h.sql<{ cents: number }>(
        `select app.seat_price_cents($1,'month') as cents`, [company]);
      expect(Number(p!.cents)).toBe(18675);
    });

    it('says plainly that a discount without a Stripe coupon is not in effect', async () => {
      const [t] = await h.asUser(boss, () => h.sql<{ applies: boolean }>(
        `select applies_in_stripe as applies from admin_billing_terms where company_id = $1`,
        [company]));
      expect(t!.applies).toBe(false);
    });

    it('counts as in effect once the coupon exists', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.set_billing_terms($1,'percent_off','Referral discount, coupon created',
                                      25, null, null, 'COUPON25')`, [company]));
      const [t] = await h.asUser(boss, () => h.sql<{ applies: boolean }>(
        `select applies_in_stripe as applies from admin_billing_terms where company_id = $1`,
        [company]));
      expect(t!.applies).toBe(true);
    });

    it('holds an agreed per-seat price flat when the list price moves', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.set_billing_terms($1,'fixed_seat_price','Negotiated on a three-year term',
                                      null, 12500)`, [company]));
      await h.asUser(boss, () => h.sql(
        `select app.set_plan_price('grounup','month',29900,'price_live_monthly')`));
      const [p] = await h.sql<{ cents: number }>(
        `select app.seat_price_cents($1,'month') as cents`, [company]);
      expect(Number(p!.cents)).toBe(12500);
    });

    it('leaves exactly one live arrangement however many are set', async () => {
      const rows = await h.sql(
        `select id from company_billing_terms where company_id = $1 and revoked_at is null`,
        [company]);
      expect(rows).toHaveLength(1);
    });

    it('lets the customer see their own arrangement', async () => {
      const [t] = await h.asUser(owner, () => h.sql<{ kind: string; cents: number }>(
        `select kind, seat_price_month_cents as cents from my_billing_terms
          where company_id = $1`, [company]));
      expect(t!.kind).toBe('fixed_seat_price');
      expect(Number(t!.cents)).toBe(12500);
    });

    it('shows one company nothing of another company arrangement', async () => {
      const other = (await h.asUser(boss, () => h.sql<{ id: string }>(
        `select app.create_company_for('books@grounup.test','Other Co','Second test tenant') as id`)))[0]!.id;
      await h.asUser(boss, () => h.sql(
        `select app.set_billing_terms($1,'free','Internal account')`, [other]));
      const seen = await h.asUser(owner, () => h.sql(
        `select company_id from my_billing_terms where company_id = $1`, [other]));
      expect(seen).toHaveLength(0);
    });
  });

  describe('what each kind of operator may do', () => {
    it('refuses a permission that does not exist', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.set_role_permissions('support', array['billing.reed'],
                                         'Typo, deliberately')`)))
        .rejects.toThrow(/No such permission/);
    });

    it('refuses to hand any role everything', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.set_role_permissions('support', array['*'], 'Trying it on')`)))
        .rejects.toThrow(/Only the superadmin role/);
    });

    it('refuses to edit the superadmin role at all', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.set_role_permissions('superadmin', array['billing.read'],
                                         'Locking myself out')`)))
        .rejects.toThrow(/is fixed/);
    });

    it('changes what a role may do, and the change takes effect immediately', async () => {
      const before = await h.asUser(books, () => h.sql(
        `select company_id from admin_companies limit 1`));
      expect(before).toHaveLength(0);

      await h.asUser(boss, () => h.sql(
        `select app.set_role_permissions('finance', array['billing.read','companies.read'],
                                         'Bookkeeping needs to match invoices to tenants')`));

      const after = await h.asUser(books, () => h.sql(
        `select company_id from admin_companies limit 1`));
      expect(after.length).toBeGreaterThan(0);
    });

    it('records what a role could do before the change', async () => {
      const [a] = await h.sql<{ old: { permissions: string[] } }>(
        `select prior_state as old from audit_events
          where entity_table = 'public.platform_roles' and entity_id = 'finance'
          order by occurred_at desc limit 1`);
      expect(a!.old.permissions).toEqual(['billing.read']);
    });

    it('lets the superadmin invent a role for a job these do not describe', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.create_platform_role('onboarding','Onboarding',
           'Sets a new customer up and hands them over to their account manager',
           array['companies.read','companies.manage'])`));
      const [r] = await h.sql<{ assignable: boolean; is_system: boolean }>(
        `select assignable, is_system from platform_roles where key = 'onboarding'`);
      expect(r!.assignable).toBe(true);
      expect(r!.is_system).toBe(false);
    });

    it('refuses a role nobody could explain', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.create_platform_role('x','X','short', array['billing.read'])`)))
        .rejects.toThrow(/Say what this role is for/);
    });
  });
});
