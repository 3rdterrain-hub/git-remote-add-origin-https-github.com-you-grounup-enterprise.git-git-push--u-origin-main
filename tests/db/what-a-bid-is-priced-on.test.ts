import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * What a bid is priced on, and what it leaves out.
 *
 * `estimate_assumptions` and `estimate_exclusions` were built in 0006, given
 * RLS in 0010 and taught to copy themselves onto a new version in 0011 and
 * 0112 — four migrations treating them as real, and no row ever written. 0232
 * opened the doors. The tests worth having are the refusals, because each one
 * is a place a bid could otherwise go out saying nothing.
 */
describe('what a bid is priced on', () => {
  let h: Harness;
  const owner = '41111111-1111-4111-8111-111111111111';
  let company = '';
  let versionId = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [owner, 'q@r.test']);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2) on conflict (id) do nothing`,
      [owner, 'q@r.test']);
    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Cutline','cutline','business') as id`)))[0]!.id;

    const [cust] = await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into customers (company_id, code, name) values ($1,'CUS-0001','Owner') returning id`,
      [company]));
    const [est] = await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into estimates (company_id, customer_id, number, name)
       values ($1,$2,'EST-0001','Site work') returning id`, [company, cust!.id]));
    const [ver] = await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into estimate_versions (company_id, estimate_id, version_number, status)
       values ($1,$2,1,'draft') returning id`, [company, est!.id]));
    versionId = ver!.id;
  });

  afterAll(async () => { await h?.db.close(); });

  describe('an exclusion', () => {
    it('is recorded with the reason beside it', async () => {
      await h.asUser(owner, () => h.sql(
        `select app.add_estimate_exclusion($1,'Rock excavation',
           'No geotechnical report was provided with the set','Earthwork')`, [versionId]));

      const [row] = await h.asUser(owner, () => h.sql<{
        exclusion: string; reason: string; category: string;
      }>(`select exclusion, reason, category from my_estimate_exclusions
           where estimate_version_id = $1`, [versionId]));
      expect(row!.exclusion).toBe('Rock excavation');
      expect(row!.reason).toBe('No geotechnical report was provided with the set');
      expect(row!.category).toBe('Earthwork');
    });

    /*
     * Section 49, written into this table's column comment in 0006 and never
     * enforced by anything, because nothing had ever inserted a row.
     */
    it('is refused without a reason, however inconvenient the item is to price', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `select app.add_estimate_exclusion($1,'Dewatering',null)`, [versionId])))
        .rejects.toThrow(/has to say why/i);
      await expect(h.asUser(owner, () => h.sql(
        `select app.add_estimate_exclusion($1,'Dewatering','   ')`, [versionId])))
        .rejects.toThrow(/has to say why/i);
    });

    it('is refused with no subject', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `select app.add_estimate_exclusion($1,'  ','because')`, [versionId])))
        .rejects.toThrow(/what is excluded/i);
    });

    it('can be taken back off while the version is a draft', async () => {
      const [e] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `select app.add_estimate_exclusion($1,'Bonds','Owner is carrying them') as id`,
        [versionId]));
      await h.asUser(owner, () => h.sql(`select app.remove_estimate_exclusion($1)`, [e!.id]));
      const rows = await h.asUser(owner, () => h.sql(
        `select 1 from my_estimate_exclusions where id = $1`, [e!.id]));
      expect(rows).toEqual([]);
    });
  });

  describe('an assumption', () => {
    it('is recorded with what it rests on', async () => {
      const [a] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `select app.add_estimate_assumption($1,'Topsoil stripped at 6 inches',
           'Sheet C1.0 grading note, confirmed on the site visit') as id`, [versionId]));
      const [row] = await h.asUser(owner, () => h.sql<{
        assumption: string; reason: string; is_disclosed_to_customer: boolean;
      }>(`select assumption, reason, is_disclosed_to_customer
            from my_estimate_assumptions where id = $1`, [a!.id]));
      expect(row!.assumption).toBe('Topsoil stripped at 6 inches');
      expect(row!.is_disclosed_to_customer).toBe(true);
    });

    it('is refused with no basis', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `select app.add_estimate_assumption($1,'Spoil stays on site',null)`, [versionId])))
        .rejects.toThrow(/what it rests on/i);
    });

    /* Everything can be shown to the client — or held back, per item. */
    it('can be held back from the customer without being deleted', async () => {
      const [a] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `select app.add_estimate_assumption($1,'Haul 4 miles to our own pit',
           'Our pit, priced at our own rate') as id`, [versionId]));
      await h.asUser(owner, () => h.sql(
        `select app.set_estimate_assumption($1,null,null,null,null,false)`, [a!.id]));
      const [row] = await h.asUser(owner, () => h.sql<{ is_disclosed_to_customer: boolean }>(
        `select is_disclosed_to_customer from my_estimate_assumptions where id = $1`, [a!.id]));
      expect(row!.is_disclosed_to_customer).toBe(false);
    });
  });

  /*
   * RULE-009. An issued version is what somebody was sent; changing what it
   * said it was priced on, afterwards, is changing the offer.
   */
  describe('a version that is no longer a draft', () => {
    /*
     * Archived rather than issued, because issuing is itself guarded: a version
     * cannot reach `issued` without a library snapshot, since an issued price
     * the platform cannot reproduce is not a record of anything. Archived
     * exercises the same branch without having to defeat that rule to do it.
     */
    it('takes no new exclusion, and says to start a revision', async () => {
      await h.asUser(owner, () => h.sql(
        `update estimate_versions set status = 'archived' where id = $1`, [versionId]));
      await expect(h.asUser(owner, () => h.sql(
        `select app.add_estimate_exclusion($1,'Permits','By owner')`, [versionId])))
        .rejects.toThrow(/cannot be changed/i);
      await expect(h.asUser(owner, () => h.sql(
        `select app.add_estimate_assumption($1,'Anything','Any reason')`, [versionId])))
        .rejects.toThrow(/cannot be changed/i);
      await h.asUser(owner, () => h.sql(
        `update estimate_versions set status = 'draft' where id = $1`, [versionId]));
    });
  });

  describe('somebody else', () => {
    it('cannot write onto another company’s estimate', async () => {
      const other = '42222222-2222-4222-8222-222222222222';
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [other, 'x@q.test']);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2) on conflict (id) do nothing`,
        [other, 'x@q.test']);
      await h.asUser(other, () => h.sql(`select app.provision_company('Other','other-q','business')`));
      await expect(h.asUser(other, () => h.sql(
        `select app.add_estimate_exclusion($1,'Sneaked in','because')`, [versionId])))
        .rejects.toThrow();
    });
  });
});
