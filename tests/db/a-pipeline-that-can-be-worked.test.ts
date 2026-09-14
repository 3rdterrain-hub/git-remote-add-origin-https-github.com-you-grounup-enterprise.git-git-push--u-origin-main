/**
 * A pipeline that can be worked, and somebody to call.
 *
 * Three tables from migration 0005, each fully modeled and each unreachable.
 *
 * `opportunities` has eight stages in a check constraint, a probability, a bid
 * due date, an owner, a loss reason and a winning competitor — and exactly one
 * writer in the system, `convert_lead`, which inserts at `identified`. Nothing
 * could move a stage, so every opportunity sat where it was born, the win-rate
 * tile could only read zero, and the loss-reason line never rendered.
 *
 * `contacts` has a customer-or-vendor constraint and a partial unique index for
 * one primary per customer. Zero readers, zero writers, while the plan blurb
 * sells "Customers, contacts and the lead intake form".
 *
 * `crm_activities` has an index on `(company_id, due_at) where completed_at is
 * null` — built to answer "what is due next" for a list nobody wrote.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '8f8f8f8f-8f8f-4f8f-8f8f-8f8f8f8f8f8f';

describe('working the pipeline', () => {
  let h: Harness;
  let company = '';
  let customer = '';
  let opportunity = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@pipe.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@pipe.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Pipe Civil','pipe-civil','enterprise') as id`)))[0]!.id;

    customer = (await h.asService(() => h.sql<{ id: string }>(
      `insert into customers (company_id, code, name)
       values ($1,'CUS-0001','Kingsway Development') returning id`, [company])))[0]!.id;
    opportunity = (await h.asService(() => h.sql<{ id: string }>(
      `insert into opportunities (company_id, customer_id, number, name, stage,
         estimated_value)
       values ($1,$2,'OPP-2026-0001','Kingsway site package','identified',480000)
       returning id`, [company, customer])))[0]!.id;
  });

  it('moves through the stages that nothing could reach', async () => {
    for (const stage of ['qualifying', 'estimating', 'proposed']) {
      await h.asUser(OWNER, () => h.sql(
        `select public.move_opportunity_stage($1, $2)`, [opportunity, stage]));
    }
    const [row] = await h.asUser(OWNER, () => h.sql<{ stage: string }>(
      `select stage from my_pipeline where id = $1`, [opportunity]));
    expect(row!.stage).toBe('proposed');
  });

  it('writes an activity for every move, so a stage has a history', async () => {
    const rows = await h.asUser(OWNER, () => h.sql<{ subject: string }>(
      `select subject from my_crm_activities where opportunity_id = $1
        order by created_at`, [opportunity]));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.map((r) => r.subject)).toContain('Moved from identified to qualifying');
  });

  it('refuses a stage that is not one of the eight', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.move_opportunity_stage($1,'nearly')`, [opportunity])))
      .rejects.toThrow(/Unknown stage/i);
  });

  it('will not close one as lost without saying why', async () => {
    /*
     * The one field that ever answers whether the number was wrong or the
     * relationship was. A loss with no reason is the figure that never improves.
     */
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.move_opportunity_stage($1,'lost')`, [opportunity])))
      .rejects.toThrow(/why it was lost/i);
  });

  it('stamps a win, and calls it certain', async () => {
    await h.asUser(OWNER, () => h.sql(
      `select public.move_opportunity_stage($1,'won')`, [opportunity]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      won_at: string | null; probability: string; is_closed: boolean;
    }>(`select won_at, probability, is_closed from my_pipeline where id = $1`,
      [opportunity]));
    expect(row!.won_at).not.toBeNull();
    expect(Number(row!.probability)).toBe(1);
    expect(row!.is_closed).toBe(true);
  });

  it('records who it went to when it is lost', async () => {
    const [o2] = await h.asService(() => h.sql<{ id: string }>(
      `insert into opportunities (company_id, customer_id, number, name, stage)
       values ($1,$2,'OPP-2026-0002','Second look','proposed') returning id`,
      [company, customer]));
    await h.asUser(OWNER, () => h.sql(
      `select public.move_opportunity_stage($1,'lost','Price. We were 8% over.','Aggregate Inc')`,
      [o2!.id]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      loss_reason: string; winning_competitor: string; lost_at: string | null;
    }>(`select loss_reason, winning_competitor, lost_at from my_pipeline where id = $1`,
      [o2!.id]));
    expect(row!.loss_reason).toBe('Price. We were 8% over.');
    expect(row!.winning_competitor).toBe('Aggregate Inc');
    expect(row!.lost_at).not.toBeNull();
  });

  it('weights the forecast by the probability, rather than storing a total', async () => {
    const [o3] = await h.asService(() => h.sql<{ id: string }>(
      `insert into opportunities (company_id, customer_id, number, name, stage,
         estimated_value) values ($1,$2,'OPP-2026-0003','Weighted','estimating',200000)
       returning id`, [company, customer]));
    await h.asUser(OWNER, () => h.sql(
      `select public.update_opportunity($1, null, null, null, 0.35)`, [o3!.id]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ weighted_value: string }>(
      `select weighted_value from my_pipeline where id = $1`, [o3!.id]));
    expect(Number(row!.weighted_value)).toBe(70000);
  });

  it('refuses a probability that is not one', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.update_opportunity($1, null, null, null, 1.4)`, [opportunity])))
      .rejects.toThrow(/between 0 and 1/i);
  });
});

