import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * What your staff did.
 *
 * No new recording — these are the same rows a customer reads in their own
 * history, joined down the operator axis instead of the tenant one. So the
 * tests worth having are about what the join must not lose: an operator whose
 * access was withdrawn, and the actions that belong to no tenant at all.
 */
describe('what your staff did', () => {
  let h: Harness;
  const boss  = '0d000000-0000-4000-8000-000000000001';
  const help  = '0d000000-0000-4000-8000-000000000002';
  const gone  = '0d000000-0000-4000-8000-000000000003';
  const owner = '0d000000-0000-4000-8000-000000000004';
  let company = '';

  const account = async (id: string, email: string) => {
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [id, email]);
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [
      [boss, 'boss@grounup.test'], [help, 'support@grounup.test'],
      [gone, 'left@grounup.test'], [owner, 'owner@ridge.test'],
    ] as const) await account(id, email);
    await h.sql(`insert into platform_admins (user_id, reason, role)
                 values ($1,'Runs the platform','superadmin')`, [boss]);
    await h.asUser(boss, () => h.sql(
      `select app.hire_operator('support@grounup.test','Answers billing tickets','support')`));
    await h.asUser(boss, () => h.sql(
      `select app.hire_operator('left@grounup.test','Covering the summer','support')`));

    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','grounup') as id`)))[0]!.id;

    // Somebody does some work, then leaves.
    await h.asUser(gone, () => h.sql(
      `select app.open_support_session($1,'Customer asked about the September invoice')`,
      [company]));
    await h.asUser(boss, () => h.sql(
      `select app.revoke_operator($1,'Summer cover finished')`, [gone]));

    // And a platform-wide action, belonging to no tenant.
    await h.asUser(boss, () => h.sql(
      `select app.set_plan_price('grounup','month',19900,'price_month')`));
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('reading down the operator axis', () => {
    it('finds what somebody did, across companies', async () => {
      const rows = await h.asUser(boss, () => h.sql<{
        operator_email: string; entity_table: string; reason: string;
      }>(`select operator_email, entity_table, reason from admin_operator_activity
           where operator_id = $1`, [gone]));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]!.operator_email).toBe('left@grounup.test');
      expect(rows.some((r) => /September invoice/.test(r.reason ?? ''))).toBe(true);
    });

    it('keeps the history of somebody whose access was withdrawn', async () => {
      /*
       * The week before somebody was let go is usually the week worth reading,
       * and a view joined only to live grants would hide exactly that.
       */
      const [r] = await h.asUser(boss, () => h.sql<{ revoked: boolean }>(
        `select operator_since_revoked as revoked from admin_operator_activity
          where operator_id = $1 limit 1`, [gone]));
      expect(r!.revoked).toBe(true);
    });

    it('includes the actions that belong to no customer at all', async () => {
      // Publishing a price, editing a role, taking somebody on: rows with a
      // null company that nothing previously read.
      const rows = await h.asUser(boss, () => h.sql<{ entity_table: string }>(
        `select entity_table from admin_operator_activity where platform_wide`));
      expect(rows.map((r) => r.entity_table)).toContain('public.plan_prices');
    });

    it('names the company where there is one', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{ company_name: string }>(
        `select company_name from admin_operator_activity
          where entity_table = 'public.support_sessions' limit 1`));
      expect(r!.company_name).toBe('Ridgeline');
    });

    it('shows nothing a customer did, only operators', async () => {
      /*
       * The join is to platform_admins, so a company owner creating an estimate
       * never appears here however much they do.
       */
      await h.asUser(owner, () => h.sql(
        `insert into estimates (company_id, number, name)
         values ($1,'E-1','Their own work')`, [company]));
      const rows = await h.asUser(boss, () => h.sql<{ entity_table: string }>(
        `select entity_table from admin_operator_activity`));
      expect(rows.map((r) => r.entity_table)).not.toContain('public.estimates');
    });
  });

  describe('the summary', () => {
    it('counts what each operator has done and how far it reached', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{
        actions_30_days: string; companies_touched: string; accounts_opened: string;
      }>(`select actions_30_days, companies_touched, accounts_opened
            from admin_operator_summary where operator_id = $1`, [gone]));
      expect(Number(r!.actions_30_days)).toBeGreaterThan(0);
      expect(Number(r!.companies_touched)).toBe(1);
      expect(Number(r!.accounts_opened)).toBe(1);
    });

    it('lists an operator who has done nothing at all', async () => {
      /*
       * An account with access and no activity is as worth seeing as a busy
       * one: an account nobody uses is an account nobody would notice being
       * used.
       */
      const [r] = await h.asUser(boss, () => h.sql<{ actions_30_days: string }>(
        `select actions_30_days from admin_operator_summary where operator_id = $1`, [help]));
      expect(r).toBeDefined();
      expect(Number(r!.actions_30_days)).toBe(0);
    });

    it('says whose access has been withdrawn', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{ access_withdrawn: boolean }>(
        `select access_withdrawn from admin_operator_summary where operator_id = $1`, [gone]));
      expect(r!.access_withdrawn).toBe(true);
    });
  });

  describe('one company history', () => {
    it('answers "who changed this", oldest first', async () => {
      const rows = await h.asUser(boss, () => h.sql<{
        operator_email: string; occurred_at: string;
      }>(`select operator_email, occurred_at from admin_company_operator_history
           where company_id = $1`, [company]));
      expect(rows.length).toBeGreaterThan(0);
      const times = rows.map((r) => new Date(r.occurred_at).getTime());
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    });

    it('is open to somebody supporting the customer, not only to whoever manages staff', async () => {
      // Knowing what has already been done to a customer is part of supporting
      // them; knowing what every colleague did all week is not.
      const history = await h.asUser(help, () => h.sql(
        `select occurred_at from admin_company_operator_history where company_id = $1`,
        [company]));
      expect(history.length).toBeGreaterThan(0);
      const everything = await h.asUser(help, () => h.sql(
        `select id from admin_operator_activity`));
      expect(everything).toHaveLength(0);
    });
  });

  describe('who may read it', () => {
    it('shows a customer none of it', async () => {
      for (const view of ['admin_operator_activity', 'admin_operator_summary',
                          'admin_company_operator_history']) {
        const rows = await h.asUser(owner, () => h.sql(`select * from ${view}`));
        expect(rows, view).toHaveLength(0);
      }
    });

    it('still shows that customer their own history, in their own ledger', async () => {
      /*
       * The point of auditing into the tenant's ledger in the first place: the
       * company can read what was done to them, and this feature changed
       * nothing about that.
       */
      const rows = await h.asUser(owner, () => h.sql<{ reason: string }>(
        `select reason from audit_events
          where company_id = $1 and entity_table = 'public.support_sessions'`, [company]));
      expect(rows.some((r) => /September invoice/.test(r.reason ?? ''))).toBe(true);
    });

    it('shows an anonymous visitor nothing at all', async () => {
      await expect(h.asAnon(() => h.sql(`select * from admin_operator_activity`)))
        .rejects.toThrow(/permission denied/);
    });
  });
});
