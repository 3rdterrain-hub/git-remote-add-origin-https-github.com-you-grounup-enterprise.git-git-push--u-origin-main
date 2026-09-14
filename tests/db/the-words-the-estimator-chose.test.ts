/**
 * The words the estimator chose for the customer.
 *
 * The estimate line has a box labeled "Description for client…". It writes
 * `estimate_line_items.notes`, and every customer-facing path rendered
 * `description` — so rewording a line for the client changed nothing the client
 * would ever see. The value was in the database the whole time, read by nobody.
 *
 * Also pins what an issued proposal does when the estimate behind it is
 * attacked directly, because that is the thing this file originally set out to
 * fix before finding migration 0111 had already fixed it.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d';

describe('what the customer reads', () => {
  let h: Harness;
  let company = '';
  let version = '';
  let shown = '';
  let hidden = '';
  let token = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@wrd.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@wrd.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Words Civil','words-civil','enterprise') as id`)))[0]!.id;

    const [est] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.create_estimate('Kingsway', null, null, null, $1) as id`, [company]));
    version = (await h.asUser(OWNER, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [est!.id])))[0]!.v;

    shown = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.add_estimate_line($1, null, 'Mass excavation', 18400, 'CY') as id`,
      [version])))[0]!.id;
    hidden = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.add_estimate_line($1, null, 'Allowance, internal', 1, 'LS') as id`,
      [version])))[0]!.id;

    await h.asUser(OWNER, () => h.sql(
      `select app.update_estimate_line($1, '{"notes":"Bulk earthwork, cut to fill"}'::jsonb)`,
      [shown]));
    await h.asUser(OWNER, () => h.sql(
      `select app.update_estimate_line($1, '{"client_visible":false}'::jsonb)`, [hidden]));

    /* Priced through the engine: 0058 refuses an engine output written by hand. */
    await h.sql(
      `select app.record_engine_result($1,'grounup-engine@test',
         jsonb_build_object('total_price', 170200::numeric, 'bid_price', 170200::numeric,
                            'direct_cost', 140000::numeric, 'blocked_from_issue', false),
         jsonb_build_array(jsonb_build_object(
           'id', $2::text, 'unit_price', 9.25, 'total_price', 170200)))`,
      [version, shown]);

    const [snap] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `insert into library_snapshots (company_id, estimate_version_id, engine_version,
         entry_count, digest) values ($1,$2,'1.0.0',1,'0123456789abcdef') returning id`,
      [company, version]));
    await h.asService(() => h.sql(
      `update estimate_versions set status='approved', library_snapshot_id=$1
         where id = $2`, [snap!.id, version]));

    const [p] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.issue_proposal($1, 'Site work', 'Thank you.', 30, true, true) as id`, [version]));
    /* Returns a table — token, expiry and the link's id. */
    token = (await h.asUser(OWNER, () => h.sql<{ token: string }>(
      `select * from app.create_proposal_share_link($1, 'Dana Whitfield', null, 30)`,
      [p!.id])))[0]!.token;
  });

  const document = async () => (await h.asAnon(() => h.sql<{ d: Record<string, unknown> }>(
    `select public.open_proposal_by_token($1) as d`, [token])))[0]!.d;

  it('shows the customer the words written for them', async () => {
    const lines = (await document()).lines as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(1);
    expect(lines[0]!.description).toBe('Bulk earthwork, cut to fill');
  });

  it('falls back to the line itself where nobody wrote any', async () => {
    /*
     * Its own estimate, because the first one is issued and RULE-009 will not
     * let a line be edited afterwards — which is the correct behavior and the
     * subject of the test below.
     */
    const [est] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.create_estimate('Unworded job', null, null, null, $1) as id`, [company]));
    const v2 = (await h.asUser(OWNER, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [est!.id])))[0]!.v;
    const l = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.add_estimate_line($1, null, 'Fine grading', 4200, 'SY') as id`,
      [v2])))[0]!.id;
    await h.sql(
      `select app.record_engine_result($1,'grounup-engine@test',
         jsonb_build_object('total_price', 21000::numeric, 'bid_price', 21000::numeric,
                            'blocked_from_issue', false),
         jsonb_build_array(jsonb_build_object(
           'id', $2::text, 'unit_price', 5, 'total_price', 21000)))`, [v2, l]);
    const [snap] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `insert into library_snapshots (company_id, estimate_version_id, engine_version,
         entry_count, digest) values ($1,$2,'1.0.0',1,'0123456789abcdef') returning id`,
      [company, v2]));
    await h.asService(() => h.sql(
      `update estimate_versions set status='approved', library_snapshot_id=$1
         where id = $2`, [snap!.id, v2]));
    const [p2] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.issue_proposal($1, 'Grading', null, 30, true, true) as id`, [v2]));
    const [link] = await h.asUser(OWNER, () => h.sql<{ token: string }>(
      `select * from app.create_proposal_share_link($1, 'Dana', null, 30)`, [p2!.id]));

    const doc = (await h.asAnon(() => h.sql<{ d: Record<string, unknown> }>(
      `select public.open_proposal_by_token($1) as d`, [link!.token])))[0]!.d;
    const lines = doc.lines as Array<Record<string, unknown>>;
    expect(lines[0]!.description).toBe('Fine grading');
  });

  it('leaves the line the estimator kept back off it', async () => {
    const lines = (await document()).lines as Array<Record<string, unknown>>;
    expect(lines.some((l) => String(l.description).includes('Allowance'))).toBe(false);
  });

  it('cannot be changed by writing at the estimate directly', async () => {
    /*
     * The thing this file set out to fix, which migration 0111 had already
     * fixed: `app.refuse_when_version_frozen` covers every child of an approved
     * version, including a direct PostgREST write that goes around
     * `update_estimate_line` entirely. Pinned here because an issued proposal
     * quietly changing under a customer is the failure that would matter most.
     */
    await expect(h.asUser(OWNER, () => h.sql(
      `update estimate_line_items set client_visible = false, notes = 'Something else'
        where id = $1`, [shown]))).rejects.toThrow(/RULE-009/);

    const lines = (await document()).lines as Array<Record<string, unknown>>;
    expect(lines[0]!.description).toBe('Bulk earthwork, cut to fill');
  });

  it('sends a lump sum when that is what was chosen', async () => {
    /*
     * Both flags are false by default and were never set by anything, so every
     * proposal this platform issued was a lump sum whether or not anybody
     * decided that. Now it is a decision, made at the one moment it can be.
     */
    const [est] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.create_estimate('Lump sum job', null, null, null, $1) as id`, [company]));
    const v3 = (await h.asUser(OWNER, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [est!.id])))[0]!.v;
    const l = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.add_estimate_line($1, null, 'Everything', 1, 'LS') as id`, [v3])))[0]!.id;
    await h.sql(
      `select app.record_engine_result($1,'grounup-engine@test',
         jsonb_build_object('total_price', 90000::numeric, 'bid_price', 90000::numeric,
                            'blocked_from_issue', false),
         jsonb_build_array(jsonb_build_object(
           'id', $2::text, 'unit_price', 90000, 'total_price', 90000)))`, [v3, l]);
    const [snap] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `insert into library_snapshots (company_id, estimate_version_id, engine_version,
         entry_count, digest) values ($1,$2,'1.0.0',1,'0123456789abcdef') returning id`,
      [company, v3]));
    await h.asService(() => h.sql(
      `update estimate_versions set status='approved', library_snapshot_id=$1
         where id = $2`, [snap!.id, v3]));

    const [p3] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.issue_proposal($1, 'Lump sum', null, 30, false) as id`, [v3]));
    const [link] = await h.asUser(OWNER, () => h.sql<{ token: string }>(
      `select * from app.create_proposal_share_link($1, 'Dana', null, 30)`, [p3!.id]));
    const doc = (await h.asAnon(() => h.sql<{ d: Record<string, unknown> }>(
      `select public.open_proposal_by_token($1) as d`, [link!.token])))[0]!.d;

    expect(doc.lines).toEqual([]);
    expect(Number(doc.totalPrice)).toBe(90000);
    expect(doc.showLineDetail).toBe(false);
  });

  it('withholds the unit prices while still showing the scope', async () => {
    const doc = (await h.asAnon(() => h.sql<{ d: Record<string, unknown> }>(
      `select public.open_proposal_by_token($1) as d`, [token])))[0]!.d;
    const lines = doc.lines as Array<Record<string, unknown>>;
    expect(doc.showUnitPrices).toBe(true);
    expect(lines[0]!.unitPrice).not.toBeNull();
  });

  it('still arrives in the sending company\'s colors', async () => {
    const co = (await document()).company as Record<string, unknown>;
    expect(co.name).toBe('Words Civil');
    expect(co.primaryColor).toBe('#111827');
    expect(co.accentColor).toBe('#F6C101');
  });
});
