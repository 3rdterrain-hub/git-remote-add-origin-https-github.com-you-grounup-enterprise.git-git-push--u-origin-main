import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * An operator looking inside a customer's subscription.
 *
 * The tests that matter here are the refusals, because this is the feature
 * most likely to quietly become "operators can read everything": that the
 * billing view is closed without a session, that it closes again when the
 * session expires, that the customer can see it happened, and that none of it
 * opens a single estimate.
 */
describe('looking at a customer account', () => {
  let h: Harness;
  const boss = 'cccccccc-0000-4000-8000-000000000001';
  const rep  = 'cccccccc-0000-4000-8000-000000000002';
  const cust = 'cccccccc-0000-4000-8000-000000000003';
  let company = '';

  const account = async (id: string, email: string) => {
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [id, email]);
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await account(boss, 'boss@grounup.test');
    await account(rep, 'support@grounup.test');
    await account(cust, 'owner@ridge.test');
    await h.sql(`insert into platform_admins (user_id, reason, role)
                 values ($1,'Runs the platform','superadmin')`, [boss]);

    company = (await h.asUser(cust, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','grounup') as id`)))[0]!.id;
    await h.sql(`insert into estimates (company_id, number, name)
                 values ($1,'E-1','Their private bid')`, [company]);

    await h.asUser(boss, () => h.sql(
      `select app.hire_operator('support@grounup.test','Answers billing tickets','support')`));
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('before a session is opened', () => {
    it('shows an operator nothing of the account', async () => {
      const rows = await h.asUser(rep, () => h.sql(
        `select company_id from admin_company_billing where company_id = $1`, [company]));
      expect(rows).toHaveLength(0);
    });

    it('reports plainly that nothing is open', async () => {
      const [r] = await h.asUser(rep, () => h.sql<{ open: boolean }>(
        `select app.is_supporting($1) as open`, [company]));
      expect(r!.open).toBe(false);
    });
  });

  describe('opening one', () => {
    it('will not open without saying what is being looked into', async () => {
      await expect(h.asUser(rep, () => h.sql(
        `select app.open_support_session($1,'looking')`, [company])))
        .rejects.toThrow(/Say what you are looking into/);
    });

    it('is its own permission, not merely reading billing', async () => {
      /*
       * Finance can read every revenue figure on the platform and cannot open
       * a single account. Seeing what an account pays and looking inside it
       * are different levels of intrusion, and folding them together would
       * hand the second to everybody who needed the first.
       */
      const books = 'cccccccc-0000-4000-8000-000000000006';
      await account(books, 'books@grounup.test');
      await h.asUser(boss, () => h.sql(
        `select app.hire_operator('books@grounup.test','Reconciles invoices','finance')`));
      const [can] = await h.asUser(books, () => h.sql<{ read: boolean; open: boolean }>(
        `select app.operator_can('billing.read') as read,
                app.operator_can('support.open') as open`));
      expect(can!.read).toBe(true);
      expect(can!.open).toBe(false);
      await expect(h.asUser(books, () => h.sql(
        `select app.open_support_session($1,'Just having a look at this one')`, [company])))
        .rejects.toThrow(/do not have permission to open/);
    });

    it('refuses an operator who does not do support', async () => {
      const seller = 'cccccccc-0000-4000-8000-000000000004';
      await account(seller, 'sales@grounup.test');
      await h.asUser(boss, () => h.sql(
        `select app.hire_operator('sales@grounup.test','Sells the platform','sales')`));
      await expect(h.asUser(seller, () => h.sql(
        `select app.open_support_session($1,'Curious about this account')`, [company])))
        .rejects.toThrow(/do not have permission/);
    });

    it('refuses a customer opening one on somebody else', async () => {
      await expect(h.asUser(cust, () => h.sql(
        `select app.open_support_session($1,'I would like a look around')`, [company])))
        .rejects.toThrow(/do not have permission/);
    });

    it('opens the billing view once a session is live', async () => {
      await h.asUser(rep, () => h.sql(
        `select app.open_support_session($1,
           'Customer says they were charged twice in March')`, [company]));
      const [r] = await h.asUser(rep, () => h.sql<{
        company_name: string; plan_id: string; seats: number;
      }>(`select company_name, plan_id, seats from admin_company_billing
           where company_id = $1`, [company]));
      expect(r!.company_name).toBe('Ridgeline');
      expect(r!.plan_id).toBe('grounup');
      expect(Number(r!.seats)).toBe(1);
    });

    it('opens that account and no other', async () => {
      const other = (await h.asUser(boss, () => h.sql<{ id: string }>(
        `select app.create_company_for('boss@grounup.test','Other Co','A second tenant') as id`)))[0]!.id;
      const rows = await h.asUser(rep, () => h.sql(
        `select company_id from admin_company_billing where company_id = $1`, [other]));
      expect(rows).toHaveLength(0);
    });
  });

  describe('what it deliberately does not open', () => {
    it('still shows the operator none of the customer work', async () => {
      // The whole design. A billing session is a billing session.
      const rows = await h.asUser(rep, () => h.sql(
        `select id from estimates where company_id = $1`, [company]));
      expect(rows).toHaveLength(0);
    });

    it('never turns the operator into a member of the company', async () => {
      const [r] = await h.asUser(rep, () => h.sql<{ member: boolean }>(
        `select app.is_member($1) as member`, [company]));
      expect(r!.member).toBe(false);
    });

    it('carries no card number, because there is none to carry', async () => {
      const cols = await h.sql<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_name = 'admin_company_billing'`);
      const names = cols.map((c) => c.column_name);
      expect(names).toContain('card_last4');
      expect(names.some((n) => n.includes('number') && n.includes('card'))).toBe(false);
    });
  });

  describe('the customer can see it happened', () => {
    it('finds the session in their own account history', async () => {
      const [a] = await h.asUser(cust, () => h.sql<{ reason: string }>(
        `select reason from audit_events
          where company_id = $1 and entity_table = 'public.support_sessions'
            and reason is not null`, [company]));
      expect(a!.reason).toMatch(/charged twice in March/);
    });

    it('can read who opened it and when it ends', async () => {
      const [s] = await h.asUser(cust, () => h.sql<{
        operator_id: string; expires_at: string; scope: string;
      }>(`select operator_id, expires_at, scope from support_sessions
           where company_id = $1`, [company]));
      expect(s!.operator_id).toBe(rep);
      expect(s!.scope).toBe('billing');
    });

    it('shows one company nothing of a session on another', async () => {
      const stranger = 'cccccccc-0000-4000-8000-000000000005';
      await account(stranger, 'stranger@elsewhere.test');
      const rows = await h.asUser(stranger, () => h.sql(
        `select id from support_sessions`));
      expect(rows).toHaveLength(0);
    });
  });

  describe('when it ends', () => {
    it('closes on its own when the hour is up, with nothing having to run', async () => {
      // An hour passing, rather than an hour waited.
      await h.sql(`update support_sessions
                      set opened_at = now() - interval '2 hours',
                          expires_at = now() - interval '1 hour'
                    where company_id = $1 and closed_at is null`, [company]);
      const rows = await h.asUser(rep, () => h.sql(
        `select company_id from admin_company_billing where company_id = $1`, [company]));
      expect(rows).toHaveLength(0);
    });

    it('can be closed early', async () => {
      await h.asUser(rep, () => h.sql(
        `select app.open_support_session($1,'Following up on the same ticket')`, [company]));
      await h.asUser(rep, () => h.sql(`select app.close_support_session($1)`, [company]));
      const [r] = await h.asUser(rep, () => h.sql<{ open: boolean }>(
        `select app.is_supporting($1) as open`, [company]));
      expect(r!.open).toBe(false);
    });

    it('leaves exactly one live session however many times it is reopened', async () => {
      for (const why of ['First look at the billing', 'Second look at the billing']) {
        await h.asUser(rep, () => h.sql(
          `select app.open_support_session($1,$2)`, [company, why]));
      }
      const live = await h.sql(
        `select id from support_sessions
          where company_id = $1 and closed_at is null`, [company]);
      expect(live).toHaveLength(1);
    });

    it('keeps every session that ever happened', async () => {
      // Retired, never deleted: "who looked at my account" has to stay
      // answerable after the looking is over.
      const all = await h.asUser(cust, () => h.sql(
        `select id from support_sessions where company_id = $1`, [company]));
      expect(all.length).toBeGreaterThan(3);
    });
  });
});
