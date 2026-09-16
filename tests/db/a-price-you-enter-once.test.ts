/**
 * A price you enter once.
 *
 * Found by the owner pricing a real line and getting $0.00.
 *
 * `app.line_resource_suggestions` (0126) reads `assembly_components` where the
 * kind is labor, equipment, material or trucking. The shipped catalog inserts
 * only `'task'` rows — seventeen statements, all of them — so all 2,545 shipped
 * services describe what work happens and carry nothing that costs money. Every
 * one prices at zero, on every company.
 *
 * Nothing here seeds a price. What was missing was the way to keep one: an
 * estimator could build a line up by hand and the catalog learned nothing, so
 * the same crew was rebuilt on every estimate that touched the same work.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '2b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b';

describe('a price you enter once', () => {
  let h: Harness;
  let company = '';
  let service = '';
  let assembly = '';
  let laborRate = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@lib.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@lib.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Lib Civil','lib-civil','enterprise') as id`)))[0]!.id;

    laborRate = (await h.asService(() => h.sql<{ id: string }>(
      `insert into labor_rates (company_id, code, classification, base_wage_per_hour,
         burden_percent, status, origin, approved_by, approved_at)
       values ($1,'LR-OPR','Operator', 40, 0.5,'active','company',$2, now())
       returning id`, [company, OWNER])))[0]!.id;

    /* A company service with its own assembly, so the guard from 0129 lets it through. */
    assembly = (await h.asService(() => h.sql<{ id: string }>(
      `insert into assemblies (company_id, code, name, assembly_type, quantity_unit,
         status, origin, approved_by, approved_at)
       values ($1,'ASM-OWN','Aggregate base — company','Standard','TON'::app.unit_code,
         'active','company',$2, now()) returning id`, [company, OWNER])))[0]!.id;
    service = (await h.asService(() => h.sql<{ id: string }>(
      `insert into services (company_id, code, name, default_unit, supported_units,
         default_assembly_id, status, origin, approved_by, approved_at)
       values ($1,'SVC-OWN','Aggregate base','TON'::app.unit_code,
         array['TON']::app.unit_code[], $2,
         'active','company',$3, now()) returning id`, [company, assembly, OWNER])))[0]!.id;
    await h.asService(() => h.sql(
      `update assemblies set service_id = $1 where id = $2`, [service, assembly]));
  });

  it('says a shipped service cannot price, before anything is priced', async () => {
    const [row] = await h.asUser(OWNER, () => h.sql<{
      can_price: boolean; task_components: string; costed_components: string; name: string;
    }>(`select can_price, task_components, costed_components, name
          from my_service_buildup
         where default_assembly_id is not null and company_id is null
           and task_components > 0 limit 1`));
    /* The catalog's own state: tasks, and nothing that costs money. */
    expect(row!.can_price).toBe(false);
    expect(Number(row!.task_components)).toBeGreaterThan(0);
    expect(Number(row!.costed_components)).toBe(0);
  });

  it('puts a crew on an assembly, which nothing could do', async () => {
    await h.asUser(OWNER, () => h.sql(
      `select public.add_assembly_resource($1,'labor',$2, 0.05,'HR')`,
      [assembly, laborRate]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      can_price: boolean; costed_components: string;
    }>(`select can_price, costed_components from my_service_buildup where service_id = $1`,
      [service]));
    expect(row!.can_price).toBe(true);
    expect(Number(row!.costed_components)).toBe(1);
  });

  it('refuses a task through the resource door, because they are different things', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.add_assembly_resource($1,'task', null, 1)`, [assembly])))
      .rejects.toThrow(/labor, equipment, material, trucking or subcontract/i);
  });

  it('refuses a rate that does not exist, by name rather than by key', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.add_assembly_resource($1,'labor',
        '00000000-0000-0000-0000-000000000000'::uuid, 1)`, [assembly])))
      .rejects.toThrow(/labor rate does not exist/i);
  });

  it('keeps a line\u2019s build-up on the service, per unit so it scales', async () => {
    const est = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.create_estimate('Transfer station pad', null, null, null, $1) as id`,
      [company])))[0]!.id;
    const version = (await h.asUser(OWNER, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [est])))[0]!.v;
    const line = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.add_estimate_line($1,$2,null,1200) as id`, [version, service])))[0]!.id;

    /* Forty crew hours on twelve hundred tons. */
    await h.asUser(OWNER, () => h.sql(
      `select app.save_line_resource($1,'labor',$2::jsonb)`,
      [line, JSON.stringify({ labor_rate_id: laborRate, hours: 40, unit_rate: 60 })]));

    const added = (await h.asUser(OWNER, () => h.sql<{ n: number }>(
      `select public.save_line_buildup_to_library($1) as n`, [line])))[0]!.n;
    /* The crew already on the assembly from the earlier test is left alone. */
    expect(Number(added)).toBe(0);

    const [row] = await h.asUser(OWNER, () => h.sql<{ quantity_per_unit: string }>(
      `select quantity_per_unit from assembly_components
        where assembly_id = $1 and component_kind = 'labor'`, [assembly]));
    expect(Number(row!.quantity_per_unit)).toBeCloseTo(0.05, 4);
  });

  it('refuses to save a build-up from a line with no quantity to scale by', async () => {
    const est = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.create_estimate('No quantity', null, null, null, $1) as id`,
      [company])))[0]!.id;
    const version = (await h.asUser(OWNER, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [est])))[0]!.v;
    const line = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.add_estimate_line($1,$2,null,0) as id`, [version, service])))[0]!.id;
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.save_line_buildup_to_library($1)`, [line])))
      .rejects.toThrow(/no quantity, so there is nothing to express the build-up per/i);
  });

  it('will not let one company change what every company reads', async () => {
    const [{ id }] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from assemblies where company_id is null limit 1`));
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.add_assembly_resource($1,'labor',$2, 1)`, [id, laborRate])))
      .rejects.toThrow(/Make your own copy of it first/i);
  });
});
