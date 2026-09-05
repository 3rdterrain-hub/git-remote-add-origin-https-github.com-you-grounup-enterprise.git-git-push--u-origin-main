import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * What is ending, and what came in.
 *
 * Three questions an operator was asking and could not answer: is this company
 * alive, what ends soon, and what actually arrived. The tests worth having are
 * the ones that hold the distinctions — paying is not the same as using,
 * an ending is five different dates on five tables, and recurring revenue is a
 * rate rather than money.
 */
describe('what is ending and what came in', () => {
  let h: Harness;
  const boss  = '14000000-0000-4000-8000-000000000001';
  const busy  = '14000000-0000-4000-8000-000000000002';
  const quiet = '14000000-0000-4000-8000-000000000003';
  let active = '', dormant = '';

  const account = async (id: string, email: string) => {
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [id, email]);
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [
      [boss, 'boss@grounup.test'], [busy, 'owner@busy.test'], [quiet, 'owner@quiet.test'],
    ] as const) await account(id, email);
    await h.sql(`insert into platform_admins (user_id, reason, role)
                 values ($1,'Runs the platform','superadmin')`, [boss]);

    active = (await h.asUser(busy, () => h.sql<{ id: string }>(
      `select app.provision_company('Busy Co','busy','grounup') as id`)))[0]!.id;
    dormant = (await h.asUser(quiet, () => h.sql<{ id: string }>(
      `select app.provision_company('Quiet Co','quiet','grounup') as id`)))[0]!.id;

    await h.sql(`update user_profiles set last_seen_at = now() where id = $1`, [busy]);
    await h.sql(`update user_profiles set last_seen_at = now() - interval '70 days'
                  where id = $1`, [quiet]);
    await h.sql(`insert into subscriptions (company_id, plan_id, stripe_customer_id,
                                            stripe_subscription_id, status, quantity,
                                            current_period_start, current_period_end)
                 values ($1,'grounup','cus_q','sub_q','active',3,
                         now() - interval '5 days', now() + interval '25 days')`, [dormant]);
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('is this company alive', () => {
    it('says active for somebody who was here today', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{ standing: string; days_quiet: number }>(
        `select standing, days_quiet from admin_company_activity where company_id = $1`,
        [active]));
      expect(r!.standing).toBe('active');
      expect(Number(r!.days_quiet)).toBe(0);
    });

    it('says gone dark for somebody who has not been here in six weeks', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{ standing: string }>(
        `select standing from admin_company_activity where company_id = $1`, [dormant]));
      expect(r!.standing).toBe('gone dark');
    });

    it('flags the combination worth acting on: paying and gone', async () => {
      /*
       * A cancellation that has not been written yet. On the tenant list it
       * looks identical to a customer who is in the platform every day.
       */
      const [r] = await h.asUser(boss, () => h.sql<{ paying_and_gone: boolean }>(
        `select paying_and_gone from admin_company_activity where company_id = $1`,
        [dormant]));
      expect(r!.paying_and_gone).toBe(true);

      const [other] = await h.asUser(boss, () => h.sql<{ paying_and_gone: boolean }>(
        `select paying_and_gone from admin_company_activity where company_id = $1`,
        [active]));
      expect(other!.paying_and_gone).toBe(false);
    });

    it('says never used rather than guessing at a company nobody opened', async () => {
      const nobody = (await h.asUser(boss, () => h.sql<{ id: string }>(
        `select app.create_company_for('boss@grounup.test','Fresh Co','A brand new tenant') as id`)))[0]!.id;
      await h.sql(`update user_profiles set last_seen_at = null where id = $1`, [boss]);
      const [r] = await h.asUser(boss, () => h.sql<{ standing: string }>(
        `select standing from admin_company_activity where company_id = $1`, [nobody]));
      expect(r!.standing).toBe('never used');
    });
  });

  describe('what ends soon', () => {
    it('finds a trial running out', async () => {
      const rows = await h.asUser(boss, () => h.sql<{ kind: string; company_name: string }>(
        `select kind, company_name from admin_expiring where kind = 'trial'`));
      expect(rows.map((r) => r.company_name)).toContain('Busy Co');
    });

    it('finds a subscription somebody has already canceled', async () => {
      await h.sql(`update subscriptions set cancel_at_period_end = true
                    where company_id = $1`, [dormant]);
      const [r] = await h.asUser(boss, () => h.sql<{ what: string; seats: number }>(
        `select what, seats from admin_expiring where kind = 'canceling'`));
      expect(r!.what).toBe('Subscription ends');
      expect(Number(r!.seats)).toBe(3);
    });

    it('finds a comp with an end date on it', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.set_billing_terms($1,'free','Comped for a quarter',
           null, null, now() + interval '30 days')`, [active]));
      const rows = await h.asUser(boss, () => h.sql<{ kind: string }>(
        `select kind from admin_expiring`));
      expect(rows.map((r) => r.kind)).toContain('terms');
    });

    it('finds an allowance given for a while', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.set_allowance($1,'ai_credits_per_month', 5000,
           'Pilot for one quarter', now() + interval '45 days')`, [active]));
      const rows = await h.asUser(boss, () => h.sql<{ kind: string; detail: string }>(
        `select kind, detail from admin_expiring where kind = 'allowance'`));
      expect(rows[0]!.detail).toBe('ai_credits_per_month');
    });

    it('is ordered by what ends first, which is the order to work through it', async () => {
      const rows = await h.asUser(boss, () => h.sql<{ ends_at: string }>(
        `select ends_at from admin_expiring`));
      const times = rows.map((r) => new Date(r.ends_at).getTime());
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    });

    it('ignores anything more than two months out', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.set_allowance($1,'storage_gb', 500,
           'A long arrangement', now() + interval '200 days')`, [dormant]));
      const rows = await h.asUser(boss, () => h.sql<{ detail: string }>(
        `select detail from admin_expiring where kind = 'allowance'`));
      expect(rows.map((r) => r.detail)).not.toContain('storage_gb');
    });
  });

  describe('what came in', () => {
    it('counts money by the month the invoice covers, not the day it was raised', async () => {
      /*
       * An invoice raised on the thirty-first for the following month is next
       * month's money, and mixing those is how a revenue report stops matching
       * the accounts.
       */
      await h.sql(`insert into billing_invoices (company_id, stripe_invoice_id, status,
                                                 amount_due_cents, amount_paid_cents,
                                                 period_start, period_end, created_at)
                   values ($1,'in_next','paid',19900,19900,
                           date_trunc('month', now()) + interval '1 month',
                           date_trunc('month', now()) + interval '2 months',
                           date_trunc('month', now()) + interval '25 days')`, [dormant]);
      const [thisMonth] = await h.asUser(boss, () => h.sql<{ paid: string }>(
        `select paid_cents as paid from admin_earnings_by_month
          where month = date_trunc('month', now())`));
      expect(Number(thisMonth!.paid)).toBe(0);
    });

    it('separates what was invoiced from what actually arrived', async () => {
      await h.sql(`insert into billing_invoices (company_id, stripe_invoice_id, status,
                                                 amount_due_cents, amount_paid_cents,
                                                 period_start, period_end)
                   values ($1,'in_now','open',19900,0,
                           date_trunc('month', now()), date_trunc('month', now()) + interval '1 month')`,
        [active]);
      const [r] = await h.asUser(boss, () => h.sql<{
        invoiced: string; paid: string; outstanding: string;
      }>(`select invoiced_cents as invoiced, paid_cents as paid,
                 outstanding_cents as outstanding
            from admin_earnings_by_month where month = date_trunc('month', now())`));
      expect(Number(r!.invoiced)).toBe(19900);
      expect(Number(r!.paid)).toBe(0);
      expect(Number(r!.outstanding)).toBe(19900);
    });

    it('takes refunds off the net', async () => {
      await h.sql(`update billing_invoices set status = 'paid', amount_paid_cents = 19900
                    where stripe_invoice_id = 'in_now'`);
      const [r] = await h.asUser(boss, () => h.sql<{ id: string }>(
        `select app.request_refund($1,'refund',5000,
           'Charged for a month they could not use','in_now') as id`, [active]));
      await h.asUser(boss, () => h.sql(`select app.decide_refund($1, true)`, [r!.id]));
      await h.asService(() => h.sql(`select app.finish_refund($1, true, 're_x')`, [r!.id]));

      const [m] = await h.asUser(boss, () => h.sql<{ paid: string; net: string }>(
        `select paid_cents as paid, net_cents as net from admin_earnings_by_month
          where month = date_trunc('month', now())`));
      expect(Number(m!.paid)).toBe(19900);
      expect(Number(m!.net)).toBe(14900);
    });

    it('ignores a voided invoice, which is money that never existed', async () => {
      await h.sql(`insert into billing_invoices (company_id, stripe_invoice_id, status,
                                                 amount_due_cents, amount_paid_cents,
                                                 period_start, period_end)
                   values ($1,'in_void','void',99900,0,
                           date_trunc('month', now()), date_trunc('month', now()) + interval '1 month')`,
        [active]);
      const [r] = await h.asUser(boss, () => h.sql<{ invoiced: string }>(
        `select invoiced_cents as invoiced from admin_earnings_by_month
          where month = date_trunc('month', now())`));
      expect(Number(r!.invoiced)).toBe(19900);
    });

    it('covers two years, because a year-on-year comparison needs both', async () => {
      const rows = await h.asUser(boss, () => h.sql(`select month from admin_earnings_by_month`));
      expect(rows).toHaveLength(24);
    });
  });

  describe('who may read it', () => {
    it('shows a customer none of it', async () => {
      for (const view of ['admin_company_activity', 'admin_expiring',
                          'admin_earnings_by_month']) {
        const rows = await h.asUser(busy, () => h.sql(`select * from ${view}`));
        expect(rows, view).toHaveLength(0);
      }
    });

    it('shows an anonymous visitor nothing at all', async () => {
      await expect(h.asAnon(() => h.sql(`select * from admin_earnings_by_month`)))
        .rejects.toThrow(/permission denied/);
    });
  });
});
