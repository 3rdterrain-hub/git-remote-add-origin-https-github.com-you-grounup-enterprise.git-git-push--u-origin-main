import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * A plan of your own, and money by the period asked for.
 *
 * The catalog was fixed at seed time, so making a plan for one customer meant
 * writing a migration. The tests worth having are the ones holding what a
 * negotiated plan must not become: something on the public pricing page by
 * accident, or something with a feature key that grants nothing.
 */
describe('a plan of your own', () => {
  let h: Harness;
  const boss = '15000000-0000-4000-8000-000000000001';
  const help = '15000000-0000-4000-8000-000000000002';
  const cust = '15000000-0000-4000-8000-000000000003';

  const account = async (id: string, email: string) => {
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [id, email]);
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [
      [boss, 'boss@grounup.test'], [help, 'support@grounup.test'],
      [cust, 'owner@third.test'],
    ] as const) await account(id, email);
    await h.sql(`insert into platform_admins (user_id, reason, role)
                 values ($1,'Runs the platform','superadmin')`, [boss]);
    await h.asUser(boss, () => h.sql(
      `select app.hire_operator('support@grounup.test','Answers tickets','support')`));
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('creating one', () => {
    it('makes a plan for one customer, off the pricing page', async () => {
      /*
       * Private by default. A negotiated plan appearing on the public page is
       * the one mistake here that is visible to everybody at once.
       */
      await h.asUser(boss, () => h.sql(
        `select app.create_plan('third_terrain','3RD Terrain',
           'Everything, on our own terms', 'The house plan.',
           null, null, null, null, null,
           array['*'], 0, false)`));
      const [p] = await h.sql<{ is_public: boolean; is_active: boolean; tier: number }>(
        `select is_public, is_active, tier from plans where id = 'third_terrain'`);
      expect(p!.is_public).toBe(false);
      expect(p!.is_active).toBe(true);
      // Above everything sold: a negotiated plan is not a rung on a ladder.
      expect(Number(p!.tier)).toBe(100);
    });

    it('keeps it off the list a visitor sees', async () => {
      const rows = await h.asAnon(() => h.sql<{ id: string }>(
        `select id from plans order by id`));
      expect(rows.map((r) => r.id)).not.toContain('third_terrain');
    });

    it('refuses a feature that grants nothing', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.create_plan('typo_plan','Typo','x','y',
           1,1,1,1,1, array['estimating','schedulng'], 0, false)`)))
        .rejects.toThrow(/No such feature: schedulng/);
    });

    it('refuses a name that is already taken', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.create_plan('grounup','Another one','x','y',
           1,1,1,1,1, array['estimating'], 0, false)`)))
        .rejects.toThrow(/already a plan called/);
    });

    it('refuses an id nothing could reference cleanly', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.create_plan('3RD Terrain!','x','y','z',
           1,1,1,1,1, array['estimating'], 0, false)`)))
        .rejects.toThrow(/lower case letters/);
    });

    it('is the superadmin to do, not support', async () => {
      await expect(h.asUser(help, () => h.sql(
        `select app.create_plan('support_plan','x','y','z',
           1,1,1,1,1, array['estimating'], 0, false)`)))
        .rejects.toThrow(/do not have permission/);
    });
  });

  describe('putting a company on it', () => {
    it('creates a company straight onto the plan somebody chose', async () => {
      /*
       * The plan used to default to `grounup` with no way to say otherwise,
       * which is wrong for exactly the customer somebody is creating a company
       * for — usually the one on different terms in the first place.
       */
      const id = (await h.asUser(boss, () => h.sql<{ id: string }>(
        `select app.create_company_for('owner@third.test','Third Terrain',
           'The house account', null, 'third_terrain') as id`)))[0]!.id;
      const [e] = await h.sql<{ plan: string }>(
        `select app.effective_plan($1) as plan`, [id]);
      expect(e!.plan).toBe('third_terrain');
    });

    it('gives them everything, because that is what the plan says', async () => {
      const [id] = await h.sql<{ id: string }>(
        `select id from companies where slug like 'third-terrain%'`);
      const [r] = await h.sql<{ has: boolean }>(
        `select app.has_entitlement($1,'scheduling') as has`, [id!.id]);
      expect(r!.has).toBe(true);
    });

    it('still defaults to the paid plan when nobody says otherwise', async () => {
      const id = (await h.asUser(boss, () => h.sql<{ id: string }>(
        `select app.create_company_for('support@grounup.test','Ordinary Co',
           'A normal tenant') as id`)))[0]!.id;
      const [e] = await h.sql<{ plan: string }>(
        `select app.effective_plan($1) as plan`, [id]);
      expect(e!.plan).toBe('grounup');
    });

    it('refuses a plan that was retired', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.set_plan_visibility('third_terrain', false, false,
           'Retiring the house plan')`));
      await expect(h.asUser(boss, () => h.sql(
        `select app.create_company_for('owner@third.test','Another Co',
           'Should not work', null, 'third_terrain')`)))
        .rejects.toThrow(/does not exist, or is retired/);
    });

    it('leaves the company already on it exactly where it was', async () => {
      // Retiring a plan stops anybody else buying it. It does not move the
      // people who already did — an entitlement holds its own terms.
      const [id] = await h.sql<{ id: string }>(
        `select id from companies where slug like 'third-terrain%'`);
      const [e] = await h.sql<{ plan: string }>(
        `select app.effective_plan($1) as plan`, [id!.id]);
      expect(e!.plan).toBe('third_terrain');
    });
  });

  describe('money by the period asked for', () => {
    beforeAll(async () => {
      const [id] = await h.sql<{ id: string }>(
        `select id from companies where slug like 'third-terrain%'`);
      await h.sql(`insert into billing_invoices (company_id, stripe_invoice_id, status,
                                                 amount_due_cents, amount_paid_cents,
                                                 period_start, period_end)
                   values ($1,'in_w','paid',19900,19900, now() - interval '2 days', now()),
                          ($1,'in_y','paid',50000,50000,
                           now() - interval '400 days', now() - interval '370 days')`,
        [id!.id]);
    });

    it('reports a week', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{ paid: string }>(
        `select paid_cents as paid from app.earnings('week', 4)
          where period = date_trunc('week', now())`));
      expect(Number(r!.paid)).toBe(19900);
    });

    it('reports a year, which gathers what the week could not show', async () => {
      const rows = await h.asUser(boss, () => h.sql<{ paid: string }>(
        `select paid_cents as paid from app.earnings('year', 3)`));
      const total = rows.reduce((a, r) => a + Number(r.paid), 0);
      expect(total).toBe(69900);
    });

    it('returns as many periods as asked for', async () => {
      const rows = await h.asUser(boss, () => h.sql(`select period from app.earnings('week', 12)`));
      expect(rows).toHaveLength(12);
    });

    it('refuses a grain nobody reports on', async () => {
      await expect(h.asUser(boss, () => h.sql(`select * from app.earnings('fortnight', 4)`)))
        .rejects.toThrow(/week, month or year/);
    });

    it('shows a customer nothing', async () => {
      const rows = await h.asUser(cust, () => h.sql(`select * from app.earnings('month', 3)`));
      expect(rows).toHaveLength(0);
    });
  });
});
