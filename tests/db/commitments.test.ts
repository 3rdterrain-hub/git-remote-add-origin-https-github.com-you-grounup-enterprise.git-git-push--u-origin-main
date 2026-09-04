/**
 * Commitments and vendor cost reaching the job, against real PostgreSQL.
 *
 * `project_costs.is_committed` was read by the financial view and written by
 * nothing, so `committed_cost` was always zero and a project manager could not
 * see a dollar of what the company had already promised a vendor. Approved
 * vendor invoices never posted either, so `material_cost` and
 * `subcontract_cost` were always zero too. And the constraint that refuses to
 * over-invoice a purchase order guarded a column no invoice ever moved.
 *
 * These hold the loop: a purchase order commits, an invoice consumes the
 * commitment and becomes cost, and the two never double-count.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('commitments and vendor cost reach the job', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let project = '';
  let vendor = '';
  let n = 0;

  const costs = (ref?: string) =>
    h.asUser(owner, () => h.sql<{
      cost_type: string; amount: string; is_committed: boolean;
      source: string; description: string; cost_code_id: string | null }>(
      `select cost_type, amount, is_committed, source, description, cost_code_id
       from project_costs where project_id = $1 ${ref ? 'and reference = $2' : ''}
       order by amount desc`, ref ? [project, ref] : [project]));

  const financials = () =>
    h.asUser(owner, () => h.sql<{
      actual_cost: string; committed_cost: string;
      material_cost: string; subcontract_cost: string }>(
      `select actual_cost, committed_cost, material_cost, subcontract_cost
       from reporting_project_financials where project_id = $1`, [project]))
      .then(([r]) => r!);

  const po = (amount: number, opts: Partial<{ type: string; status: string }> = {}) =>
    h.asUser(owner, () => h.sql<{ id: string; number: string }>(
      `insert into purchase_orders (company_id, project_id, vendor_id, number, title,
         po_type, committed_amount, status, issued_at)
       values ($1,$2,$3,$4,'Supply',$5,$6,$7,now()) returning id, number`,
      [company, project, vendor, `PO-C${++n}`, opts.type ?? 'material', amount,
       opts.status ?? 'issued'])).then(([r]) => r!);

  const invoice = (amount: number, opts: Partial<{
    po: string | null; approved: boolean; tax: number }> = {}) =>
    h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into ap_invoices (company_id, vendor_id, purchase_order_id, project_id,
         invoice_number, invoice_date, amount, tax, approval_state, approved_by, approved_at)
       values ($1,$2,$3,$4,$5,'2026-06-01',$6,$7,
               $8::app.approval_state,
               case when $8 = 'approved' then $9::uuid end,
               case when $8 = 'approved' then now() end)
       returning id`,
      [company, vendor, opts.po ?? null, project, `INV-C${++n}`, amount, opts.tax ?? 0,
       opts.approved === false ? 'pending' : 'approved', owner])).then(([r]) => r!);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test') on conflict (id) do nothing`, [owner]);
    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    project = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, status, contract_value)
       values ($1,'PRJ-C1','Vale Bridge','active',5000000) returning id`, [company])))[0]!.id;
    vendor = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into vendors (company_id, code, name) values ($1,'V1','Cascade Aggregates')
       returning id`, [company])))[0]!.id;
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('a purchase order commits', () => {
    it('posts the commitment when the order is issued', async () => {
      const p = await po(100000);
      const rows = await costs(`purchase_order:${p.id}`);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.amount)).toBe(100000);
      expect(rows[0]!.is_committed).toBe(true);
      expect(rows[0]!.cost_type).toBe('material');
      expect(rows[0]!.source).toBe('purchase_order');
    });

    it('posts nothing for a draft order', async () => {
      // A draft purchase order is not a promise to anybody.
      const p = await po(50000, { status: 'draft' });
      expect(await costs(`purchase_order:${p.id}`)).toEqual([]);
    });

    it('follows the order type into the cost category', async () => {
      const sub = await po(200000, { type: 'subcontract' });
      expect((await costs(`purchase_order:${sub.id}`))[0]!.cost_type).toBe('subcontract');
      const rental = await po(30000, { type: 'rental' });
      expect((await costs(`purchase_order:${rental.id}`))[0]!.cost_type).toBe('equipment');
    });

    it('removes the commitment when the order is canceled', async () => {
      const p = await po(70000);
      expect((await costs(`purchase_order:${p.id}`)).length).toBe(1);
      await h.asUser(owner, () => h.sql(
        `update purchase_orders set status='canceled' where id=$1`, [p.id]));
      expect(await costs(`purchase_order:${p.id}`)).toEqual([]);
    });
  });

  describe('the commitment lands on the cost codes it was raised against', () => {
    it('spreads it across the line items in proportion to their value', async () => {
      const p = await po(100000);
      const [a, b] = await h.asUser(owner, () => h.sql<{ id: string }>(
        // An active company library row needs an approver — library governance,
        // and it applies to a cost code like it applies to a rate.
        `insert into cost_codes (company_id, code, name, status, approved_by, approved_at)
         values ($1,'02-100','Earthwork','active',$2,now()),
                ($1,'03-100','Concrete','active',$2,now()) returning id`, [company, owner]));
      await h.asUser(owner, () => h.sql(
        `insert into purchase_order_items (company_id, purchase_order_id, cost_code_id,
           sort_order, description, quantity, unit_price)
         values ($1,$2,$3,1,'Base rock',1,75000), ($1,$2,$4,2,'Ready mix',1,25000)`,
        [company, p.id, a!.id, b!.id]));
      const rows = await costs(`purchase_order:${p.id}`);
      expect(rows.map((r) => Number(r.amount))).toEqual([75000, 25000]);
      expect(rows.map((r) => r.cost_code_id).sort()).toEqual([a!.id, b!.id].sort());
    });

    it('adds to the commitment exactly, with the last line taking the remainder', async () => {
      // Three equal thirds of 100 do not divide evenly. Rows that add to 99.99
      // would understate the commitment by a cent on every such order.
      const p = await po(100);
      await h.asUser(owner, () => h.sql(
        `insert into purchase_order_items (company_id, purchase_order_id, sort_order,
           description, quantity, unit_price)
         values ($1,$2,1,'A',1,1), ($1,$2,2,'B',1,1), ($1,$2,3,'C',1,1)`,
        [company, p.id]));
      const rows = await costs(`purchase_order:${p.id}`);
      expect(rows).toHaveLength(3);
      expect(rows.reduce((t, r) => t + Number(r.amount), 0)).toBe(100);
    });
  });

  describe('an invoice consumes the commitment and becomes cost', () => {
    let open = '';

    it('reduces the open commitment by what has been invoiced', async () => {
      const p = await po(100000);
      open = p.id;
      await invoice(40000, { po: p.id });
      const rows = await costs(`purchase_order:${p.id}`);
      // 100,000 promised, 40,000 invoiced, 60,000 still open.
      expect(Number(rows[0]!.amount)).toBe(60000);
      expect(rows[0]!.is_committed).toBe(true);
    });

    it('posts the invoice as actual cost beside it', async () => {
      const rows = await h.asUser(owner, () => h.sql<{ amount: string; is_committed: boolean }>(
        `select amount, is_committed from project_costs
         where project_id=$1 and source='accounting_import' and amount='40000.00'`, [project]));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.is_committed).toBe(false);
    });

    it('counts the money once across the two', async () => {
      // The reason the open commitment is posted rather than the whole order:
      // actual and committed sit side by side, and posting the full value
      // would count the invoiced part twice.
      const rows = await costs();
      const forThisPo = rows.filter((r) => r.description.includes('PO-C'));
      expect(forThisPo.length).toBeGreaterThan(0);
      const [row] = await h.asUser(owner, () => h.sql<{ total: string }>(
        `select coalesce(sum(amount),0) as total from project_costs
         where project_id=$1 and (reference=$2 or reference like 'ap_invoice:%')`,
        [project, `purchase_order:${open}`]));
      expect(Number(row!.total)).toBe(100000);
    });

    it('includes tax, because it is money the job owes', async () => {
      const p = await po(10000);
      const inv = await invoice(1000, { po: p.id, tax: 80 });
      const rows = await costs(`ap_invoice:${inv.id}`);
      expect(Number(rows[0]!.amount)).toBe(1080);
    });

    it('posts nothing for an invoice nobody approved', async () => {
      const inv = await invoice(9999, { approved: false });
      expect(await costs(`ap_invoice:${inv.id}`)).toEqual([]);
    });

    it('posts it the moment it is approved, and removes it if withdrawn', async () => {
      const inv = await invoice(2500, { approved: false });
      expect(await costs(`ap_invoice:${inv.id}`)).toEqual([]);
      await h.asUser(owner, () => h.sql(
        `update ap_invoices set approval_state='approved', approved_by=$1, approved_at=now()
         where id=$2`, [owner, inv.id]));
      expect(Number((await costs(`ap_invoice:${inv.id}`))[0]!.amount)).toBe(2500);
      await h.asUser(owner, () => h.sql(
        `update ap_invoices set approval_state='rejected' where id=$1`, [inv.id]));
      expect(await costs(`ap_invoice:${inv.id}`)).toEqual([]);
    });

    it('posts an invoice with no purchase order as other, rather than guessing', async () => {
      // An unmatched invoice is exactly the case where the platform does not
      // know what was bought.
      const inv = await invoice(600);
      expect((await costs(`ap_invoice:${inv.id}`))[0]!.cost_type).toBe('other');
    });
  });

  describe('what the financial report now says', () => {
    it('reports a committed cost that is no longer zero', async () => {
      const f = await financials();
      expect(Number(f.committed_cost)).toBeGreaterThan(0);
    });

    it('reports material and subcontract cost that are no longer zero', async () => {
      const f = await financials();
      expect(Number(f.material_cost)).toBeGreaterThan(0);
      expect(Number(f.subcontract_cost)).toBeGreaterThan(0);
    });

    it('keeps committed money out of actual cost', async () => {
      const [row] = await h.asUser(owner, () => h.sql<{ actual: string }>(
        `select coalesce(sum(amount),0) as actual from project_costs
         where project_id=$1 and not is_committed`, [project]));
      const f = await financials();
      expect(Number(f.actual_cost)).toBe(Number(row!.actual));
    });
  });
});

/**
 * The forecast, after commitments became real.
 *
 * `cost_to_complete` was `approved_budget - actual_cost`. That ignored nothing
 * while `committed_cost` was structurally zero, and became wrong the moment
 * migration 0046 started posting commitments — always in the optimistic
 * direction, and by more the better the job is bought out.
 */
