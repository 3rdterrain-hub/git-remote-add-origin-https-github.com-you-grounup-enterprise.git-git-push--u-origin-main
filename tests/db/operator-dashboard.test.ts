import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * What the business is doing, as the operator dashboard reports it.
 *
 * The tests that matter are the ones that would catch a number being made up:
 * revenue counted from what GrounUp wishes it charged rather than from what
 * Stripe bills, a comped account quietly counted as revenue, and a yearly
 * subscription counted as if it billed that much every month.
 */
describe('what the business is doing', () => {
  let h: Harness;
  const boss = 'bbbbbbbb-0000-4000-8000-000000000001';
  const a = 'bbbbbbbb-0000-4000-8000-000000000002';
  const b = 'bbbbbbbb-0000-4000-8000-000000000003';
  const c = 'bbbbbbbb-0000-4000-8000-000000000004';
  let payer = '', annual = '', comped = '';

  const account = async (id: string, email: string) => {
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [id, email]);
  };

  /** A subscription as the Stripe webhook would have mirrored it. */
  const subscribe = async (
    company: string, priceId: string, quantity: number, status = 'active',
  ) => {
    const [s] = await h.sql<{ id: string }>(
      `insert into subscriptions (company_id, plan_id, stripe_customer_id,
                                  stripe_subscription_id, status, quantity,
                                  current_period_start, current_period_end)
       values ($1,'grounup','cus_' || left(md5(random()::text), 8),
               'sub_' || left(md5(random()::text), 8), $2, $3,
               now() - interval '2 days', now() + interval '28 days')
       returning id`, [company, status, quantity]);
    await h.sql(
      `insert into subscription_items (company_id, subscription_id, stripe_item_id,
                                       stripe_price_id, quantity)
       values ($1,$2,'si_' || left(md5(random()::text), 8), $3, $4)`,
      [company, s!.id, priceId, quantity]);
    return s!.id;
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await account(boss, 'boss@grounup.test');
    await account(a, 'a@one.test');
    await account(b, 'b@two.test');
    await account(c, 'c@three.test');
    await h.sql(`insert into platform_admins (user_id, reason, role)
                 values ($1,'Runs the platform','superadmin')`, [boss]);

    await h.asUser(boss, () => h.sql(
      `select app.set_plan_price('grounup','month',19900,'price_month')`));
    await h.asUser(boss, () => h.sql(
      `select app.set_plan_price('grounup','year',199000,'price_year')`));

    payer = (await h.asUser(a, () => h.sql<{ id: string }>(
      `select app.provision_company('Payer','payer','grounup') as id`)))[0]!.id;
    annual = (await h.asUser(b, () => h.sql<{ id: string }>(
      `select app.provision_company('Annual','annual','grounup') as id`)))[0]!.id;
    comped = (await h.asUser(c, () => h.sql<{ id: string }>(
      `select app.provision_company('Comped','comped','grounup') as id`)))[0]!.id;

    await subscribe(payer, 'price_month', 4);
    await subscribe(annual, 'price_year', 2);
    await h.asUser(boss, () => h.sql(
      `select app.set_billing_terms($1,'free','Founding customer')`, [comped]));
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('revenue', () => {
    it('counts a monthly subscription at what Stripe bills for it', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{ cents: number }>(
        `select billed_monthly_cents as cents from admin_revenue_by_company
          where company_id = $1`, [payer]));
      expect(Number(r!.cents)).toBe(4 * 19900);
    });

    it('spreads a yearly subscription across the year rather than over one month', async () => {
      // 2 seats at $1,990 a year is $331.67 a month, not $3,980.
      const [r] = await h.asUser(boss, () => h.sql<{ cents: number }>(
        `select billed_monthly_cents as cents from admin_revenue_by_company
          where company_id = $1`, [annual]));
      expect(Number(r!.cents)).toBe(Math.round(2 * 199000 / 12));
    });

    it('counts a comped account as revenue of nothing', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{ cents: number; free: boolean }>(
        `select billed_monthly_cents as cents, (terms = 'free') as free
           from admin_revenue_by_company where company_id = $1`, [comped]));
      expect(Number(r!.cents)).toBe(0);
      expect(r!.free).toBe(true);
    });

    it('reports what the comped account would have been worth', async () => {
      // Given away is a number, not an absence: one seat at the list price.
      const [r] = await h.asUser(boss, () => h.sql<{ cents: number }>(
        `select list_monthly_cents as cents from admin_revenue_by_company
          where company_id = $1`, [comped]));
      expect(Number(r!.cents)).toBe(19900);
    });

    it('adds up to a monthly figure and twelve times it', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{ mrr: number; arr: number }>(
        `select mrr_cents as mrr, arr_cents as arr from admin_revenue`));
      expect(Number(r!.mrr)).toBe(4 * 19900 + Math.round(2 * 199000 / 12));
      expect(Number(r!.arr)).toBe(Number(r!.mrr) * 12);
    });

    it('separates what is given away from what is earned', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{ given: number; free: number }>(
        `select given_away_cents as given, on_free as free from admin_revenue`));
      expect(Number(r!.given)).toBe(19900);
      // The comped account is on the paid plan with a manual grant, not on the
      // free plan — being given the product is not the same as using the free
      // tier, and counting them together would overstate both.
      expect(Number(r!.free)).toBe(0);
    });

    it('notices a subscription billing for fewer seats than are in use', async () => {
      await h.sql(`insert into company_memberships (company_id, user_id, role_id, status)
                   select $1, $2, r.id, 'active' from roles r
                    where r.company_id is null and r.key = 'estimator'`, [payer, boss]);
      const [r] = await h.asUser(boss, () => h.sql<{ n: number }>(
        `select accounts_that_disagree as n from admin_revenue`));
      expect(Number(r!.n)).toBeGreaterThan(0);
    });
  });

  describe('growth', () => {
    it('counts this month the companies created this month', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{ n: number }>(
        `select new_companies as n from admin_growth
          where month = date_trunc('month', now())`));
      expect(Number(r!.n)).toBe(3);
    });

    it('counts people separately from companies', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{ n: number }>(
        `select new_users as n from admin_growth
          where month = date_trunc('month', now())`));
      expect(Number(r!.n)).toBe(4);
    });

    it('covers thirteen months so this one has last year beside it', async () => {
      const rows = await h.asUser(boss, () => h.sql(`select month from admin_growth`));
      expect(rows).toHaveLength(13);
    });
  });

  describe('who arrived', () => {
    it('names the company each person landed in', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{
        company_name: string; no_company_yet: boolean; is_owner: boolean;
      }>(`select company_name, no_company_yet, is_owner from admin_recent_signups
           where user_id = $1`, [b]));
      expect(r!.company_name).toBe('Annual');
      expect(r!.no_company_yet).toBe(false);
      expect(r!.is_owner).toBe(true);
    });

    it('shows somebody who signed up and got stuck', async () => {
      const stuck = 'bbbbbbbb-0000-4000-8000-000000000009';
      await account(stuck, 'stuck@nowhere.test');
      const [r] = await h.asUser(boss, () => h.sql<{ no_company_yet: boolean }>(
        `select no_company_yet from admin_recent_signups where user_id = $1`, [stuck]));
      expect(r!.no_company_yet).toBe(true);
    });
  });

  describe('who may see it', () => {
    it('shows a customer nothing of any of it', async () => {
      for (const view of ['admin_revenue', 'admin_revenue_by_company',
                          'admin_growth', 'admin_recent_signups']) {
        const rows = await h.asUser(a, () => h.sql(`select * from ${view}`));
        expect(rows, view).toHaveLength(0);
      }
    });

    it('shows an anonymous visitor nothing either', async () => {
      await expect(h.asAnon(() => h.sql(`select * from admin_revenue`)))
        .rejects.toThrow(/permission denied/);
    });

    it('needs the billing permission for revenue, not merely operator access', async () => {
      const seller = 'bbbbbbbb-0000-4000-8000-00000000000a';
      await account(seller, 'seller@grounup.test');
      await h.asUser(boss, () => h.sql(
        `select app.hire_operator('seller@grounup.test','Sells the platform','sales')`));
      // Sales holds companies.read and upsell.propose — not billing.read.
      const revenue = await h.asUser(seller, () => h.sql(`select * from admin_revenue_by_company`));
      expect(revenue).toHaveLength(0);
      const growth = await h.asUser(seller, () => h.sql(`select * from admin_growth`));
      expect(growth.length).toBeGreaterThan(0);
    });
  });
});
