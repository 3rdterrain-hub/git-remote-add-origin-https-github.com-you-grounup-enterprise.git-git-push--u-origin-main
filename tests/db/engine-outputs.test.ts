import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * The engine owns the price.
 *
 * Before migration 0058 the schema said so in a comment and nothing enforced
 * it: any holder of estimate write permission could set `total_price` to
 * whatever they liked and stamp `engine_version = 'made up'` beside it. The
 * first test here is the exact statement that used to succeed.
 *
 * The boundary is deliberately not a permission. There is no role senior enough
 * to price an estimate by hand — pricing is an operation only the engine host
 * performs, and `app.record_engine_result()` is granted to `service_role`
 * alone, which no browser session ever holds.
 */
describe('engine outputs', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let version = '';
  let line = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test') on conflict (id) do nothing`, [owner]);
    company = (await h.asUser(owner, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','business') as id`)))[0]!.id;

    await h.asUser(owner, async () => {
      const est = (await h.sql<{ id: string }>(
        `insert into estimates (company_id, number, name) values ($1,'EST-1','Kingsway') returning id`,
        [company]))[0]!.id;
      version = (await h.sql<{ id: string }>(
        `insert into estimate_versions (company_id, estimate_id, version_number)
         values ($1,$2,1) returning id`, [company, est]))[0]!.id;
      line = (await h.sql<{ id: string }>(
        `insert into estimate_line_items (company_id, estimate_version_id, description, measured_quantity, unit)
         values ($1,$2,'Trench excavation',1200,'CY') returning id`, [company, version]))[0]!.id;
    });
  });

  afterAll(async () => { await h?.db.close(); });

  // ------------------------------------------------------------ refusal
  it('refuses a price the engine never computed', async () => {
    // This exact statement succeeded before 0058.
    await expect(h.asUser(owner, () => h.sql(
      `update estimate_versions set total_price = 9999999, bid_price = 9999999,
              engine_version = 'made up', calculated_at = now() where id = $1`, [version])))
      .rejects.toThrow(/may not be written by hand/);
  });

  it('names the columns that were refused, so the caller knows what to stop doing', async () => {
    await expect(h.asUser(owner, () => h.sql(
      `update estimate_versions set direct_cost = 5, cost_fuel = 7 where id = $1`, [version])))
      .rejects.toThrow(/cost_fuel/);
  });

  it('refuses a hand-written line cost', async () => {
    await expect(h.asUser(owner, () => h.sql(
      `update estimate_line_items set total_direct_cost = 100000, unit_cost = 83.33 where id = $1`, [line])))
      .rejects.toThrow(/may not be written by hand/);
  });

  it('refuses a hand-written confidence band', async () => {
    /*
     * Confidence is not decoration: `blocked_from_issue` follows from it, and a
     * line marked verified by hand would let an unpriced estimate reach a
     * customer.
     */
    await expect(h.asUser(owner, () => h.sql(
      `update estimate_line_items set confidence_band = 'strong', verification_status = 'verified'
       where id = $1`, [line]))).rejects.toThrow(/may not be written by hand/);
  });

  it('refuses a hand-written resource extension', async () => {
    const res = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into estimate_line_resources (company_id, line_item_id, resource_kind, quantity, unit_rate)
       values ($1,$2,'labor',8,45) returning id`, [company, line])))[0]!.id;
    await expect(h.asUser(owner, () => h.sql(
      `update estimate_line_resources set extended_cost = 99999 where id = $1`, [res])))
      .rejects.toThrow(/may not be written by hand/);
  });

  // ------------------------------------------------------------- inputs
  it('leaves the estimator their own inputs', async () => {
    /*
     * The boundary has to be exactly right in both directions. Quantity, waste,
     * the contingency actually applied and the verification checks a person
     * performs are decisions, not derivations, and refusing them would make the
     * estimate unusable.
     */
    await h.asUser(owner, () => h.sql(
      `update estimate_line_items
          set measured_quantity = 1500, waste_percent = 0.05, waste_basis = 'Trench spoil',
              check_primary_source = true, production_modifier = 0.9
        where id = $1`, [line]));
    await h.asUser(owner, () => h.sql(
      `update estimate_versions set shift_hours = 10, applied_contingency = 0.08,
              swell_percent = 0.30 where id = $1`, [version]));

    const [l] = await h.asUser(owner, () => h.sql<{ measured_quantity: string }>(
      `select measured_quantity from estimate_line_items where id = $1`, [line]));
    expect(Number(l!.measured_quantity)).toBe(1500);
  });

  // ------------------------------------------------------------- insert
  it('discards a price forged at insert rather than storing it', async () => {
    /*
     * A new version is unpriced by definition, so there is nothing to refuse —
     * only a forged starting position to drop. `revise_estimate_version` has
     * always declined to copy these forward; this makes that true of every path.
     */
    const est = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into estimates (company_id, number, name) values ($1,'EST-2','Forged') returning id`,
      [company])))[0]!.id;
    const [v] = await h.asUser(owner, () => h.sql<{
      total_price: string; engine_version: string | null; blocked_from_issue: boolean;
      confidence_band: string;
    }>(`insert into estimate_versions
          (company_id, estimate_id, version_number, total_price, bid_price,
           engine_version, blocked_from_issue, confidence_band)
        values ($1,$2,1,750000,750000,'made up',false,'strong')
        returning total_price, engine_version, blocked_from_issue, confidence_band`,
      [company, est]));

    expect(Number(v!.total_price)).toBe(0);
    expect(v!.engine_version).toBeNull();
    // The pessimistic defaults survive: an unpriced version stays unissuable.
    expect(v!.blocked_from_issue).toBe(true);
    expect(v!.confidence_band).toBe('do_not_price');
  });

  it('resets to the column default and not to a second opinion about it', async () => {
    /*
     * The guard reads its reset values from `pg_attrdef` rather than carrying
     * its own copy, so the schema is the single definition of "unpriced". This
     * asserts the two agree — if a default changes and the guard did hold a
     * copy, this is where it would show.
     */
    const rows = await h.sql<{ column_name: string; column_default: string | null }>(
      `select column_name, column_default from information_schema.columns
        where table_name = 'estimate_versions'
          and column_name in ('total_price','blocked_from_issue','confidence_band',
                              'recommended_contingency','executive_decision')
        order by column_name`);
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r.column_default]));
    expect(byName.total_price).toMatch(/^0/);
    expect(byName.blocked_from_issue).toBe('true');
    expect(byName.confidence_band).toMatch(/do_not_price/);
    expect(byName.executive_decision).toMatch(/document_set_incomplete/);
    expect(byName.recommended_contingency).toMatch(/0\.12/);
  });

  // -------------------------------------------------------------- door
  it('lets the engine write, through the one function that may', async () => {
    await h.sql(
      `select app.record_engine_result($1, 'grounup-engine@1.0.0',
         jsonb_build_object('direct_cost', 412000, 'total_price', 498520,
                            'bid_price', 498500, 'confidence_band', 'strong',
                            'blocked_from_issue', false),
         jsonb_build_array(jsonb_build_object('id', $2::text, 'total_direct_cost', 412000,
                                              'unit_cost', 274.67)))`,
      [version, line]);

    const [v] = await h.sql<{ total_price: string; engine_version: string; calculated_at: string }>(
      `select total_price, engine_version, calculated_at from estimate_versions where id = $1`, [version]);
    expect(Number(v!.total_price)).toBe(498520);
    expect(v!.engine_version).toBe('grounup-engine@1.0.0');
    expect(v!.calculated_at).not.toBeNull();

    const [l] = await h.sql<{ total_direct_cost: string }>(
      `select total_direct_cost from estimate_line_items where id = $1`, [line]);
    expect(Number(l!.total_direct_cost)).toBe(412000);
  });

  it('will not record a result that does not say which engine produced it', async () => {
    // Provenance is the point. An unattributed number is the defect again.
    await expect(h.sql(
      `select app.record_engine_result($1, '', '{}'::jsonb)`, [version]))
      .rejects.toThrow(/which engine produced it/);
  });

  it('closes the door again when the transaction ends', async () => {
    /*
     * `set local` cannot outlive its transaction, so a pricing run cannot leave
     * the guard open for the next statement on the same connection.
     */
    await expect(h.asUser(owner, () => h.sql(
      `update estimate_versions set total_price = 1 where id = $1`, [version])))
      .rejects.toThrow(/may not be written by hand/);
  });

  it('is not reachable by a signed-in user', async () => {
    /*
     * The whole boundary in one assertion. If `authenticated` could execute
     * this, every guard above would be a speed bump.
     */
    const [g] = await h.sql<{ has: boolean }>(
      `select has_function_privilege('authenticated',
         'app.record_engine_result(uuid, text, jsonb, jsonb, jsonb)', 'execute') as has`);
    expect(g!.has).toBe(false);

    const [s] = await h.sql<{ has: boolean }>(
      `select has_function_privilege('service_role',
         'app.record_engine_result(uuid, text, jsonb, jsonb, jsonb)', 'execute') as has`);
    expect(s!.has).toBe(true);
  });
});
