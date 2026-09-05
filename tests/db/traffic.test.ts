import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Who came, and who tried to sign up.
 *
 * This is the part of the platform most likely to quietly become surveillance,
 * so the tests that matter are the ones holding the line: no address is stored,
 * an anonymous visitor can write a visit and read nothing back, and the console
 * paths are never recorded at all.
 */
describe('who came and who tried', () => {
  let h: Harness;
  const boss = 'dddddddd-0000-4000-8000-000000000001';
  const rep  = 'dddddddd-0000-4000-8000-000000000002';
  const cust = 'dddddddd-0000-4000-8000-000000000003';
  const visitor = 'dddddddd-1111-4111-8111-111111111111';

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
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('a visit', () => {
    it('can be recorded by somebody with no account at all', async () => {
      await h.asAnon(() => h.sql(
        `select public.record_visit('/', $1, 'https://www.google.com/search?q=takeoff',
                                    null, null, null, 'phone')`, [visitor]));
      const [r] = await h.sql<{ n: string }>(
        `select count(*)::text as n from visit_events`);
      expect(Number(r!.n)).toBe(1);
    });

    it('shows that visitor nothing back', async () => {
      // Writing is a function; reading is not something an anonymous caller can
      // do at all, which is what keeps this from being a public log of who
      // visited the site.
      await expect(h.asAnon(() => h.sql(`select id from visit_events`)))
        .rejects.toThrow(/permission denied/);
      await expect(h.asAnon(() => h.sql(`select * from admin_traffic`)))
        .rejects.toThrow(/permission denied/);
    });

    it('stores no address and no user agent, because none is passed', async () => {
      const cols = await h.sql<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'visit_events'`);
      const names = cols.map((c) => c.column_name);
      expect(names).not.toContain('ip_address');
      expect(names).not.toContain('user_agent');
      // What is kept about the device is one of three words.
      expect(names).toContain('device');
    });

    it('never records the console or the application', async () => {
      /*
       * Both because they are not traffic, and because a function anybody can
       * call should not confirm which internal paths exist.
       */
      for (const path of ['/admin', '/admin/companies', '/app/estimates']) {
        await h.asAnon(() => h.sql(`select public.record_visit($1)`, [path]));
      }
      const [r] = await h.sql<{ n: string }>(
        `select count(*)::text as n from visit_events where path like '/a%'`);
      expect(Number(r!.n)).toBe(0);
    });

    it('cannot be edited or deleted once written', async () => {
      await expect(h.sql(`update visit_events set path = '/edited'`))
        .rejects.toThrow(/append-only/);
      await expect(h.sql(`delete from visit_events`)).rejects.toThrow(/append-only/);
    });

    it('never breaks a page over a page view', async () => {
      // A path of nothing, a device that is not one, a referrer far too long:
      // all of it is discarded rather than raised at somebody reading the site.
      await h.asAnon(() => h.sql(`select public.record_visit('')`));
      await h.asAnon(() => h.sql(
        `select public.record_visit('/pricing', $1, null, null, null, null, 'fridge')`,
        [visitor]));
      const [r] = await h.sql<{ device: string | null }>(
        `select device from visit_events where path = '/pricing'`);
      expect(r!.device).toBeNull();
    });
  });

  describe('an attempt to sign up', () => {
    it('records what went wrong, in the words they saw', async () => {
      await h.asAnon(() => h.sql(
        `select public.record_signup_attempt('SOMEBODY@Example.com','failed',
           'That email is already registered', $1)`, [visitor]));
      const [r] = await h.sql<{ email: string; failure: string }>(
        `select email, failure from signup_attempts`);
      // Lower-cased, so the same person typing it two ways is one person.
      expect(r!.email).toBe('somebody@example.com');
      expect(r!.failure).toMatch(/already registered/);
    });

    it('ignores something that is not an email rather than storing it', async () => {
      await h.asAnon(() => h.sql(
        `select public.record_signup_attempt('not an address','failed','x')`));
      const [r] = await h.sql<{ n: string }>(
        `select count(*)::text as n from signup_attempts`);
      expect(Number(r!.n)).toBe(1);
    });

    it('says whether they ever came back', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{ has: boolean }>(
        `select has_an_account_now as has from admin_failed_signups
          where email = 'somebody@example.com'`));
      expect(r!.has).toBe(false);

      await account('dddddddd-0000-4000-8000-000000000004', 'somebody@example.com');
      const [after] = await h.asUser(boss, () => h.sql<{ has: boolean }>(
        `select has_an_account_now as has from admin_failed_signups
          where email = 'somebody@example.com'`));
      expect(after!.has).toBe(true);
    });

    it('cannot be rewritten to say something else happened', async () => {
      await expect(h.sql(`update signup_attempts set outcome = 'completed'`))
        .rejects.toThrow(/append-only/);
    });
  });

  describe('what an operator sees', () => {
    it('counts the day traffic', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{
        views: string; visitors: string; pricing_views: string;
      }>(`select views, visitors, pricing_views from admin_traffic
           where day = date_trunc('day', now())`));
      expect(Number(r!.views)).toBeGreaterThan(0);
      expect(Number(r!.visitors)).toBe(1);
      expect(Number(r!.pricing_views)).toBe(1);
    });

    it('names the site somebody came from, without their search terms', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{ source: string }>(
        `select source from admin_traffic_sources where source <> 'direct'`));
      expect(r!.source).toBe('google.com');
    });

    it('counts a visit with no referrer as direct', async () => {
      const rows = await h.asUser(boss, () => h.sql<{ source: string }>(
        `select source from admin_traffic_sources`));
      expect(rows.map((x) => x.source)).toContain('direct');
    });

    it('lays out the funnel from a visitor to a subscription', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{
        visitors: string; attempted: string; failed: string; accounts_created: string;
      }>(`select visitors, attempted, failed, accounts_created
            from admin_signup_funnel where day = date_trunc('day', now())`));
      expect(Number(r!.visitors)).toBe(1);
      expect(Number(r!.attempted)).toBe(1);
      expect(Number(r!.failed)).toBe(1);
      expect(Number(r!.accounts_created)).toBeGreaterThan(0);
    });

    it('covers thirty days whether or not anybody came', async () => {
      const rows = await h.asUser(boss, () => h.sql(`select day from admin_signup_funnel`));
      expect(rows).toHaveLength(30);
    });

    it('shows a customer none of it', async () => {
      for (const view of ['admin_traffic', 'admin_traffic_sources',
                          'admin_signup_funnel', 'admin_failed_signups']) {
        const rows = await h.asUser(cust, () => h.sql(`select * from ${view}`));
        expect(rows, view).toHaveLength(0);
      }
    });

    it('shows it to sales, who sell against it', async () => {
      // companies.read rather than billing.read: knowing the site had four
      // hundred visitors is not commercially sensitive, and it is the number
      // somebody selling most needs.
      const rows = await h.asUser(rep, () => h.sql(`select day from admin_traffic`));
      expect(rows.length).toBeGreaterThan(0);
    });
  });
});
