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
});
