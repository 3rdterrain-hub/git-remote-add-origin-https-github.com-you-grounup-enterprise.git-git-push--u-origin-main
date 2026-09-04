/**
 * The price on the document that goes to the customer, against real PostgreSQL.
 *
 * A proposal has always been required to cite an estimate version, and that was
 * the whole of the connection. Reproduced before migration 0045 was written: a
 * proposal issued from a *draft* estimate, priced at zero while the estimate it
 * cited bid $1.2m, carrying a $5 line item added after the proposal had already
 * been frozen — because the immutability control guarded the header row while
 * the content lived in another table it never touched.
 *
 * RULE-008 makes deterministic estimating output authoritative over AI. These
 * tests hold the same line against a person typing a number into the document
 * a customer signs.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('a proposal presents the estimate it cites', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let customer = '';
  let estimate = '';
  let n = 0;

  /**
   * A version of the estimate at a given status and bid price.
   *
   * Created as a draft and then moved, because the platform refuses to approve
   * or issue a version that carries no library snapshot — an issued price it
   * cannot reproduce is not a record of anything. That control is P25's and it
   * applies here like it applies everywhere.
   */
  const version = async (status: string, bid: number) => {
    const [v] = await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into estimate_versions (company_id, estimate_id, version_number, status,
         total_price, bid_price)
       values ($1,$2,$3,'draft',$4,$4) returning id`,
      [company, estimate, ++n, bid]));
    if (status !== 'draft') {
      const [snap] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into library_snapshots (company_id, estimate_version_id, engine_version,
           entry_count, digest)
         values ($1,$2,'1.0.0',1,'0123456789abcdef') returning id`, [company, v!.id]));
      await h.asUser(owner, () => h.sql(
        // An issued version must record when, like everything else the
        // platform treats as sent.
        `update estimate_versions set status=$1::app.estimate_status, library_snapshot_id=$2,
           issued_at = case when $1 in ('issued','awarded') then now() end
         where id=$3`, [status, snap!.id, v!.id]));
    }
    return v!.id;
  };

  const proposal = (ev: string, opts: Partial<{ total: number; status: string }> = {}) =>
    h.asUser(owner, () => h.sql<{ id: string; total_price: string; status: string }>(
      `insert into proposals (company_id, estimate_version_id, customer_id, number, title,
         total_price, status, issued_at)
       values ($1,$2,$3,$4,'Vale Bridge',$5,$6,
               case when $6 <> 'draft' then now() end)
       returning id, total_price, status`,
      [company, ev, customer, `PRO-${++n}`, opts.total ?? 0, opts.status ?? 'draft']));

  const line = (p: string, price: number, opts: Partial<{ alt: boolean; opt: boolean }> = {}) =>
    h.asUser(owner, () => h.sql(
      `insert into proposal_line_items (company_id, proposal_id, description,
         extended_price, is_alternate, is_optional)
       values ($1,$2,'Mobilization',$3,$4,$5)`,
      [company, p, price, opts.alt ?? false, opts.opt ?? false]));

  const issue = (p: string) =>
    h.asUser(owner, () => h.sql(
      `update proposals set status='issued', issued_at=now() where id=$1`, [p]));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test')`, [owner]);
    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    customer = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into customers (company_id, code, name) values ($1,'C1','City of Vale')
       returning id`, [company])))[0]!.id;
    const opp = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into opportunities (company_id, customer_id, number, name, estimated_value)
       values ($1,$2,'OPP-1','Vale Bridge',1200000) returning id`, [company, customer])))[0]!.id;
    estimate = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into estimates (company_id, opportunity_id, customer_id, number, name)
       values ($1,$2,$3,'EST-1','Vale Bridge') returning id`,
      [company, opp, customer])))[0]!.id;
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('the price is the engine\'s, not a typed number', () => {
    it('takes the bid price from the version, ignoring what was submitted', async () => {
      const ev = await version('approved', 1200000);
      const [p] = await proposal(ev, { total: 0 });
      expect(Number(p!.total_price)).toBe(1200000);
    });

    it('re-derives it while the proposal is still a draft', async () => {
      const ev = await version('approved', 950000);
      const [p] = await proposal(ev, { total: 0 });
      await h.asUser(owner, () => h.sql(
        `update proposals set total_price = 1 where id=$1`, [p!.id]));
      const [after] = await h.asUser(owner, () => h.sql<{ total_price: string }>(
        `select total_price from proposals where id=$1`, [p!.id]));
      expect(Number(after!.total_price)).toBe(950000);
    });

    it('leaves an issued price exactly as it went out', async () => {
      // Re-deriving after issue would let a later estimate revision quietly
      // restate a price the customer already has.
      const ev = await version('approved', 500000);
      const [p] = await proposal(ev);
      await issue(p!.id);
      const [after] = await h.asUser(owner, () => h.sql<{ total_price: string }>(
        `select total_price from proposals where id=$1`, [p!.id]));
      expect(Number(after!.total_price)).toBe(500000);
    });

    it('refuses a proposal citing a version that does not exist', async () => {
      await expect(proposal('00000000-0000-4000-8000-000000000000'))
        .rejects.toThrow(/estimate version that does not exist/);
    });
  });

  describe('nothing is sent from an estimate nobody approved', () => {
    for (const status of ['draft', 'in_review']) {
      it(`refuses to issue from a ${status} estimate`, async () => {
        const ev = await version(status, 1200000);
        const [p] = await proposal(ev);
        await expect(issue(p!.id))
          .rejects.toThrow(new RegExp(`cites an estimate version that is ${status}`));
      });
    }

    it('refuses one created already issued from a draft estimate', async () => {
      // The exact shape reproduced before the fix.
      const ev = await version('draft', 1200000);
      await expect(proposal(ev, { status: 'issued' }))
        .rejects.toThrow(/estimate nobody has approved/);
    });

    for (const status of ['approved', 'issued', 'awarded']) {
      it(`allows issue from an ${status} estimate`, async () => {
        const ev = await version(status, 400000);
        const [p] = await proposal(ev);
        await issue(p!.id);
        const [after] = await h.asUser(owner, () => h.sql<{ status: string }>(
          `select status from proposals where id=$1`, [p!.id]));
        expect(after!.status).toBe('issued');
      });
    }
  });

  describe('the detail must agree with the total', () => {
    it('refuses to issue when the base line items do not add up', async () => {
      const ev = await version('approved', 1200000);
      const [p] = await proposal(ev);
      await line(p!.id, 5);
      await expect(issue(p!.id))
        .rejects.toThrow(/base line items add to 5/);
    });

    it('issues when they do', async () => {
      const ev = await version('approved', 1000000);
      const [p] = await proposal(ev);
      await line(p!.id, 600000);
      await line(p!.id, 400000);
      await issue(p!.id);
      const [after] = await h.asUser(owner, () => h.sql<{ status: string }>(
        `select status from proposals where id=$1`, [p!.id]));
      expect(after!.status).toBe('issued');
    });

    it('leaves alternates and options out of the base', async () => {
      // An alternate is a price the customer may or may not take. Counting it
      // in the base would make every proposal carrying one fail to tie.
      const ev = await version('approved', 800000);
      const [p] = await proposal(ev);
      await line(p!.id, 800000);
      await line(p!.id, 250000, { alt: true });
      await line(p!.id, 90000, { opt: true });
      await issue(p!.id);
      const [base] = await h.asUser(owner, () => h.sql<{ base: string }>(
        `select app.proposal_base_total($1) as base`, [p!.id]));
      expect(Number(base!.base)).toBe(800000);
    });

    it('issues a proposal that carries no line detail at all', async () => {
      // No detail is a presentation choice; detail that contradicts the total
      // is a defect. Only the second is refused.
      const ev = await version('approved', 700000);
      const [p] = await proposal(ev);
      await issue(p!.id);
      const [after] = await h.asUser(owner, () => h.sql<{ status: string }>(
        `select status from proposals where id=$1`, [p!.id]));
      expect(after!.status).toBe('issued');
    });
  });

  describe('an issued proposal is frozen through to its content', () => {
    let issued = '';

    beforeAll(async () => {
      const ev = await version('approved', 300000);
      const [p] = await proposal(ev);
      issued = p!.id;
      await line(issued, 300000);
      await issue(issued);
    });

    it('refuses a new line item', async () => {
      // The hole: the immutability trigger guarded the header row and said the
      // content was fixed, while the content lived in another table.
      await expect(line(issued, 5))
        .rejects.toThrow(/line items are fixed; INSERT is not permitted/);
    });

    it('refuses an edit to an existing line item', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `update proposal_line_items set extended_price = 1 where proposal_id=$1`, [issued])))
        .rejects.toThrow(/line items are fixed; UPDATE is not permitted/);
    });

    it('refuses a deletion', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `delete from proposal_line_items where proposal_id=$1`, [issued])))
        .rejects.toThrow(/line items are fixed; DELETE is not permitted/);
    });

    it('still allows the answer from the customer to be recorded', async () => {
      // Acceptance is not a change to the document.
      await h.asUser(owner, () => h.sql(
        `update proposals set status='accepted', accepted_at=now(), accepted_by_name='M. Reyes'
         where id=$1`, [issued]));
      const [after] = await h.asUser(owner, () => h.sql<{ status: string }>(
        `select status from proposals where id=$1`, [issued]));
      expect(after!.status).toBe('accepted');
    });

    it('keeps line items editable while it is a draft', async () => {
      const ev = await version('approved', 100000);
      const [p] = await proposal(ev);
      await line(p!.id, 1);
      await h.asUser(owner, () => h.sql(
        `update proposal_line_items set extended_price = 2 where proposal_id=$1`, [p!.id]));
      await h.asUser(owner, () => h.sql(
        `delete from proposal_line_items where proposal_id=$1`, [p!.id]));
      expect(await h.asUser(owner, () => h.sql(
        `select 1 from proposal_line_items where proposal_id=$1`, [p!.id]))).toEqual([]);
    });
  });
});
