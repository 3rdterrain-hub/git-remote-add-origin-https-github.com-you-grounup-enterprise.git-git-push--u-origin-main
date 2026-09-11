/**
 * The three checks the engine scores confidence from, and who may set them.
 *
 * `check_primary_source`, `check_cross_source` and `check_reconciliation` are
 * columns on the line, read by `estimate-pricing.ts` and handed to
 * `scoreConfidence`. They default to false and nothing in the application had
 * ever written one.
 *
 * That is not a cosmetic score. All three false with a hand-entered quantity
 * scores around 30, which is below 80, which routes the line to
 * `senior_review`, which sets `blocks_issue`, which sets `blocked_from_issue`
 * on the version, which is what approval refuses on. An estimate somebody typed
 * could not be approved, could not be issued, could not be awarded, and could
 * never become a project — and the screen could only say "1 line is not
 * confident enough to bid" with no control anywhere able to answer it.
 *
 * So these tests hold down three things: the fields are accepted, they are
 * still refused when misspelled, and the permission and frozen-version rules
 * that governed every other field still govern these.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const CHIEF = '11111111-1111-4111-8111-111111111111';
const CLERK = '22222222-2222-4222-8222-222222222222';

describe('how sure are you of that quantity', () => {
  let h: Harness;
  let company = '';
  let version = '';
  let line = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [[CHIEF, 'chief@ridge.test'], [CLERK, 'clerk@ridge.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, email]);
    }
    company = (await h.asUser(CHIEF, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','professional') as id`)))[0]!.id;

    // A member whose role holds no `estimates.write`.
    await h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status, joined_at)
       select $1, $2, r.id, 'active', now() from roles r
        where r.company_id is null and r.key = 'foreman' limit 1`, [company, CLERK]);

    await h.asUser(CHIEF, async () => {
      const est = (await h.sql<{ id: string }>(
        `insert into estimates (company_id, number, name)
         values ($1,'EST-CONF','Duct bank') returning id`, [company]))[0]!.id;
      version = (await h.sql<{ id: string }>(
        `insert into estimate_versions (company_id, estimate_id, version_number, status)
         values ($1,$2,1,'draft') returning id`, [company, est]))[0]!.id;
      line = (await h.sql<{ id: string }>(
        `insert into estimate_line_items (company_id, estimate_version_id, description,
                                          measured_quantity, unit)
         values ($1,$2,'Electrical duct bank installation',500,'LF') returning id`,
        [company, version]))[0]!.id;
    });
  });

  afterAll(async () => { await h?.db.close(); });

  it('starts every check false, which is the honest default', async () => {
    /*
     * A quantity nobody has said anything about has had nothing checked. The
     * defect was never this default — it was that no caller could change it.
     */
    const [row] = await h.asUser(CHIEF, () => h.sql<Record<string, unknown>>(
      `select check_primary_source, check_cross_source, check_reconciliation, measurement_method
         from estimate_line_items where id = $1`, [line]));
    expect(row!.check_primary_source).toBe(false);
    expect(row!.check_cross_source).toBe(false);
    expect(row!.check_reconciliation).toBe(false);
  });

  it('takes all three, which is what the engine scores confidence from', async () => {
    await h.asUser(CHIEF, () => h.sql(
      `select app.update_estimate_line($1, $2::jsonb)`,
      [line, JSON.stringify({
        check_primary_source: true, check_cross_source: true, check_reconciliation: true,
      })]));
    const [row] = await h.asUser(CHIEF, () => h.sql<Record<string, unknown>>(
      `select check_primary_source, check_cross_source, check_reconciliation
         from estimate_line_items where id = $1`, [line]));
    expect(row!.check_primary_source).toBe(true);
    expect(row!.check_cross_source).toBe(true);
    expect(row!.check_reconciliation).toBe(true);
  });

  it('takes them back off again, because a check is a claim somebody can withdraw', async () => {
    await h.asUser(CHIEF, () => h.sql(
      `select app.update_estimate_line($1, $2::jsonb)`,
      [line, JSON.stringify({ check_cross_source: false })]));
    const [row] = await h.asUser(CHIEF, () => h.sql<Record<string, unknown>>(
      `select check_primary_source, check_cross_source from estimate_line_items where id = $1`,
      [line]));
    // The one named changed; the one not named did not.
    expect(row!.check_cross_source).toBe(false);
    expect(row!.check_primary_source).toBe(true);
  });

  it('records how the quantity was arrived at', async () => {
    await h.asUser(CHIEF, () => h.sql(
      `select app.update_estimate_line($1, $2::jsonb)`,
      [line, JSON.stringify({ measurement_method: 'explicit_dimension' })]));
    const [row] = await h.asUser(CHIEF, () => h.sql<{ measurement_method: string }>(
      `select measurement_method::text from estimate_line_items where id = $1`, [line]));
    expect(row!.measurement_method).toBe('explicit_dimension');
  });

  it('takes every basis the screen offers, so the list cannot drift from the type', async () => {
    /*
     * The other half of the joint the component test holds down. That one
     * asserts the screen's list equals the enum; this one asserts the writer
     * accepts every value in it, so a basis a person can pick is always a basis
     * that lands.
     */
    for (const method of ['explicit_dimension', 'calculated', 'schedule_quantity',
      'owner_quantity', 'verified_scale', 'derived', 'approximate_scale',
      'estimator_allowance']) {
      await h.asUser(CHIEF, () => h.sql(
        `select app.update_estimate_line($1, $2::jsonb)`,
        [line, JSON.stringify({ measurement_method: method })]));
      const [row] = await h.asUser(CHIEF, () => h.sql<{ m: string }>(
        `select measurement_method::text as m from estimate_line_items where id = $1`, [line]));
      expect(row!.m, method).toBe(method);
    }
  });

  it('refuses a measurement method that is not one of the ones it has', async () => {
    await expect(h.asUser(CHIEF, () => h.sql(
      `select app.update_estimate_line($1, $2::jsonb)`,
      [line, JSON.stringify({ measurement_method: 'i_had_a_feeling' })])))
      .rejects.toThrow();
  });

  it('still refuses a field name nobody recognizes, and names it', async () => {
    /*
     * The guard from 0136 is the reason these four had to be added by name
     * rather than passed through: `checkPrimarySource` would otherwise have
     * matched nothing, written nothing, and returned success.
     */
    await expect(h.asUser(CHIEF, () => h.sql(
      `select app.update_estimate_line($1, $2::jsonb)`,
      [line, JSON.stringify({ checkPrimarySource: true })])))
      .rejects.toThrow(/checkPrimarySource/);
  });

  it('refuses somebody without estimates.write', async () => {
    await expect(h.asUser(CLERK, () => h.sql(
      `select app.update_estimate_line($1, $2::jsonb)`,
      [line, JSON.stringify({ check_primary_source: true })])))
      .rejects.toThrow(/permission/);
  });

  it('refuses a frozen version, like every other field', async () => {
    const frozen = await h.asUser(CHIEF, async () => {
      const est = (await h.sql<{ id: string }>(
        `insert into estimates (company_id, number, name)
         values ($1,'EST-FROZEN','Out for review') returning id`, [company]))[0]!.id;
      const v = (await h.sql<{ id: string }>(
        `insert into estimate_versions (company_id, estimate_id, version_number, status)
         values ($1,$2,1,'draft') returning id`, [company, est]))[0]!.id;
      const l = (await h.sql<{ id: string }>(
        `insert into estimate_line_items (company_id, estimate_version_id, description,
                                          measured_quantity, unit)
         values ($1,$2,'Frozen line',10,'LF') returning id`, [company, v]))[0]!.id;
      /*
       * `approved`, with the snapshot it requires. Not `in_review`, which 0137
       * deliberately still allows editing in — an estimate out for review is
       * one somebody is still working on. And not `issued` without a snapshot,
       * which the database refuses outright, because an issued price the
       * platform cannot reproduce is not a record of anything.
       */
      const snap = (await h.asService(() => h.sql<{ id: string }>(
        `insert into library_snapshots (company_id, estimate_version_id, engine_version,
                                        entry_count, digest)
         values ($1,$2,'1.0.0',0,'0000000000000000') returning id`, [company, v])))[0]!.id;
      await h.asService(() => h.sql(
        `update estimate_versions set library_snapshot_id = $2, status = 'approved'
          where id = $1`, [v, snap]));
      return l;
    });
    await expect(h.asUser(CHIEF, () => h.sql(
      `select app.update_estimate_line($1, $2::jsonb)`,
      [frozen, JSON.stringify({ check_primary_source: true })])))
      .rejects.toThrow(/make a new version to change it/);
  });

  it('is reachable through the public function the browser calls', async () => {
    await h.asUser(CHIEF, () => h.sql(
      `select public.update_estimate_line($1, $2::jsonb)`,
      [line, JSON.stringify({ check_reconciliation: false })]));
    const [row] = await h.asUser(CHIEF, () => h.sql<{ check_reconciliation: boolean }>(
      `select check_reconciliation from estimate_line_items where id = $1`, [line]));
    expect(row!.check_reconciliation).toBe(false);
  });
});
