/**
 * Putting a crew on a line.
 *
 * `estimate_line_resources` has held the crew, machines, materials, trucks and
 * subcontracts behind a line since migration 0006, and nothing has ever put one
 * there — so an estimate line was a service and a quantity, and everything that
 * decides what the work costs had nowhere to go.
 *
 * Two properties matter more than the rest. A resource may never carry a cost,
 * because 0058's guard resets one silently on insert rather than refusing it —
 * so a browser that sent a number would get no error and no effect. And a
 * frozen version has to refuse a resource: RULE-009 freezes the version row and
 * the line, and its children were the way around both.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('building a line the way an estimator does', () => {
  let h: Harness;
  const chief = '11111111-1111-4111-8111-111111111111';
  const outsider = '22222222-2222-4222-8222-222222222222';
  let company = '';
  let version = '';
  let line = '';
  let service = '';

  const save = (kind: string, fields: Record<string, unknown>, id?: string) =>
    h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.save_line_resource($1,$2,$3::jsonb,$4) as id`,
      [line, kind, JSON.stringify(fields), id ?? null])).then(([r]) => r!.id);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, mail] of [[chief, 'c@r.test'], [outsider, 'x@k.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, mail]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, mail]);
    }
    company = (await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    await h.asUser(outsider, () => h.sql(
      `select app.provision_company('Kesler','kesler','enterprise')`));

    const [s] = await h.sql<{ id: string }>(
      `select s.id from services s
        join assembly_components ac on ac.assembly_id = s.default_assembly_id
       where s.company_id is null and s.status = 'active' and s.default_unit = 'CY'
       group by s.id limit 1`);
    service = s!.id;

    const [e] = await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.create_estimate('Berm build', null, null, null, $1) as id`, [company]));
    const [v] = await h.asUser(chief, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [e!.id]));
    version = v!.v;
    line = await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.add_estimate_line($1,$2,null,1837) as id`, [version, service]))
      .then(([r]) => r!.id);
  }, 240_000);

  afterAll(async () => { await h?.db.close(); });

  // ---------------------------------------------------------------- crew
  it('puts a crew on a line, with the wage and the burden kept apart', async () => {
    /*
     * Two figures rather than one loaded rate, so the loaded rate is derived
     * and cannot be contradicted by a third number somebody typed.
     */
    const id = await save('labor', {
      role: 'Operator', description: 'Excavator Operator',
      headcount: 2, base_rate: 40, burden_rate: 15,
      drives_hours: true, production_per_hour: 100,
    });
    const [r] = await h.asUser(chief, () => h.sql<{
      role: string; headcount: number; base: string; burden: string;
      drives: boolean; prod: string; sort: number; cost: string;
    }>(`select role, headcount, base_rate as base, burden_rate as burden,
               drives_hours as drives, production_per_hour as prod,
               sort_order as sort, extended_cost as cost
          from estimate_line_resources where id = $1`, [id]));
    expect(r!.role).toBe('Operator');
    expect(r!.headcount).toBe(2);
    expect(Number(r!.base)).toBe(40);
    expect(Number(r!.burden)).toBe(15);
    expect(r!.drives).toBe(true);
    expect(Number(r!.prod)).toBe(100);
    expect(r!.sort).toBe(10);
    // The cost is the engine's, and nothing here supplied one.
    expect(Number(r!.cost)).toBe(0);
  });

  it('will not take a cost, because sending one would be silently dropped',
    async () => {
      // 0058's guard resets a hand-written engine output on insert rather than
      // refusing it, so a caller would get no error and no effect.
      const id = await save('labor', {
        role: 'Labor', description: 'Laborer', headcount: 1,
        base_rate: 30, burden_rate: 15, extended_cost: 9999,
      });
      const [r] = await h.asUser(chief, () => h.sql<{ cost: string }>(
        `select extended_cost as cost from estimate_line_resources where id = $1`, [id]));
      expect(Number(r!.cost)).toBe(0);
    });

  it('orders resources rather than returning them however the table feels', async () => {
    const rows = await h.asUser(chief, () => h.sql<{ sort: number }>(
      `select sort_order as sort from estimate_line_resources
        where line_item_id = $1 and resource_kind = 'labor' order by sort_order`, [line]));
    expect(rows.map((r) => r.sort)).toEqual([10, 20]);
  });

  // ----------------------------------------------------------- equipment
  it('bills a machine on the basis it is actually rented at', async () => {
    /*
     * An hourly rate and a weekly rate are different numbers with different
     * rounding, and that difference is most of what an equipment line costs.
     */
    const id = await save('equipment', {
      description: 'Dozer D5', rate_basis: 'week', unit_rate: 2650,
      drives_hours: true, production_per_hour: 100,
      mobilization_cost: 600, is_owned: true,
    });
    const [r] = await h.asUser(chief, () => h.sql<{
      basis: string; rate: string; mob: string; owned: boolean;
    }>(`select rate_basis as basis, unit_rate as rate,
               mobilization_cost as mob, is_owned as owned
          from estimate_line_resources where id = $1`, [id]));
    expect(r!.basis).toBe('week');
    expect(Number(r!.rate)).toBe(2650);
    expect(Number(r!.mob)).toBe(600);
    expect(r!.owned).toBe(true);
  });

  it('refuses a rate basis that is not one', async () => {
    await expect(save('equipment', { description: 'Grader', rate_basis: 'fortnight' }))
      .rejects.toThrow();
  });

  // ------------------------------------------------------------- hauling
  it('holds the inputs a haul cycle is computed from, and never the answer',
    async () => {
      /*
       * Storing the cycle time or the load count would be storing a conclusion
       * that goes stale the moment somebody changes the haul distance.
       */
      const id = await save('trucking', {
        description: 'Quad-Axle Dump Truck', haul_mode: 'trip',
        round_trip_miles: 12, average_speed_mph: 25, truck_capacity: 22,
        tons_per_load: 30, load_minutes: 7, dump_minutes: 4, queue_minutes: 10,
        unit_rate: 135, includes_disposal: false,
      });
      const [r] = await h.asUser(chief, () => h.sql<{
        mode: string; miles: string; speed: string; cap: string; load: string;
      }>(`select haul_mode as mode, round_trip_miles as miles,
                 average_speed_mph as speed, truck_capacity as cap,
                 load_minutes as load
            from estimate_line_resources where id = $1`, [id]));
      expect(r!.mode).toBe('trip');
      expect(Number(r!.miles)).toBe(12);
      expect(Number(r!.cap)).toBe(22);

      // And no column exists to store the derived figures in.
      const columns = await h.sql<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_name = 'estimate_line_resources'`);
      const names = columns.map((c) => c.column_name);
      for (const derived of ['cycle_minutes', 'load_count', 'truck_count']) {
        expect(names, `${derived} would be a stored conclusion`).not.toContain(derived);
      }
    });

  it('refuses a trip haul with nothing to compute a cycle from', async () => {
    // It would price as zero and look complete.
    await expect(save('trucking', { description: 'Tri-axle', haul_mode: 'trip' }))
      .rejects.toThrow(/elr_trip_inputs/);
  });

  it('refuses a row that drives the hours without saying at what rate', async () => {
    // A ticked box contributing nothing to the fleet rate silently makes the
    // line take longer than it should.
    await expect(save('equipment', { description: 'Roller', drives_hours: true }))
      .rejects.toThrow(/elr_driver_needs_production/);
  });

  // -------------------------------------------------------------- edits
  it('changes only what was sent', async () => {
    const id = await save('material', {
      description: 'Aggregate base', quantity: 400, unit: 'TON', unit_rate: 22,
    });
    await save('material', { quantity: 550 }, id);
    const [r] = await h.asUser(chief, () => h.sql<{ d: string; q: string; rate: string }>(
      `select description as d, quantity as q, unit_rate as rate
         from estimate_line_resources where id = $1`, [id]));
    expect(Number(r!.q)).toBe(550);
    // Untouched, rather than blanked by a partial send.
    expect(r!.d).toBe('Aggregate base');
    expect(Number(r!.rate)).toBe(22);
  });

  it('deletes one', async () => {
    const id = await save('subcontract', { description: 'Seeding', unit_rate: 4200 });
    await h.asUser(chief, () => h.sql(`select app.delete_line_resource($1)`, [id]));
    const rows = await h.asUser(chief, () => h.sql(
      `select id from estimate_line_resources where id = $1`, [id]));
    expect(rows).toHaveLength(0);
  });

  // ------------------------------------------------------------ the line
  it('records what the customer is allowed to see, and this line\'s own markup',
    async () => {
      await h.asUser(chief, () => h.sql(
        `select app.update_estimate_line($1, '{"client_visible":false,"markup_override":0.30}'::jsonb)`,
        [line]));
      const [r] = await h.asUser(chief, () => h.sql<{ visible: boolean; markup: string }>(
        `select client_visible as visible, markup_override as markup
           from estimate_line_items where id = $1`, [line]));
      expect(r!.visible).toBe(false);
      expect(Number(r!.markup)).toBe(0.30);
    });

  it('lets a line go back to the profile\'s markup', async () => {
    // Null means "use the profile", which somebody chooses on purpose — so it
    // is the one field a partial send may clear.
    await h.asUser(chief, () => h.sql(
      `select app.update_estimate_line($1, '{"markup_override":null}'::jsonb)`, [line]));
    const [r] = await h.asUser(chief, () => h.sql<{ markup: string | null }>(
      `select markup_override as markup from estimate_line_items where id = $1`, [line]));
    expect(r!.markup).toBeNull();
  });

  it('records what the proposal discloses, per cost category', async () => {
    await h.asUser(chief, () => h.sql(
      `select app.update_estimate_version($1,
         '{"show_labor":true,"show_equipment":false}'::jsonb)`, [version]));
    const [r] = await h.asUser(chief, () => h.sql<{ labor: boolean; equip: boolean; mat: boolean }>(
      `select show_labor as labor, show_equipment as equip, show_materials as mat
         from estimate_versions where id = $1`, [version]));
    expect(r!.labor).toBe(true);
    expect(r!.equip).toBe(false);
    // Untouched by a partial send, and still at its default.
    expect(r!.mat).toBe(true);
  });

  it('defaults to not showing a customer what the crew costs', async () => {
    const [e] = await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.create_estimate('Defaults', null, null, null, $1) as id`, [company]));
    const [r] = await h.asUser(chief, () => h.sql<{ labor: boolean; equip: boolean; mat: boolean }>(
      `select v.show_labor as labor, v.show_equipment as equip, v.show_materials as mat
         from estimates e join estimate_versions v on v.id = e.current_version_id
        where e.id = $1`, [e!.id]));
    expect(r!.labor).toBe(false);
    expect(r!.equip).toBe(false);
    // Material and trucking are things a contractor will show.
    expect(r!.mat).toBe(true);
  });

  // ------------------------------------------------------------- refusals
  it('keeps another company out of the line entirely', async () => {
    await expect(h.asUser(outsider, () => h.sql(
      `select app.save_line_resource($1,'labor','{}'::jsonb)`, [line])))
      .rejects.toThrow(/permission/i);
    await expect(h.asUser(outsider, () => h.sql(
      `select app.update_estimate_line($1,'{}'::jsonb)`, [line])))
      .rejects.toThrow(/permission/i);
  });

  it('refuses a resource on a version that has been signed off', async () => {
    /*
     * RULE-009 freezes the version row and the line. Its resources were the way
     * around both — nothing stopped a machine being added to an approved
     * estimate, which would change what it cost without changing its status.
     */
    const lines = await h.sql<{ id: string }>(
      `select id from estimate_line_items where estimate_version_id = $1`, [version]);
    await h.asService(() => h.sql(
      `select app.record_engine_result($1,'test-1.0.0',
         jsonb_build_object('total_price', 90000, 'bid_price', 90000,
                            'blocked_from_issue', false), $2::jsonb)`,
      [version, JSON.stringify(lines.map((l) => ({
        id: l.id, total_direct_cost: 900, blocks_issue: false })))]));
    await h.asUser(chief, () => h.sql(
      `select app.set_estimate_status($1,'approved')`, [version]));

    await expect(save('labor', { role: 'Operator', headcount: 1 }))
      .rejects.toThrow(/make a new version/);
    await expect(h.asUser(chief, () => h.sql(
      `select app.update_estimate_line($1,'{"measured_quantity":99}'::jsonb)`, [line])))
      .rejects.toThrow(/make a new version/);
    await expect(h.asUser(chief, () => h.sql(
      `select app.update_estimate_version($1,'{"show_labor":true}'::jsonb)`, [version])))
      .rejects.toThrow(/make a new version/);
  });
});

