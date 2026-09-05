import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * When a payment fails.
 *
 * The most expensive gap on the platform, because a failed payment is usually
 * an expired card rather than a decision to leave. The tests that matter are
 * the ones holding the two shapes apart: an attempt is an event and is counted
 * by being recorded, and whether somebody is still failing is derived from the
 * invoice so nothing has to remember to clear a flag when they pay.
 */
describe('when a payment fails', () => {
  let h: Harness;
  const boss  = '0b000000-0000-4000-8000-000000000001';
  const owner = '0b000000-0000-4000-8000-000000000002';
  const other = '0b000000-0000-4000-8000-000000000003';
  let company = '', elsewhere = '';

  const account = async (id: string, email: string) => {
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [id, email]);
  };

  const invoice = (co: string, id: string, status: string, cents: number) =>
    h.sql(`insert into billing_invoices (company_id, stripe_invoice_id, number, status,
                                         amount_due_cents, currency, hosted_invoice_url)
           values ($1,$2,'GU-1',$3,$4,'USD','https://invoice.stripe.test/' || $2)
           on conflict (stripe_invoice_id) do update set status = excluded.status`,
      [co, id, status, cents]);

  const fail = (co: string, inv: string, attempt: number, code: string,
                next: string | null) =>
    h.asService(() => h.sql(
      `select app.record_payment_failure($1,$2,$3,19900,'USD',$4,'The card was declined.',$5)`,
      [co, inv, attempt, code, next]));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [
      [boss, 'boss@grounup.test'], [owner, 'owner@ridge.test'],
      [other, 'owner@quiet.test'],
    ] as const) await account(id, email);
    await h.sql(`insert into platform_admins (user_id, reason, role)
                 values ($1,'Runs the platform','superadmin')`, [boss]);

    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','grounup') as id`)))[0]!.id;
    elsewhere = (await h.asUser(other, () => h.sql<{ id: string }>(
      `select app.provision_company('Quiet Co','quiet','grounup') as id`)))[0]!.id;

    await h.sql(`insert into subscriptions (company_id, plan_id, stripe_customer_id,
                                            stripe_subscription_id, status, quantity,
                                            current_period_start, current_period_end)
                 values ($1,'grounup','cus_r','sub_r','past_due',1,
                         now() - interval '10 days', now() + interval '20 days')`,
      [company]);
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('recording a refusal', () => {
    it('keeps every attempt rather than a running count', async () => {
      /*
       * "How many times has this card been refused" cannot be answered by a
       * column that gets overwritten, and the answer decides whether this is a
       * blip or a customer about to be lost.
       */
      await invoice(company, 'in_1', 'open', 19900);
      await fail(company, 'in_1', 1, 'card_declined', '2026-09-08T10:00:00Z');
      await fail(company, 'in_1', 2, 'expired_card', '2026-09-11T10:00:00Z');
      const rows = await h.sql<{ attempt: number }>(
        `select attempt from payment_failures where stripe_invoice_id = 'in_1'
          order by attempt`);
      expect(rows.map((r) => Number(r.attempt))).toEqual([1, 2]);
    });

    it('is idempotent, because webhooks arrive twice', async () => {
      await fail(company, 'in_1', 2, 'expired_card', '2026-09-11T10:00:00Z');
      const [n] = await h.sql<{ n: string }>(
        `select count(*)::text as n from payment_failures where stripe_invoice_id = 'in_1'`);
      expect(Number(n!.n)).toBe(2);
    });

    it('cannot be written by a customer, or edited by anybody', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `select app.record_payment_failure($1,'in_x',1,100)`, [company])))
        .rejects.toThrow(/permission denied/);
      await expect(h.sql(`update payment_failures set attempt = 9`))
        .rejects.toThrow(/append-only/);
    });

    it('shows the most recent reason rather than the first', async () => {
      // The card was declined, then it turned out to have expired. The second
      // is the one worth telling somebody.
      const [p] = await h.sql<{ code: string; attempts: number }>(
        `select failure_code as code, attempts from reporting_payment_problems
          where stripe_invoice_id = 'in_1'`);
      expect(p!.code).toBe('expired_card');
      expect(Number(p!.attempts)).toBe(2);
    });
  });

  describe('whether they are still failing', () => {
    it('is derived from the invoice, not from a flag', async () => {
      /*
       * The point of deriving it: paying is what makes the problem stop, and
       * nothing has to remember to say so. A flag would have needed clearing
       * from whatever code handles a late payment, which is exactly the code
       * that would be forgotten.
       */
      const before = await h.sql(
        `select stripe_invoice_id from reporting_payment_problems where company_id = $1`,
        [company]);
      expect(before).toHaveLength(1);

      await invoice(company, 'in_1', 'paid', 19900);
      const after = await h.sql(
        `select stripe_invoice_id from reporting_payment_problems where company_id = $1`,
        [company]);
      expect(after).toHaveLength(0);
    });

    it('keeps the history of the refusals even after it is paid', async () => {
      // The problem is over; that it happened is not erased.
      const rows = await h.sql(
        `select id from payment_failures where stripe_invoice_id = 'in_1'`);
      expect(rows).toHaveLength(2);
    });

    it('treats an uncollectible invoice as no longer outstanding either', async () => {
      await invoice(company, 'in_2', 'open', 19900);
      await fail(company, 'in_2', 1, 'card_declined', null);
      expect(await h.sql(
        `select stripe_invoice_id from reporting_payment_problems where company_id = $1`,
        [company])).toHaveLength(1);

      await invoice(company, 'in_2', 'uncollectible', 19900);
      expect(await h.sql(
        `select stripe_invoice_id from reporting_payment_problems where company_id = $1`,
        [company])).toHaveLength(0);
    });
  });

  describe('what an operator sees', () => {
    it('says when Stripe has stopped trying, which is when a person must', async () => {
      await invoice(company, 'in_3', 'open', 19900);
      await fail(company, 'in_3', 1, 'card_declined', '2026-09-20T10:00:00Z');
      const [still] = await h.asUser(boss, () => h.sql<{ gave_up: boolean }>(
        `select stripe_gave_up as gave_up from admin_failing_payments
          where stripe_invoice_id = 'in_3'`));
      expect(still!.gave_up).toBe(false);

      await fail(company, 'in_3', 4, 'card_declined', null);
      const [done] = await h.asUser(boss, () => h.sql<{ gave_up: boolean; attempts: number }>(
        `select stripe_gave_up as gave_up, attempts from admin_failing_payments
          where stripe_invoice_id = 'in_3'`));
      expect(done!.gave_up).toBe(true);
      expect(Number(done!.attempts)).toBe(4);
    });

    it('names who to call and how long it has been going on', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{
        owner_email: string; company_name: string; days_failing: number; seats: number;
      }>(`select owner_email, company_name, days_failing, seats
            from admin_failing_payments where stripe_invoice_id = 'in_3'`));
      expect(r!.owner_email).toBe('owner@ridge.test');
      expect(r!.company_name).toBe('Ridgeline');
      expect(Number(r!.days_failing)).toBeGreaterThanOrEqual(0);
      expect(Number(r!.seats)).toBe(1);
    });

    it('puts the ones Stripe has given up on first', async () => {
      await invoice(elsewhere, 'in_4', 'open', 19900);
      await fail(elsewhere, 'in_4', 1, 'insufficient_funds', '2026-09-25T10:00:00Z');
      const rows = await h.asUser(boss, () => h.sql<{ stripe_invoice_id: string }>(
        `select stripe_invoice_id from admin_failing_payments`));
      expect(rows[0]!.stripe_invoice_id).toBe('in_3');
    });

    it('shows a customer none of the operator view', async () => {
      const rows = await h.asUser(owner, () => h.sql(`select * from admin_failing_payments`));
      expect(rows).toHaveLength(0);
    });
  });

  describe('what the customer is told', () => {
    it('gets words rather than a Stripe decline code', async () => {
      const [m] = await h.asUser(owner, () => h.sql<{ what_happened: string }>(
        `select what_happened from my_payment_problem where company_id = $1`, [company]));
      expect(m!.what_happened).toBe('The bank declined the payment.');
    });

    it('names an expired card as an expired card, because that is fixable', async () => {
      await invoice(elsewhere, 'in_5', 'open', 19900);
      await fail(elsewhere, 'in_5', 1, 'expired_card', null);
      const rows = await h.asUser(other, () => h.sql<{ what_happened: string }>(
        `select what_happened from my_payment_problem`));
      expect(rows.map((r) => r.what_happened)).toContain('The card on file has expired.');
    });

    it('falls back to plain language for a code nobody has seen', async () => {
      await invoice(elsewhere, 'in_6', 'open', 19900);
      await fail(elsewhere, 'in_6', 1, 'issuer_not_available', null);
      const rows = await h.asUser(other, () => h.sql<{ what_happened: string }>(
        `select what_happened from my_payment_problem`));
      expect(rows.map((r) => r.what_happened)).toContain('The payment did not go through.');
    });

    it('carries the Stripe invoice link, so they can pay it themselves', async () => {
      const [m] = await h.asUser(other, () => h.sql<{ hosted_invoice_url: string }>(
        `select hosted_invoice_url from my_payment_problem where hosted_invoice_url like '%in_5'`));
      expect(m!.hosted_invoice_url).toMatch(/invoice\.stripe\.test/);
    });

    it('shows one company nothing of another company problem', async () => {
      const rows = await h.asUser(owner, () => h.sql<{ company_id: string }>(
        `select company_id from my_payment_problem`));
      expect(rows.every((r) => r.company_id === company)).toBe(true);
    });

    it('shows an anonymous visitor nothing at all', async () => {
      await expect(h.asAnon(() => h.sql(`select * from my_payment_problem`)))
        .rejects.toThrow(/permission denied/);
    });
  });
});
