/**
 * The work comes in by phone.
 *
 * Found by the owner using the product. The Leads tab could only receive a lead
 * from the public website form; the Lead-source breakdown beneath it listed
 * phone call, referral, walk-in and bid board, none of which could ever have a
 * row. The Pipeline tab said an opportunity arrives when a lead converts, so
 * with no lead there was no opportunity. And `Add customer` was a button with
 * no handler over a function that did not exist.
 *
 * The first three steps of the workflow, and none of them could be performed.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '3a6a6a6a-6a6a-4a6a-8a6a-6a6a6a6a6a6a';

describe('the work comes in by phone', () => {
  let h: Harness;
  let company = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@crm.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@crm.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Phone Civil','phone-civil','enterprise') as id`)))[0]!.id;
  });

  it('writes down a lead that came in by phone', async () => {
    const id = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_lead($1,'Sandusky Aggregates','Phone call','Ray Beltran',
        null,'419-555-0142','Wants a price on a transfer station pad') as id`,
      [company])))[0]!.id;
    const [row] = await h.asUser(OWNER, () => h.sql<{
      source: string; stage: string; company_name: string; phone: string;
    }>(`select source, stage, company_name, phone from leads where id = $1`, [id]));
    expect(row!.source).toBe('Phone call');
    expect(row!.stage).toBe('new');
    expect(row!.company_name).toBe('Sandusky Aggregates');
  });

  it('refuses a lead with no way to reply to it', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.create_lead($1,'Nobody','Referral')`, [company])))
      .rejects.toThrow(/needs a phone number or an email/i);
  });

  it('takes its sources from the company\u2019s own list, not one written in the function', async () => {
    /*
     * `lead_source` is a user-addable category (0124, 0150). The guard on the
     * column is the only judge, so a company that wins work some way nobody
     * thought of adds the source rather than asking for a migration.
     */
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.create_lead($1,'Somebody','A guy I know', null, 'a@b.test')`,
      [company]))).rejects.toThrow(/not one of your lead source options/i);

    const shipped = await h.asUser(OWNER, () => h.sql<{ name: string }>(
      `select name from library_categories where kind = 'lead_source'
         and company_id is null order by sort_order`));
    expect(shipped.length).toBeGreaterThan(4);
    for (const s of shipped) {
      await h.asUser(OWNER, () => h.sql(
        `select public.create_lead($1, $2, $3, null, 'x@y.test')`,
        [company, `Lead via ${s.name}`, s.name]));
    }

    /* And a company can add its own, which is the whole point of the rule. */
    await h.asUser(OWNER, () => h.sql(
      `select public.add_library_category('lead_source','Union hall', null, $1)`, [company]));
    await h.asUser(OWNER, () => h.sql(
      `select public.create_lead($1,'Hall referral','Union hall', null,'z@y.test')`,
      [company]));
    const [{ n }] = await h.asUser(OWNER, () => h.sql<{ n: string }>(
      `select count(*) as n from leads where company_id = $1 and source = 'Union hall'`,
      [company]));
    expect(Number(n)).toBe(1);
  });

  it('works a lead along, and refuses to convert it by setting a stage', async () => {
    const [{ id }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from leads where company_name = 'Sandusky Aggregates'`));
    await h.asUser(OWNER, () => h.sql(
      `select public.update_lead($1,'qualified', null, null, null, null, 480000)`, [id]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ stage: string; estimated_value: string }>(
      `select stage, estimated_value from leads where id = $1`, [id]));
    expect(row!.stage).toBe('qualified');
    expect(Number(row!.estimated_value)).toBe(480000);

    await expect(h.asUser(OWNER, () => h.sql(
      `select public.update_lead($1,'converted')`, [id])))
      .rejects.toThrow(/its own action, because it creates a customer/i);
  });

  it('adds a customer, which no function anywhere could do', async () => {
    const id = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_customer($1,'Toledo Public Works','municipal',
        'works@toledo.test','419-555-0180','Toledo','OH') as id`, [company])))[0]!.id;
    const [row] = await h.asUser(OWNER, () => h.sql<{
      code: string; customer_type: string; payment_terms: string; name: string;
    }>(`select code, customer_type, payment_terms, name from customers where id = $1`, [id]));
    expect(row!.code).toBe('CUS-0001');
    expect(row!.customer_type).toBe('municipal');
    expect(row!.payment_terms).toBe('Net 30');
  });

  it('refuses a second record for the same outfit, and says which one exists', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.create_customer($1,'toledo public works')`, [company])))
      .rejects.toThrow(/already have a customer called .*CUS-0001/i);
  });

  it('numbers the next customer from the same rule conversion uses', async () => {
    const id = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_customer($1,'Erie Excavating','commercial',
        null,'419-555-0199') as id`, [company])))[0]!.id;
    const [row] = await h.asUser(OWNER, () => h.sql<{ code: string }>(
      `select code from customers where id = $1`, [id]));
    expect(row!.code).toBe('CUS-0002');
  });

  it('opens an opportunity against a customer without inventing a lead first', async () => {
    const [{ id: customer }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from customers where code = 'CUS-0001' and company_id = $1`, [company]));
    const id = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_opportunity($1,'Transfer station pad',
        'Repeat customer, rang up about next year', 520000) as id`, [customer])))[0]!.id;
    const [row] = await h.asUser(OWNER, () => h.sql<{
      number: string; stage: string; estimated_value: string; customer_id: string;
    }>(`select number, stage, estimated_value, customer_id from opportunities where id = $1`,
      [id]));
    expect(row!.number).toMatch(/^OPP-\d{4}-0001$/);
    expect(row!.stage).toBe('identified');
    expect(Number(row!.estimated_value)).toBe(520000);
    expect(row!.customer_id).toBe(customer);
  });

  it('shows the new opportunity in the pipeline the board reads', async () => {
    const rows = await h.asUser(OWNER, () => h.sql<{ name: string; stage: string }>(
      `select name, stage from my_pipeline where company_id = $1`, [company]));
    expect(rows.some((r) => r.name === 'Transfer station pad')).toBe(true);
  });

  it('corrects a customer that was typed wrong', async () => {
    const [{ id }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from customers where code = 'CUS-0002' and company_id = $1`, [company]));
    await h.asUser(OWNER, () => h.sql(
      `select public.update_customer($1, p_phone => '419-555-0200',
         p_payment_terms => 'Net 45')`, [id]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ phone: string; payment_terms: string }>(
      `select phone, payment_terms from customers where id = $1`, [id]));
    expect(row!.phone).toBe('419-555-0200');
    expect(row!.payment_terms).toBe('Net 45');
  });
});
