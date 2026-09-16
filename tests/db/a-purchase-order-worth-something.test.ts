/**
 * A purchase order worth something, and a quote you can compare.
 *
 * Migration 0037 put a signing limit on purchase orders — "the commitment a
 * contractor makes most often, and the one commitment with no signing limit" —
 * checked against `committed_amount` as the order is issued. Nothing computed
 * that from the order's lines, because `purchase_order_items` had no writer.
 * So every order was worth $0.00 when issued, and the limit passed for every
 * one of them whatever it was really worth.
 *
 * `rfq_responses` carried a generated `leveled_amount` and no writer, so an RFQ
 * could be sent and nothing could ever come back.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '1d9d9d9d-9d9d-4d9d-8d9d-9d9d9d9d9d9d';

describe('a purchase order worth something', () => {
  let h: Harness;
  let company = '';
  let project = '';
  let vendor = '';
  let other = '';
  let po = '';

  const poRow = async () => (await h.asUser(OWNER, () => h.sql<{
    committed_amount: string; received_amount: string; status: string;
    open_commitment: string; line_count: string; lines_outstanding: string;
  }>(`select committed_amount, received_amount, status, open_commitment,
             line_count, lines_outstanding
        from my_purchase_orders where id = $1`, [po])))[0]!;

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@po.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@po.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Po Civil','po-civil','enterprise') as id`)))[0]!.id;
    project = (await h.asService(() => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name) values ($1,'PRJ-2026-0400','Yard pad')
       returning id`, [company])))[0]!.id;
    for (const [code, name] of [['V-0001', 'Stone supplier'], ['V-0002', 'Other pit']] as const) {
      const [v] = await h.asService(() => h.sql<{ id: string }>(
        `insert into vendors (company_id, code, name, status) values ($1,$2,$3,'active')
         returning id`, [company, code, name]));
      if (code === 'V-0001') vendor = v!.id; else other = v!.id;
    }
    po = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_purchase_order($1,$2,'Aggregate for the pad','material',$3) as id`,
      [company, vendor, project])))[0]!.id;
  });

  it('starts worth nothing, which is the state that used to be permanent', async () => {
    const row = await poRow();
    expect(Number(row.committed_amount)).toBe(0);
    expect(Number(row.line_count)).toBe(0);
  });

  it('is worth the sum of its lines, recomputed rather than incremented', async () => {
    await h.asUser(OWNER, () => h.sql(
      `select public.add_purchase_order_item($1,'Crushed stone 304', 400, 22.50,'TON')`, [po]));
    await h.asUser(OWNER, () => h.sql(
      `select public.add_purchase_order_item($1,'Delivery', 1, 850,'EA')`, [po]));
    let row = await poRow();
    expect(Number(row.committed_amount)).toBeCloseTo(400 * 22.5 + 850, 2);
    expect(Number(row.line_count)).toBe(2);

    /* Removing a line must lower it — an incremented total would not. */
    const [{ id }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from purchase_order_items where purchase_order_id = $1
        and description = 'Delivery'`, [po]));
    await h.asUser(OWNER, () => h.sql(`select public.remove_purchase_order_item($1)`, [id]));
    row = await poRow();
    expect(Number(row.committed_amount)).toBeCloseTo(9000, 2);
  });

  it('refuses to issue an order with nothing on it', async () => {
    const empty = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_purchase_order($1,$2,'Nothing at all','material') as id`,
      [company, vendor])))[0]!.id;
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.issue_purchase_order($1)`, [empty])))
      .rejects.toThrow(/nothing on it/i);
  });

  it('issues, and the signing limit finally has a number to check', async () => {
    await h.asUser(OWNER, () => h.sql(`select public.issue_purchase_order($1)`, [po]));
    const row = await poRow();
    expect(row.status).toBe('issued');
    expect(Number(row.committed_amount)).toBeCloseTo(9000, 2);
    /* 0046 posts the open commitment to job cost. */
    expect(Number(row.open_commitment)).toBeCloseTo(9000, 2);
  });

  it('will not change the lines of an order the vendor already holds', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.add_purchase_order_item($1,'Sneaky extra', 1, 100)`, [po])))
      .rejects.toThrow(/the vendor already holds it/i);
  });

  it('records what actually arrived, and moves the status to match the lines', async () => {
    const [{ id }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from purchase_order_items where purchase_order_id = $1 limit 1`, [po]));
    await h.asUser(OWNER, () => h.sql(
      `select public.receive_purchase_order_item($1, 150)`, [id]));
    let row = await poRow();
    expect(row.status).toBe('partially_received');
    expect(Number(row.received_amount)).toBeCloseTo(150 * 22.5, 2);

    await h.asUser(OWNER, () => h.sql(
      `select public.receive_purchase_order_item($1, 250)`, [id]));
    row = await poRow();
    expect(row.status).toBe('received');
    expect(Number(row.lines_outstanding)).toBe(0);
  });

  it('refuses to receive more than was ordered', async () => {
    /*
     * Its own order, because the one above is fully received and a closed order
     * refuses a receipt for a different and equally correct reason.
     */
    const second = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_purchase_order($1,$2,'Second load','material') as id`,
      [company, vendor])))[0]!.id;
    await h.asUser(OWNER, () => h.sql(
      `select public.add_purchase_order_item($1,'Crushed stone 304', 100, 22.50,'TON')`,
      [second]));
    await h.asUser(OWNER, () => h.sql(`select public.issue_purchase_order($1)`, [second]));
    const [{ id }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from purchase_order_items where purchase_order_id = $1`, [second]));

    /* An over-receipt accepted quietly becomes an over-invoice the schema
       refuses later, at the worst possible moment. */
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.receive_purchase_order_item($1, 140)`, [id])))
      .rejects.toThrow(/would receive .* of .* ordered/i);
  });
});

