import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Giving money back.
 *
 * The rule worth testing hardest is the segregation: the person who asks for a
 * refund is not the person who releases it, with the superadmin as the stated
 * exception because they are the business. Everything else here exists to stop
 * the amount, the approval or the outcome being decided by whoever happens to
 * be calling.
 */
describe('giving money back', () => {
  let h: Harness;
  const boss   = '0c000000-0000-4000-8000-000000000001';
  const help   = '0c000000-0000-4000-8000-000000000002';
  const books  = '0c000000-0000-4000-8000-000000000003';
  const owner  = '0c000000-0000-4000-8000-000000000004';
  let company = '', elsewhere = '';

  const account = async (id: string, email: string) => {
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [id, email]);
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [
      [boss, 'boss@grounup.test'], [help, 'support@grounup.test'],
      [books, 'money@grounup.test'], [owner, 'owner@ridge.test'],
    ] as const) await account(id, email);
    await h.sql(`insert into platform_admins (user_id, reason, role)
                 values ($1,'Runs the platform','superadmin')`, [boss]);
    await h.asUser(boss, () => h.sql(
      `select app.hire_operator('support@grounup.test','Answers billing tickets','support')`));
    await h.asUser(boss, () => h.sql(
      `select app.hire_operator('money@grounup.test','Reconciles invoices','finance')`));

    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','grounup') as id`)))[0]!.id;
    elsewhere = (await h.asUser(boss, () => h.sql<{ id: string }>(
      `select app.create_company_for('boss@grounup.test','Other Co','A second tenant') as id`)))[0]!.id;

    await h.sql(`insert into billing_invoices (company_id, stripe_invoice_id, number, status,
                                               amount_due_cents, amount_paid_cents)
                 values ($1,'in_ridge','GU-1','paid',19900,19900),
                        ($2,'in_other','GU-2','paid',19900,19900)`, [company, elsewhere]);
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('who may ask', () => {
    it('is support, who field the ticket', async () => {
      const [r] = await h.asUser(help, () => h.sql<{ id: string }>(
        `select app.request_refund($1,'refund',19900,
           'Charged for September after they had already canceled in August',
           'in_ridge') as id`, [company]));
      expect(r!.id).toBeTruthy();
    });

    it('is not finance, who reconcile the invoices they would be refunding', async () => {
      await expect(h.asUser(books, () => h.sql(
        `select app.request_refund($1,'refund',1000,'Tidying up a discrepancy','in_ridge')`,
        [company]))).rejects.toThrow(/do not have permission/);
    });

    it('is not the customer', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `select app.request_refund($1,'refund',19900,'I would like my money back','in_ridge')`,
        [company]))).rejects.toThrow(/do not have permission/);
    });

    it('refuses a refund of nothing', async () => {
      await expect(h.asUser(help, () => h.sql(
        `select app.request_refund($1,'refund',0,'A refund of nothing at all','in_ridge')`,
        [company]))).rejects.toThrow(/refund of nothing/);
    });

    it('refuses a reason too short to mean anything', async () => {
      await expect(h.asUser(help, () => h.sql(
        `select app.request_refund($1,'refund',500,'oops','in_ridge')`, [company])))
        .rejects.toThrow(/Say why/);
    });

    it('refuses an invoice belonging to somebody else', async () => {
      /*
       * A mistyped id must not quietly file a refund against another
       * customer's charge — the one mistake here that moves real money to the
       * wrong place.
       */
      await expect(h.asUser(help, () => h.sql(
        `select app.request_refund($1,'refund',19900,
           'Refunding the wrong company by accident','in_other')`, [company])))
        .rejects.toThrow(/does not belong to that company/);
    });
  });

  describe('who may release', () => {
    it('is not the person who asked', async () => {
      // The rule that makes the whole thing trustworthy.
      const [r] = await h.asUser(help, () => h.sql<{ id: string }>(
        `select app.request_refund($1,'credit',5000,
           'Goodwill for the outage on the 3rd') as id`, [company]));
      await expect(h.asUser(help, () => h.sql(
        `select app.decide_refund($1, true)`, [r!.id])))
        .rejects.toThrow(/do not have permission to approve/);
    });

    it('is not finance either, however much they see', async () => {
      const [r] = await h.sql<{ id: string }>(
        `select id from refund_requests where state = 'requested' limit 1`);
      await expect(h.asUser(books, () => h.sql(
        `select app.decide_refund($1, true)`, [r!.id])))
        .rejects.toThrow(/do not have permission/);
    });

    it('is the superadmin, who has nobody above them', async () => {
      const [r] = await h.sql<{ id: string }>(
        `select id from refund_requests where state = 'requested'
          order by requested_at limit 1`);
      await h.asUser(boss, () => h.sql(`select app.decide_refund($1, true)`, [r!.id]));
      const [after] = await h.sql<{ state: string; decided_by: string }>(
        `select state, decided_by from refund_requests where id = $1`, [r!.id]);
      expect(after!.state).toBe('approved');
      expect(after!.decided_by).toBe(boss);
    });

    it('lets the superadmin release one they asked for themselves', async () => {
      /*
       * A company of one has to be able to refund somebody. The rule that
       * would prevent it is a rule people work around in Stripe instead, and
       * it starts applying to everybody else the day anyone is hired.
       */
      const [r] = await h.asUser(boss, () => h.sql<{ id: string }>(
        `select app.request_refund($1,'credit',2500,
           'Sorted this one out on the phone myself') as id`, [company]));
      await h.asUser(boss, () => h.sql(`select app.decide_refund($1, true)`, [r!.id]));
      const [after] = await h.sql<{ state: string }>(
        `select state from refund_requests where id = $1`, [r!.id]);
      expect(after!.state).toBe('approved');
    });

    it('will not refuse one without saying why', async () => {
      const [r] = await h.asUser(help, () => h.sql<{ id: string }>(
        `select app.request_refund($1,'credit',1000,
           'They asked for something we do not do') as id`, [company]));
      await expect(h.asUser(boss, () => h.sql(
        `select app.decide_refund($1, false)`, [r!.id])))
        .rejects.toThrow(/refusal has to say why/);
      await h.asUser(boss, () => h.sql(
        `select app.decide_refund($1, false, 'Not our error, and they have used the month')`,
        [r!.id]));
    });

    it('cannot be decided twice', async () => {
      const [r] = await h.sql<{ id: string }>(
        `select id from refund_requests where state = 'rejected' limit 1`);
      await expect(h.asUser(boss, () => h.sql(
        `select app.decide_refund($1, true)`, [r!.id])))
        .rejects.toThrow(/already rejected/);
    });
  });

  describe('sending it to Stripe', () => {
    it('hands over only what has been approved', async () => {
      const [rejected] = await h.sql<{ id: string }>(
        `select id from refund_requests where state = 'rejected' limit 1`);
      await expect(h.asService(() => h.sql(
        `select * from app.claim_refund($1)`, [rejected!.id])))
        .rejects.toThrow(/not approved/);
    });

    it('hands over the amount from the row, not from the caller', async () => {
      const [approved] = await h.sql<{ id: string }>(
        `select id from refund_requests where state = 'approved'
          order by requested_at limit 1`);
      const [claim] = await h.asService(() => h.sql<{ amount_cents: number; kind: string }>(
        `select amount_cents, kind from app.claim_refund($1)`, [approved!.id]));
      expect(Number(claim!.amount_cents)).toBe(19900);
      expect(claim!.kind).toBe('refund');
    });

    it('cannot be claimed or finished by an operator', async () => {
      // Approving a refund and declaring Stripe paid it are different acts.
      const [approved] = await h.sql<{ id: string }>(
        `select id from refund_requests where state = 'approved' limit 1`);
      await expect(h.asUser(boss, () => h.sql(
        `select public.finish_refund($1, true, 're_fake')`, [approved!.id])))
        .rejects.toThrow(/permission denied/);
    });

    it('records what Stripe did', async () => {
      const [approved] = await h.sql<{ id: string }>(
        `select id from refund_requests where state = 'approved'
          order by requested_at limit 1`);
      await h.asService(() => h.sql(
        `select app.finish_refund($1, true, 're_1')`, [approved!.id]));
      const [after] = await h.sql<{ state: string; stripe_refund_id: string }>(
        `select state, stripe_refund_id from refund_requests where id = $1`, [approved!.id]);
      expect(after!.state).toBe('applied');
      expect(after!.stripe_refund_id).toBe('re_1');
    });

    it('records a failure against the request rather than losing it', async () => {
      /*
       * Otherwise the next person sees one sitting at "approved" with no sign
       * anybody tried, and issues it a second time.
       */
      const [r] = await h.asUser(help, () => h.sql<{ id: string }>(
        `select app.request_refund($1,'refund',1000,
           'Duplicate charge on the 9th','in_ridge') as id`, [company]));
      await h.asUser(boss, () => h.sql(`select app.decide_refund($1, true)`, [r!.id]));
      await h.asService(() => h.sql(
        `select app.finish_refund($1, false, null, 'Stripe: charge already refunded')`,
        [r!.id]));
      const [after] = await h.sql<{ state: string; error: string }>(
        `select state, error from refund_requests where id = $1`, [r!.id]);
      expect(after!.state).toBe('failed');
      expect(after!.error).toMatch(/already refunded/);
    });
  });

  describe('what each side sees', () => {
    it('tells an operator whether they may decide a given one', async () => {
      const [r] = await h.asUser(help, () => h.sql<{ id: string }>(
        `select app.request_refund($1,'credit',1500,
           'A month they could not use because of the migration') as id`, [company]));
      const [mine] = await h.asUser(help, () => h.sql<{ may: boolean }>(
        `select you_may_decide as may from admin_refunds where id = $1`, [r!.id]));
      expect(mine!.may).toBe(false);
      const [theirs] = await h.asUser(boss, () => h.sql<{ may: boolean }>(
        `select you_may_decide as may from admin_refunds where id = $1`, [r!.id]));
      expect(theirs!.may).toBe(true);
    });

    it('tells the customer in words, without the internal reason', async () => {
      const rows = await h.asUser(owner, () => h.sql<{ standing: string }>(
        `select standing from my_refunds where company_id = $1`, [company]));
      expect(rows.map((x) => x.standing)).toContain('Refunded to your card');

      const cols = await h.sql<{ column_name: string }>(
        `select column_name from information_schema.columns where table_name = 'my_refunds'`);
      expect(cols.map((c) => c.column_name)).not.toContain('reason');
      expect(cols.map((c) => c.column_name)).not.toContain('decision_note');
    });

    it('never tells a customer about one that was refused', async () => {
      /*
       * Somebody who was never told a refund was being considered should not
       * learn of it by being told it was turned down.
       */
      const rows = await h.asUser(owner, () => h.sql<{ standing: string }>(
        `select standing from my_refunds where company_id = $1`, [company]));
      expect(rows.map((x) => x.standing)).not.toContain('Not approved');
    });

    it('shows one company nothing of another company refunds', async () => {
      const rows = await h.asUser(owner, () => h.sql<{ company_id: string }>(
        `select company_id from my_refunds`));
      expect(rows.every((x) => x.company_id === company)).toBe(true);
    });

    it('shows an anonymous visitor nothing at all', async () => {
      await expect(h.asAnon(() => h.sql(`select * from admin_refunds`)))
        .rejects.toThrow(/permission denied/);
    });
  });
});
