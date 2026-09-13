/**
 * The library that was in a spreadsheet.
 *
 * The suggestion machinery has been complete since 0126 and shows nothing, for
 * every service, and the reason was never the code: every one of the 8,142
 * `assembly_components` in the shipped catalog is `component_kind = 'task'`.
 * There is not one labor, equipment or material component in the whole library,
 * so the query cannot return a row however it is asked.
 *
 * The GES Phase 05 entity catalog says what an assembly component is meant to
 * be — "Labor, equipment, material, subcontract or other component" — and the
 * data was in `3rd_Terrain_Estimating_Workbook.xlsx` the whole time, in two
 * columns headed Suggested Crew and Suggested Equipment.
 *
 * These hold the install and, more importantly, the thing it exists for: that
 * picking a service now tells you what it takes.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '77777777-7777-4777-8777-777777777777';

describe('installing the earthwork starter library', () => {
  let h: Harness;
  let company = '';
  let installed: {
    crews: number; machines: number; assemblies: number; components: number; rates: number;
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@ridge.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@ridge.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridge Civil','ridge-civil','enterprise') as id`)))[0]!.id;
    installed = (await h.asUser(OWNER, () => h.sql<typeof installed>(
      `select * from app.install_earthwork_starter_library($1)`, [company])))[0]!;
  });

  it('installs the crews, machines, assemblies and rates', () => {
    expect(installed.crews).toBe(7);
    expect(installed.machines).toBe(9);
    expect(installed.assemblies).toBe(59);
    expect(installed.rates).toBe(47);
    // The thing the catalog never had: components that are resources.
    expect(installed.components).toBeGreaterThan(100);
  });

  it('files everything under a category the company actually offers', async () => {
    /*
     * The first attempt was refused with "Earthwork is not one of your crew
     * discipline options", which is the category governance working. The
     * install adds the words before it files anything under them.
     */
    const rows = await h.asUser(OWNER, () => h.sql<{ name: string; mine: boolean }>(
      `select name, company_id is not null as mine from library_categories
        where kind = 'crew_discipline'
          and (company_id = $1 or company_id is null) and status = 'active'
        order by name`, [company]));
    const names = rows.map((r) => r.name);
    for (const d of ['Earthwork', 'Utilities', 'Trucking', 'General']) {
      expect(names).toContain(d);
    }
    /*
     * And no duplicates of the platform's own words. `add_library_category`
     * returns an existing category rather than creating a second one, which is
     * what keeps one name for one thing when a library is imported.
     */
    expect(new Set(names).size).toBe(names.length);
  });

  it('makes a service say what it takes', async () => {
    // The whole point. Before this, every service returned nothing.
    const [svc] = await h.asUser(OWNER, () => h.sql<{ id: string; asm: string }>(
      `select id, default_assembly_id as asm from services
        where company_id = $1 and name = 'General Excavation - Common Earth'`, [company]));
    expect(svc!.asm).toBeTruthy();

    const [est] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.create_estimate('Starter', null, null, null, $1) as id`, [company]));
    const [ver] = await h.asUser(OWNER, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [est!.id]));
    const [line] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.add_estimate_line($1,$2,null,8400,'CY') as id`, [ver!.v, svc!.id]));

    const sug = await h.asUser(OWNER, () => h.sql<{
      resource_kind: string; name: string; quantity: string; extended_cost: string;
    }>(`select resource_kind, name, quantity, extended_cost
          from my_line_resource_suggestions where line_item_id = $1
         order by resource_kind, name`, [line!.id]));

    expect(sug.length).toBeGreaterThan(0);
    expect(sug.some((s) => s.resource_kind === 'labor')).toBe(true);
    expect(sug.some((s) => s.resource_kind === 'equipment')).toBe(true);
    // 800 CY a day over an eight hour shift is 0.01 hours a cubic yard; two
    // operators on Excavation Crew B is 0.02, so 8,400 CY is 168 man-hours.
    const labor = sug.filter((s) => s.resource_kind === 'labor')
      .reduce((a, s) => a + Number(s.quantity), 0);
    expect(labor).toBeCloseTo(168, 0);
  });

  it('carries a rate measured in another unit as a note rather than converting it', async () => {
    /*
     * Strip topsoil is measured per acre and rated in cubic yards. That rate
     * cannot turn an acre into hours, so it is not installed as one.
     */
    const [svc] = await h.asUser(OWNER, () => h.sql<{ description: string }>(
      `select description from services
        where company_id = $1 and name = 'Strip Topsoil (4")'`, [company]));
    expect(svc!.description).toMatch(/different unit/i);

    const rates = await h.asUser(OWNER, () => h.sql(
      `select 1 from production_rates
        where company_id = $1 and code = 'PR-3T-STRIP-TOPSOIL-4'`, [company]));
    expect(rates).toHaveLength(0);
  });

  it('installs rates as historical, because nobody has measured them yet', async () => {
    const rows = await h.asUser(OWNER, () => h.sql<{ source_type: string }>(
      `select distinct source_type from production_rates where company_id = $1`, [company]));
    expect(rows.map((r) => r.source_type)).toEqual(['company_historical']);
  });

  it('runs twice without doubling anything', async () => {
    const again = (await h.asUser(OWNER, () => h.sql<typeof installed>(
      `select * from app.install_earthwork_starter_library($1)`, [company])))[0]!;
    expect(again.assemblies).toBe(59);
    const [count] = await h.asUser(OWNER, () => h.sql<{ n: string }>(
      `select count(*) as n from services where company_id = $1`, [company]));
    expect(Number(count!.n)).toBe(59);
  });

  it('refuses somebody without permission to change the library', async () => {
    const STRANGER = '78787878-7878-4878-8878-787878787878';
    await h.sql(`insert into auth.users (id, email) values ($1,'s@other.test')`, [STRANGER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'s@other.test')
                 on conflict (id) do nothing`, [STRANGER]);
    await expect(h.asUser(STRANGER, () => h.sql(
      `select * from app.install_earthwork_starter_library($1)`, [company])))
      .rejects.toThrow(/permission/i);
  });
});
