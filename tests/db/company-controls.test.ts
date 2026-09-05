import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Everything controllable.
 *
 * An operator could read everything and change almost nothing, and every gap
 * had the same cause: the control existed for a company member, and an
 * operator is deliberately a member of no company.
 *
 * The tests worth having are the ones that hold the two refusals — a plan
 * change that would make GrounUp and Stripe disagree, and a deletion of the
 * wrong company — and the one that proves an allowance survives the next
 * invoice, which is where the obvious implementation fails.
 */
describe('everything controllable', () => {
  let h: Harness;
  const boss  = '12000000-0000-4000-8000-000000000001';
  const help  = '12000000-0000-4000-8000-000000000002';
  const owner = '12000000-0000-4000-8000-000000000003';
  let company = '', paying = '';

  const account = async (id: string, email: string) => {
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [id, email]);
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [
      [boss, 'boss@grounup.test'], [help, 'support@grounup.test'],
      [owner, 'owner@ridge.test'],
    ] as const) await account(id, email);
    await h.sql(`insert into platform_admins (user_id, reason, role)
                 values ($1,'Runs the platform','superadmin')`, [boss]);
    await h.asUser(boss, () => h.sql(
      `select app.hire_operator('support@grounup.test','Answers tickets','support')`));

    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','grounup') as id`)))[0]!.id;
    paying = (await h.asUser(boss, () => h.sql<{ id: string }>(
      `select app.create_company_for('boss@grounup.test','Paying Co','A paying tenant') as id`)))[0]!.id;
    await h.sql(`insert into subscriptions (company_id, plan_id, stripe_customer_id,
                                            stripe_subscription_id, status, quantity)
                 values ($1,'grounup','cus_p','sub_p','active',1)`, [paying]);
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('changing how many credits somebody gets', () => {
    it('gives one company more than the plan allows', async () => {
      const [before] = await h.sql<{ n: number }>(
        `select app.plan_limit($1,'ai_credits_per_month') as n`, [company]);
      expect(Number(before!.n)).toBe(500);

      await h.asUser(boss, () => h.sql(
        `select app.set_allowance($1,'ai_credits_per_month', 5000,
           'Running a pilot on plan review for us')`, [company]));
      const [after] = await h.sql<{ n: number }>(
        `select app.plan_limit($1,'ai_credits_per_month') as n`, [company]);
      expect(Number(after!.n)).toBe(5000);
    });

    it('survives the next invoice, which is where the obvious version fails', async () => {
      /*
       * The Stripe webhook upserts the whole entitlement row. An allowance
       * edited into `entitlements` would last exactly until then, which is the
       * same trap migration 0064 avoided for features.
       */
      await h.sql(`update entitlements set ai_credits_per_month = 500,
                                           updated_at = now()
                    where company_id = $1`, [company]);
      const [after] = await h.sql<{ n: number }>(
        `select app.plan_limit($1,'ai_credits_per_month') as n`, [company]);
      expect(Number(after!.n)).toBe(5000);
    });

    it('makes an allowance unlimited when that is the answer', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.set_allowance($1,'storage_gb', null, 'Enterprise agreement, no cap')`,
        [company]));
      const [r] = await h.sql<{ n: number | null }>(
        `select app.plan_limit($1,'storage_gb') as n`, [company]);
      expect(r!.n).toBeNull();
    });

    it('puts it back on the plan when cleared', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.clear_allowance($1,'ai_credits_per_month','Pilot finished')`, [company]));
      const [r] = await h.sql<{ n: number }>(
        `select app.plan_limit($1,'ai_credits_per_month') as n`, [company]);
      expect(Number(r!.n)).toBe(500);
    });

    it('leaves exactly one live override per allowance however many are set', async () => {
      for (const n of [1000, 2000, 3000]) {
        await h.asUser(boss, () => h.sql(
          `select app.set_allowance($1,'ai_credits_per_month', $2, 'Adjusting again')`,
          [company, n]));
      }
      const rows = await h.sql(
        `select id from allowance_overrides
          where company_id = $1 and allowance = 'ai_credits_per_month'
            and revoked_at is null`, [company]);
      expect(rows).toHaveLength(1);
    });

    it('is refused to an operator without the permission', async () => {
      await expect(h.asUser(help, () => h.sql(
        `select app.set_allowance($1,'storage_gb', 999, 'Being generous')`, [company])))
        .rejects.toThrow(/do not have permission/);
    });

    it('is refused to the customer themselves', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `select app.set_allowance($1,'ai_credits_per_month', 99999, 'I would like more')`,
        [company]))).rejects.toThrow(/do not have permission/);
    });
  });

  describe('moving a company between plans', () => {
    it('moves one that is not paying Stripe anything', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.set_company_plan($1,'free','Downgraded at their request')`, [company]));
      const [r] = await h.sql<{ plan: string }>(
        `select app.effective_plan($1) as plan`, [company]);
      expect(r!.plan).toBe('free');
    });

    it('refuses one with a live Stripe subscription', async () => {
      /*
       * Moving their entitlement here would leave GrounUp saying one thing and
       * Stripe billing another until somebody noticed — which is the
       * disagreement the dashboard already counts.
       */
      await expect(h.asUser(boss, () => h.sql(
        `select app.set_company_plan($1,'free','Trying to downgrade a payer')`, [paying])))
        .rejects.toThrow(/live Stripe subscription/);
    });

    it('refuses a plan that does not exist', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.set_company_plan($1,'platinum','Inventing a plan')`, [company])))
        .rejects.toThrow(/does not exist/);
    });
  });

  describe('the trial', () => {
    it('can be changed, which it could not before', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.set_plan_trial('grounup', 30, 'Thirty converts better than fourteen')`));
      const [r] = await h.sql<{ days: number }>(
        `select trial_days as days from plans where id = 'grounup'`);
      expect(Number(r!.days)).toBe(30);
    });

    it('refuses a trial longer than a year', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.set_plan_trial('grounup', 400, 'Forever')`)))
        .rejects.toThrow(/between nothing and a year/);
    });

    it('is the superadmin and whoever prices things, not support', async () => {
      await expect(h.asUser(help, () => h.sql(
        `select app.set_plan_trial('grounup', 60, 'Being generous')`)))
        .rejects.toThrow(/do not have permission/);
    });
  });

  describe('what the free plan gives away', () => {
    it('can be changed without a deployment', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.set_plan_limits('free', 3, 10, 1, 2, 50,
           'Two seats was too tight to evaluate it properly')`));
      const [r] = await h.sql<{ seats: number; credits: number }>(
        `select max_seats as seats, ai_credits_per_month as credits
           from plans where id = 'free'`);
      expect(Number(r!.seats)).toBe(3);
      expect(Number(r!.credits)).toBe(50);
    });

    it('reaches the companies on it immediately', async () => {
      // plan_limit reads the plan rather than a copy of it.
      const free = (await h.asUser(boss, () => h.sql<{ id: string }>(
        `select app.create_company_for('support@grounup.test','Free Co','Testing the free tier') as id`)))[0]!.id;
      await h.asUser(boss, () => h.sql(
        `select app.set_company_plan($1,'free','On the free tier')`, [free]));
      const [r] = await h.sql<{ n: number }>(
        `select app.plan_limit($1,'max_seats') as n`, [free]);
      expect(Number(r!.n)).toBe(3);
    });

    it('changes what the free plan includes', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.set_plan_features('free',
           array['estimating','takeoff','master_libraries','crm_basic','proposals',
                 'documents','scheduling'],
           'Scheduling brings people back daily, which is what a free tier is for')`));
      const [r] = await h.sql<{ features: string[] }>(
        `select features from plans where id = 'free'`);
      expect(r!.features).toContain('scheduling');
    });

    it('refuses a feature that does not exist, because a typo grants nothing', async () => {
      /*
       * `has_entitlement` matches on exact string equality, so 'scheduleing'
       * would have been accepted and been worth precisely nothing.
       */
      await expect(h.asUser(boss, () => h.sql(
        `select app.set_plan_features('free', array['estimating','scheduleing'],
           'A typo, deliberately')`)))
        .rejects.toThrow(/No such feature: scheduleing/);
    });

    it('says which features the database actually enforces', async () => {
      // A feature key nothing gates is a line on a pricing page and nothing in
      // the product, and this is where that difference is visible.
      const [r] = await h.sql<{ enforced: boolean }>(
        `select enforced from feature_catalog where key = 'projects'`);
      expect(r!.enforced).toBe(true);
      const [soft] = await h.sql<{ enforced: boolean }>(
        `select enforced from feature_catalog where key = 'estimating'`);
      expect(soft!.enforced).toBe(false);
    });

    it('is the superadmin to change, not support', async () => {
      await expect(h.asUser(help, () => h.sql(
        `select app.set_plan_limits('free', 99, 99, 99, 99, 9999, 'Being generous')`)))
        .rejects.toThrow(/do not have permission/);
    });
  });

  describe('deleting a company', () => {
    it('refuses unless the name is typed exactly', async () => {
      /*
       * Not for show. This is the one action with no undo, and the difference
       * between deleting Ridgeline and Ridgeline Excavating is one click in a
       * dropdown.
       */
      await expect(h.asUser(boss, () => h.sql(
        `select app.delete_company($1,'Ridgeline Excavating',
           'They asked to be removed entirely')`, [company])))
        .rejects.toThrow(/Type the company name exactly/);
    });

    it('refuses one that is still being charged', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.delete_company($1,'Paying Co',
           'Tidying up a tenant we no longer need')`, [paying])))
        .rejects.toThrow(/live Stripe subscription/);
    });

    it('refuses somebody without the permission', async () => {
      await expect(h.asUser(help, () => h.sql(
        `select app.delete_company($1,'Ridgeline','Tidying up after a support call')`,
        [company]))).rejects.toThrow(/do not have permission/);
    });

    it('deletes it, and everything it owned', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.delete_company($1,'Ridgeline',
           'They asked to be removed entirely under their own data request')`, [company]));
      expect(await h.sql(`select id from companies where id = $1`, [company])).toHaveLength(0);
      expect(await h.sql(`select id from entitlements where company_id = $1`, [company]))
        .toHaveLength(0);
    });

    it('leaves the record of the deletion behind', async () => {
      // audit_events.company_id is set null on delete, so the row survives and
      // correctly stops pointing at something that is gone.
      const [a] = await h.sql<{ reason: string; company_id: string | null }>(
        `select reason, company_id from audit_events
          where entity_table = 'public.companies' and entity_id = $1
            and action = 'delete'`, [company]);
      expect(a!.reason).toMatch(/own data request/);
      expect(a!.company_id).toBeNull();
    });
  });

  describe('what an operator sees for one company', () => {
    it('shows the allowances after every override, not what the plan says', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{
        ai_credits_per_month: number; overridden: string[] | null;
      }>(`select ai_credits_per_month, overridden from admin_company_controls
           where company_id = $1`, [paying]));
      expect(r).toBeDefined();
      expect(r!.overridden).toBeNull();
    });

    it('shows a customer none of it', async () => {
      const rows = await h.asUser(owner, () => h.sql(`select * from admin_company_controls`));
      expect(rows).toHaveLength(0);
    });
  });
});
