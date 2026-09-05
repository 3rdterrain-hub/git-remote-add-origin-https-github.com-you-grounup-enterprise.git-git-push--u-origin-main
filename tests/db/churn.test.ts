import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Why they left.
 *
 * The number a subscription business cannot go back for. The tests that matter
 * are the ones holding what makes it trustworthy: the value is captured while
 * it is still true, "nobody was asked" is a recorded answer rather than a
 * missing one, and a webhook arriving afterwards never overwrites what the
 * customer actually said.
 */
describe('why they left', () => {
  let h: Harness;
  const boss  = '0a000000-0000-4000-8000-000000000001';
  const owner = '0a000000-0000-4000-8000-000000000002';
  const crew  = '0a000000-0000-4000-8000-000000000003';
  const other = '0a000000-0000-4000-8000-000000000004';
  let company = '', quiet = '';

  const account = async (id: string, email: string) => {
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [id, email]);
  };

  const subscribe = async (co: string, seats: number, stripeId: string) => {
    const [s] = await h.sql<{ id: string }>(
      `insert into subscriptions (company_id, plan_id, stripe_customer_id,
                                  stripe_subscription_id, status, quantity,
                                  current_period_start, current_period_end)
       values ($1,'grounup','cus_' || $2, $2, 'active', $3,
               now() - interval '2 days', now() + interval '28 days')
       returning id`, [co, stripeId, seats]);
    await h.sql(
      `insert into subscription_items (company_id, subscription_id, stripe_item_id,
                                       stripe_price_id, quantity)
       values ($1,$2,'si_' || $3,'price_month',$4)`, [co, s!.id, stripeId, seats]);
    return s!.id;
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [
      [boss, 'boss@grounup.test'], [owner, 'owner@ridge.test'],
      [crew, 'crew@ridge.test'], [other, 'owner@quiet.test'],
    ] as const) await account(id, email);
    await h.sql(`insert into platform_admins (user_id, reason, role)
                 values ($1,'Runs the platform','superadmin')`, [boss]);
    await h.asUser(boss, () => h.sql(
      `select app.set_plan_price('grounup','month',19900,'price_month')`));

    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','grounup') as id`)))[0]!.id;
    quiet = (await h.asUser(other, () => h.sql<{ id: string }>(
      `select app.provision_company('Quiet Co','quiet','grounup') as id`)))[0]!.id;

    // A second person, so the seat count at cancellation is not trivially one.
    await h.sql(`insert into company_memberships (company_id, user_id, role_id, status)
                 select $1, $2, r.id, 'active' from roles r
                  where r.company_id is null and r.key = 'estimator'`, [company, crew]);

    await subscribe(company, 2, 'sub_ridge');
    await subscribe(quiet, 1, 'sub_quiet');
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('recording one', () => {
    it('captures what they were worth while it is still true', async () => {
      /*
       * The whole reason this is stored rather than derived. Once the
       * subscription ends its items are gone and the figure is unrecoverable —
       * which the next test proves by ending it.
       */
      await h.asUser(owner, () => h.sql(
        `select app.record_cancellation($1,'too_expensive',
           'Two hundred a month is more than the work justifies right now')`, [company]));
      const [c] = await h.sql<{ seats: number; cents: number; months: number }>(
        `select seats_at_cancellation as seats, monthly_cents_at_cancellation as cents,
                months_as_a_customer as months
           from cancellations where company_id = $1`, [company]);
      expect(Number(c!.seats)).toBe(2);
      expect(Number(c!.cents)).toBe(2 * 19900);
      expect(Number(c!.months)).toBeGreaterThanOrEqual(0);
    });

    it('would have lost the figure had it waited', async () => {
      // Ending the subscription the way Stripe eventually does.
      await h.sql(`delete from subscription_items where company_id = $1`, [company]);
      const [s] = await h.sql<{ cents: string }>(
        `select app.subscription_monthly_cents(
                  (select id from subscriptions where company_id = $1)) as cents`, [company]);
      expect(Number(s!.cents)).toBe(0);
      // And the recorded one is untouched.
      const [c] = await h.sql<{ cents: number }>(
        `select monthly_cents_at_cancellation as cents from cancellations
          where company_id = $1`, [company]);
      expect(Number(c!.cents)).toBe(2 * 19900);
    });

    it('refuses a reason that needs detail without any', async () => {
      await expect(h.asUser(other, () => h.sql(
        `select app.record_cancellation($1,'missing_feature')`, [quiet])))
        .rejects.toThrow(/cancellations_detail_when_needed/);
    });

    it('refuses somebody with no business canceling', async () => {
      const stranger = '0a000000-0000-4000-8000-000000000009';
      await account(stranger, 'stranger@elsewhere.test');
      await expect(h.asUser(stranger, () => h.sql(
        `select app.record_cancellation($1,'too_expensive')`, [company])))
        .rejects.toThrow(/do not have permission/);
    });

    it('cannot be edited afterwards', async () => {
      // A reason changed after the fact is not what the customer said.
      await expect(h.sql(`update cancellations set reason_key = 'not_using_it'`))
        .rejects.toThrow(/append-only/);
      await expect(h.sql(`delete from cancellations`)).rejects.toThrow(/append-only/);
    });
  });

  describe('when nobody was asked', () => {
    it('records the cancellation with no reason rather than guessing one', async () => {
      // What the Stripe webhook does when a customer cancels in Stripe's portal.
      await h.asService(() => h.sql(
        `select app.record_cancellation($1, null, null, null, null, false, 'stripe')`,
        [quiet]));
      const [c] = await h.sql<{ reason: string | null; source: string }>(
        `select reason_key as reason, source from cancellations where company_id = $1`,
        [quiet]);
      expect(c!.reason).toBeNull();
      expect(c!.source).toBe('stripe');
    });

    it('reports it as its own row rather than as "other"', async () => {
      /*
       * The distinction that makes the whole report trustworthy. Filing an
       * unknown reason under "other" puts a number beside a thing nobody said,
       * and how often nobody was asked is itself the useful figure.
       */
      const rows = await h.asUser(boss, () => h.sql<{
        reason_key: string; label: string; customers: string;
      }>(`select reason_key, label, customers from admin_churn_reasons`));
      const notAsked = rows.find((r) => r.reason_key === 'not_asked');
      expect(notAsked).toBeDefined();
      expect(notAsked!.label).toBe('Nobody was asked');
      expect(rows.find((r) => r.reason_key === 'other')).toBeUndefined();
    });

    it('never files a second copy over a reason the customer gave', async () => {
      // The webhook always follows a cancellation made in the product.
      await h.asService(() => h.sql(
        `select app.record_cancellation($1, null, null, null, null, false, 'stripe')`,
        [company]));
      const rows = await h.sql<{ reason: string | null }>(
        `select reason_key as reason from cancellations where company_id = $1`, [company]);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.reason).toBe('too_expensive');
    });
  });

  describe('what an operator reads', () => {
    it('adds up what each reason cost', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{ cents: string; seats: string }>(
        `select monthly_cents_lost as cents, seats_lost as seats
           from admin_churn_reasons where reason_key = 'too_expensive'`));
      expect(Number(r!.cents)).toBe(2 * 19900);
      expect(Number(r!.seats)).toBe(2);
    });

    it('names the competitors, so losing to one twice reads as a pattern', async () => {
      const third = '0a000000-0000-4000-8000-00000000000a';
      await account(third, 'owner@third.test');
      const co = (await h.asUser(third, () => h.sql<{ id: string }>(
        `select app.provision_company('Third Co','third','grounup') as id`)))[0]!.id;
      await h.asUser(third, () => h.sql(
        `select app.record_cancellation($1,'switched',
           'Their takeoff is faster', 'Bluebeam')`, [co]));
      const [r] = await h.asUser(boss, () => h.sql<{ competitors: string[] }>(
        `select competitors from admin_churn_reasons where reason_key = 'switched'`));
      expect(r!.competitors).toContain('Bluebeam');
    });

    it('puts customers gained beside customers lost', async () => {
      // Either number alone is half a sentence.
      const [m] = await h.asUser(boss, () => h.sql<{
        customers_lost: string; customers_gained: string; gave_a_reason: string;
      }>(`select customers_lost, customers_gained, gave_a_reason
            from admin_churn_by_month where month = date_trunc('month', now())`));
      expect(Number(m!.customers_lost)).toBe(3);
      expect(Number(m!.gave_a_reason)).toBe(2);
      expect(Number(m!.customers_gained)).toBeGreaterThan(0);
    });

    it('says whether a lost customer has since come back', async () => {
      const [c] = await h.asUser(boss, () => h.sql<{ came_back: boolean }>(
        `select came_back from admin_cancellations where company_id = $1`, [quiet]));
      expect(c!.came_back).toBe(false);

      // The old one has to end before a new one can start; the index that
      // enforces one live subscription per company is the point.
      await h.sql(`update subscriptions set status = 'canceled', canceled_at = now()
                    where company_id = $1`, [quiet]);
      await subscribe(quiet, 1, 'sub_quiet_again');
      const [after] = await h.asUser(boss, () => h.sql<{ came_back: boolean }>(
        `select came_back from admin_cancellations where company_id = $1`, [quiet]));
      expect(after!.came_back).toBe(true);
    });

    it('shows a customer their own and nobody else', async () => {
      const rows = await h.asUser(owner, () => h.sql<{ company_id: string }>(
        `select company_id from cancellations`));
      expect(rows.map((r) => r.company_id)).toEqual([company]);
    });

    it('shows a customer none of the operator reports', async () => {
      for (const view of ['admin_churn_reasons', 'admin_churn_by_month', 'admin_cancellations']) {
        const rows = await h.asUser(owner, () => h.sql(`select * from ${view}`));
        expect(rows, view).toHaveLength(0);
      }
    });

    it('shows an anonymous visitor nothing at all', async () => {
      await expect(h.asAnon(() => h.sql(`select * from admin_churn_reasons`)))
        .rejects.toThrow(/permission denied/);
      await expect(h.asAnon(() => h.sql(`select * from cancellation_reasons`)))
        .rejects.toThrow(/permission denied/);
    });
  });
});