describe('a quote you can compare', () => {
  let h: Harness;
  let company = '';
  let rfq = '';
  let low = '';
  let high = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@rfq.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@rfq.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Rfq Civil','rfq-civil','enterprise') as id`)))[0]!.id;
    for (const [code, name] of [['V-1', 'Cheap and narrow'], ['V-2', 'Dearer and complete']] as const) {
      const [v] = await h.asService(() => h.sql<{ id: string }>(
        `insert into vendors (company_id, code, name, status) values ($1,$2,$3,'active')
         returning id`, [company, code, name]));
      if (code === 'V-1') low = v!.id; else high = v!.id;
    }
    rfq = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_rfq($1,'Asphalt paving') as id`, [company])))[0]!.id;
  });

  it('records a quote, which nothing could do', async () => {
    const id = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.record_rfq_response($1,$2, 84000, 21) as id`, [rfq, low])))[0]!.id;
    const [row] = await h.asUser(OWNER, () => h.sql<{
      vendor_name: string; quoted_amount: string; leveled_amount: string; status: string;
    }>(`select vendor_name, quoted_amount, leveled_amount, status
          from my_rfq_responses where id = $1`, [id]));
    expect(row!.vendor_name).toBe('Cheap and narrow');
    expect(Number(row!.quoted_amount)).toBe(84000);
    expect(Number(row!.leveled_amount)).toBe(84000);
    expect(row!.status).toBe('received');
  });

  it('ranks on the leveled figure, not the quoted one', async () => {
    /*
     * The cheap quote excludes traffic control; adding it back is what makes
     * the two comparable. Ranking raw quotes is the mistake leveling exists to
     * prevent, and it is the one that awards the wrong vendor.
     */
    await h.asUser(OWNER, () => h.sql(
      `select public.record_rfq_response($1,$2, 84000, 21, null,
        null,'Excludes traffic control', 9000)`, [rfq, low]));
    await h.asUser(OWNER, () => h.sql(
      `select public.record_rfq_response($1,$2, 89500, 14,
        null,'Traffic control included')`, [rfq, high]));

    const rows = await h.asUser(OWNER, () => h.sql<{
      vendor_name: string; leveled_amount: string; leveled_rank: string;
    }>(`select vendor_name, leveled_amount, leveled_rank
          from my_rfq_responses where rfq_id = $1 order by leveled_rank`, [rfq]));
    expect(rows[0]!.vendor_name).toBe('Dearer and complete');
    expect(Number(rows[0]!.leveled_amount)).toBe(89500);
    expect(Number(rows[1]!.leveled_amount)).toBe(93000);
  });

  it('refuses a quote with no amount unless the vendor declined', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.record_rfq_response($1,$2)`, [rfq, low])))
      .rejects.toThrow(/needs an amount, or say the vendor declined/i);
  });

  it('awards with a reason, and marks the others not awarded', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.award_rfq($1,$2,'')`, [rfq, high])))
      .rejects.toThrow(/Say why this vendor/i);

    await h.asUser(OWNER, () => h.sql(
      `select public.award_rfq($1,$2,'Lower leveled price once traffic control is added back')`,
      [rfq, high]));
    const rows = await h.asUser(OWNER, () => h.sql<{ vendor_name: string; status: string }>(
      `select vendor_name, status from my_rfq_responses where rfq_id = $1`, [rfq]));
    expect(rows.find((r) => r.vendor_name === 'Dearer and complete')!.status).toBe('awarded');
    expect(rows.find((r) => r.vendor_name === 'Cheap and narrow')!.status).toBe('not_awarded');

    const [r] = await h.asUser(OWNER, () => h.sql<{ status: string; award_reason: string }>(
      `select status, award_reason from rfqs where id = $1`, [rfq]));
    expect(r!.status).toBe('awarded');
    expect(r!.award_reason).toMatch(/traffic control/);
  });

  it('will not award a vendor who never quoted', async () => {
    const fresh = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_rfq($1,'Striping') as id`, [company])))[0]!.id;
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.award_rfq($1,$2,'Because I like them')`, [fresh, low])))
      .rejects.toThrow(/no quote on this RFQ/i);
  });
});
