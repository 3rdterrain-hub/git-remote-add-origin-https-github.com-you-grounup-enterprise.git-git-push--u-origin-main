import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Setting a price, and claiming the first operator seat.
 *
 * Both existed only as instructions to open a SQL editor. The bootstrap is the
 * more delicate of the two: `platform_admins` has no insert policy on purpose,
 * which is right once a platform is running and wrong on the day it is
 * installed, because there is nobody to do the granting.
 *
 * Every refusal below is a way that bootstrap could be abused if one of its
 * conditions were dropped.
 */
describe('price control and the first operator', () => {
  let h: Harness;
  const first  = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    // Created in order, so "earliest account" is a real fact rather than an
    // artefact of insert order.
    await h.sql(`insert into auth.users (id, email, created_at)
                 values ($1,'first@r.test', now() - interval '2 days')`, [first]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'first@r.test') on conflict (id) do nothing`, [first]);
    await h.sql(`insert into auth.users (id, email, created_at)
                 values ($1,'second@r.test', now() - interval '1 day')`, [second]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'second@r.test') on conflict (id) do nothing`, [second]);
  });

  afterAll(async () => { await h?.db.close(); });

  describe('claiming the first seat', () => {
    it('reports the seat as open before anybody holds it', async () => {
      const [r] = await h.asUser(first, () => h.sql<{ open: boolean }>(
        `select app.superadmin_seat_is_open() as open`));
      expect(r!.open).toBe(true);
    });

    it('refuses anybody but the earliest account', async () => {
      /*
       * Without this a stranger who signs up on a deployment that has been
       * sitting idle takes the platform.
       */
      await expect(h.asUser(second, () => h.sql(`select app.claim_first_superadmin()`)))
        .rejects.toThrow(/first account registered/);
    });

    it('lets the person who installed it claim the seat', async () => {
      const [r] = await h.asUser(first, () => h.sql<{ id: string }>(
        `select app.claim_first_superadmin() as id`));
      expect(r!.id).toBeTruthy();
      const [s] = await h.asUser(first, () => h.sql<{ is_super: boolean }>(
        `select app.is_superadmin() as is_super`));
      expect(s!.is_super).toBe(true);
    });

    it('cannot be used twice', async () => {
      // Otherwise it is a way to displace whoever holds the seat.
      await expect(h.asUser(first, () => h.sql(`select app.claim_first_superadmin()`)))
        .rejects.toThrow(/already has a superadmin/);
    });

    it('reports the seat as taken afterwards', async () => {
      const [r] = await h.asUser(second, () => h.sql<{ open: boolean }>(
        `select app.superadmin_seat_is_open() as open`));
      expect(r!.open).toBe(false);
    });

    it('leaves an audit record of a claim that powerful', async () => {
      const rows = await h.sql<{ reason: string }>(
        `select reason from audit_events where entity_table = 'public.platform_admins'`);
      expect(rows.map((r) => r.reason).join(' ')).toMatch(/First operator seat claimed/);
    });
  });

  describe('setting a price', () => {
    it('publishes one', async () => {
      await h.asUser(first, () => h.sql(
        `select app.set_plan_price('grounup','month',19900,'price_live_monthly')`));
      const [p] = await h.asUser(first, () => h.sql<{
        unit_amount_cents: number; stripe_price_id: string; usage_type: string;
      }>(`select unit_amount_cents, stripe_price_id, usage_type from plan_prices
           where plan_id='grounup' and interval='month' and is_active`));
      expect(p!.unit_amount_cents).toBe(19900);
      expect(p!.stripe_price_id).toBe('price_live_monthly');
      expect(p!.usage_type).toBe('licensed');
    });

    it('leaves exactly one active price after a change', async () => {
      /*
       * The table is unique on plan, interval and usage type, so a change
       * updates the row in place rather than adding a second. What must never
       * happen is two active prices for the same plan and interval: checkout
       * would then have a choice to make, and no basis for making it.
       *
       * The number a past subscription was created at stays answerable through
       * the audit ledger and Stripe's own record of the price it charged.
       */
      await h.asUser(first, () => h.sql(
        `select app.set_plan_price('grounup','month',24900,'price_live_monthly_v2')`));
      const rows = await h.asUser(first, () => h.sql<{
        unit_amount_cents: number; is_active: boolean;
      }>(`select unit_amount_cents, is_active from plan_prices
           where plan_id='grounup' and interval='month'`));
      const active = rows.filter((r) => r.is_active);
      expect(active).toHaveLength(1);
      expect(active[0]!.unit_amount_cents).toBe(24900);
    });

    it('accepts a price decided before Stripe is connected', async () => {
      /*
       * Deciding what to charge and wiring up payments are separate acts that
       * happen in that order. Migration 0070 refused this, protecting the wrong
       * thing: a customer is harmed by a checkout that fails, not by a
       * published number.
       */
      await h.asUser(first, () => h.sql(
        `select app.set_plan_price('grounup','year',199000)`));
      const [p] = await h.asUser(first, () => h.sql<{
        unit_amount_cents: number; stripe_price_id: string | null; is_chargeable: boolean;
      }>(`select unit_amount_cents, stripe_price_id, is_chargeable from plan_prices
           where plan_id='grounup' and interval='year' and is_active`));
      expect(p!.unit_amount_cents).toBe(199000);
      expect(p!.stripe_price_id).toBeNull();
      expect(p!.is_chargeable).toBe(false);
    });

    it('becomes chargeable the moment a Stripe id is pasted in', async () => {
      // Derived from whether the id exists, so it cannot be forgotten.
      await h.asUser(first, () => h.sql(
        `select app.set_plan_price('grounup','year',199000,'price_live_yearly')`));
      const [p] = await h.asUser(first, () => h.sql<{ is_chargeable: boolean }>(
        `select is_chargeable from plan_prices
          where plan_id='grounup' and interval='year' and is_active`));
      expect(p!.is_chargeable).toBe(true);
    });

    it('treats whitespace as no Stripe id rather than as one', async () => {
      await h.asUser(first, () => h.sql(
        `select app.set_plan_price('grounup','year',199000,'   ')`));
      const [p] = await h.asUser(first, () => h.sql<{
        stripe_price_id: string | null; is_chargeable: boolean;
      }>(`select stripe_price_id, is_chargeable from plan_prices
           where plan_id='grounup' and interval='year' and is_active`));
      expect(p!.stripe_price_id).toBeNull();
      expect(p!.is_chargeable).toBe(false);
    });

    it('refuses an interval nobody bills on', async () => {
      await expect(h.asUser(first, () => h.sql(
        `select app.set_plan_price('grounup','fortnight',9900,'price_x')`)))
        .rejects.toThrow(/by the month or by the year/);
    });

    it('refuses a negative price', async () => {
      await expect(h.asUser(first, () => h.sql(
        `select app.set_plan_price('grounup','month',-1,'price_x')`)))
        .rejects.toThrow(/zero or more/);
    });

    it('refuses a plan that does not exist', async () => {
      await expect(h.asUser(first, () => h.sql(
        `select app.set_plan_price('imaginary','month',9900,'price_x')`)))
        .rejects.toThrow(/does not exist/);
    });

    it('is the superadmin alone', async () => {
      /*
       * A price is the most consequential number the platform publishes: what a
       * customer agrees to and what Stripe charges.
       */
      await expect(h.asUser(second, () => h.sql(
        `select app.set_plan_price('grounup','month',100,'price_x')`)))
        .rejects.toThrow(/Only the superadmin/);
    });

    it('records who changed a price and to what', async () => {
      /*
       * Two audit rows exist per change: the generic full-row trigger every
       * table carries, and the deliberate one this function writes with the
       * price stated in business terms. This asserts the second — the first
       * says what changed in the table, and this says what was decided.
       */
      const rows = await h.sql<{ new_state: Record<string, unknown>; actor_id: string }>(
        `select new_state, actor_id from audit_events
          where entity_table = 'public.plan_prices'
            and reason = 'Price published from the operator console'
            and new_state->>'interval' = 'month'
          order by occurred_at desc limit 1`);
      expect(rows[0]!.new_state).toMatchObject({ plan: 'grounup', cents: 24900 });
      expect(rows[0]!.actor_id).toBe(first);
    });

    it('shows an anonymous visitor the price and nothing else', async () => {
      // plan_prices is one of two tables anon may read, so the pricing page can
      // render without an account. It must stay read-only to them.
      const rows = await h.asAnon(() => h.sql(
        `select unit_amount_cents from plan_prices where is_active`));
      expect(rows.length).toBeGreaterThan(0);
      await expect(h.asAnon(() => h.sql(
        `select app.set_plan_price('grounup','month',1,'x')`))).rejects.toThrow();
    });
  });
});
