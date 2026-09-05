import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Telling everybody.
 *
 * The tests that matter are the ones about who sees what and for how long: an
 * audience worked out from the plan, a window that closes on its own, a
 * dismissal that belongs to one person rather than to their company, and a
 * retraction that stops a message being shown without pretending it was never
 * sent.
 */
describe('telling everybody', () => {
  let h: Harness;
  const boss   = '0f000000-0000-4000-8000-000000000001';
  const help   = '0f000000-0000-4000-8000-000000000002';
  const owner  = '0f000000-0000-4000-8000-000000000003';
  const mate   = '0f000000-0000-4000-8000-000000000004';
  const skint  = '0f000000-0000-4000-8000-000000000005';
  let paying = '', free = '';

  const account = async (id: string, email: string) => {
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [id, email]);
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [
      [boss, 'boss@grounup.test'], [help, 'support@grounup.test'],
      [owner, 'owner@ridge.test'], [mate, 'crew@ridge.test'],
      [skint, 'owner@small.test'],
    ] as const) await account(id, email);
    await h.sql(`insert into platform_admins (user_id, reason, role)
                 values ($1,'Runs the platform','superadmin')`, [boss]);
    await h.asUser(boss, () => h.sql(
      `select app.hire_operator('support@grounup.test','Answers billing tickets','support')`));

    paying = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','grounup') as id`)))[0]!.id;
    free = (await h.asUser(skint, () => h.sql<{ id: string }>(
      `select app.provision_company('Small Co','small','free') as id`)))[0]!.id;

    // A second person at the paying company, to prove dismissal is personal.
    await h.sql(`insert into company_memberships (company_id, user_id, role_id, status)
                 select $1, $2, r.id, 'active' from roles r
                  where r.company_id is null and r.key = 'estimator'`, [paying, mate]);
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('who may say something', () => {
    it('is not support, whose messages reach one customer at a time', async () => {
      await expect(h.asUser(help, () => h.sql(
        `select app.publish_announcement('Hello','Something I would like everybody to know')`)))
        .rejects.toThrow(/do not have permission/);
    });

    it('is not a customer', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `select app.publish_announcement('Hello','Something I would like everybody to know')`)))
        .rejects.toThrow(/do not have permission/);
    });

    it('refuses a maintenance notice with no end', async () => {
      // A banner about last Sunday's maintenance is worse than no banner.
      await expect(h.asUser(boss, () => h.sql(
        `select app.publish_announcement('Maintenance',
           'We will be down for a while at some point','maintenance')`)))
        .rejects.toThrow(/announcements_maintenance_ends/);
    });
  });

  describe('who sees it', () => {
    it('reaches everybody when it is for everybody', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.publish_announcement('New takeoff tools',
           'On-screen measurement now covers every trade, not only earthwork.')`));
      for (const person of [owner, mate, skint]) {
        const rows = await h.asUser(person, () => h.sql<{ title: string }>(
          `select title from my_announcements`));
        expect(rows.map((r) => r.title)).toContain('New takeoff tools');
      }
    });

    it('reaches only the free customers when it is for them', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.publish_announcement('Everything in the paid plan',
           'Projects, fleet and field production are what a subscription adds.',
           'info','free')`));
      const theirs = await h.asUser(skint, () => h.sql<{ title: string }>(
        `select title from my_announcements`));
      expect(theirs.map((r) => r.title)).toContain('Everything in the paid plan');

      const others = await h.asUser(owner, () => h.sql<{ title: string }>(
        `select title from my_announcements`));
      expect(others.map((r) => r.title)).not.toContain('Everything in the paid plan');
    });

    it('reaches only the paying customers when it is for them', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.publish_announcement('Your invoices have moved',
           'Invoices now live under Settings, Billing.','info','paying')`));
      const theirs = await h.asUser(owner, () => h.sql<{ title: string }>(
        `select title from my_announcements`));
      expect(theirs.map((r) => r.title)).toContain('Your invoices have moved');

      const others = await h.asUser(skint, () => h.sql<{ title: string }>(
        `select title from my_announcements`));
      expect(others.map((r) => r.title)).not.toContain('Your invoices have moved');
    });

    it('does not show one before it starts', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.publish_announcement('Prices change in January',
           'The per-seat price changes on the first.','info','everyone',
           now() + interval '7 days')`));
      const rows = await h.asUser(owner, () => h.sql<{ title: string }>(
        `select title from my_announcements`));
      expect(rows.map((r) => r.title)).not.toContain('Prices change in January');
    });

    it('stops showing one after it ends, with nothing having to run', async () => {
      const [a] = await h.asUser(boss, () => h.sql<{ id: string }>(
        `select app.publish_announcement('Maintenance on Sunday',
           'The platform will be unavailable between two and four in the morning.',
           'maintenance','everyone', now(), now() + interval '1 hour') as id`));
      expect((await h.asUser(owner, () => h.sql<{ title: string }>(
        `select title from my_announcements`))).map((r) => r.title))
        .toContain('Maintenance on Sunday');

      await h.sql(`update announcements set starts_at = now() - interval '2 hours',
                                            ends_at = now() - interval '1 hour'
                    where id = $1`, [a!.id]);
      expect((await h.asUser(owner, () => h.sql<{ title: string }>(
        `select title from my_announcements`))).map((r) => r.title))
        .not.toContain('Maintenance on Sunday');
    });

    it('shows an anonymous visitor nothing at all', async () => {
      await expect(h.asAnon(() => h.sql(`select * from my_announcements`)))
        .rejects.toThrow(/permission denied/);
    });
  });

  describe('clearing one', () => {
    it('clears it for the person who cleared it', async () => {
      const [a] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `select id from my_announcements where title = 'New takeoff tools'`));
      await h.asUser(owner, () => h.sql(`select app.dismiss_announcement($1)`, [a!.id]));
      const rows = await h.asUser(owner, () => h.sql<{ title: string }>(
        `select title from my_announcements`));
      expect(rows.map((r) => r.title)).not.toContain('New takeoff tools');
    });

    it('leaves it in front of their colleague', async () => {
      /*
       * The property that makes a broadcast feature usable. Per-company
       * dismissal means the first person to clear a banner hides it from
       * everybody who had not read it.
       */
      const rows = await h.asUser(mate, () => h.sql<{ title: string }>(
        `select title from my_announcements`));
      expect(rows.map((r) => r.title)).toContain('New takeoff tools');
    });

    it('can be done twice without complaint', async () => {
      const [a] = await h.sql<{ id: string }>(
        `select id from announcements where title = 'New takeoff tools'`);
      await h.asUser(owner, () => h.sql(`select app.dismiss_announcement($1)`, [a!.id]));
      const [n] = await h.sql<{ n: string }>(
        `select count(*)::text as n from announcement_dismissals
          where announcement_id = $1 and user_id = $2`, [a!.id, owner]);
      expect(Number(n!.n)).toBe(1);
    });

    it('shows one person nothing of what another has cleared', async () => {
      const rows = await h.asUser(mate, () => h.sql(`select * from announcement_dismissals`));
      expect(rows).toHaveLength(0);
    });
  });

  describe('pulling one', () => {
    it('will not be pulled without saying why', async () => {
      const [a] = await h.sql<{ id: string }>(
        `select id from announcements where title = 'Your invoices have moved'`);
      await expect(h.asUser(boss, () => h.sql(
        `select app.retract_announcement($1,'x')`, [a!.id])))
        .rejects.toThrow(/Say why/);
    });

    it('stops it being shown', async () => {
      const [a] = await h.sql<{ id: string }>(
        `select id from announcements where title = 'Your invoices have moved'`);
      await h.asUser(boss, () => h.sql(
        `select app.retract_announcement($1,'They have not moved yet; that ships next week')`,
        [a!.id]));
      const rows = await h.asUser(owner, () => h.sql<{ title: string }>(
        `select title from my_announcements`));
      expect(rows.map((r) => r.title)).not.toContain('Your invoices have moved');
    });

    it('does not pretend it was never sent', async () => {
      /*
       * Somebody read it. A platform that could make that untrue is a platform
       * whose history means nothing.
       */
      const [a] = await h.asUser(boss, () => h.sql<{
        retract_reason: string; live: boolean; title: string;
      }>(`select retract_reason, live, title from admin_announcements
           where title = 'Your invoices have moved'`));
      expect(a!.retract_reason).toMatch(/ships next week/);
      expect(a!.live).toBe(false);
    });

    it('cannot be pulled twice', async () => {
      const [a] = await h.sql<{ id: string }>(
        `select id from announcements where title = 'Your invoices have moved'`);
      await expect(h.asUser(boss, () => h.sql(
        `select app.retract_announcement($1,'Pulling it again for some reason')`, [a!.id])))
        .rejects.toThrow(/No live announcement/);
    });
  });

  describe('what an operator sees', () => {
    it('counts who cleared it, and calls it cleared rather than read', async () => {
      const [a] = await h.asUser(boss, () => h.sql<{ dismissals: string }>(
        `select dismissals from admin_announcements where title = 'New takeoff tools'`));
      expect(Number(a!.dismissals)).toBe(1);

      const cols = await h.sql<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_name = 'admin_announcements'`);
      // A dismissal is the only signal there is; calling it "read" would be a
      // claim about somebody's attention that nothing here can support.
      expect(cols.map((c) => c.column_name)).not.toContain('reads');
    });

    it('appears on the staff activity screen like everything else', async () => {
      const rows = await h.asUser(boss, () => h.sql<{ reason: string }>(
        `select reason from admin_operator_activity
          where entity_table = 'public.announcements'`));
      expect(rows.some((r) => /Announced to everyone/.test(r.reason ?? ''))).toBe(true);
    });

    it('shows a customer none of the operator view', async () => {
      const rows = await h.asUser(owner, () => h.sql(`select * from admin_announcements`));
      expect(rows).toHaveLength(0);
    });
  });
});