/**
 * Markup on this bid rather than on the company.
 *
 * `markup_components` hangs off a pricing profile, which is right for a
 * standard and wrong for a bond that applies to one job. An estimator had two
 * options and both were bad: edit the company profile and move every other open
 * estimate, or make a profile per bid.
 */
describe('adjusting the markup on one bid', () => {
  let h: Harness;
  const chief = '11111111-1111-4111-8111-111111111111';
  const outsider = '22222222-2222-4222-8222-222222222222';
  let company = '';
  let version = '';

  const set = (code: string, fields: Record<string, unknown>) =>
    h.asUser(chief, () => h.sql(
      `select app.set_estimate_markup($1,$2,$3::jsonb)`,
      [version, code, JSON.stringify(fields)]));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, mail] of [[chief, 'c@r.test'], [outsider, 'x@k.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, mail]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, mail]);
    }
    company = (await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    await h.asUser(outsider, () => h.sql(
      `select app.provision_company('Kesler','kesler','enterprise')`));

    const [e] = await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.create_estimate('Bonded job', null, null, null, $1) as id`, [company]));
    version = (await h.asUser(chief, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [e!.id])))[0]!.v;
  }, 240_000);

  afterAll(async () => { await h?.db.close(); });

  it('starts a bid from the company standard', async () => {
    const [n] = await h.asUser(chief, () => h.sql<{ n: number }>(
      `select app.adopt_profile_markups($1) as n`, [version]));
    // 0011 seeds overhead, profit and contingency on a new company's profile.
    expect(n!.n).toBe(3);
    const rows = await h.asUser(chief, () => h.sql<{ code: string }>(
      `select code from estimate_version_markups where estimate_version_id = $1
        order by sequence`, [version]));
    expect(rows.map((r) => r.code)).toEqual(['OH', 'PROFIT', 'CONT']);
  });

  it('refuses to copy over adjustments somebody already made', async () => {
    // Overwriting an estimator's work with the defaults is the worst thing
    // this could do.
    await expect(h.asUser(chief, () => h.sql(
      `select app.adopt_profile_markups($1)`, [version])))
      .rejects.toThrow(/already has its own adjustments/);
  });

  it('adds a bond charged on the marked-up total', async () => {
    /*
     * Bond and tax are charged on the marked-up total and apply in a second
     * pass; overhead and profit apply together against cost. Getting that
     * backwards is a few percent on every bonded bid.
     */
    await set('BOND', { label: 'Bond', percent: 0.05, basis: 'marked_up_total', sequence: 40 });
    const [r] = await h.asUser(chief, () => h.sql<{ basis: string; pct: string }>(
      `select basis, percent as pct from estimate_version_markups
        where estimate_version_id = $1 and code = 'BOND'`, [version]));
    expect(r!.basis).toBe('marked_up_total');
    expect(Number(r!.pct)).toBe(0.05);
  });

  it('changes a rate rather than adding a second one', async () => {
    // A second TAX row would be applied twice, which only shows up on the
    // invoice.
    await set('TAX', { percent: 0.073, basis: 'marked_up_total', sequence: 50 });
    await set('TAX', { percent: 0.065 });
    const rows = await h.asUser(chief, () => h.sql<{ pct: string }>(
      `select percent as pct from estimate_version_markups
        where estimate_version_id = $1 and code = 'TAX'`, [version]));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.pct)).toBe(0.065);
    // And the untouched fields survive a partial change.
    const [r] = await h.asUser(chief, () => h.sql<{ basis: string }>(
      `select basis from estimate_version_markups
        where estimate_version_id = $1 and code = 'TAX'`, [version]));
    expect(r!.basis).toBe('marked_up_total');
  });

  it('switches one off without losing the rate', async () => {
    await set('BOND', { enabled: false });
    const [r] = await h.asUser(chief, () => h.sql<{ enabled: boolean; pct: string }>(
      `select enabled, percent as pct from estimate_version_markups
        where estimate_version_id = $1 and code = 'BOND'`, [version]));
    expect(r!.enabled).toBe(false);
    // Off, not gone: switching it back on during a negotiation should not lose
    // the rate somebody looked up.
    expect(Number(r!.pct)).toBe(0.05);
  });

  it('leaves the company profile alone', async () => {
    /*
     * The whole point. Adjusting this bid must not move every other open
     * estimate, which is what editing the profile would have done.
     */
    const rows = await h.asUser(chief, () => h.sql<{ code: string; pct: string }>(
      `select m.code, m.percent as pct from markup_components m
         join pricing_profiles p on p.id = m.pricing_profile_id
        where p.company_id = $1 order by m.sequence`, [company]));
    expect(rows.map((r) => r.code)).toEqual(['OH', 'PROFIT', 'CONT']);
    expect(rows.every((r) => r.code !== 'BOND' && r.code !== 'TAX')).toBe(true);
  });

  it('normalizes the code, so tax and TAX are the same adjustment', async () => {
    await set('tax', { percent: 0.06 });
    const rows = await h.asUser(chief, () => h.sql(
      `select code from estimate_version_markups
        where estimate_version_id = $1 and code = 'TAX'`, [version]));
    expect(rows).toHaveLength(1);
  });

  it('refuses a rate nobody could mean', async () => {
    await expect(set('OH', { percent: 9 })).rejects.toThrow();
  });

  it('removes one', async () => {
    await h.asUser(chief, () => h.sql(
      `select app.remove_estimate_markup($1,'BOND')`, [version]));
    const rows = await h.asUser(chief, () => h.sql(
      `select code from estimate_version_markups
        where estimate_version_id = $1 and code = 'BOND'`, [version]));
    expect(rows).toHaveLength(0);
  });

  it('keeps another company out', async () => {
    await expect(h.asUser(outsider, () => h.sql(
      `select app.set_estimate_markup($1,'OH','{"percent":0.5}'::jsonb)`, [version])))
      .rejects.toThrow(/permission/i);
  });

  it('refuses an adjustment on a version that has gone out', async () => {
    const [e] = await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.create_estimate('Frozen', null, null, null, $1) as id`, [company]));
    const [v] = await h.asUser(chief, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [e!.id]));
    /*
     * A bid that was lost, rather than an approved one: 0026 refuses to mark a
     * version approved without a library snapshot, and faking one to test a
     * different rule would be working around a guard that is doing its job.
     */
    await h.sql(`update estimate_versions set status = 'lost' where id = $1`, [v!.v]);
    await expect(h.asUser(chief, () => h.sql(
      `select app.set_estimate_markup($1,'TAX','{"percent":0.05}'::jsonb)`, [v!.v])))
      .rejects.toThrow(/make a new version/);
  });
});