describe('cost to complete counts money already promised', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let project = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test') on conflict (id) do nothing`, [owner]);
    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    project = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, status, contract_value, approved_budget)
       values ($1,'PRJ-CTC','Vale','active',120000,100000) returning id`, [company])))[0]!.id;
    const vendor = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into vendors (company_id, code, name) values ($1,'V-CTC','Cascade') returning id`,
      [company])))[0]!.id;

    // $60,000 of actual cost through an approved vendor invoice, and $50,000
    // committed on an issued purchase order that has not been invoiced.
    const po = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into purchase_orders (company_id, project_id, vendor_id, number, title,
         committed_amount, status, issued_at)
       values ($1,$2,$3,'PO-CTC','Aggregate',50000,'issued',now()) returning id`,
      [company, project, vendor])))[0]!.id;
    expect(po).toBeTruthy();
    await h.asUser(owner, () => h.sql(
      `insert into ap_invoices (company_id, vendor_id, project_id, invoice_number,
         invoice_date, amount, approval_state, approved_by, approved_at)
       values ($1,$2,$3,'INV-CTC','2026-06-01',60000,'approved',$4,now())`,
      [company, vendor, project, owner]));
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  it('reports the hole rather than the room', async () => {
    // 100,000 budget − 60,000 spent − 50,000 promised = −10,000. The old
    // definition reported 40,000.
    const [row] = await h.asUser(owner, () => h.sql<{ value: string }>(
      `select value from reporting_metric_values
       where company_id = $1 and key = 'cost_to_complete'`, [company]));
    expect(Number(row!.value)).toBe(-10000);
  });

  it('keeps the definition that reported the room', async () => {
    const rows = await h.sql<{ version: number; expression: string }>(
      `select v.version, v.expression from metric_definition_versions v
       join metric_definitions m on m.id = v.metric_id
       where m.company_id is null and m.key = 'cost_to_complete' order by v.version`);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.expression).not.toContain('committed_cost');
    expect(rows[1]!.expression).toContain('committed_cost');
  });
});
