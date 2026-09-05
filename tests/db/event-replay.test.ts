import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Replaying a payment event that never landed.
 *
 * A replay writes subscription and entitlement state, so the tests worth having
 * are the ones that stop it being a general-purpose write: it can only re-apply
 * a payload already stored, it cannot touch an event that already finished, and
 * the operator who asks for one cannot be the one who declares it successful.
 */
describe('replaying a stuck event', () => {
  let h: Harness;
  const boss = 'eeeeeeee-0000-4000-8000-000000000001';
  const rep  = 'eeeeeeee-0000-4000-8000-000000000002';
  const rich = 'eeeeeeee-0000-4000-8000-000000000003';
  const cust = 'eeeeeeee-0000-4000-8000-000000000004';
  let company = '';

  const account = async (id: string, email: string) => {
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [id, email]);
  };

  const storeEvent = (id: string, state: string, company_id: string | null = null) =>
    h.sql(`insert into stripe_events (id, type, livemode, company_id, payload,
                                      processing_state, processing_error, processed_at)
           values ($1::text,'customer.subscription.updated', false, $2::uuid,
                   jsonb_build_object('id', $1::text, 'type','customer.subscription.updated',
                                      'data', jsonb_build_object('object',
                                        jsonb_build_object('id','sub_x','customer','cus_x'))),
                   $3::text,
                   case when $3::text = 'failed' then 'Timed out talking to Stripe' end,
                   case when $3::text in ('processed','ignored') then now() end)`,
      [id, company_id, state]);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await account(boss, 'boss@grounup.test');
    await account(rep, 'support@grounup.test');
    await account(rich, 'money@grounup.test');
    await account(cust, 'owner@ridge.test');
    await h.sql(`insert into platform_admins (user_id, reason, role)
                 values ($1,'Runs the platform','superadmin')`, [boss]);
    await h.asUser(boss, () => h.sql(
      `select app.hire_operator('support@grounup.test','Answers billing tickets','support')`));
    await h.asUser(boss, () => h.sql(
      `select app.hire_operator('money@grounup.test','Reconciles invoices','finance')`));

    company = (await h.asUser(cust, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','grounup') as id`)))[0]!.id;
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('who may ask for one', () => {
    it('is support, because support fields the ticket', async () => {
      const [can] = await h.asUser(rep, () => h.sql<{ retry: boolean }>(
        `select app.operator_can('webhooks.retry') as retry`));
      expect(can!.retry).toBe(true);
    });

    it('is not the person closing the renewal', async () => {
      // An account manager is on the commercial side of the same customer.
      const [r] = await h.sql<{ has: boolean }>(
        `select permissions @> array['webhooks.retry'] as has
           from platform_roles where key = 'account_manager'`);
      expect(r!.has).toBe(false);
    });

    it('is refused to finance, who can read every figure', async () => {
      await storeEvent('evt_finance', 'failed');
      await expect(h.asUser(rich, () => h.sql(
        `select * from app.claim_event_replay('evt_finance','Curious what this does')`)))
        .rejects.toThrow(/do not have permission/);
    });

    it('is refused to a customer outright', async () => {
      await expect(h.asUser(cust, () => h.sql(
        `select * from app.claim_event_replay('evt_finance','I would like my subscription back')`)))
        .rejects.toThrow(/do not have permission/);
    });
  });

  describe('what may be replayed', () => {
    it('hands back the stored payload rather than taking one', async () => {
      await storeEvent('evt_stuck', 'failed', company);
      const [r] = await h.asUser(rep, () => h.sql<{
        replay_id: string; event_type: string; payload: { id: string };
      }>(`select * from app.claim_event_replay('evt_stuck',
            'Customer paid on the 3rd and still has no access')`));
      expect(r!.event_type).toBe('customer.subscription.updated');
      // The payload comes out of the table. The caller named an id; they did
      // not get to supply an event.
      expect(r!.payload.id).toBe('evt_stuck');
      expect(r!.replay_id).toBeTruthy();
    });

    it('refuses an event that already finished', async () => {
      /*
       * The dangerous case. Re-applying a processed event writes an old
       * subscription state over a newer one — which is how a cancellation that
       * was already handled brings a dead subscription back to life.
       */
      await storeEvent('evt_done', 'processed');
      await expect(h.asUser(rep, () => h.sql(
        `select * from app.claim_event_replay('evt_done','Trying it again for luck')`)))
        .rejects.toThrow(/already processed/);
    });

    it('refuses one Stripe never sent', async () => {
      await expect(h.asUser(rep, () => h.sql(
        `select * from app.claim_event_replay('evt_invented','Made this id up')`)))
        .rejects.toThrow(/No stored event/);
    });

    it('refuses to replay without saying why', async () => {
      await storeEvent('evt_nowhy', 'failed');
      await expect(h.asUser(rep, () => h.sql(
        `select * from app.claim_event_replay('evt_nowhy','x')`)))
        .rejects.toThrow(/Say why/);
    });
  });

  describe('recording how it went', () => {
    it('cannot be declared successful by the operator who asked', async () => {
      // Otherwise "I retried it and it worked" is a claim rather than a fact.
      await storeEvent('evt_selfmark', 'failed');
      const [r] = await h.asUser(rep, () => h.sql<{ replay_id: string }>(
        `select * from app.claim_event_replay('evt_selfmark','Second attempt at this one')`));
      await expect(h.asUser(rep, () => h.sql(
        `select public.finish_event_replay($1, true)`, [r!.replay_id])))
        .rejects.toThrow(/permission denied/);
    });

    it('marks the event processed when the replay worked', async () => {
      const [r] = await h.asUser(rep, () => h.sql<{ replay_id: string }>(
        `select * from app.claim_event_replay('evt_selfmark','Third attempt')`));
      await h.asService(() => h.sql(
        `select app.finish_event_replay($1, true)`, [r!.replay_id]));
      const [e] = await h.sql<{ state: string; processed: string | null; attempts: number }>(
        `select processing_state as state, processed_at as processed, attempts
           from stripe_events where id = 'evt_selfmark'`);
      expect(e!.state).toBe('processed');
      expect(e!.processed).not.toBeNull();
      expect(Number(e!.attempts)).toBeGreaterThan(0);
    });

    it('keeps the event stuck when the replay failed, with the reason', async () => {
      await storeEvent('evt_stillbad', 'failed');
      const [r] = await h.asUser(rep, () => h.sql<{ replay_id: string }>(
        `select * from app.claim_event_replay('evt_stillbad','Having another go')`));
      await h.asService(() => h.sql(
        `select app.finish_event_replay($1, false, 'Stripe returned 404 for that subscription')`,
        [r!.replay_id]));
      const [e] = await h.sql<{ state: string; err: string; processed: string | null }>(
        `select processing_state as state, processing_error as err, processed_at as processed
           from stripe_events where id = 'evt_stillbad'`);
      expect(e!.state).toBe('failed');
      expect(e!.processed).toBeNull();
      expect(e!.err).toMatch(/404/);
    });

    it('writes a replay into the customer own account history', async () => {
      const [a] = await h.asUser(cust, () => h.sql<{ reason: string }>(
        `select reason from audit_events
          where company_id = $1 and entity_table = 'public.stripe_events'`, [company]));
      expect(a).toBeUndefined();

      // Now one on an event that does resolve to them.
      const [r] = await h.asUser(rep, () => h.sql<{ replay_id: string }>(
        `select * from app.claim_event_replay('evt_stuck','Customer paid and got nothing')`));
      await h.asService(() => h.sql(
        `select app.finish_event_replay($1, true)`, [r!.replay_id]));
      const [after] = await h.asUser(cust, () => h.sql<{ reason: string }>(
        `select reason from audit_events
          where company_id = $1 and entity_table = 'public.stripe_events'`, [company]));
      expect(after!.reason).toMatch(/Customer paid and got nothing/);
    });
  });

  describe('what an operator sees', () => {
    it('lists what is still stuck and what has been tried', async () => {
      const rows = await h.asUser(rep, () => h.sql<{
        event_id: string; attempts_by_hand: string; last_error: string | null;
      }>(`select event_id, attempts_by_hand, last_error from admin_stuck_events`));
      const stillBad = rows.find((x) => x.event_id === 'evt_stillbad');
      expect(stillBad).toBeDefined();
      expect(Number(stillBad!.attempts_by_hand)).toBe(1);
      expect(stillBad!.last_error).toMatch(/404/);
    });

    it('drops an event off the list once it is applied', async () => {
      const rows = await h.asUser(rep, () => h.sql<{ event_id: string }>(
        `select event_id from admin_stuck_events`));
      expect(rows.map((x) => x.event_id)).not.toContain('evt_stuck');
    });

    it('names the Stripe customer, which is usually all there is to go on', async () => {
      const [r] = await h.asUser(rep, () => h.sql<{ stripe_customer_id: string }>(
        `select stripe_customer_id from admin_stuck_events where event_id = 'evt_stillbad'`));
      expect(r!.stripe_customer_id).toBe('cus_x');
    });

    it('shows a customer none of it', async () => {
      const rows = await h.asUser(cust, () => h.sql(`select * from admin_stuck_events`));
      expect(rows).toHaveLength(0);
    });

    it('shows an anonymous visitor none of it either', async () => {
      await expect(h.asAnon(() => h.sql(`select * from admin_stuck_events`)))
        .rejects.toThrow(/permission denied/);
    });
  });
});
