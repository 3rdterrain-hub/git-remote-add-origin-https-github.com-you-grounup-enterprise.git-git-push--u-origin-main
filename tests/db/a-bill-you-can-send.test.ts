/**
 * A bill you can send, and one you can pay.
 *
 * Finance had exactly one writer — `create_pay_application` (0162) opens a
 * header — so the section could open a bill and never fill one in, and the
 * schedule of values the bill is measured against had no writer at all.
 *
 * The property most of these tests are really about: **the figures on a pay
 * application are computed, never typed.** Completed to date, stored materials,
 * retainage, previous payments and the amount due all follow from the lines and
 * from what earlier applications were actually paid. Every one of them is a
 * figure somebody would otherwise retype off last month's paperwork, and the
 * first one retyped wrong is a bill the owner rejects — or pays.
 *
 * And the one refusal worth more than the rest: `ap_invoices_pay_requires_match`
 * has stood since 0017 and had never been reached by anything, because nothing
 * could record an invoice. A control nobody has ever tripped is a control nobody
 * has checked.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '7a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';

describe('a bill you can send', () => {
  let h: Harness;
  let company = '';
  let project = '';
  let version = '';
  const lines: string[] = [];

  const asOwner = <T>(fn: () => Promise<T>) => h.asUser(OWNER, fn);
  const one = <T>(sql: string, args: unknown[] = []) =>
    asOwner(() => h.sql<T>(sql, args)).then((r) => r[0]!);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@bill.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@bill.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await asOwner(() => h.sql<{ id: string }>(
      `select app.provision_company('Bill Civil','bill-civil','enterprise') as id`)))[0]!.id;

    const estimate = (await h.asService(() => h.sql<{ id: string }>(
      `insert into estimates (company_id, number, name, status)
       values ($1,'E-2026-0001','Pad and drive','draft') returning id`, [company])))[0]!.id;
    version = (await h.asService(() => h.sql<{ id: string }>(
      `insert into estimate_versions (company_id, estimate_id, version_number, status)
       values ($1,$2,1,'draft') returning id`, [company, estimate])))[0]!.id;

    for (const [i, d] of ['Site preparation', 'Mass excavation', 'Aggregate base'].entries()) {
      lines.push((await h.asService(() => h.sql<{ id: string }>(
        `insert into estimate_line_items
           (company_id, estimate_version_id, description, unit, measured_quantity, sort_order)
         values ($1,$2,$3,'LS',1,$4) returning id`, [company, version, d, i * 10])))[0]!.id);
    }
    /* The engine's own path, because a line's price is an engine output. */
    await h.asService(() => h.sql(
      `select app.record_engine_result($1,'engine-test','{}'::jsonb,$2::jsonb)`,
      [version, JSON.stringify([
        { id: lines[0], total_price: 40000 },
        { id: lines[1], total_price: 120000 },
        { id: lines[2], total_price: 40000 },
      ])]));

    project = (await asOwner(() => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, status, contract_value,
         retainage_percent, source_estimate_version_id)
       values ($1,'PRJ-B1','Pad and drive','active',200000,0.05,$2) returning id`,
      [company, version])))[0]!.id;
  }, 180_000);

  // ------------------------------------------------------ schedule of values
  describe('the schedule of values', () => {
    it('is built from the estimate rather than retyped', async () => {
      // A number is entered once. Retyping the bid into a billing schedule is
      // how the bill stops agreeing with the bid.
      const row = await one<{ n: number }>(
        `select public.build_sov_from_estimate($1) as n`, [project]);
      expect(Number(row.n)).toBe(3);

      const [total] = await asOwner(() => h.sql<{ sum: string; from_estimate: string }>(
        `select sum(scheduled_value) as sum,
                count(*) filter (where from_the_estimate) as from_estimate
           from my_schedule_of_values where project_id = $1`, [project]));
      expect(Number(total!.sum)).toBe(200000);
      expect(Number(total!.from_estimate)).toBe(3);
    });

    it('refuses to build a second time, because that would bill the job twice', async () => {
      await expect(asOwner(() => h.sql(
        `select public.build_sov_from_estimate($1)`, [project])))
        .rejects.toThrow(/already has a schedule of values/);
    });

    it('accepts an item the owner asked for separately', async () => {
      const row = await one<{ id: string }>(
        `select public.add_sov_item($1,'004','Temporary fencing',5000) as id`, [project]);
      expect(row.id).toBeTruthy();
      await asOwner(() => h.sql(`select public.remove_sov_item($1)`, [row.id]));
    });

    it('refuses a second item with the same number the owner sees', async () => {
      await expect(asOwner(() => h.sql(
        `select public.add_sov_item($1,'001','Duplicate',1)`, [project])))
        .rejects.toThrow(/already on this schedule of values/);
    });

    it('refuses a unit-price item with no quantity or no price', async () => {
      await expect(asOwner(() => h.sql(
        `select public.add_sov_item($1,'900','Rock excavation',0,'unit_price',null,'CY')`,
        [project]))).rejects.toThrow(/needs both/);
    });
  });

  // ------------------------------------------------------- the application
  describe('the application', () => {
    let app1 = '';
    const line = async (item: string) => (await one<{ id: string }>(
      `select l.id from pay_application_lines l
        where l.pay_application_id = $1 and l.item_number = $2`, [app1, item])).id;

    it('opens with its lines drawn from the schedule of values', async () => {
      app1 = (await one<{ id: string }>(
        `select public.create_pay_application($1,'2026-09-01','2026-09-30') as id`,
        [project])).id;
      const built = await one<{ n: number }>(
        `select public.build_pay_application_lines($1) as n`, [app1]);
      expect(Number(built.n)).toBe(3);
    });

    it('refuses to fill an application twice', async () => {
      await expect(asOwner(() => h.sql(
        `select public.build_pay_application_lines($1)`, [app1])))
        .rejects.toThrow(/already has its lines/);
    });

    it('bills a line by amount and recomputes the header from it', async () => {
      const id = await line('001');
      await asOwner(() => h.sql(
        `select public.set_pay_application_line($1, 40000)`, [id]));
      const row = await one<{
        completed_to_date: string; retainage_to_date: string; current_due: string;
      }>(`select completed_to_date, retainage_to_date, current_due
            from pay_applications where id = $1`, [app1]);
      expect(Number(row.completed_to_date)).toBe(40000);
      /* Five percent of what has been earned, per line, summed. */
      expect(Number(row.retainage_to_date)).toBe(2000);
      expect(Number(row.current_due)).toBe(38000);
    });

    it('bills a line by percent, which is the other way estimators work', async () => {
      const id = await line('002');
      await asOwner(() => h.sql(
        `select public.set_pay_application_line($1, null, 0.25)`, [id]));
      const row = await one<{ this_period: string; percent_complete: string }>(
        `select this_period, percent_complete from pay_application_lines where id = $1`,
        [id]);
      expect(Number(row.this_period)).toBe(30000);
      expect(Number(row.percent_complete)).toBeCloseTo(0.25, 6);
    });

    it('refuses an amount and a percent together', async () => {
      // Two figures that can disagree is one figure too many.
      const id = await line('003');
      await expect(asOwner(() => h.sql(
        `select public.set_pay_application_line($1, 100, 0.5)`, [id])))
        .rejects.toThrow(/by amount or by percent, not by both/);
    });

    it('refuses to bill a line past what it is scheduled at', async () => {
      const id = await line('001');
      await expect(asOwner(() => h.sql(
        `select public.set_pay_application_line($1, 50000)`, [id])))
        .rejects.toThrow(/scheduled at 40000.00 and this would bill 50000.00/);
    });

    it('carries the contract sum to date from approved change orders', async () => {
      await asOwner(() => h.sql(
        `insert into change_orders (company_id, project_id, number, title, reason,
           status, price_impact, decided_at)
         values ($1,$2,'CO-001','Extra drive apron','Owner added the apron after award',
                 'approved',18000, now())`,
        [company, project]));
      /* Recomputed on the next touch, rather than stored from when it was opened. */
      const id = await line('003');
      await asOwner(() => h.sql(
        `select public.set_pay_application_line($1, 0)`, [id]));
      const row = await one<{ approved_changes: string; contract_sum_to_date: string }>(
        `select approved_changes, contract_sum_to_date from pay_applications where id = $1`,
        [app1]);
      expect(Number(row.approved_changes)).toBe(18000);
      expect(Number(row.contract_sum_to_date)).toBe(218000);
    });

    it('certifies, and then its figures stop moving', async () => {
      await asOwner(() => h.sql(`select public.submit_pay_application($1)`, [app1]));
      const id = await line('003');
      await expect(asOwner(() => h.sql(
        `select public.set_pay_application_line($1, 1000)`, [id])))
        .rejects.toThrow(/is submitted and its figures are certified/);
    });

    it('is approved by somebody else, on another day', async () => {
      await asOwner(() => h.sql(`select public.approve_pay_application($1)`, [app1]));
      const row = await one<{ status: string; approved_at: string }>(
        `select status, approved_at from pay_applications where id = $1`, [app1]);
      expect(row.status).toBe('approved');
      expect(row.approved_at).not.toBeNull();
    });

    it('records a short payment as partially paid, without being told which', async () => {
      // The status follows the arithmetic. A status somebody picks and an amount
      // somebody types will eventually disagree, and people act on the status.
      await asOwner(() => h.sql(
        `select public.record_pay_application_payment($1, 60000)`, [app1]));
      const row = await one<{ status: string; amount_paid: string; current_due: string }>(
        `select status, amount_paid, current_due from pay_applications where id = $1`, [app1]);
      expect(row.status).toBe('partially_paid');
      expect(Number(row.amount_paid)).toBe(60000);
      expect(Number(row.current_due)).toBe(66500);
    });

    it('refuses a payment larger than what is due', async () => {
      await expect(asOwner(() => h.sql(
        `select public.record_pay_application_payment($1, 999999)`, [app1])))
        .rejects.toThrow(/more than the .* due on application/);
    });

    it('carries what was actually paid onto the next application, not what was billed', async () => {
      /*
       * The whole point of `previous_payments`: an owner who short-paid
       * application 1 is still owed against it, and a figure taken from what was
       * billed would quietly forgive the difference.
       */
      const app2 = (await one<{ id: string }>(
        `select public.create_pay_application($1,'2026-10-01','2026-10-31') as id`,
        [project])).id;
      await asOwner(() => h.sql(`select public.build_pay_application_lines($1)`, [app2]));
      const row = await one<{ previous_payments: string }>(
        `select previous_payments from pay_applications where id = $1`, [app2]);
      expect(Number(row.previous_payments)).toBe(60000);

      const carried = await one<{ previous_completed: string }>(
        `select previous_completed from pay_application_lines
          where pay_application_id = $1 and item_number = '001'`, [app2]);
      expect(Number(carried.previous_completed)).toBe(40000);
    });

    it('refuses to change a scheduled value that has been billed', async () => {
      const item = await one<{ id: string }>(
        `select id from schedule_of_values where project_id = $1 and item_number = '001'`,
        [project]);
      await expect(asOwner(() => h.sql(
        `select public.update_sov_item($1,null,null,99999)`, [item.id])))
        .rejects.toThrow(/billed on a certified application/);
    });
  });

  // -------------------------------------------------------- the bills that come
  describe('a bill that arrives', () => {
    let vendor = '';
    let order = '';
    let invoice = '';

    beforeAll(async () => {
      vendor = (await one<{ id: string }>(
        `insert into vendors (company_id, code, name) values ($1,'V-0001','Toledo Aggregates')
         returning id`, [company])).id;
      order = (await one<{ id: string }>(
        `insert into purchase_orders (company_id, vendor_id, number, title, project_id, status)
         values ($1,$2,'PO-0001','Crushed stone for the pad',$3,'issued') returning id`,
        [company, vendor, project])).id;
      await asOwner(() => h.sql(
        `insert into purchase_order_items (company_id, purchase_order_id, description,
           quantity, unit, unit_price, quantity_received)
         values ($1,$2,'Crushed stone', 100, 'TON', 22, 60)`, [company, order]));
    });

    it('records the invoice and works out the match itself', async () => {
      // The match is computed, not taken: a browser that could declare an
      // invoice matched could declare its way past the control below.
      invoice = (await one<{ id: string }>(
        `select public.record_ap_invoice($1,$2,'INV-5541','2026-09-20',2200) as id`,
        [company, vendor])).id;
      await asOwner(() => h.sql(
        `update ap_invoices set purchase_order_id = $2 where id = $1`, [invoice, order]));
      const match = await one<{ m: string }>(
        `select public.rematch_ap_invoice($1) as m`, [invoice]);
      expect(match.m).toBe('quantity_variance');
    });

    it('refuses to pay for what has not been received, and says which it is', async () => {
      // `ap_invoices_pay_requires_match` has stood since 0017 and had never once
      // been reached, because nothing could record an invoice.
      await expect(asOwner(() => h.sql(
        `select public.record_ap_payment($1, 2200)`, [invoice])))
        .rejects.toThrow(/billing for more than has been received/);
    });

    it('matches once the rest of the order arrives', async () => {
      await asOwner(() => h.sql(
        `update purchase_order_items set quantity_received = 100
          where purchase_order_id = $1`, [order]));
      const match = await one<{ m: string }>(
        `select public.rematch_ap_invoice($1) as m`, [invoice]);
      expect(match.m).toBe('matched');
    });

    it('pays it, and the status follows the arithmetic', async () => {
      await asOwner(() => h.sql(`select public.approve_ap_invoice($1)`, [invoice]));
      await asOwner(() => h.sql(`select public.record_ap_payment($1, 1000)`, [invoice]));
      let row = await one<{ status: string; balance_due: string }>(
        `select status, balance_due from my_ap_invoices where id = $1`, [invoice]);
      expect(row.status).toBe('partially_paid');
      expect(Number(row.balance_due)).toBe(1200);

      await asOwner(() => h.sql(`select public.record_ap_payment($1, 1200)`, [invoice]));
      row = await one<{ status: string; balance_due: string }>(
        `select status, balance_due from my_ap_invoices where id = $1`, [invoice]);
      expect(row.status).toBe('paid');
      expect(Number(row.balance_due)).toBe(0);
    });

    it('refuses the same invoice number from the same vendor twice', async () => {
      await expect(asOwner(() => h.sql(
        `select public.record_ap_invoice($1,$2,'INV-5541','2026-09-20',2200)`,
        [company, vendor]))).rejects.toThrow(/already sent invoice INV-5541/);
    });

    it('treats an invoice with no order as one nobody has to match', async () => {
      const id = (await one<{ id: string }>(
        `select public.record_ap_invoice($1,$2,'INV-5600','2026-09-21',480) as id`,
        [company, vendor])).id;
      const row = await one<{ match_status: string; payable: boolean; match_problem: string }>(
        `select match_status, payable, match_problem from my_ap_invoices where id = $1`, [id]);
      expect(row.match_status).toBe('no_po');
      expect(row.payable).toBe(true);
      expect(row.match_problem).toBeNull();
    });

    it('will not void an invoice that has been paid', async () => {
      await expect(asOwner(() => h.sql(
        `select public.set_ap_invoice_status($1,'void')`, [invoice])))
        .rejects.toThrow(/has been paid and cannot be voided/);
    });
  });
});
