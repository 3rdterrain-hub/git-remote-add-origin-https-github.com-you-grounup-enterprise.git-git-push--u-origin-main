import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Suspending an account, and giving it back.
 *
 * The tests that matter are the ones holding the shape of it: a suspended
 * company can still read and export everything it ever made, cannot add to it,
 * and is told why in the words the operator wrote for them rather than the
 * internal note. And the carve-out that makes it possible to end — a Stripe
 * webhook is not a person and is never blocked.
 */
describe('suspending an account', () => {
  let h: Harness;
  const boss = 'ffffffff-0000-4000-8000-000000000001';
  const rep  = 'ffffffff-0000-4000-8000-000000000002';
  const cust = 'ffffffff-0000-4000-8000-000000000003';
  let company = '', estimate = '';

  const account = async (id: string, email: string) => {
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [id, email]);
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await account(boss, 'boss@grounup.test');
    await account(rep, 'sales@grounup.test');
    await account(cust, 'owner@ridge.test');
    await h.sql(`insert into platform_admins (user_id, reason, role)
                 values ($1,'Runs the platform','superadmin')`, [boss]);
    await h.asUser(boss, () => h.sql(
      `select app.hire_operator('sales@grounup.test','Sells the platform','sales')`));

    company = (await h.asUser(cust, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','grounup') as id`)))[0]!.id;
    estimate = (await h.asUser(cust, () => h.sql<{ id: string }>(
      `insert into estimates (company_id, number, name)
       values ($1,'E-1','Their work') returning id`, [company])))[0]!.id;
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('who may do it', () => {
    it('is refused to sales, who sell to the same customer', async () => {
      await expect(h.asUser(rep, () => h.sql(
        `select app.suspend_company($1,'nonpayment','Three months in arrears now',
           'Your account is read-only while an invoice is outstanding.')`, [company])))
        .rejects.toThrow(/do not have permission/);
    });

    it('is refused to the customer themselves', async () => {
      await expect(h.asUser(cust, () => h.sql(
        `select app.restore_company($1,'I would rather not be suspended')`, [company])))
        .rejects.toThrow(/do not have permission/);
    });

    it('will not suspend without a message the customer will actually see', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.suspend_company($1,'nonpayment','Three months in arrears now','x')`,
        [company])))
        .rejects.toThrow(/what the customer will see/);
    });

    it('will not suspend without an internal reason either', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.suspend_company($1,'nonpayment','short',
           'Your account is read-only while an invoice is outstanding.')`, [company])))
        .rejects.toThrow(/Say why/);
    });
  });

  describe('what a suspension does', () => {
    it('takes effect the moment it is recorded', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.suspend_company($1,'nonpayment',
           'Invoices from June and July unpaid after four reminders',
           'Your account is read-only until the outstanding invoice is paid. Everything you have made is still here.')`,
        [company]));
      const [s] = await h.sql<{ suspended: boolean }>(
        `select app.is_suspended($1) as suspended`, [company]);
      expect(s!.suspended).toBe(true);
    });

    it('refuses new work, in the words written for the customer', async () => {
      await expect(h.asUser(cust, () => h.sql(
        `insert into estimates (company_id, number, name)
         values ($1,'E-2','A new bid')`, [company])))
        .rejects.toThrow(/read-only until the outstanding invoice is paid/);
    });

    it('refuses changes to what is already there', async () => {
      await expect(h.asUser(cust, () => h.sql(
        `update estimates set name = 'Renamed' where id = $1`, [estimate])))
        .rejects.toThrow(/read-only/);
    });

    it('refuses deletion, so nothing can be tidied away under one', async () => {
      await expect(h.asUser(cust, () => h.sql(
        `delete from estimates where id = $1`, [estimate])))
        .rejects.toThrow(/read-only/);
    });

    it('never stops them reading what they built', async () => {
      /*
       * The line this whole design is drawn around. Holding a contractor's own
       * estimates hostage over an invoice is not leverage; it is the thing
       * that makes them tell every other contractor never to use you.
       */
      const rows = await h.asUser(cust, () => h.sql<{ id: string; name: string }>(
        `select id, name from estimates where company_id = $1`, [company]));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.name).toBe('Their work');
    });

    it('never stops them reading their documents, costs or projects either', async () => {
      // Reads are untouched across the board, not just on the table somebody
      // remembered to test.
      for (const table of ['documents', 'customers', 'pricing_profiles', 'markup_components']) {
        await expect(h.asUser(cust, () => h.sql(
          `select id from ${table} where company_id = $1`, [company]))).resolves.toBeDefined();
      }
    });

    it('tells them why, without showing them the internal note', async () => {
      const [m] = await h.asUser(cust, () => h.sql<{
        customer_message: string; kind: string;
      }>(`select customer_message, kind from my_suspension where company_id = $1`, [company]));
      expect(m!.customer_message).toMatch(/outstanding invoice/);
      expect(m!.kind).toBe('nonpayment');

      const cols = await h.sql<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_name = 'my_suspension'`);
      // The note written for colleagues is not in the view the customer reads.
      expect(cols.map((c) => c.column_name)).not.toContain('reason');
    });

    it('shows one company nothing of another company suspension', async () => {
      const stranger = 'ffffffff-0000-4000-8000-000000000004';
      await account(stranger, 'stranger@elsewhere.test');
      const rows = await h.asUser(stranger, () => h.sql(`select company_id from my_suspension`));
      expect(rows).toHaveLength(0);
    });
  });

  describe('the carve-out that lets one end', () => {
    it('never blocks a machine write', async () => {
      /*
       * Concrete: the Stripe webhook that records the payment ending a
       * non-payment suspension is a write to a suspended company. A guard that
       * refused it would make the suspension impossible to end by paying.
       */
      await expect(h.asService(() => h.sql(
        `insert into subscriptions (company_id, plan_id, stripe_customer_id,
                                    stripe_subscription_id, status, quantity)
         values ($1,'grounup','cus_s','sub_s','active',1)`, [company])))
        .resolves.toBeDefined();
    });

    it('leaves the global library alone, which belongs to no tenant', async () => {
      await expect(h.asUser(cust, () => h.sql(
        `select count(*) from equipment where company_id is null`)))
        .resolves.toBeDefined();
    });
  });

  describe('giving it back', () => {
    it('will not lift without saying why', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.restore_company($1,'ok')`, [company])))
        .rejects.toThrow(/Say why/);
    });

    it('restores writing immediately', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.restore_company($1,'Invoice paid in full on the 12th')`, [company]));
      const [r] = await h.asUser(cust, () => h.sql<{ id: string }>(
        `insert into estimates (company_id, number, name)
         values ($1,'E-3','Back to work') returning id`, [company]));
      expect(r!.id).toBeTruthy();
    });

    it('refuses to lift one that is not there', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.restore_company($1,'Lifting it a second time')`, [company])))
        .rejects.toThrow(/not suspended/);
    });

    it('keeps the record after it is lifted', async () => {
      const [s] = await h.asUser(boss, () => h.sql<{
        live: boolean; lift_reason: string; customer_message: string;
      }>(`select live, lift_reason, customer_message from admin_suspensions
           where company_id = $1`, [company]));
      expect(s!.live).toBe(false);
      expect(s!.lift_reason).toMatch(/paid in full/);
    });

    it('leaves both the suspension and the lifting in the customer own history', async () => {
      const rows = await h.asUser(cust, () => h.sql<{ reason: string }>(
        `select reason from audit_events
          where company_id = $1 and entity_table = 'public.company_suspensions'
            and reason is not null
          order by occurred_at`, [company]));
      expect(rows).toHaveLength(2);
      expect(rows[0]!.reason).toMatch(/four reminders/);
      expect(rows[1]!.reason).toMatch(/paid in full/);
    });

    it('can happen again afterwards', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.suspend_company($1,'nonpayment','Missed the next one as well',
           'Your account is read-only again while the September invoice is outstanding.')`,
        [company]));
      const [s] = await h.sql<{ n: string }>(
        `select count(*)::text as n from company_suspensions where company_id = $1`, [company]);
      expect(Number(s!.n)).toBe(2);
      await h.asUser(boss, () => h.sql(
        `select app.restore_company($1,'Paid again, tidying up the test')`, [company]));
    });
  });

  describe('the guard covers the whole schema', () => {
    it('is on every tenant table rather than a list somebody maintained', async () => {
      const [gap] = await h.sql<{ missing: string[] | null }>(`
        select array_agg(c.relname order by c.relname) as missing
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id'
                           and a.attnum > 0 and not a.attisdropped
        where n.nspname = 'public' and c.relkind = 'r'
          -- The append-only ledgers, the suspension record itself (which has
          -- to stay writable so it can be lifted), and cancellations — a
          -- company that stopped paying is precisely the one that wants to
          -- cancel, and refusing that would trap them.
          and c.relname not in ('audit_events','api_requests','usage_events',
                                'company_suspensions','stripe_events',
                                'cancellations')
          and not exists (
            select 1 from pg_trigger t
            join pg_proc p on p.oid = t.tgfoid
            where t.tgrelid = c.oid and not t.tgisinternal
              and p.proname = 'refuse_when_suspended')`);
      expect(gap!.missing).toBeNull();
    });
  });
});
