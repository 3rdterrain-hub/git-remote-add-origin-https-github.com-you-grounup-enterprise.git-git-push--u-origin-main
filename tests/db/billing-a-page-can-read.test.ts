/**
 * The billing screen can read what it shows, and only its own.
 *
 * Migration 0009 built subscriptions, entitlements, invoices and usage; 0031
 * built `reporting_plan_usage` for the three enforced limits; 0069 built
 * `reporting_company_usage` for the metered ones; 0077 built `my_plan`. Every
 * one of them was tested, and the billing page read five usage bars and four
 * invoices out of literals in the component. This is the defect this repository
 * keeps producing: a working feature with no door.
 *
 * These tests are the door. They select the exact column lists
 * `apps/web/src/lib/data/billing.ts` selects, as an ordinary member through row
 * level security, so a renamed column or a tightened policy fails here rather
 * than silently emptying a page about money.
 *
 * And they check the other half of it: a member of one company sees nothing
 * belonging to another. A billing page is the worst possible place for a
 * cross-tenant read, because the figures look plausible and nobody checks a
 * number that looks plausible.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const RIVAL = '22222222-2222-4222-8222-222222222222';
/** A member with no billing permission at all. */
const CREW = '33333333-3333-4333-8333-333333333333';

describe('what the billing screen reads', () => {
  let h: Harness;
  let mine: string;
  let theirs: string;

  beforeAll(async () => {
    h = await createHarness({ seed: true });

    for (const [id, email] of [[OWNER, 'owner@ridge.test'], [RIVAL, 'rival@other.test'],
      [CREW, 'crew@ridge.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, email]);
    }

    mine = (await h.asUser(OWNER, () => h.sql<{ provision_company: string }>(
      `select app.provision_company('Ridgeline','ridgeline','grounup')`)))[0]!.provision_company;
    theirs = (await h.asUser(RIVAL, () => h.sql<{ provision_company: string }>(
      `select app.provision_company('Other Co','other-co','grounup')`)))[0]!.provision_company;

    // A second member of the same company, in a role that holds no billing.read.
    await h.asService(() => h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status)
       select $1, $2, r.id, 'active' from roles r where r.key = 'foreman'
       on conflict do nothing`, [mine, CREW]));

    /*
     * A subscription, its priced item and an invoice, written the way the
     * webhook writes them: service role, because no tenant policy permits it.
     */
    await h.asService(async () => {
      await h.sql(
        `insert into subscriptions
           (company_id, plan_id, stripe_customer_id, stripe_subscription_id, status, quantity,
            current_period_start, current_period_end, cancel_at_period_end,
            default_payment_method_brand, default_payment_method_last4, last_event_at)
         values ($1, app.effective_plan($1), 'cus_mine', 'sub_mine', 'active', 9,
                 now() - interval '3 days', now() + interval '27 days', false,
                 'mastercard', '8391', now())`, [mine]);
      await h.sql(
        `insert into billing_invoices
           (company_id, stripe_invoice_id, number, status, amount_due_cents, amount_paid_cents,
            period_start, period_end, hosted_invoice_url, invoice_pdf_url, issued_at, paid_at)
         values ($1, 'in_mine', 'GU-2026-0918', 'paid', 44100, 44100,
                 now() - interval '3 days', now() + interval '27 days',
                 'https://invoice.stripe.com/i/1', 'https://files.stripe.com/1.pdf',
                 now() - interval '3 days', now() - interval '3 days')`, [mine]);
      await h.sql(
        `insert into subscriptions
           (company_id, plan_id, stripe_customer_id, stripe_subscription_id, status, quantity)
         values ($1, app.effective_plan($1), 'cus_theirs', 'sub_theirs', 'active', 4)`, [theirs]);
      await h.sql(
        `insert into billing_invoices
           (company_id, stripe_invoice_id, number, status, amount_due_cents, amount_paid_cents, issued_at)
         values ($1, 'in_theirs', 'GU-2026-0777', 'paid', 99900, 99900, now())`, [theirs]);
    });
  });

  describe('the columns the page selects', () => {
    it('reads the subscription, including only the last four of a card', async () => {
      const rows = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select id, plan_id, status, quantity, current_period_start, current_period_end,
                trial_end, cancel_at_period_end, canceled_at, last_event_at,
                default_payment_method_brand, default_payment_method_last4, created_at
           from subscriptions`));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('active');
      expect(rows[0]!.default_payment_method_last4).toBe('8391');
      // The column is four characters wide. There is nowhere to put a PAN.
      expect(String(rows[0]!.default_payment_method_last4)).toHaveLength(4);
    });

    it('reads the plan the entitlement resolves to', async () => {
      const rows = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select company_id, plan_id, plan_name, tagline, features, everything_included,
                access_valid_until, entitlement_source, on_the_free_plan
           from my_plan`));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.company_id).toBe(mine);
      expect(rows[0]!.plan_name).toBeTruthy();
    });

    it('reads the three enforced limits, which is what refuses the next one', async () => {
      const rows = await h.asUser(OWNER, () => h.sql<{ resource: string; used: number; allowed: number | null }>(
        `select resource, used, allowed from reporting_plan_usage order by resource`));
      expect(rows.map((r) => r.resource))
        .toEqual(['active estimates', 'active projects', 'users']);
      // One member and one crew member, both able to sign in.
      expect(Number(rows.find((r) => r.resource === 'users')!.used)).toBe(2);
    });

    it('reads the metered figures beside them', async () => {
      const rows = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select seats, ai_requests_this_period, ai_credits_included,
                storage_gb, storage_gb_included, files_without_a_size
           from reporting_company_usage`));
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.seats)).toBe(2);
      expect(Number(rows[0]!.storage_gb)).toBe(0);
    });

    it('reads the invoice history with the links to Stripe on it', async () => {
      const rows = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select id, number, status, amount_due_cents, amount_paid_cents, currency,
                period_start, period_end, hosted_invoice_url, invoice_pdf_url, issued_at, paid_at
           from billing_invoices order by issued_at desc`));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.number).toBe('GU-2026-0918');
      expect(rows[0]!.invoice_pdf_url).toBe('https://files.stripe.com/1.pdf');
    });
  });

  describe('and only its own', () => {
    it('shows a rival company nothing of this one', async () => {
      const subs = await h.asUser(RIVAL, () => h.sql(
        `select stripe_subscription_id from subscriptions`));
      expect(subs).toEqual([{ stripe_subscription_id: 'sub_theirs' }]);

      const invoices = await h.asUser(RIVAL, () => h.sql(
        `select number from billing_invoices`));
      expect(invoices).toEqual([{ number: 'GU-2026-0777' }]);
    });

    it('keeps the usage views to the caller\'s own companies', async () => {
      const rows = await h.asUser(RIVAL, () => h.sql<{ company_id: string }>(
        `select company_id from reporting_company_usage`));
      expect(rows.map((r) => r.company_id)).toEqual([theirs]);
    });

    it('shows a member with no billing permission no money at all', async () => {
      // Entitlement is readable by any member — the UI has to know which
      // features to show. Subscriptions and invoices are not.
      const entitlement = await h.asUser(CREW, () => h.sql(`select plan_id from my_plan`));
      expect(entitlement).toHaveLength(1);

      expect(await h.asUser(CREW, () => h.sql(`select id from subscriptions`))).toEqual([]);
      expect(await h.asUser(CREW, () => h.sql(`select id from billing_invoices`))).toEqual([]);
    });

    it('shows an anonymous caller nothing', async () => {
      // Refused at the grant rather than filtered by a policy, which is one
      // step earlier: an unauthenticated caller has no privilege on the table
      // at all, so there is no policy for a mistake in it to weaken.
      await expect(h.asAnon(() => h.sql(`select id from subscriptions`)))
        .rejects.toThrow(/permission denied/);
      await expect(h.asAnon(() => h.sql(`select id from billing_invoices`)))
        .rejects.toThrow(/permission denied/);
    });
  });

  describe('and cannot be written from a browser', () => {
    it('changes nothing when a tenant writes their own subscription', async () => {
      /*
       * The structural form of "a redirect grants nothing": there is no UPDATE
       * policy for `authenticated` on any of these tables, so the row is not
       * visible for update and the statement touches nothing. It does not
       * raise — which is why this asserts on the row afterwards rather than on
       * an error, and why a test written the other way would have passed while
       * the update worked.
       */
      await h.asUser(OWNER, () => h.sql(
        `update subscriptions set status = 'active',
                                  current_period_end = now() + interval '1 year'`));
      const [row] = await h.asService(() => h.sql<{ current_period_end: string }>(
        `select current_period_end from subscriptions where stripe_subscription_id = 'sub_mine'`));
      expect(new Date(row!.current_period_end).getTime())
        .toBeLessThan(Date.now() + 40 * 24 * 3600 * 1000);
    });

    it('refuses a tenant granting themselves an entitlement', async () => {
      await expect(h.asUser(OWNER, () => h.sql(
        `insert into entitlements (company_id, plan_id, is_active, features)
         values ($1, 'enterprise', true, array['*'])`, [mine])))
        .rejects.toThrow();
    });

    it('refuses a tenant writing an invoice as paid', async () => {
      await expect(h.asUser(OWNER, () => h.sql(
        `insert into billing_invoices (company_id, stripe_invoice_id, status, amount_due_cents)
         values ($1, 'in_forged', 'paid', 0)`, [mine])))
        .rejects.toThrow();
    });
  });

  /*
   * Two views that existed for the length of this build with no reader.
   *
   * `my_billing_terms` (0076) carries a comment saying, in as many words, that
   * a customer unable to see why their invoice is what it is would be its own
   * defect — and then nothing showed it, so a company on a negotiated 20% saw
   * the list price and never the 20%. `my_refunds` (0085) was built with a
   * deliberate split between what an operator writes and what a customer reads,
   * and that split was never rendered to anybody.
   */
  describe('why the invoice is what it is', () => {
    beforeAll(async () => {
      await h.asService(async () => {
        /*
         * A published seat price, which is what a discount is a discount *off*.
         * Without one `app.seat_price_cents` has nothing to reduce and answers
         * 0 — and a screen that renders that reads "a seat costs you $0.00",
         * which is the same defect as an uncosted material priced at nothing.
         */
        for (const [interval, cents] of [['month', 4900], ['year', 49000]] as const) {
          await h.sql(
            `insert into plan_prices (plan_id, stripe_price_id, interval, unit_amount_cents)
             select pl.id, $1, $2, $3 from plans pl
              where pl.is_active and pl.is_public order by pl.id limit 1
             on conflict (plan_id, interval, usage_type) do update
               set unit_amount_cents = excluded.unit_amount_cents,
                   is_active = true, updated_at = now()`,
            [`price_seat_${interval}`, interval, cents]);
        }
        await h.sql(
          `insert into company_billing_terms (company_id, kind, percent_off, reason, valid_until)
           values ($1, 'percent_off', 20, 'Negotiated at signing for a three-year term',
                   now() + interval '2 years')`, [mine]);
        await h.sql(
          `insert into company_billing_terms (company_id, kind, percent_off, reason, revoked_at)
           values ($1, 'percent_off', 50, 'Launch promotion, ended', now() - interval '1 day')`,
          [mine]);
        await h.sql(
          `insert into company_billing_terms (company_id, kind, seat_price_cents, reason)
           values ($1, 'fixed_seat_price', 1200, 'Rival co, different arrangement entirely')`,
          [theirs]);
      });
    });

    it('reads the terms the page shows, with the seat price they produce', async () => {
      const rows = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select kind, percent_off, seat_price_cents, reason, valid_until, created_at,
                seat_price_month_cents, seat_price_year_cents
           from my_billing_terms order by created_at desc`));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.kind).toBe('percent_off');
      expect(Number(rows[0]!.percent_off)).toBe(20);
      // The reason is the whole point: it is the sentence that answers the question.
      expect(rows[0]!.reason).toBe('Negotiated at signing for a three-year term');
      /*
       * The whole point of showing the terms: 20% off a $49 seat is $39.20, and
       * the customer can check the arithmetic on their own invoice. A screen
       * showing the list price beside a discount it never applies is worse than
       * one showing neither.
       */
      expect(Number(rows[0]!.seat_price_month_cents)).toBe(3920);
      expect(Number(rows[0]!.seat_price_year_cents)).toBe(39200);
    });

    it('leaves a revoked arrangement out, so nothing claims a discount that ended', async () => {
      const rows = await h.asUser(OWNER, () => h.sql<{ percent_off: string }>(
        `select percent_off from my_billing_terms`));
      expect(rows.map((r) => Number(r.percent_off))).not.toContain(50);
    });

    it('shows one company nothing of another company’s arrangement', async () => {
      const rows = await h.asUser(OWNER, () => h.sql<{ reason: string }>(
        `select reason from my_billing_terms`));
      expect(rows.map((r) => r.reason)).not.toContain('Rival co, different arrangement entirely');
    });
  });

  describe('money coming back', () => {
    beforeAll(async () => {
      await h.asService(async () => {
        await h.sql(
          `insert into refund_requests (company_id, kind, amount_cents, reason, state)
           values ($1, 'refund', 44100, 'Charged twice in the same period', 'requested')`, [mine]);
        await h.sql(
          `insert into refund_requests
             (company_id, kind, amount_cents, reason, state, decided_by, decided_at, applied_at)
           values ($1, 'credit', 9900, 'Seats billed for two people who had left',
                   'applied', $2, now(), now())`, [mine, OWNER]);
        await h.sql(
          `insert into refund_requests
             (company_id, kind, amount_cents, reason, state, decided_by, decided_at, decision_note)
           values ($1, 'refund', 1000, 'Asked for a refund of the annual term',
                   'rejected', $2, now(), 'Outside the refund window')`, [mine, OWNER]);
        await h.sql(
          `insert into refund_requests (company_id, kind, amount_cents, reason, state)
           values ($1, 'refund', 500, 'Rival co, nothing to do with us', 'requested')`, [theirs]);
      });
    });

    it('reads each one in the words the customer is meant to see', async () => {
      const rows = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select kind, amount_cents, currency, standing, requested_at, applied_at
           from my_refunds order by amount_cents desc`));
      expect(rows).toHaveLength(2);
      expect(rows[0]!.standing).toBe('Being reviewed');
      expect(rows[1]!.standing).toBe('Credited to your next invoice');
    });

    it('never hands the customer the note the operators wrote about them', async () => {
      /*
       * The view selects a fixed column list that excludes `reason`,
       * `decision_note` and `error`. Asking for one by name is how that stays
       * true through a later `create or replace view`.
       */
      await expect(h.asUser(OWNER, () => h.sql(`select decision_note from my_refunds`)))
        .rejects.toThrow();
      await expect(h.asUser(OWNER, () => h.sql(`select error from my_refunds`)))
        .rejects.toThrow();
    });

    it('leaves a rejected request out entirely rather than showing a refusal', async () => {
      const rows = await h.asUser(OWNER, () => h.sql<{ amount_cents: number }>(
        `select amount_cents from my_refunds`));
      expect(rows.map((r) => Number(r.amount_cents))).not.toContain(1000);
    });

    it('shows one company nothing of another company’s refunds', async () => {
      const rows = await h.asUser(OWNER, () => h.sql<{ amount_cents: number }>(
        `select amount_cents from my_refunds`));
      expect(rows.map((r) => Number(r.amount_cents))).not.toContain(500);
    });
  });
});
