import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Actually sending email.
 *
 * Every notice this platform produced was in-app, which reaches somebody only
 * if they come looking — and the customer whose card expired is precisely the
 * one who is not looking.
 *
 * The tests that matter are the ones holding the four decisions: nothing sends
 * inline, the same cause queues one message however many times it fires,
 * transactional mail cannot be switched off, and nothing is silently dropped.
 */
describe('actually sending email', () => {
  let h: Harness;
  const boss  = '10000000-0000-4000-8000-000000000001';
  const owner = '10000000-0000-4000-8000-000000000002';
  const crew  = '10000000-0000-4000-8000-000000000003';
  let company = '';

  const account = async (id: string, email: string) => {
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [id, email]);
  };

  const fail = (invoice: string, attempt: number, code = 'expired_card',
                next: string | null = null) =>
    h.asService(() => h.sql(
      `select app.record_payment_failure($1,$2,$3,19900,'USD',$4,'Declined.',$5)`,
      [company, invoice, attempt, code, next]));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [
      [boss, 'boss@grounup.test'], [owner, 'owner@ridge.test'],
      [crew, 'crew@ridge.test'],
    ] as const) await account(id, email);
    await h.sql(`insert into platform_admins (user_id, reason, role)
                 values ($1,'Runs the platform','superadmin')`, [boss]);

    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','grounup') as id`)))[0]!.id;
    // A second person who is not an owner.
    await h.sql(`insert into company_memberships (company_id, user_id, role_id, status)
                 select $1, $2, r.id, 'active' from roles r
                  where r.company_id is null and r.key = 'estimator'`, [company, crew]);
    await h.sql(`insert into billing_invoices (company_id, stripe_invoice_id, status,
                                               amount_due_cents)
                 values ($1,'in_1','open',19900)`, [company]);
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('a card being refused', () => {
    it('writes a message to the owner, not to everybody', async () => {
      /*
       * An estimator does not need to hear that the card was declined, and a
       * company of eleven should not get eleven copies of it.
       */
      await fail('in_1', 1, 'expired_card', null);
      const rows = await h.sql<{ to_email: string; state: string }>(
        `select to_email, state from email_messages where category = 'billing.payment_failed'`);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.to_email).toBe('owner@ridge.test');
      expect(rows[0]!.state).toBe('queued');
    });

    it('says what actually happened, in words', async () => {
      const [m] = await h.sql<{ subject: string; body: string }>(
        `select subject, body from email_messages where category = 'billing.payment_failed'`);
      expect(m!.subject).toMatch(/Ridgeline/);
      expect(m!.body).toMatch(/the card has expired/);
      expect(m!.body).toMatch(/\$199\.00/);
      expect(m!.body).toMatch(/stopped trying automatically/);
      // The reassurance that makes it safe to send.
      expect(m!.body).toMatch(/Nothing is ever deleted over a payment/);
    });

    it('names the next attempt when there is going to be one', async () => {
      await h.sql(`insert into billing_invoices (company_id, stripe_invoice_id, status,
                                                 amount_due_cents)
                   values ($1,'in_2','open',19900)`, [company]);
      await fail('in_2', 1, 'card_declined', '2026-10-01T10:00:00Z');
      const [m] = await h.sql<{ body: string }>(
        `select body from email_messages where dedupe_key = 'payment_failure:in_2:1'`);
      expect(m!.body).toMatch(/We will try again on/);
    });

    it('queues one message however many times the webhook fires', async () => {
      /*
       * A Stripe retry is indistinguishable from the original delivery, so the
       * only defense is refusing the second write.
       */
      await fail('in_1', 1, 'expired_card', null);
      await fail('in_1', 1, 'expired_card', null);
      const rows = await h.sql(
        `select id from email_messages where dedupe_key = 'payment_failure:in_1:1'`);
      expect(rows).toHaveLength(1);
    });

    it('sends a second one for a second attempt, which is a new fact', async () => {
      await fail('in_1', 2, 'expired_card', null);
      const rows = await h.sql(
        `select id from email_messages where category = 'billing.payment_failed'`);
      expect(rows.length).toBeGreaterThan(2);
    });
  });

  describe('a suspension', () => {
    it('sends the customer the words the operator wrote for them', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.suspend_company($1,'nonpayment',
           'Two invoices unpaid after four reminders',
           'Your account is read-only until the outstanding invoice is paid.')`, [company]));
      const [m] = await h.sql<{ body: string; to_email: string }>(
        `select body, to_email from email_messages where category = 'account.suspended'`);
      expect(m!.to_email).toBe('owner@ridge.test');
      expect(m!.body).toMatch(/read-only until the outstanding invoice is paid/);
      // And never the internal note.
      expect(m!.body).not.toMatch(/four reminders/);
    });

    it('tells them their work is still there, because that is the question', async () => {
      const [m] = await h.sql<{ body: string }>(
        `select body from email_messages where category = 'account.suspended'`);
      expect(m!.body).toMatch(/Nothing has been deleted/);
      expect(m!.body).toMatch(/exported/);
    });
  });

  describe('a refund', () => {
    it('is sent when Stripe has actually moved the money, not when it was approved', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.restore_company($1,'Paid in full')`, [company]));
      const [r] = await h.asUser(boss, () => h.sql<{ id: string }>(
        `select app.request_refund($1,'refund',5000,
           'Charged for a month after they had already canceled','in_1') as id`, [company]));
      await h.asUser(boss, () => h.sql(`select app.decide_refund($1, true)`, [r!.id]));

      expect(await h.sql(`select id from email_messages where category = 'billing.refund'`))
        .toHaveLength(0);

      await h.asService(() => h.sql(
        `select app.finish_refund($1, true, 're_1')`, [r!.id]));
      const [m] = await h.sql<{ body: string; subject: string }>(
        `select body, subject from email_messages where category = 'billing.refund'`);
      expect(m!.subject).toMatch(/refund is on its way/);
      expect(m!.body).toMatch(/\$50\.00/);
      expect(m!.body).toMatch(/five to ten days/);
    });

    it('calls a credit a credit rather than a refund', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{ id: string }>(
        `select app.request_refund($1,'credit',2500,
           'Goodwill for the outage on the third') as id`, [company]));
      await h.asUser(boss, () => h.sql(`select app.decide_refund($1, true)`, [r!.id]));
      await h.asService(() => h.sql(`select app.finish_refund($1, true, 'cbt_1')`, [r!.id]));
      const [m] = await h.sql<{ subject: string; body: string }>(
        `select subject, body from email_messages where dedupe_key = 'refund:' || $1`,
        [r!.id]);
      expect(m!.subject).toMatch(/credit has been applied/);
      expect(m!.body).toMatch(/comes off your next invoice/);
    });
  });

  describe('an announcement', () => {
    it('reaches the owner by email as well as on screen', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.publish_announcement('New takeoff tools',
           'On-screen measurement now covers every trade, not only earthwork.')`));
      const [m] = await h.sql<{ to_email: string; transactional: boolean; body: string }>(
        `select to_email, transactional, body from email_messages
          where category = 'platform.announcement'`);
      expect(m!.to_email).toBe('owner@ridge.test');
      // The only one of the four a customer may switch off.
      expect(m!.transactional).toBe(false);
      expect(m!.body).toMatch(/switch these off under Settings/);
      // And it says what still gets through regardless.
      expect(m!.body).toMatch(/billing and your account will still reach you/);
    });

    it('sends one per owner, however many times it is read', async () => {
      const rows = await h.sql(
        `select id from email_messages where category = 'platform.announcement'`);
      expect(rows).toHaveLength(1);
    });

    it('waits for one that has not started yet', async () => {
      /*
       * A price change announced today and effective in January is emailed in
       * January, not a week early with everybody wondering what happened.
       */
      await h.asUser(boss, () => h.sql(
        `select app.publish_announcement('Prices change in January',
           'The per-seat price changes on the first.','info','everyone',
           now() + interval '30 days')`));
      const rows = await h.sql(
        `select id from email_messages where subject = 'Prices change in January'`);
      expect(rows).toHaveLength(0);
    });
  });

  describe('what a customer may switch off', () => {
    it('is not a declined card', async () => {
      /*
       * A preference that could suppress this produces a customer who loses
       * their account without ever being told.
       */
      await h.asUser(owner, () => h.sql(
        `insert into notification_preferences (company_id, user_id, category, in_app, email)
         values ($1,$2,'billing.payment_failed', true, false)`, [company, owner]));
      await h.sql(`insert into billing_invoices (company_id, stripe_invoice_id, status,
                                                 amount_due_cents)
                   values ($1,'in_3','open',19900)`, [company]);
      await fail('in_3', 1, 'expired_card', null);
      const rows = await h.sql<{ state: string }>(
        `select state from email_messages where dedupe_key = 'payment_failure:in_3:1'`);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.state).toBe('queued');
    });

    it('is anything that is not', async () => {
      await h.asUser(owner, () => h.sql(
        `insert into notification_preferences (company_id, user_id, category, in_app, email)
         values ($1,$2,'platform.news', true, false)`, [company, owner]));
      const [id] = await h.asService(() => h.sql<{ q: string | null }>(
        `select app.queue_email('owner@ridge.test','Something new',
           'We have built a thing you might like.','platform.news','news:1',
           $1, $2, false) as q`, [company, owner]));
      expect(id!.q).toBeNull();
    });

    it('records a suppressed message as a row saying why, not as a silence', async () => {
      const [m] = await h.sql<{ state: string; reason: string }>(
        `select state, suppressed_reason as reason from email_messages
          where dedupe_key = 'news:1'`);
      expect(m!.state).toBe('suppressed');
      expect(m!.reason).toMatch(/switched off email for platform\.news/);
    });

    it('sends to somebody who has never opened the settings', async () => {
      // No row means the default, and the default is on. Somebody who has never
      // looked has not opted out of anything.
      const [id] = await h.asService(() => h.sql<{ q: string }>(
        `select app.queue_email('crew@ridge.test','Something new',
           'We have built a thing you might like.','platform.news','news:2',
           $1, $2, false) as q`, [company, crew]));
      expect(id!.q).toBeTruthy();
    });
  });

  describe('who may read the outbox', () => {
    it('lets a person read mail addressed to them', async () => {
      const rows = await h.asUser(owner, () => h.sql<{ subject: string }>(
        `select subject from email_messages`));
      expect(rows.length).toBeGreaterThan(0);
    });

    it('shows one person nothing addressed to another', async () => {
      const rows = await h.asUser(crew, () => h.sql<{ to_email: string }>(
        `select to_email from email_messages`));
      expect(rows.every((r) => r.to_email === 'crew@ridge.test')).toBe(true);
    });

    it('shows an operator the whole outbox and whether it is draining', async () => {
      const [health] = await h.asUser(boss, () => h.sql<{ waiting: string; sent: string }>(
        `select waiting, sent from admin_outbox_health`));
      expect(Number(health!.waiting)).toBeGreaterThan(0);
      expect(Number(health!.sent)).toBe(0);
    });

    it('shows an anonymous visitor nothing at all', async () => {
      await expect(h.asAnon(() => h.sql(`select * from email_messages`)))
        .rejects.toThrow(/permission denied/);
    });
  });

  describe('what the platform said it sent', () => {
    it('cannot be deleted', async () => {
      /*
       * The record of what somebody was told is exactly the record worth
       * having when they say they were never told.
       */
      await expect(h.sql(`delete from email_messages`)).rejects.toThrow(/append-only/);
    });
  });

  describe('nothing sends inline', () => {
    it('leaves every message queued, for a sender to drain', async () => {
      /*
       * The decision the whole design rests on. A webhook that blocked on a
       * mail provider would time out, Stripe would retry it, and the customer
       * would be charged once and emailed twice.
       */
      const [r] = await h.sql<{ n: string }>(
        `select count(*)::text as n from email_messages where sent_at is not null`);
      expect(Number(r!.n)).toBe(0);
    });
  });
});
