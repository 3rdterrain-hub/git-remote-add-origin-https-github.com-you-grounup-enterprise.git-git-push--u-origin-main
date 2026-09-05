import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * A working unsubscribe.
 *
 * Migration 0090 sent announcement email ending "You can switch these off under
 * Settings, Notifications", and there was no such screen —
 * `notification_preferences` had existed since 0018 and nothing had ever read
 * or written it. An opt-out that does not work is the one part of bulk email
 * that is not merely rude.
 */
describe('a working unsubscribe', () => {
  let h: Harness;
  const boss  = '11000000-0000-4000-8000-000000000001';
  const owner = '11000000-0000-4000-8000-000000000002';
  const crew  = '11000000-0000-4000-8000-000000000003';
  const other = '11000000-0000-4000-8000-000000000004';
  let company = '', elsewhere = '';

  const account = async (id: string, email: string) => {
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [id, email]);
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [
      [boss, 'boss@grounup.test'], [owner, 'owner@ridge.test'],
      [crew, 'crew@ridge.test'], [other, 'owner@small.test'],
    ] as const) await account(id, email);
    await h.sql(`insert into platform_admins (user_id, reason, role)
                 values ($1,'Runs the platform','superadmin')`, [boss]);

    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','grounup') as id`)))[0]!.id;
    elsewhere = (await h.asUser(other, () => h.sql<{ id: string }>(
      `select app.provision_company('Small Co','small','grounup') as id`)))[0]!.id;
    await h.sql(`insert into company_memberships (company_id, user_id, role_id, status)
                 select $1, $2, r.id, 'active' from roles r
                  where r.company_id is null and r.key = 'estimator'`, [company, crew]);
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('what somebody is shown', () => {
    it('lists every category, not only the ones they have touched', async () => {
      /*
       * Somebody who has never opened the screen has no preference rows at
       * all. A view built from those rows would show them nothing and imply
       * they receive nothing.
       */
      const rows = await h.asUser(owner, () => h.sql<{ category: string; email: boolean }>(
        `select category, email from my_notification_settings where company_id = $1`,
        [company]));
      expect(rows.length).toBeGreaterThanOrEqual(7);
      expect(rows.every((r) => r.email)).toBe(true);
    });

    it('shows the ones that cannot be switched off rather than hiding them', async () => {
      // A list that quietly omits what it cannot change reads as a shorter
      // list rather than an honest one.
      const rows = await h.asUser(owner, () => h.sql<{ category: string; optional: boolean }>(
        `select category, optional from my_notification_settings where company_id = $1`,
        [company]));
      const fixed = rows.filter((r) => !r.optional).map((r) => r.category);
      expect(fixed).toContain('billing.payment_failed');
      expect(fixed).toContain('account.suspended');
      expect(fixed).toContain('billing.refund');
    });

    it('shows one person nothing of another company', async () => {
      const rows = await h.asUser(owner, () => h.sql<{ company_id: string }>(
        `select distinct company_id from my_notification_settings`));
      expect(rows.map((r) => r.company_id)).toEqual([company]);
    });

    it('shows an anonymous visitor nothing at all', async () => {
      await expect(h.asAnon(() => h.sql(`select * from my_notification_settings`)))
        .rejects.toThrow(/permission denied/);
    });
  });

  describe('changing it', () => {
    it('switches off what may be switched off', async () => {
      await h.asUser(owner, () => h.sql(
        `select app.set_notification_preference($1,'platform.announcement', true, false)`,
        [company]));
      const [r] = await h.asUser(owner, () => h.sql<{ email: boolean; in_app: boolean }>(
        `select email, in_app from my_notification_settings
          where company_id = $1 and category = 'platform.announcement'`, [company]));
      expect(r!.email).toBe(false);
      expect(r!.in_app).toBe(true);
    });

    it('actually stops the email, rather than only recording the wish', async () => {
      // The whole point. The preference is honored by the same function the
      // announcement trigger calls.
      await h.asUser(boss, () => h.sql(
        `select app.publish_announcement('Something new',
           'We have built a thing you might like.')`));
      const mine = await h.sql<{ to_email: string }>(
        `select to_email from email_messages where category = 'platform.announcement'`);
      expect(mine.map((m) => m.to_email)).not.toContain('owner@ridge.test');
      // And somebody who did not switch it off still gets it.
      expect(mine.map((m) => m.to_email)).toContain('owner@small.test');
    });

    it('refuses to switch off what a person is entitled to hear', async () => {
      /*
       * Refused rather than silently ignored. A screen that accepted the change
       * and did nothing would be the same defect this migration exists to fix.
       */
      await expect(h.asUser(owner, () => h.sql(
        `select app.set_notification_preference($1,'billing.payment_failed', true, false)`,
        [company]))).rejects.toThrow(/cannot switch off/);
    });

    it('refuses a category that does not exist', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `select app.set_notification_preference($1,'invented.category', true, false)`,
        [company]))).rejects.toThrow(/nothing called/);
    });

    it('is mine and not my colleague to set', async () => {
      // An owner switching off their estimator's email would be a strange
      // thing for a platform to allow.
      await h.asUser(crew, () => h.sql(
        `select app.set_notification_preference($1,'platform.announcement', true, true)`,
        [company]));
      const [theirs] = await h.asUser(crew, () => h.sql<{ email: boolean }>(
        `select email from my_notification_settings
          where company_id = $1 and category = 'platform.announcement'`, [company]));
      const [mine] = await h.asUser(owner, () => h.sql<{ email: boolean }>(
        `select email from my_notification_settings
          where company_id = $1 and category = 'platform.announcement'`, [company]));
      expect(theirs!.email).toBe(true);
      expect(mine!.email).toBe(false);
    });

    it('refuses a company somebody does not belong to', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `select app.set_notification_preference($1,'platform.announcement', true, false)`,
        [elsewhere]))).rejects.toThrow(/not a member/);
    });

    it('can be switched back on', async () => {
      await h.asUser(owner, () => h.sql(
        `select app.set_notification_preference($1,'platform.announcement', true, true)`,
        [company]));
      const [r] = await h.asUser(owner, () => h.sql<{ email: boolean }>(
        `select email from my_notification_settings
          where company_id = $1 and category = 'platform.announcement'`, [company]));
      expect(r!.email).toBe(true);
    });
  });

  describe('the list itself', () => {
    it('is the same list the mail-sending code uses', async () => {
      /*
       * The reason the categories are a table rather than a constant in the
       * screen: two copies drift, and the drift shows up as a category nobody
       * can switch off because the screen has never heard of it.
       */
      const rows = await h.sql<{ key: string }>(`select key from notification_categories`);
      const keys = rows.map((r) => r.key);
      for (const sent of ['billing.payment_failed', 'account.suspended',
                          'billing.refund', 'platform.announcement']) {
        expect(keys, sent).toContain(sent);
      }
    });

    it('cannot be edited outside a migration', async () => {
      await expect(h.sql(
        `insert into notification_categories (key, label, description)
         values ('made.up','Made up','Something somebody added at runtime')`))
        .rejects.toThrow(/append-only/);
    });
  });
});