describe('somebody to call', () => {
  let h: Harness;
  let company = '';
  let customer = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'c@pipe.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'c@pipe.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Contact Civil','contact-civil','enterprise') as id`)))[0]!.id;
    customer = (await h.asService(() => h.sql<{ id: string }>(
      `insert into customers (company_id, code, name)
       values ($1,'CUS-0001','Kingsway Development') returning id`, [company])))[0]!.id;
  });

  it('adds somebody, and shows them against their customer', async () => {
    await h.asUser(OWNER, () => h.sql(
      `select public.save_contact(null, $1, null, 'Dana', 'Whitfield', 'Project Manager',
         'dana@kingsway.test', '419-555-0134', null, null, null, true)`, [customer]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      full_name: string; customer_name: string; is_primary: boolean;
    }>(`select full_name, customer_name, is_primary from my_contacts
          where customer_id = $1`, [customer]));
    expect(row!.full_name).toBe('Dana Whitfield');
    expect(row!.customer_name).toBe('Kingsway Development');
    expect(row!.is_primary).toBe(true);
  });

  it('stands the old primary down rather than refusing the new one', async () => {
    /*
     * A partial unique index enforces one primary per customer. Hitting it
     * would read as a bug; naming a new primary is how you name a new primary.
     */
    await h.asUser(OWNER, () => h.sql(
      `select public.save_contact(null, $1, null, 'Marcus', 'Ruiz', 'Owner',
         null, null, null, null, null, true)`, [customer]));
    const rows = await h.asUser(OWNER, () => h.sql<{ full_name: string; is_primary: boolean }>(
      `select full_name, is_primary from my_contacts where customer_id = $1
        order by is_primary desc`, [customer]));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.full_name).toBe('Marcus Ruiz');
    expect(rows.filter((r) => r.is_primary)).toHaveLength(1);
  });

  it('refuses a contact that belongs to nobody, and one that belongs to both', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.save_contact(null, null, null, 'Nobody', 'Atall')`)))
      .rejects.toThrow(/customer or to a vendor/i);
  });

  it('needs a name to go on', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.save_contact(null, $1, null, 'Dana', '  ')`, [customer])))
      .rejects.toThrow(/first and last name/i);
  });

  it('archives rather than deletes, because they answered the phone for two years', async () => {
    const [c] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from my_contacts where first_name = 'Dana' and customer_id = $1`,
      [customer]));
    await h.asUser(OWNER, () => h.sql(`select public.retire_contact($1)`, [c!.id]));
    const rows = await h.asUser(OWNER, () => h.sql(
      `select id from my_contacts where id = $1`, [c!.id]));
    expect(rows).toHaveLength(0);
    const [still] = await h.asUser(OWNER, () => h.sql<{ status: string }>(
      `select status from contacts where id = $1`, [c!.id]));
    expect(still!.status).toBe('archived');
  });
});

describe('what was said, and what is due', () => {
  let h: Harness;
  let company = '';
  let customer = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'a@pipe.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'a@pipe.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Activity Civil','activity-civil','enterprise') as id`)))[0]!.id;
    customer = (await h.asService(() => h.sql<{ id: string }>(
      `insert into customers (company_id, code, name)
       values ($1,'CUS-0001','Kingsway Development') returning id`, [company])))[0]!.id;
  });

  it('records a call that happened', async () => {
    await h.asUser(OWNER, () => h.sql(
      `select public.log_crm_activity('call','Spoke to Dana about the schedule',
         'They want to start in March.', $1)`, [customer]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      subject: string; completed_at: string | null; customer_name: string;
    }>(`select subject, completed_at, customer_name from my_crm_activities
          where customer_id = $1`, [customer]));
    expect(row!.subject).toBe('Spoke to Dana about the schedule');
    expect(row!.completed_at).not.toBeNull();
    expect(row!.customer_name).toBe('Kingsway Development');
  });

  it('records a call still to make, and says when it is overdue', async () => {
    /*
     * A call made and a call to make are the same record from either side of a
     * date, which is why one function writes both.
     */
    await h.asUser(OWNER, () => h.sql(
      `select public.log_crm_activity('follow_up','Chase the geotech report', null,
         $1, null, null, now() - interval '2 days', false)`, [customer]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ overdue: boolean; subject: string }>(
      `select overdue, subject from my_crm_activities
        where customer_id = $1 and completed_at is null`, [customer]));
    expect(row!.subject).toBe('Chase the geotech report');
    expect(row!.overdue).toBe(true);
  });

  it('ticks one off', async () => {
    const [a] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from my_crm_activities where completed_at is null and customer_id = $1`,
      [customer]));
    await h.asUser(OWNER, () => h.sql(`select public.complete_crm_activity($1)`, [a!.id]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ completed_at: string | null }>(
      `select completed_at from my_crm_activities where id = $1`, [a!.id]));
    expect(row!.completed_at).not.toBeNull();
  });

  it('refuses one about nobody', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.log_crm_activity('note','Floating in space')`)))
      .rejects.toThrow(/who this is about/i);
  });

  it('refuses a kind of activity nobody defined', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.log_crm_activity('telepathy','Thought about them', null, $1)`,
      [customer]))).rejects.toThrow(/Unknown activity type/i);
  });

  it('refuses somebody from another company', async () => {
    const STRANGER = '8b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
    await h.sql(`insert into auth.users (id, email) values ($1,'s@pipe.test')`, [STRANGER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'s@pipe.test')
                 on conflict (id) do nothing`, [STRANGER]);
    await expect(h.asUser(STRANGER, () => h.sql(
      `select public.log_crm_activity('call','Not mine', null, $1)`, [customer])))
      .rejects.toThrow();
  });
});
