import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/** Commercial controls: billing, three-way match, commitments and stock. */
describe('finance and procurement', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  const foreman = '66666666-6666-4666-8666-666666666666';
  let company = '';
  let project = '';
  let vendor = '';
  let po = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test'), ($2,'f@r.test')`, [owner, foreman]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test'), ($2,'f@r.test')`, [owner, foreman]);
    company = (await h.asUser(owner, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','business') as id`)))[0]!.id;

    const foremanRole = (await h.sql<{ id: string }>(
      `select id from roles where key='foreman' and company_id is null`))[0]!.id;
    await h.sql(`insert into company_memberships (company_id, user_id, role_id, status, joined_at)
                 values ($1,$2,$3,'active',now())`, [company, foreman, foremanRole]);

    await h.asUser(owner, async () => {
      project = (await h.sql<{ id: string }>(
        `insert into projects (company_id, number, name, contract_value) values ($1,'PRJ-1','Test',500000)
         returning id`, [company]))[0]!.id;
      vendor = (await h.sql<{ id: string }>(
        `insert into vendors (company_id, code, name) values ($1,'V-1','Stoneco') returning id`, [company]))[0]!.id;
    });
  });

  afterAll(async () => { await h?.db.close(); });

  describe('pay applications', () => {
    let app = '';

    it('computes contract sum and total earned from their parts', async () => {
      const [p] = await h.asUser(owner, () =>
        h.sql<{ id: string; contract_sum_to_date: string; total_earned: string }>(
          `insert into pay_applications
           (company_id, project_id, application_number, period_start, period_end,
            contract_sum, approved_changes, completed_to_date, stored_materials)
           values ($1,$2,1,'2026-08-01','2026-08-31',500000,11175,320000,18200)
           returning id, contract_sum_to_date, total_earned`, [company, project]));
      app = p!.id;
      expect(Number(p!.contract_sum_to_date)).toBe(511_175);
      expect(Number(p!.total_earned)).toBe(338_200);
    });

    it('refuses to bill more than the contract is worth', async () => {
      // Over-billing is not a rounding error; it is a claim the owner rejects.
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into pay_applications
                 (company_id, project_id, application_number, period_start, period_end,
                  contract_sum, approved_changes, completed_to_date)
                 values ($1,$2,99,'2026-09-01','2026-09-30',500000,0,600000)`, [company, project])),
      ).rejects.toThrow(/pay_applications_not_over_billed/);
    });

    it('freezes the certificate once submitted', async () => {
      await h.asUser(owner, () =>
        h.sql(`update pay_applications set status='submitted', submitted_at=now() where id=$1`, [app]));
      await expect(
        h.asUser(owner, () => h.sql(`update pay_applications set completed_to_date=1 where id=$1`, [app])),
      ).rejects.toThrow(/certified; field/);
    });

    it('still records payment against a certified application', async () => {
      await h.asUser(owner, () =>
        h.sql(`update pay_applications set status='paid', paid_at=now(), amount_paid=100000 where id=$1`, [app]));
      const [p] = await h.sql<{ status: string }>(`select status from pay_applications where id=$1`, [app]);
      expect(p!.status).toBe('paid');
    });

    it('computes line completed-to-date from its components', async () => {
      const [l] = await h.asUser(owner, () =>
        h.sql<{ completed_to_date: string }>(
          `insert into pay_application_lines
           (company_id, pay_application_id, item_number, description, scheduled_value,
            previous_completed, this_period, stored_materials)
           values ($1,$2,'01','Sanitary',486000,340200,72900,0)
           returning completed_to_date`, [company, app]));
      expect(Number(l!.completed_to_date)).toBe(413_100);
    });

    it('hides financial records from a role without finance.read', async () => {
      const seen = await h.asUser(foreman, () => h.sql(`select id from pay_applications`));
      expect(seen).toEqual([]);
    });
  });

  describe('purchase orders', () => {
    it('creates a commitment', async () => {
      const [p] = await h.asUser(owner, () =>
        h.sql<{ id: string }>(
          `insert into purchase_orders (company_id, project_id, vendor_id, number, title, committed_amount)
           values ($1,$2,$3,'PO-1','Aggregate',128400) returning id`, [company, project, vendor]));
      po = p!.id;
      expect(po).toBeTruthy();
    });

    it('refuses to invoice beyond the commitment', async () => {
      // A vendor invoicing over the PO is a change to approve, not a payable
      // to quietly post. Driven through a real invoice since migration 0046:
      // the constraint had always guarded `invoiced_amount`, and until then
      // nothing but a hand-written update ever moved that column.
      await expect(
        h.asUser(owner, () => h.sql(
          `insert into ap_invoices (company_id, vendor_id, purchase_order_id, project_id,
             invoice_number, invoice_date, amount, approval_state, approved_by, approved_at)
           values ($1,$2,$3,$4,'INV-OVER','2026-05-01',150000,'approved',$5,now())`,
          [company, vendor, po, project, owner])),
      ).rejects.toThrow(/committed at .* would take invoices against it to/);
    });

    it('absorbs freight and rounding inside a small tolerance', async () => {
      // 128,450 against a commitment of 128,400 — inside the 0.1% the
      // constraint allows, because freight and rounding are not a change order.
      await h.asUser(owner, () => h.sql(
        `insert into ap_invoices (company_id, vendor_id, purchase_order_id, project_id,
           invoice_number, invoice_date, amount, approval_state, approved_by, approved_at)
         values ($1,$2,$3,$4,'INV-FREIGHT','2026-05-02',128450,'approved',$5,now())`,
        [company, vendor, po, project, owner]));
      const [p] = await h.sql<{ invoiced_amount: string }>(
        `select invoiced_amount from purchase_orders where id=$1`, [po]);
      expect(Number(p!.invoiced_amount)).toBe(128_450);
    });

    it('derives the invoiced total rather than letting it be typed', async () => {
      await expect(
        h.asUser(owner, () => h.sql(
          `update purchase_orders set invoiced_amount=1 where id=$1`, [po])),
      ).rejects.toThrow(/derived from them and cannot be set to/);
    });

    it('refuses to pay more than has been invoiced', async () => {
      await expect(
        h.asUser(owner, () => h.sql(`update purchase_orders set paid_amount=200000 where id=$1`, [po])),
      ).rejects.toThrow(/purchase_orders_paid/);
    });

    it('computes line extended price', async () => {
      const [i] = await h.asUser(owner, () =>
        h.sql<{ extended: string }>(
          `insert into purchase_order_items (company_id, purchase_order_id, description, quantity, unit_price)
           values ($1,$2,'ODOT 304',5100,18.75) returning extended`, [company, po]));
      expect(Number(i!.extended)).toBe(95_625);
    });

    it('requires a note when a delivery is not accepted', async () => {
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into deliveries (company_id, purchase_order_id, quantity, is_accepted)
                 values ($1,$2,100,false)`, [company, po])),
      ).rejects.toThrow(/deliveries_discrepancy/);
    });
  });

  describe('RFQ leveling and award', () => {
    let rfq = '';
    it('records an RFQ and its responses', async () => {
      const [r] = await h.asUser(owner, () =>
        h.sql<{ id: string }>(
          `insert into rfqs (company_id, number, title) values ($1,'RFQ-1','Precast') returning id`, [company]));
      rfq = r!.id;
      const [resp] = await h.asUser(owner, () =>
        h.sql<{ leveled_amount: string }>(
          `insert into rfq_responses (company_id, rfq_id, vendor_id, quoted_amount, leveling_adjustment, status)
           values ($1,$2,$3,31200,3400,'leveled') returning leveled_amount`, [company, rfq, vendor]));
      // Leveling is what makes an apples-to-apples comparison possible.
      expect(Number(resp!.leveled_amount)).toBe(34_600);
    });

    it('refuses to award without naming a vendor and a reason', async () => {
      await expect(
        h.asUser(owner, () => h.sql(`update rfqs set status='awarded' where id=$1`, [rfq])),
      ).rejects.toThrow(/rfqs_award/);
    });

    it('accepts an award that records why', async () => {
      await h.asUser(owner, () =>
        h.sql(`update rfqs set status='awarded', awarded_vendor_id=$1, awarded_at=now(),
               award_reason='Low leveled price and the only quote holding through the window'
               where id=$2`, [vendor, rfq]));
      const [r] = await h.sql<{ status: string }>(`select status from rfqs where id=$1`, [rfq]);
      expect(r!.status).toBe('awarded');
    });

    it('requires a quote once a response is marked received', async () => {
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into rfq_responses (company_id, rfq_id, vendor_id, status)
                 values ($1,$2,$3,'received')`, [company, rfq, vendor]),
        ),
      ).rejects.toThrow(/rfq_responses_received|duplicate key/);
    });
  });

  describe('accounts payable three-way match', () => {
    it('refuses to pay an invoice that fails its match', async () => {
      // This is the control that stops paying for goods never received.
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into ap_invoices
                 (company_id, vendor_id, invoice_number, invoice_date, amount, match_status, status, amount_paid)
                 values ($1,$2,'INV-1','2026-08-28',24320,'quantity_variance','paid',24320)`, [company, vendor])),
      ).rejects.toThrow(/ap_invoices_pay_requires_match/);
    });

    it('allows payment once the invoice matches', async () => {
      const rows = await h.asUser(owner, () =>
        h.sql<{ id: string }>(
          `insert into ap_invoices
           (company_id, vendor_id, invoice_number, invoice_date, amount, match_status, status, amount_paid)
           values ($1,$2,'INV-2','2026-08-28',24320,'matched','paid',24320) returning id`, [company, vendor]));
      expect(rows).toHaveLength(1);
    });

    it('refuses to pay more than the invoice', async () => {
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into ap_invoices
                 (company_id, vendor_id, invoice_number, invoice_date, amount, match_status, amount_paid)
                 values ($1,$2,'INV-3','2026-08-28',1000,'matched',5000)`, [company, vendor])),
      ).rejects.toThrow(/ap_invoices_paid/);
    });
  });

  describe('inventory', () => {
    let item = '';
    it('tracks available as on-hand less reserved', async () => {
      const [i] = await h.asUser(owner, () =>
        h.sql<{ id: string; quantity_available: string }>(
          `insert into inventory_items (company_id, sku, name, unit, quantity_on_hand, quantity_reserved)
           values ($1,'PVC-8','8" PVC','LF',640,480) returning id, quantity_available`, [company]));
      item = i!.id;
      expect(Number(i!.quantity_available)).toBe(160);
    });

    it('refuses to reserve more than is on hand', async () => {
      // Otherwise two crews both plan on the same pipe.
      await expect(
        h.asUser(owner, () =>
          h.sql(`update inventory_items set quantity_reserved=900 where id=$1`, [item])),
      ).rejects.toThrow(/inventory_items_reserved/);
    });

    it('moves stock through its transaction ledger', async () => {
      await h.asUser(owner, () =>
        h.sql(`insert into inventory_transactions (company_id, inventory_item_id, transaction_type, quantity)
               values ($1,$2,'receipt',400)`, [company, item]));
      await h.asUser(owner, () =>
        h.sql(`insert into inventory_transactions (company_id, inventory_item_id, transaction_type, quantity)
               values ($1,$2,'issue',-120)`, [company, item]));
      const [i] = await h.sql<{ quantity_on_hand: string }>(
        `select quantity_on_hand from inventory_items where id=$1`, [item]);
      expect(Number(i!.quantity_on_hand)).toBe(920); // 640 + 400 − 120
    });

    it('requires a reason for an adjustment', async () => {
      // An unexplained adjustment is indistinguishable from shrinkage.
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into inventory_transactions (company_id, inventory_item_id, transaction_type, quantity)
                 values ($1,$2,'adjustment',-50)`, [company, item])),
      ).rejects.toThrow(/inventory_transactions_adjustment/);
    });
  });

  describe('schedule of values', () => {
    it('requires quantity and unit price for unit-price billing', async () => {
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into schedule_of_values
                 (company_id, project_id, item_number, description, scheduled_value, billing_basis)
                 values ($1,$2,'01','Sanitary',486000,'unit_price')`, [company, project])),
      ).rejects.toThrow(/sov_unit_price/);
    });

    it('accepts a lump-sum item without them', async () => {
      const rows = await h.asUser(owner, () =>
        h.sql<{ id: string }>(
          `insert into schedule_of_values
           (company_id, project_id, item_number, description, scheduled_value)
           values ($1,$2,'02','Mobilization',92000) returning id`, [company, project]));
      expect(rows).toHaveLength(1);
    });
  });
});
