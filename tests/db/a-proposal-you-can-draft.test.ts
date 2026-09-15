/**
 * A proposal you can draft.
 *
 * `proposals.status` has allowed `'draft'` since migration 0006, and
 * `app.enforce_proposal_immutability` opens with
 * `if old.status = 'draft' then return new` — a branch that had never executed,
 * because `issue_proposal` inserts straight at `'issued'`. There was no moment
 * at which a proposal was editable.
 *
 * Which is why `commercial_terms` and `payment_terms` were written by nothing:
 * not missing columns, and not a missing form, but two fields with nowhere in
 * the lifecycle to be filled in.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '8c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c';

describe('drafting a proposal', () => {
  let h: Harness;
  let company = '';
  let n = 0;

  /** An approved version with a price the engine wrote. */
  const approvedVersion = async (): Promise<string> => {
    n += 1;
    const [est] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.create_estimate($2, null, null, null, $1) as id`,
      [company, `Kingsway ${n}`]));
    const version = (await h.asUser(OWNER, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [est!.id])))[0]!.v;
    const line = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.add_estimate_line($1, null, 'Mass excavation', 18400, 'CY') as id`,
      [version])))[0]!.id;
    await h.sql(
      `select app.record_engine_result($1,'grounup-engine@test',
         jsonb_build_object('total_price', 170200::numeric, 'bid_price', 170200::numeric,
                            'blocked_from_issue', false),
         jsonb_build_array(jsonb_build_object(
           'id', $2::text, 'unit_price', 9.25, 'total_price', 170200)))`, [version, line]);
    const [snap] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `insert into library_snapshots (company_id, estimate_version_id, engine_version,
         entry_count, digest) values ($1,$2,'1.0.0',1,'0123456789abcdef') returning id`,
      [company, version]));
    await h.asService(() => h.sql(
      `update estimate_versions set status='approved', library_snapshot_id=$1
         where id = $2`, [snap!.id, version]));
    return version;
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@dft.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@dft.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Draft Civil','draft-civil','enterprise') as id`)))[0]!.id;
  });

  it('writes the two columns nothing has ever written', async () => {
    const v = await approvedVersion();
    const [p] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.draft_proposal($1,'Site work','Thank you for the opportunity.',
         'Price held 30 days. Rock excavation excluded.','Net 30') as id`, [v]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      status: string; commercial_terms: string; payment_terms: string; total_price: string;
    }>(`select status, commercial_terms, payment_terms, total_price
          from proposals where id = $1`, [p!.id]));
    expect(row!.status).toBe('draft');
    expect(row!.commercial_terms).toBe('Price held 30 days. Rock excavation excluded.');
    expect(row!.payment_terms).toBe('Net 30');
    /* Derived by `enforce_proposal_price`, never typed. */
    expect(Number(row!.total_price)).toBe(170200);
  });

  it('lets a draft be changed, which is the whole point of one', async () => {
    const v = await approvedVersion();
    const [p] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.draft_proposal($1,'Site work','First draft') as id`, [v]));
    await h.asUser(OWNER, () => h.sql(
      `select public.update_proposal($1, null, 'Second draft, with the typo fixed',
         'Price held 45 days.', 'Net 45', 45)`, [p!.id]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      cover_letter: string; commercial_terms: string; payment_terms: string;
      validity_days: number; title: string;
    }>(`select cover_letter, commercial_terms, payment_terms, validity_days, title
          from proposals where id = $1`, [p!.id]));
    expect(row!.cover_letter).toBe('Second draft, with the typo fixed');
    expect(row!.payment_terms).toBe('Net 45');
    expect(row!.validity_days).toBe(45);
    /* Null left the title alone. */
    expect(row!.title).toBe('Site work');
  });

  it('sends it, and stops it being editable at that moment', async () => {
    const v = await approvedVersion();
    const [p] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.draft_proposal($1,'Site work','Ready to go') as id`, [v]));
    await h.asUser(OWNER, () => h.sql(
      `select public.issue_drafted_proposal($1)`, [p!.id]));

    const [row] = await h.asUser(OWNER, () => h.sql<{
      status: string; issued_at: string | null;
    }>(`select status, issued_at from proposals where id = $1`, [p!.id]));
    expect(row!.status).toBe('issued');
    expect(row!.issued_at).not.toBeNull();

    await expect(h.asUser(OWNER, () => h.sql(
      `select public.update_proposal($1, null, 'Changed my mind')`, [p!.id])))
      .rejects.toThrow(/does not change/i);
  });

  it('moves the estimate to issued along with it', async () => {
    const v = await approvedVersion();
    const [p] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.draft_proposal($1,'Site work') as id`, [v]));
    await h.asUser(OWNER, () => h.sql(`select public.issue_drafted_proposal($1)`, [p!.id]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ status: string }>(
      `select status from estimate_versions where id = $1`, [v]));
    expect(row!.status).toBe('issued');
  });

  it('throws away one that was never sent', async () => {
    const v = await approvedVersion();
    const [p] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.draft_proposal($1,'Never mind') as id`, [v]));
    await h.asUser(OWNER, () => h.sql(`select public.discard_proposal_draft($1)`, [p!.id]));
    const rows = await h.asUser(OWNER, () => h.sql(
      `select id from proposals where id = $1`, [p!.id]));
    expect(rows).toHaveLength(0);
  });

  it('refuses to delete one the customer has seen', async () => {
    /* An issued proposal is withdrawn, not deleted. */
    const v = await approvedVersion();
    const [p] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.draft_proposal($1,'Sent already') as id`, [v]));
    await h.asUser(OWNER, () => h.sql(`select public.issue_drafted_proposal($1)`, [p!.id]));
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.discard_proposal_draft($1)`, [p!.id])))
      .rejects.toThrow(/withdrawn, not deleted/i);
  });

  it('will not draft from an estimate nobody has approved', async () => {
    const [est] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.create_estimate('Unapproved', null, null, null, $1) as id`, [company]));
    const v = (await h.asUser(OWNER, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [est!.id])))[0]!.v;
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.draft_proposal($1,'Too early')`, [v])))
      .rejects.toThrow(/approved before a proposal is drafted/i);
  });

  it('re-checks the estimate when the draft is finally sent', async () => {
    /*
     * A draft may sit for a week, so `issue_drafted_proposal` runs
     * `assert_issuable` again rather than trusting the check made when the
     * draft was started. Here a line the engine marked as blocking is what
     * stops it — the version itself is approved and cannot be altered
     * afterwards, which RULE-009 enforces and which this test originally tried
     * to do before being refused.
     */
    n += 1;
    const [est] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.create_estimate($2, null, null, null, $1) as id`,
      [company, `Blocked ${n}`]));
    const v = (await h.asUser(OWNER, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [est!.id])))[0]!.v;
    const line = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.add_estimate_line($1, null, 'Unverified rate', 100, 'CY') as id`,
      [v])))[0]!.id;
    await h.sql(
      `select app.record_engine_result($1,'grounup-engine@test',
         jsonb_build_object('total_price', 5000::numeric, 'bid_price', 5000::numeric,
                            'blocked_from_issue', false),
         jsonb_build_array(jsonb_build_object(
           'id', $2::text, 'unit_price', 50, 'total_price', 5000,
           'blocks_issue', true)))`, [v, line]);
    const [snap] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `insert into library_snapshots (company_id, estimate_version_id, engine_version,
         entry_count, digest) values ($1,$2,'1.0.0',1,'0123456789abcdef') returning id`,
      [company, v]));
    await h.asService(() => h.sql(
      `update estimate_versions set status='approved', library_snapshot_id=$1
         where id = $2`, [snap!.id, v]));

    const [p] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.draft_proposal($1,'Sat for a week') as id`, [v]));
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.issue_drafted_proposal($1)`, [p!.id])))
      .rejects.toThrow(/not confident enough to bid/i);
  });

  it('refuses a second send of the same draft', async () => {
    const v = await approvedVersion();
    const [p] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.draft_proposal($1,'Once only') as id`, [v]));
    await h.asUser(OWNER, () => h.sql(`select public.issue_drafted_proposal($1)`, [p!.id]));
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.issue_drafted_proposal($1)`, [p!.id])))
      .rejects.toThrow(/already issued/i);
  });

  it('refuses somebody without permission to issue', async () => {
    const STRANGER = '8c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c';
    await h.sql(`insert into auth.users (id, email) values ($1,'s@dft.test')`, [STRANGER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'s@dft.test')
                 on conflict (id) do nothing`, [STRANGER]);
    const v = await approvedVersion();
    await expect(h.asUser(STRANGER, () => h.sql(
      `select public.draft_proposal($1,'Not mine')`, [v]))).rejects.toThrow();
  });
});
