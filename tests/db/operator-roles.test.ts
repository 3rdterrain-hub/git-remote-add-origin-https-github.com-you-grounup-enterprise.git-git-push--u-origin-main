import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * One superadmin, and the people who sell for them.
 *
 * Migration 0064 gave the platform one kind of operator, which is wrong for how
 * a business runs: somebody sells and somebody decides. Giving the first the
 * powers of the second is how a discount nobody approved becomes permanent.
 *
 * The tests that matter are the refusals — what a sales admin cannot do — and
 * the one that stops the superadmin quietly approving their own proposal.
 */
describe('platform operator roles', () => {
  let h: Harness;
  const boss     = '11111111-1111-4111-8111-111111111111';
  const seller   = '22222222-2222-4222-8222-222222222222';
  const customer = '33333333-3333-4333-8333-333333333333';
  let company = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [
      [boss, 'boss@grounup.test'], [seller, 'sales@grounup.test'], [customer, 'c@r.test'],
    ] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2) on conflict (id) do nothing`,
        [id, email]);
    }
    await h.sql(`insert into platform_admins (user_id, reason, role)
                 values ($1,'Runs the platform','superadmin')`, [boss]);
    await h.sql(`insert into platform_admins (user_id, reason, role)
                 values ($1,'Sells the platform','sales')`, [seller]);

    company = (await h.asUser(customer, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','starter') as id`)))[0]!.id;
  });

  afterAll(async () => { await h?.db.close(); });

  describe('there is exactly one superadmin', () => {
    it('refuses a second', async () => {
      /*
       * "There should only be one" is the kind of rule that quietly stops being
       * true, so it is a unique index rather than a convention.
       *
       * A fresh person, deliberately: promoting somebody who already holds a
       * live grant trips the one-grant-per-person index instead, and the test
       * would pass while proving nothing about how many superadmins there are.
       */
      const rival = '55555555-5555-4555-8555-555555555555';
      await h.sql(`insert into auth.users (id, email) values ($1,'rival@g.test')`, [rival]);
      await h.sql(`insert into user_profiles (id, email) values ($1,'rival@g.test') on conflict (id) do nothing`, [rival]);
      await expect(h.sql(
        `insert into platform_admins (user_id, reason, role)
         values ($1,'Also in charge','superadmin')`, [rival]))
        .rejects.toThrow(/platform_admins_one_superadmin/);
    });

    it('lets the role be handed over once the first is revoked', async () => {
      const interim = '44444444-4444-4444-8444-444444444444';
      await h.sql(`insert into auth.users (id, email) values ($1,'i@g.test')`, [interim]);
      await h.sql(`insert into user_profiles (id, email) values ($1,'i@g.test') on conflict (id) do nothing`, [interim]);
      await h.sql(`update platform_admins set revoked_at = now(), revoke_reason = 'Handover'
                    where user_id = $1 and role = 'superadmin'`, [boss]);
      await h.sql(`insert into platform_admins (user_id, reason, role)
                   values ($1,'Took over','superadmin')`, [interim]);
      // Put it back for the rest of the suite.
      await h.sql(`update platform_admins set revoked_at = now(), revoke_reason = 'Returned'
                    where user_id = $1`, [interim]);
      await h.sql(`update platform_admins set revoked_at = null, revoke_reason = null
                    where user_id = $1 and role = 'superadmin'`, [boss]);
      const [n] = await h.sql<{ n: string }>(
        `select count(*)::text as n from platform_admins
          where role = 'superadmin' and revoked_at is null`);
      expect(Number(n!.n)).toBe(1);
    });

    it('tells the two roles apart', async () => {
      const [b] = await h.asUser(boss, () => h.sql<{ a: boolean; s: boolean }>(
        `select app.is_platform_admin() as a, app.is_superadmin() as s`));
      expect(b!.a).toBe(true);
      expect(b!.s).toBe(true);

      const [s] = await h.asUser(seller, () => h.sql<{ a: boolean; s: boolean }>(
        `select app.is_platform_admin() as a, app.is_superadmin() as s`));
      expect(s!.a).toBe(true);
      expect(s!.s).toBe(false);
    });
  });

  describe('what sales can do', () => {
    it('sees every tenant, like any operator', async () => {
      const rows = await h.asUser(seller, () => h.sql(`select 1 from admin_companies`));
      expect(rows.length).toBeGreaterThan(0);
    });

    it('still sees no customer business data', async () => {
      // The 0064 boundary is unchanged. This adds roles, not reach.
      for (const table of ['estimates', 'projects', 'project_costs', 'documents']) {
        expect(await h.asUser(seller, () => h.sql(`select 1 from ${table} limit 3`))).toEqual([]);
      }
    });

    it('cannot change a customer entitlement', async () => {
      /*
       * The whole reason the role exists. Selling and deciding are different
       * jobs, and this is the line between them.
       */
      await expect(h.asUser(seller, () => h.sql(
        `select app.set_feature_override($1,'white_label','grant','Customer asked nicely')`,
        [company]))).rejects.toThrow(/do not have permission/);
    });

    it('cannot withdraw one either', async () => {
      await expect(h.asUser(seller, () => h.sql(
        `select app.clear_feature_override($1,'white_label','No longer needed')`, [company])))
        .rejects.toThrow(/do not have permission/);
    });

    it('can propose an upsell, with a reason', async () => {
      const [r] = await h.asUser(seller, () => h.sql<{ id: string }>(
        `select app.propose_upsell($1,'business',array['white_label'],
           'They have hit the seat limit twice this quarter and asked about branding',
           29900) as id`, [company]));
      expect(r!.id).toBeTruthy();
    });

    it('cannot propose without saying why this customer, and why now', async () => {
      /*
       * The rationale is the thing that makes this mechanism worth more than
       * simply granting sales the permission: six months later somebody asks
       * why this account is priced this way, and there is an answer.
       */
      await expect(h.asUser(seller, () => h.sql(
        `select app.propose_upsell($1,'business',array[]::text[],'because')`, [company])))
        .rejects.toThrow(/why this customer, and why now/);
    });

    it('cannot propose nothing at all', async () => {
      await expect(h.asUser(seller, () => h.sql(
        `select app.propose_upsell($1,null,array[]::text[],
           'They seem like they might want something eventually')`, [company])))
        .rejects.toThrow(/proposes nothing is not a proposal/);
    });

    it('cannot decide its own proposal', async () => {
      const id = (await h.asUser(seller, () => h.sql<{ id: string }>(
        `select app.propose_upsell($1,'professional',array[]::text[],
           'Steady growth, three new estimators this quarter') as id`, [company])))[0]!.id;
      await expect(h.asUser(seller, () => h.sql(
        `select app.decide_upsell($1, true)`, [id])))
        .rejects.toThrow(/do not have permission to decide/);
    });
  });

  describe('what the superadmin does', () => {
    let proposal = '';
    beforeAll(async () => {
      proposal = (await h.asUser(seller, () => h.sql<{ id: string }>(
        `select app.propose_upsell($1,'business',array['white_label'],
           'Hit the seat limit twice and asked about branding', 29900) as id`,
        [company])))[0]!.id;
    });

    it('approves a proposal', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.decide_upsell($1, true, 'Agreed at the quoted price')`, [proposal]));
      const [p] = await h.sql<{ state: string; decided_by: string }>(
        `select state, decided_by from upsell_proposals where id = $1`, [proposal]);
      expect(p!.state).toBe('approved');
      expect(p!.decided_by).toBe(boss);
    });

    it('does not apply it as a side effect of approving it', async () => {
      /*
       * "We agreed to this" and "this is live on their account" are different
       * facts, and collapsing them means nobody can tell which one is true.
       */
      const [r] = await h.asUser(customer, () => h.sql<{ has: boolean }>(
        `select app.has_entitlement($1,'white_label') as has`, [company]));
      expect(r!.has).toBe(false);
    });

    it('applies it as a separate, audited act', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.set_feature_override($1,'white_label','grant',
           'Approved upsell, proposal on file')`, [company]));
      const [r] = await h.asUser(customer, () => h.sql<{ has: boolean }>(
        `select app.has_entitlement($1,'white_label') as has`, [company]));
      expect(r!.has).toBe(true);
    });

    it('cannot decide the same proposal twice', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.decide_upsell($1, false, 'Changed my mind')`, [proposal])))
        .rejects.toThrow(/already approved/);
    });

    it('must say why when rejecting', async () => {
      const id = (await h.asUser(seller, () => h.sql<{ id: string }>(
        `select app.propose_upsell($1,'business',array[]::text[],
           'Worth a try on this account I think') as id`, [company])))[0]!.id;
      await expect(h.asUser(boss, () => h.sql(`select app.decide_upsell($1, false)`, [id])))
        .rejects.toThrow(/rejection has to say why/);
    });

    it('cannot approve a proposal it wrote itself', async () => {
      // The same segregation the platform enforces inside a tenant, applied to
      // its own commercial decisions.
      const own = (await h.asUser(boss, () => h.sql<{ id: string }>(
        `select app.propose_upsell($1,'business',array[]::text[],
           'I spoke to them myself at the trade show') as id`, [company])))[0]!.id;
      await expect(h.asUser(boss, () => h.sql(`select app.decide_upsell($1, true)`, [own])))
        .rejects.toThrow(/cannot be the one who approves it/);
    });
  });

  describe('where the potential is', () => {
    it('names why a customer is worth a call', async () => {
      /*
       * Under one plan the reason is never "there is a bigger plan" — there
       * isn't one. It is seats in use against seats billed, which is the whole
       * commercial relationship on a per-seat plan.
       */
      await h.sql(`insert into subscriptions
                     (company_id, stripe_subscription_id, stripe_customer_id,
                      plan_id, status, quantity, current_period_start, current_period_end)
                   values ($1,'sub_test','cus_test','grounup','active',1,
                           now() - interval '3 days', now() + interval '27 days')`,
        [company]);
      for (const [id, email] of [
        ['66666666-6666-4666-8666-666666666666', 'crew1@r.test'],
        ['77777777-7777-4777-8777-777777777777', 'crew2@r.test'],
      ] as const) {
        await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
        await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                     on conflict (id) do nothing`, [id, email]);
        await h.sql(`insert into company_memberships (company_id, user_id, role_id, status)
                     select $1, $2, r.id, 'active' from roles r
                      where r.company_id = $1 or r.company_id is null
                      order by r.company_id nulls last, r.approval_tier limit 1`,
          [company, id]);
      }

      const [r] = await h.asUser(seller, () => h.sql<{
        signal: string | null; seats_in_use: number;
        seats_billed: number; seats_unbilled: number;
      }>(`select signal, seats_in_use, seats_billed, seats_unbilled
            from admin_upsell_potential where company_id = $1`, [company]));
      expect(Number(r!.seats_in_use)).toBe(3);
      expect(Number(r!.seats_billed)).toBe(1);
      expect(Number(r!.seats_unbilled)).toBe(2);
      expect(r!.signal).toBe('Using 3 seats, billed for 1');
    });

    it('says nothing rather than inventing a reason', async () => {
      // A customer inside every allowance, billed for what they use, has no
      // upsell — and a pipeline that admits that is one an operator can trust.
      await h.sql(`update subscriptions set quantity = 3 where company_id = $1`, [company]);
      const [r] = await h.asUser(seller, () => h.sql<{ signal: string | null }>(
        `select signal from admin_upsell_potential where company_id = $1`, [company]));
      expect(r!.signal).toBeNull();
      // Put the gap back for the tests that follow.
      await h.sql(`update subscriptions set quantity = 1 where company_id = $1`, [company]);
    });

    it('counts the proposals already open on an account', async () => {
      const [r] = await h.asUser(seller, () => h.sql<{ open_proposals: string }>(
        `select open_proposals from admin_upsell_potential where company_id = $1`, [company]));
      expect(Number(r!.open_proposals)).toBeGreaterThan(0);
    });

    it('shows a customer nothing of any of it', async () => {
      expect(await h.asUser(customer, () => h.sql(`select 1 from admin_upsell_potential`)))
        .toEqual([]);
      expect(await h.asUser(customer, () => h.sql(`select 1 from upsell_proposals`)))
        .toEqual([]);
    });
  });
});
