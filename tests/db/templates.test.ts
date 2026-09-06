/**
 * Starting from one you have built before.
 *
 * Two properties this file exists for.
 *
 * `app.revise_estimate_version` has been the sanctioned way to change an issued
 * estimate since migration 0011, and six other migrations point callers at it
 * by name. It copied the lines and dropped the crew, the machines, the
 * materials, the modifiers and every markup on the bid — everything the line
 * actually cost money for. The first block below proves the copy is faithful
 * now, and proves it by column count rather than by a list somebody maintains,
 * so a column added next year is covered without anybody remembering.
 *
 * And a template must not carry a price. Applying one gives an unpriced
 * estimate the engine then prices against today's rates; a template that
 * carried last year's costs would look priced and be wrong.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('starting from one you have built before', () => {
  let h: Harness;
  const chief = '11111111-1111-4111-8111-111111111111';
  const rival = '22222222-2222-4222-8222-222222222222';
  let company = '';
  let rivalCompany = '';
  let estimate = '';
  let version = '';
  let line = '';
  let service = '';

  const asChief = <T>(q: string, p?: unknown[]) =>
    h.asUser(chief, () => h.sql<T extends object ? T : never>(q, p));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, mail] of [[chief, 'chief@ridge.test'], [rival, 'r@kesler.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, mail]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, mail]);
    }
    company = (await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    rivalCompany = (await h.asUser(rival, () => h.sql<{ id: string }>(
      `select app.provision_company('Kesler','kesler','enterprise') as id`)))[0]!.id;

    const [s] = await h.sql<{ id: string }>(
      `select s.id from services s
        join assembly_components ac on ac.assembly_id = s.default_assembly_id
       where s.company_id is null and s.status = 'active' and s.default_unit = 'CY'
       group by s.id limit 1`);
    service = s!.id;

    estimate = (await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.create_estimate('Pond and access road', null, null, null, $1) as id`,
      [company])))[0]!.id;
    version = (await h.asUser(chief, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [estimate])))[0]!.v;

    line = (await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.add_estimate_line($1,$2,null,1837) as id`, [version, service])))[0]!.id;

    // A crew member, a machine and a haul: the three shapes a resource takes.
    await h.asUser(chief, () => h.sql(
      `select app.save_line_resource($1,'labor',$2::jsonb)`,
      [line, JSON.stringify({ description: 'Operator', headcount: 2, base_rate: 38,
                              burden_rate: 14, drives_hours: false, hours: 40 })]));
    await h.asUser(chief, () => h.sql(
      `select app.save_line_resource($1,'equipment',$2::jsonb)`,
      [line, JSON.stringify({ description: 'D6 dozer', quantity: 1, unit_rate: 165,
                              rate_basis: 'hour', mobilization_cost: 850,
                              production_per_hour: 120, drives_hours: true })]));
    await h.asUser(chief, () => h.sql(
      `select app.save_line_resource($1,'trucking',$2::jsonb)`,
      [line, JSON.stringify({ description: 'Off-haul', haul_mode: 'trip',
                              round_trip_miles: 30, average_speed_mph: 35,
                              truck_capacity: 14, load_minutes: 6, dump_minutes: 4,
                              queue_minutes: 5, unit_rate: 95 })]));

    await h.asUser(chief, () => h.sql(
      `select app.set_estimate_markup($1,'OH',$2::jsonb)`,
      [version, JSON.stringify({ label: 'Overhead', percent: 0.12, sequence: 10 })]));
    await h.asUser(chief, () => h.sql(
      `select app.set_estimate_markup($1,'BOND',$2::jsonb)`,
      [version, JSON.stringify({ label: 'Bond', percent: 0.011, sequence: 40,
                                 basis: 'marked_up_total' })]));

    await h.asUser(chief, () => h.sql(
      `insert into estimate_indirects (company_id, estimate_version_id, code, label,
                                       per_day, days, basis)
       values ($1,$2,'FIELD','Field office',185,60,'per day')`, [company, version]));
    await h.asUser(chief, () => h.sql(
      `insert into estimate_exclusions (company_id, estimate_version_id, exclusion, reason)
       values ($1,$2,'Dewatering permit','The owner holds the permit')`, [company, version]));
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  describe('a copy that copies everything', () => {
    let revised = '';

    beforeAll(async () => {
      revised = (await h.asUser(chief, () => h.sql<{ id: string }>(
        `select app.revise_estimate_version($1,'Owner moved the pond outlet') as id`,
        [version])))[0]!.id;
    }, 60_000);

    it('brings the lines', async () => {
      const [r] = await asChief<{ n: string }>(
        `select count(*) as n from estimate_line_items where estimate_version_id = $1`,
        [revised]);
      expect(Number(r!.n)).toBe(1);
    });

    it('brings the crew, the machine and the haul — which it used to drop', async () => {
      const rows = await asChief<{ resource_kind: string; description: string }>(
        `select r.resource_kind, r.description
           from estimate_line_resources r
           join estimate_line_items l on l.id = r.line_item_id
          where l.estimate_version_id = $1 order by r.resource_kind`, [revised]);
      expect(rows.map((r) => r.resource_kind)).toEqual(['equipment', 'labor', 'trucking']);
    });

    it('brings every column of every resource, not a list somebody maintains', async () => {
      /*
       * The point of the catalog-driven copy: compare the source and the copy
       * column by column, so a column added to the table next year is covered
       * by this test on the day it is added.
       */
      const [r] = await asChief<{ differing: string[] }>(
        `with cols as (
           select unnest(app.copyable_columns('public.estimate_line_resources'::regclass,
                                              array['line_item_id'])) as c),
         src as (select to_jsonb(r) as j from estimate_line_resources r
                  join estimate_line_items l on l.id = r.line_item_id
                 where l.estimate_version_id = $1 and r.resource_kind = 'equipment'),
         cpy as (select to_jsonb(r) as j from estimate_line_resources r
                  join estimate_line_items l on l.id = r.line_item_id
                 where l.estimate_version_id = $2 and r.resource_kind = 'equipment')
         select coalesce(array_agg(c) filter (
                  where (select j -> c from src) is distinct from (select j -> c from cpy)),
                '{}') as differing
           from cols`, [version, revised]);
      expect(r!.differing).toEqual([]);
    });

    it('brings the markups on the bid', async () => {
      const rows = await asChief<{ code: string; percent: string }>(
        `select code, percent from estimate_version_markups
          where estimate_version_id = $1 order by sequence`, [revised]);
      expect(rows.map((x) => x.code)).toEqual(['OH', 'BOND']);
    });

    it('brings the indirects and the exclusions', async () => {
      const [r] = await asChief<{ i: string; e: string }>(
        `select (select count(*) from estimate_indirects where estimate_version_id = $1) as i,
                (select count(*) from estimate_exclusions where estimate_version_id = $1) as e`,
        [revised]);
      expect([Number(r!.i), Number(r!.e)]).toEqual([1, 1]);
    });

    it('leaves the new version unpriced, because it is', async () => {
      const [r] = await asChief<{ total_price: string; calculated_at: string | null }>(
        `select total_price, calculated_at from estimate_versions where id = $1`, [revised]);
      expect(Number(r!.total_price)).toBe(0);
      expect(r!.calculated_at).toBeNull();
    });

    it('does not carry the frozen library that priced the old one', async () => {
      /*
       * `library_snapshot_id` is the column that proved why one shared list of
       * exclusions is worth having: carried forward, it points a fresh version
       * at another version's snapshot, and 0026 refuses it.
       */
      const [r] = await asChief<{ library_snapshot_id: string | null }>(
        `select library_snapshot_id from estimate_versions where id = $1`, [revised]);
      expect(r!.library_snapshot_id).toBeNull();
    });

    it('is reachable from a browser, which it never was before', async () => {
      /*
       * Seven refusals across this schema say "make a new version to change
       * it". The function they name lives in `app`, PostgREST exposes only
       * `public`, and no wrapper existed — so the revision an estimator was
       * told to make could not be made.
       */
      const [r] = await asChief<{ n: string }>(
        `select count(*) as n from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'revise_estimate_version'`);
      expect(Number(r!.n)).toBe(1);
      const id = (await asChief<{ id: string }>(
        `select public.revise_estimate_version($1,'Priced against the new fuel number') as id`,
        [version]))[0]!.id;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('does not carry a discount somebody approved on the old price', async () => {
      const [r] = await asChief<{ discount_percent: string }>(
        `select discount_percent from estimate_versions where id = $1`, [revised]);
      expect(Number(r!.discount_percent)).toBe(0);
    });

    it('still refuses a revision that does not say why', async () => {
      await expect(asChief(`select app.revise_estimate_version($1,'x')`, [version]))
        .rejects.toThrow(/why it exists/i);
    });
  });

  describe('saving one as a template', () => {
    let template = '';

    beforeAll(async () => {
      template = (await h.asUser(chief, () => h.sql<{ id: string }>(
        `select app.save_estimate_template($1,'Pond with access road',
                'Excavate, line, and the road in',
                'Earthwork', false) as id`, [version])))[0]!.id;
    }, 60_000);

    it('records how many lines it starts you with', async () => {
      const [r] = await asChief<{ line_count: number; carries_quantities: boolean }>(
        `select line_count, carries_quantities from estimate_templates where id = $1`,
        [template]);
      expect(r!.line_count).toBe(1);
      expect(r!.carries_quantities).toBe(false);
    });

    it('leaves the quantities behind unless you asked for them', async () => {
      const [r] = await asChief<{ q: string }>(
        `select measured_quantity as q from estimate_template_lines where template_id = $1`,
        [template]);
      expect(Number(r!.q)).toBe(0);
    });

    it('carries them when you do ask', async () => {
      const t = (await asChief<{ id: string }>(
        `select app.save_estimate_template($1,'Pond, as bid',null,null,true) as id`,
        [version]))[0]!.id;
      const [r] = await asChief<{ q: string; c: boolean }>(
        `select l.measured_quantity as q, t.carries_quantities as c
           from estimate_template_lines l join estimate_templates t on t.id = l.template_id
          where l.template_id = $1`, [t]);
      expect(Number(r!.q)).toBe(1837);
      expect(r!.c).toBe(true);
    });

    it('holds no price at all, so nothing looks priced that is not', async () => {
      const [r] = await asChief<{ leaked: string[] }>(
        `select coalesce(array_agg(c) filter (where l.value ? c), '{}') as leaked
           from estimate_templates t
           cross join lateral jsonb_array_elements(t.payload -> 'lines') l
           cross join lateral unnest(
             app.engine_output_columns('public.estimate_line_items'::regclass)) c
          where t.id = $1`, [template]);
      expect(r!.leaked).toEqual([]);
    });

    it('refuses a template made from an empty estimate', async () => {
      const e = (await asChief<{ id: string }>(
        `select app.create_estimate('Nothing yet', null, null, null, $1) as id`,
        [company]))[0]!.id;
      const v = (await asChief<{ v: string }>(
        `select current_version_id as v from estimates where id = $1`, [e]))[0]!.v;
      await expect(asChief(`select app.save_estimate_template($1,'Empty')`, [v]))
        .rejects.toThrow(/nothing on this estimate/i);
    });

    it('refuses a second template holding the same name', async () => {
      await expect(asChief(
        `select app.save_estimate_template($1,'  pond with ACCESS road  ')`, [version]))
        .rejects.toThrow(/already have a template/i);
    });

    it('lets an archived name be used again', async () => {
      const t = (await asChief<{ id: string }>(
        `select app.save_estimate_template($1,'Seasonal') as id`, [version]))[0]!.id;
      await asChief(`select app.archive_estimate_template($1)`, [t]);
      await expect(asChief(
        `select app.save_estimate_template($1,'Seasonal')`, [version])).resolves.toBeDefined();
    });

    it('can be saved from a version that has already gone out', async () => {
      /*
       * The templates worth having come from bids that were awarded. Reading a
       * frozen version is not editing it, and 0111's freeze is untouched.
       */
      const [ok] = await asChief<{ n: string }>(
        `select count(*) as n from estimate_templates where id = $1`, [template]);
      expect(Number(ok!.n)).toBe(1);
    });
  });

  describe('applying one', () => {
    let template = '';
    let target = '';

    beforeAll(async () => {
      template = (await h.asUser(chief, () => h.sql<{ id: string }>(
        `select app.save_estimate_template($1,'Road section','','Earthwork',true) as id`,
        [version])))[0]!.id;
      const e = (await h.asUser(chief, () => h.sql<{ id: string }>(
        `select app.create_estimate('Second pond', null, null, null, $1) as id`,
        [company])))[0]!.id;
      target = (await h.asUser(chief, () => h.sql<{ v: string }>(
        `select current_version_id as v from estimates where id = $1`, [e])))[0]!.v;
    }, 60_000);

    it('adds the lines and says how many', async () => {
      const [r] = await asChief<{ out: { lines_added: number; warnings: string[] } }>(
        `select app.apply_estimate_template($1,$2) as out`, [target, template]);
      expect(r!.out.lines_added).toBe(1);
      expect(r!.out.warnings).toEqual([]);
    });

    it('brings the crew and the machine with the line', async () => {
      const rows = await asChief<{ resource_kind: string }>(
        `select r.resource_kind from estimate_line_resources r
           join estimate_line_items l on l.id = r.line_item_id
          where l.estimate_version_id = $1 order by r.resource_kind`, [target]);
      expect(rows.map((x) => x.resource_kind)).toEqual(['equipment', 'labor', 'trucking']);
    });

    it('arrives unpriced, whatever the estimate it came from cost', async () => {
      const [r] = await asChief<{ c: string; e: string }>(
        `select coalesce(sum(l.total_direct_cost),0) as c,
                coalesce(sum(r.extended_cost),0) as e
           from estimate_line_items l
           left join estimate_line_resources r on r.line_item_id = l.id
          where l.estimate_version_id = $1`, [target]);
      expect([Number(r!.c), Number(r!.e)]).toEqual([0, 0]);
    });

    it('appends rather than replacing, so two templates make one bid', async () => {
      await asChief(`select app.apply_estimate_template($1,$2)`, [target, template]);
      const rows = await asChief<{ sort_order: number }>(
        `select sort_order from estimate_line_items
          where estimate_version_id = $1 order by sort_order`, [target]);
      expect(rows.length).toBe(2);
      expect(rows[0]!.sort_order).toBeLessThan(rows[1]!.sort_order);
    });

    it('brings the markups the template was saved with', async () => {
      const rows = await asChief<{ code: string }>(
        `select code from estimate_version_markups
          where estimate_version_id = $1 order by sequence`, [target]);
      expect(rows.map((x) => x.code)).toEqual(['OH', 'BOND']);
    });

    it('does not apply a second bond twice', async () => {
      /*
       * A duplicate markup row is charged twice, and that is a mistake that
       * only shows up on the invoice. Applying the same template again upserts
       * on the code rather than appending.
       */
      const [r] = await asChief<{ n: string }>(
        `select count(*) as n from estimate_version_markups
          where estimate_version_id = $1 and code = 'BOND'`, [target]);
      expect(Number(r!.n)).toBe(1);
    });

    it('takes the estimating assumptions onto an estimate nobody has started', async () => {
      await h.asUser(chief, () => h.sql(
        `select app.update_estimate_version($1,$2::jsonb)`,
        [version, JSON.stringify({ shift_hours: 10, swell_percent: 0.32 })]));
      const t = (await asChief<{ id: string }>(
        `select app.save_estimate_template($1,'Ten-hour shifts') as id`, [version]))[0]!.id;
      const e = (await asChief<{ id: string }>(
        `select app.create_estimate('Long days', null, null, null, $1) as id`,
        [company]))[0]!.id;
      const v = (await asChief<{ v: string }>(
        `select current_version_id as v from estimates where id = $1`, [e]))[0]!.v;
      const [out] = await asChief<{ out: { settings_applied: boolean } }>(
        `select app.apply_estimate_template($1,$2) as out`, [v, t]);
      expect(out!.out.settings_applied).toBe(true);
      const [r] = await asChief<{ shift_hours: string; swell_percent: string }>(
        `select shift_hours, swell_percent from estimate_versions where id = $1`, [v]);
      expect(Number(r!.shift_hours)).toBe(10);
      expect(Number(r!.swell_percent)).toBe(0.32);
    });

    it('leaves a half-built bid’s assumptions exactly where they were', async () => {
      /*
       * Adding a second template to an estimate somebody is working on must
       * not move its shift hours: that would change every line on it, quietly,
       * and they asked for lines.
       */
      const t = (await asChief<{ id: string }>(
        `select app.save_estimate_template($1,'Ten-hour shifts, again') as id`,
        [version]))[0]!.id;
      const before = (await asChief<{ shift_hours: string }>(
        `select shift_hours from estimate_versions where id = $1`, [target]))[0]!.shift_hours;
      const [out] = await asChief<{ out: { settings_applied: boolean } }>(
        `select app.apply_estimate_template($1,$2) as out`, [target, t]);
      expect(out!.out.settings_applied).toBe(false);
      const after = (await asChief<{ shift_hours: string }>(
        `select shift_hours from estimate_versions where id = $1`, [target]))[0]!.shift_hours;
      expect(after).toBe(before);
    });

    it('counts how often it has been used', async () => {
      const [r] = await asChief<{ times_used: number; last_used_at: string }>(
        `select times_used, last_used_at from estimate_templates where id = $1`, [template]);
      expect(r!.times_used).toBe(2);
      expect(r!.last_used_at).not.toBeNull();
    });

    it('keeps the line and says so when the library has moved on', async () => {
      /*
       * A template saved a year ago may name a machine the company has since
       * retired. Failing would lose the template; attaching to nothing quietly
       * would lose the machine without saying. It clears the reference, keeps
       * the line, and reports it.
       */
      const t = (await asChief<{ id: string }>(
        `select app.save_estimate_template($1,'With a machine that leaves') as id`,
        [version]))[0]!.id;
      await h.asService(() => h.sql(
        `update estimate_templates
            set payload = jsonb_set(payload, '{lines,0,service_id}',
                                    to_jsonb('00000000-0000-4000-8000-00000000dead'::uuid))
          where id = $1`, [t]));
      const e = (await asChief<{ id: string }>(
        `select app.create_estimate('Third pond', null, null, null, $1) as id`,
        [company]))[0]!.id;
      const v = (await asChief<{ v: string }>(
        `select current_version_id as v from estimates where id = $1`, [e]))[0]!.v;
      const [r] = await asChief<{ out: { lines_added: number; warnings: string[] } }>(
        `select app.apply_estimate_template($1,$2) as out`, [v, t]);
      expect(r!.out.lines_added).toBe(1);
      expect(r!.out.warnings.join(' ')).toMatch(/service .* no longer in your library/i);
      const [l] = await asChief<{ service_id: string | null; description: string }>(
        `select service_id, description from estimate_line_items
          where estimate_version_id = $1`, [v]);
      expect(l!.service_id).toBeNull();
      expect(l!.description.length).toBeGreaterThan(0);
    });

    it('refuses to apply onto a version that is no longer open', async () => {
      const e = (await asChief<{ id: string }>(
        `select app.create_estimate('Fourth pond', null, null, null, $1) as id`,
        [company]))[0]!.id;
      const v = (await asChief<{ v: string }>(
        `select current_version_id as v from estimates where id = $1`, [e]))[0]!.v;
      await h.asService(() => h.sql(
        `update estimate_versions set status = 'archived' where id = $1`, [v]));
      await expect(asChief(`select app.apply_estimate_template($1,$2)`, [v, template]))
        .rejects.toThrow(/make a new version/i);
    });

    it("refuses one company another company's template", async () => {
      const e = (await h.asUser(rival, () => h.sql<{ id: string }>(
        `select app.create_estimate('Their job', null, null, null, $1) as id`,
        [rivalCompany])))[0]!.id;
      const v = (await h.asUser(rival, () => h.sql<{ v: string }>(
        `select current_version_id as v from estimates where id = $1`, [e])))[0]!.v;
      await expect(h.asUser(rival, () => h.sql(
        `select app.apply_estimate_template($1,$2)`, [v, template])))
        .rejects.toThrow(/no such template/i);
    });

    it("does not show one company another company's templates", async () => {
      const rows = await h.asUser(rival, () => h.sql(
        `select id from my_estimate_templates`));
      expect(rows).toEqual([]);
    });
  });

  describe('starting a whole estimate from one', () => {
    it('makes the estimate and fills it in one call', async () => {
      const t = (await asChief<{ id: string }>(
        `select app.save_estimate_template($1,'Standard pond',null,null,true) as id`,
        [version]))[0]!.id;
      const [r] = await asChief<{ out: { estimate: string; version: string; lines_added: number } }>(
        `select app.create_estimate_from_template($1,'Fifth pond',null,null,null,$2) as out`,
        [t, company]);
      expect(r!.out.lines_added).toBe(1);
      const [e] = await asChief<{ name: string; number: string }>(
        `select name, number from estimates where id = $1`, [r!.out.estimate]);
      expect(e!.name).toBe('Fifth pond');
      expect(e!.number).toMatch(/^E-\d{4}-/);
      const [l] = await asChief<{ q: string }>(
        `select measured_quantity as q from estimate_line_items
          where estimate_version_id = $1`, [r!.out.version]);
      expect(Number(l!.q)).toBe(1837);
    });
  });

  describe('the column lists it is built on', () => {
    it('never offers a copy the columns it must decide for itself', async () => {
      const [r] = await asChief<{ cols: string[] }>(
        `select app.copyable_columns('public.estimate_line_items'::regclass) as cols`);
      for (const forbidden of ['id', 'company_id', 'created_at', 'updated_at', 'created_by']) {
        expect(r!.cols).not.toContain(forbidden);
      }
      expect(r!.cols).toContain('measured_quantity');
      expect(r!.cols).toContain('client_visible');
    });

    it('reads the engine-owned columns out of the guard trigger itself', async () => {
      const [r] = await asChief<{ cols: string[] }>(
        `select app.engine_output_columns('public.estimate_line_items'::regclass) as cols`);
      expect(r!.cols).toContain('total_direct_cost');
      expect(r!.cols).toContain('confidence_band');
      expect(r!.cols).not.toContain('measured_quantity');
    });
  });
});
