import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * One plan, priced per seat, with the two real costs measured.
 *
 * The distinction these tests exist to hold is between a flow and a level.
 * AI requests are consumption: they happen, they are counted over the paid
 * period, and summing events is right. Storage is occupancy: what matters is
 * what is held now, and summing upload events would bill a company for every
 * file they ever deleted.
 *
 * Migration 0039 recorded that storage "could not be metered". It was right
 * about the mechanism it had and wrong about the conclusion: storage cannot be
 * *metered*, and it can be *measured*.
 */
describe('one plan, priced per seat', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  const mate  = '22222222-2222-4222-8222-222222222222';
  let company = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [[owner, 'o@r.test'], [mate, 'm@r.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2) on conflict (id) do nothing`,
        [id, email]);
    }
    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','grounup') as id`)))[0]!.id;
  });

  afterAll(async () => { await h?.db.close(); });

  describe('the catalog', () => {
    it('sells exactly one paid plan, beside the free one', async () => {
      /*
       * The point of one plan was never that nothing else is listed — it was
       * that nobody has to choose between crippled versions of the same
       * product. Migration 0077 adds a permanent free tier, which is a
       * different question: not which product you get, but whether you are
       * paying for the half of it that runs a construction company.
       */
      const rows = await h.sql<{ id: string }>(
        `select id from plans where is_public and is_active order by id`);
      expect(rows.map((r) => r.id)).toEqual(['free', 'grounup']);
      // One of them is the free tier; there is exactly one thing to buy.
      expect(rows.filter((r) => r.id !== 'free')).toHaveLength(1);
    });

    it('keeps an unadvertised plan for what enterprises negotiate', async () => {
      // Not a feature difference. Single sign-on, a service level, terms.
      const [e] = await h.sql<{ is_public: boolean; is_active: boolean }>(
        `select is_public, is_active from plans where id = 'grounup_enterprise'`);
      expect(e!.is_public).toBe(false);
      expect(e!.is_active).toBe(true);
    });

    it('retires the old tiers rather than deleting them', async () => {
      /*
       * They are published commercial terms and anything that ever bought under
       * one still points at it. Deleting would break that; retiring stops them
       * being sold and changes nothing already agreed.
       */
      const rows = await h.sql<{ id: string; is_active: boolean }>(
        `select id, is_active from plans where id in ('starter','professional','business')`);
      expect(rows.length).toBe(3);
      expect(rows.every((r) => !r.is_active)).toBe(true);
    });

    it('caps nothing that is billed', async () => {
      // A seat limit on a per-seat plan would refuse the eleventh person on a
      // plan that charges for the eleventh person.
      const [p] = await h.sql<{
        max_seats: number | null; max_active_estimates: number | null; features: string[];
      }>(`select max_seats, max_active_estimates, features from plans where id = 'grounup'`);
      expect(p!.max_seats).toBeNull();
      expect(p!.max_active_estimates).toBeNull();
      expect(p!.features).toEqual(['*']);
    });

    it('includes every feature, so nothing is gated', async () => {
      for (const feature of ['ai_plan_review', 'white_label', 'anything_at_all']) {
        const [r] = await h.asUser(owner, () => h.sql<{ has: boolean }>(
          `select app.has_entitlement($1,$2) as has`, [company, feature]));
        expect(r!.has, feature).toBe(true);
      }
    });
  });

  describe('seats are counted, not capped', () => {
    it('counts people who can sign in and do work', async () => {
      const [s] = await h.asUser(owner, () => h.sql<{ n: number }>(
        `select app.billable_seats($1) as n`, [company]));
      expect(s!.n).toBe(1);
    });

    it('counts a second person joining', async () => {
      const role = (await h.sql<{ id: string }>(
        `select id from roles where key='estimator' and company_id is null`))[0]!.id;
      await h.sql(`insert into company_memberships (company_id, user_id, role_id, status, joined_at)
                   values ($1,$2,$3,'active',now())`, [company, mate, role]);
      const [s] = await h.asUser(owner, () => h.sql<{ n: number }>(
        `select app.billable_seats($1) as n`, [company]));
      expect(s!.n).toBe(2);
    });

    it('does not count somebody who has been removed', async () => {
      /*
       * Any other definition produces an invoice a customer disputes, and they
       * are right to.
       */
      await h.sql(`update company_memberships set status = 'removed'
                    where company_id = $1 and user_id = $2`, [company, mate]);
      const [s] = await h.asUser(owner, () => h.sql<{ n: number }>(
        `select app.billable_seats($1) as n`, [company]));
      expect(s!.n).toBe(1);
      // Put them back for the usage view test below.
      await h.sql(`update company_memberships set status = 'active'
                    where company_id = $1 and user_id = $2`, [company, mate]);
    });
  });

  describe('storage is measured, not metered', () => {
    let doc = '';
    beforeAll(async () => {
      doc = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into documents (company_id, name, document_type)
         values ($1,'Plan set','plan_set') returning id`, [company])))[0]!.id;
    });

    it('reports nothing held before anything is uploaded', async () => {
      const [s] = await h.asUser(owner, () => h.sql<{ b: string }>(
        `select app.storage_bytes($1) as b`, [company]));
      expect(Number(s!.b)).toBe(0);
    });

    it('measures what is held', async () => {
      await h.asUser(owner, () => h.sql(
        `insert into document_versions
           (company_id, document_id, version_number, storage_path, file_name, byte_size)
         values ($1,$2,1,'p/v1.pdf','v1.pdf',5242880)`, [company, doc]));
      const [s] = await h.asUser(owner, () => h.sql<{ b: string }>(
        `select app.storage_bytes($1) as b`, [company]));
      expect(Number(s!.b)).toBe(5242880);
    });

    it('stops counting a file once it is gone', async () => {
      /*
       * The distinction the whole design turns on. A metered total would keep
       * charging for this; a measured one does not, because it reports what is
       * held rather than what was ever uploaded.
       */
      await h.asUser(owner, () => h.sql(
        `insert into document_versions
           (company_id, document_id, version_number, storage_path, file_name, byte_size)
         values ($1,$2,2,'p/v2.pdf','v2.pdf',1048576)`, [company, doc]));
      let [s] = await h.asUser(owner, () => h.sql<{ b: string }>(
        `select app.storage_bytes($1) as b`, [company]));
      expect(Number(s!.b)).toBe(6291456);

      await h.asUser(owner, () => h.sql(
        `delete from document_versions where document_id = $1 and version_number = 2`, [doc]));
      [s] = await h.asUser(owner, () => h.sql<{ b: string }>(
        `select app.storage_bytes($1) as b`, [company]));
      expect(Number(s!.b)).toBe(5242880);
    });

    it('says how much of the total is unmeasured rather than guessing', async () => {
      /*
       * A file with no recorded size contributes nothing, which understates.
       * Understating is the right direction for an invoice, and saying so makes
       * it visible rather than something discovered during a dispute.
       */
      await h.asUser(owner, () => h.sql(
        `insert into document_versions
           (company_id, document_id, version_number, storage_path, file_name)
         values ($1,$2,3,'p/v3.pdf','v3.pdf')`, [company, doc]));
      const [u] = await h.asUser(owner, () => h.sql<{
        storage_bytes: string; files_without_a_size: string;
      }>(`select storage_bytes, files_without_a_size from reporting_company_usage
           where company_id = $1`, [company]));
      expect(Number(u!.storage_bytes)).toBe(5242880);
      expect(Number(u!.files_without_a_size)).toBe(1);
    });

    it('is inside the allowance while it is', async () => {
      const [r] = await h.asUser(owner, () => h.sql<{ ok: boolean }>(
        `select app.storage_within_allowance($1) as ok`, [company]));
      expect(r!.ok).toBe(true);
    });

    it('is outside it when it is', async () => {
      await h.asUser(owner, () => h.sql(
        `insert into document_versions
           (company_id, document_id, version_number, storage_path, file_name, byte_size)
         values ($1,$2,4,'p/big.pdf','big.pdf',$3)`,
        [company, doc, 200 * 1073741824]));
      const [r] = await h.asUser(owner, () => h.sql<{ ok: boolean }>(
        `select app.storage_within_allowance($1) as ok`, [company]));
      expect(r!.ok).toBe(false);
      await h.asUser(owner, () => h.sql(
        `delete from document_versions where document_id = $1 and version_number = 4`, [doc]));
    });

    it('treats no allowance as unlimited, so a billing gap is not an outage', async () => {
      await h.sql(`update entitlements set storage_gb = null where company_id = $1`, [company]);
      const [r] = await h.asUser(owner, () => h.sql<{ ok: boolean }>(
        `select app.storage_within_allowance($1) as ok`, [company]));
      expect(r!.ok).toBe(true);
      await h.sql(`update entitlements set storage_gb = 100 where company_id = $1`, [company]);
    });
  });

  describe('the three billing inputs together', () => {
    it('reports seats, AI this period, and bytes held now', async () => {
      const [u] = await h.asUser(owner, () => h.sql<{
        seats: number; ai_requests_this_period: string;
        storage_gb: string; ai_credits_included: number | null;
      }>(`select seats, ai_requests_this_period, storage_gb, ai_credits_included
            from reporting_company_usage where company_id = $1`, [company]));
      expect(u!.seats).toBe(2);
      expect(Number(u!.ai_requests_this_period)).toBe(0);
      expect(Number(u!.storage_gb)).toBeCloseTo(0.005, 3);
      expect(u!.ai_credits_included).toBe(500);
    });

    it('counts an AI request as a flow, within the period', async () => {
      await h.sql(
        `insert into usage_events (company_id, metric, quantity, unit)
         values ($1,'ai.request',1,'request')`, [company]);
      const [u] = await h.asUser(owner, () => h.sql<{ ai_requests_this_period: string }>(
        `select ai_requests_this_period from reporting_company_usage where company_id = $1`,
        [company]));
      expect(Number(u!.ai_requests_this_period)).toBe(1);
    });

    it('shows one company nothing of another company usage', async () => {
      const stranger = '33333333-3333-4333-8333-333333333333';
      await h.sql(`insert into auth.users (id, email) values ($1,'s@r.test')`, [stranger]);
      await h.sql(`insert into user_profiles (id, email) values ($1,'s@r.test') on conflict (id) do nothing`, [stranger]);
      await h.asUser(stranger, () => h.sql(`select app.provision_company('Other','other','grounup')`));
      const rows = await h.asUser(stranger, () => h.sql(
        `select 1 from reporting_company_usage where company_id = $1`, [company]));
      expect(rows).toEqual([]);
    });
  });
});
