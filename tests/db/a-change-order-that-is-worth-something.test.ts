/**
 * A change order that is worth something.
 *
 * `change_orders.cost_impact` and `price_impact` have existed since migration
 * 0007 under a comment reading "Priced by the same deterministic engine as the
 * base estimate", and `change_order_items` since 0013 with RLS, a tenant
 * trigger and an index. Nothing ever wrote an item, so every change order this
 * platform raised was worth $0.00 forever — and a change order at zero does not
 * look broken, it looks unpriced, on a screen offering no way to price it.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '8c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c';

describe('pricing a change order', () => {
  let h: Harness;
  let company = '';
  let project = '';
  let co = '';
  let n = 0;

  const newCo = async (): Promise<string> => {
    n += 1;
    return (await h.asService(() => h.sql<{ id: string }>(
      `insert into change_orders (company_id, project_id, number, title, reason)
       values ($1,$2,$3,'Rock in the north basin','Differing site condition')
       returning id`, [company, project, `CO-${n}`])))[0]!.id;
  };

  const impact = async (id = co) => (await h.asUser(OWNER, () => h.sql<{
    cost_impact: string; price_impact: string;
  }>(`select cost_impact, price_impact from change_orders where id = $1`, [id])))[0]!;

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@chg.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@chg.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Change Civil','change-civil','enterprise') as id`)))[0]!.id;
    project = (await h.asService(() => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, contract_value)
       values ($1,'PRJ-2026-0003','Kingsway',480000) returning id`,
      [company])))[0]!.id;
    co = await newCo();
  });

  it('starts at nothing, which is where every change order used to stay', async () => {
    const i = await impact();
    expect(Number(i.cost_impact)).toBe(0);
    expect(Number(i.price_impact)).toBe(0);
  });

  it('is worth the sum of its lines', async () => {
    await h.asUser(OWNER, () => h.sql(
      `select public.add_change_order_item($1,'Rock excavation',8000,11000)`, [co]));
    let i = await impact();
    expect(Number(i.cost_impact)).toBe(8000);
    expect(Number(i.price_impact)).toBe(11000);

    await h.asUser(OWNER, () => h.sql(
      `select public.add_change_order_item($1,'Haul and dispose',2500,3200)`, [co]));
    i = await impact();
    expect(Number(i.cost_impact)).toBe(10500);
    expect(Number(i.price_impact)).toBe(14200);
  });

  it('prices a line from its rate rather than trusting two numbers to agree', async () => {
    const c2 = await newCo();
    await h.asUser(OWNER, () => h.sql(
      `select public.add_change_order_item($1,'Extra pipe',4000,null,200,'LF'::app.unit_code,25)`,
      [c2]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      price_amount: string; unit_price: string; quantity: string; margin: string;
    }>(`select price_amount, unit_price, quantity, margin
          from my_change_order_items where change_order_id = $1`, [c2]));
    /* 200 LF at 25 is 5,000 — the rate wins, not a figure typed beside it. */
    expect(Number(row!.price_amount)).toBe(5000);
    expect(Number(row!.margin)).toBe(1000);
  });

  it('shows a change order done at cost rather than hiding it as a zero', async () => {
    /*
     * A change order priced at cost is a decision somebody made. Defaulting the
     * price to zero would make "done for nothing" and "not priced yet" the same
     * number.
     */
    const c3 = await newCo();
    await h.asUser(OWNER, () => h.sql(
      `select public.add_change_order_item($1,'Goodwill repair',1500)`, [c3]));
    const i = await impact(c3);
    expect(Number(i.cost_impact)).toBe(1500);
    expect(Number(i.price_impact)).toBe(1500);
  });

  it('falls again when a line is taken off', async () => {
    const [item] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from my_change_order_items
        where change_order_id = $1 and description = 'Haul and dispose'`, [co]));
    await h.asUser(OWNER, () => h.sql(
      `select public.remove_change_order_item($1)`, [item!.id]));
    const i = await impact();
    expect(Number(i.cost_impact)).toBe(8000);
    expect(Number(i.price_impact)).toBe(11000);
  });

  it('will not price one that has been approved', async () => {
    /* The impact of an approved change order is the amendment to the contract. */
    const c4 = await newCo();
    await h.asUser(OWNER, () => h.sql(
      `select public.add_change_order_item($1,'Priced while open',1000,1400)`, [c4]));
    await h.asService(() => h.sql(
      `update change_orders set status='approved', decided_at=now() where id=$1`, [c4]));

    await expect(h.asUser(OWNER, () => h.sql(
      `select public.add_change_order_item($1,'Sneaked in later',500,900)`, [c4])))
      .rejects.toThrow(/cannot be repriced/i);

    /* And what it was worth when it was approved is still what it is worth. */
    const i = await impact(c4);
    expect(Number(i.price_impact)).toBe(1400);
  });

  it('will not take a line off one that has been approved', async () => {
    const [c4] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from change_orders where status='approved' limit 1`));
    const [item] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from my_change_order_items where change_order_id = $1`, [c4!.id]));
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.remove_change_order_item($1)`, [item!.id])))
      .rejects.toThrow(/lines are the amendment/i);
  });

  it('refuses to price one that was rejected', async () => {
    const c5 = await newCo();
    await h.asService(() => h.sql(
      `update change_orders set status='rejected', decided_at=now() where id=$1`, [c5]));
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.add_change_order_item($1,'Too late',100)`, [c5])))
      .rejects.toThrow(/nothing to price/i);
  });

  it('refuses a line with nothing said about it', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.add_change_order_item($1,'   ',100)`, [co])))
      .rejects.toThrow(/what the line is for/i);
  });

  it('refuses a negative cost, and says where a credit goes instead', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.add_change_order_item($1,'Credit',-500)`, [co])))
      .rejects.toThrow(/zero or more/i);
  });

  it('refuses somebody from another company', async () => {
    const STRANGER = '8c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c';
    await h.sql(`insert into auth.users (id, email) values ($1,'s@chg.test')`, [STRANGER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'s@chg.test')
                 on conflict (id) do nothing`, [STRANGER]);
    await expect(h.asUser(STRANGER, () => h.sql(
      `select public.add_change_order_item($1,'Not mine',100)`, [co]))).rejects.toThrow();
  });
});
