/**
 * A library row you can actually change.
 *
 * The owner, going through Master Libraries tab by tab: "you can't change the
 * prices in labor rates… we need to be able to set a base wage, a burden…
 * materials, yes I can change the cost, but I can't change the unit…
 * equipment, we need hourly, daily, weekly, monthly… fuel, mobilization, the
 * class, the name."
 *
 * Two cost cells were editable and nothing else was. Every table already had
 * the INSERT and UPDATE policies, so nothing was being refused — there was no
 * door on either side.
 *
 * The test that matters most is the material unit. A unit cost is a price *per
 * unit*, so changing TON to CY and leaving the cost alone produces a figure
 * that looks as authoritative as it did a moment ago and means nothing.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '9d9d9d9d-9d9d-4d9d-8d9d-9d9d9d9d9d9d';

describe('a library row you can actually change', () => {
  let h: Harness;
  let company = '';
  let material = '';
  let machine = '';

  const asOwner = <T>(fn: () => Promise<T>) => h.asUser(OWNER, fn);
  const one = <T>(sql: string, args: unknown[] = []) =>
    asOwner(() => h.sql<T>(sql, args)).then((r) => r[0]!);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [OWNER, 'o@edit.test']);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [OWNER, 'o@edit.test']);
    company = (await asOwner(() => h.sql<{ id: string }>(
      `select app.provision_company('Edit Civil','edit-civil','enterprise') as id`)))[0]!.id;

    /* Categories are a maintained list, not free text (0113), so the ones this
       fixture uses are registered before use. */
    for (const [kind, name] of [
      ['equipment_class', 'Earthmoving'], ['equipment_class', 'Excavation'],
      ['material_category', 'Aggregate'], ['labor_group', 'Operating Engineers'],
    ]) {
      await asOwner(() => h.sql(
        `select app.add_library_category($1,$2,null,$3)`, [kind, name, company]));
    }

    material = (await one<{ id: string }>(
      `insert into materials (company_id, code, name, unit, unit_cost, approved_by, approved_at)
       values ($1,'MAT-STONE','Crushed stone','TON',12.40,$2,now()) returning id`,
      [company, OWNER])).id;
    machine = (await one<{ id: string }>(
      `insert into equipment (company_id, code, name, equipment_class, fuel_gallons_per_hour,
                              mobilization_cost, approved_by, approved_at)
       values ($1,'EQ-EX210','Excavator 210','Earthmoving',6,500,$2,now()) returning id`,
      [company, OWNER])).id;
  }, 180_000);

  describe('labor', () => {
    let rate = '';

    it('is created with a wage and a burden', async () => {
      rate = (await one<{ id: string }>(
        `select public.create_labor_rate($1,'Operator',44.50,0.38,'Operating Engineers') as id`,
        [company])).id;
      const row = await one<{ classification: string; base: string; burden: string; loaded: string }>(
        `select classification, base_wage_per_hour as base, burden_percent as burden,
                burdened_cost_per_hour as loaded from labor_rates where id = $1`, [rate]);
      expect(row.classification).toBe('Operator');
      expect(Number(row.base)).toBe(44.5);
      expect(Number(row.burden)).toBe(0.38);
      /* Generated, so it cannot drift from the two figures it comes from. */
      expect(Number(row.loaded)).toBeCloseTo(44.5 * 1.38, 2);
    });

    it('changes the wage, and the loaded rate follows on its own', async () => {
      await asOwner(() => h.sql(`select public.set_labor_rate($1,null,48.00)`, [rate]));
      const row = await one<{ base: string; loaded: string }>(
        `select base_wage_per_hour as base, burdened_cost_per_hour as loaded
           from labor_rates where id = $1`, [rate]);
      expect(Number(row.base)).toBe(48);
      expect(Number(row.loaded)).toBeCloseTo(48 * 1.38, 2);
    });

    it('changes the burden, which was not editable at all', async () => {
      await asOwner(() => h.sql(`select public.set_labor_rate($1,null,null,0.42)`, [rate]));
      const row = await one<{ burden: string; loaded: string }>(
        `select burden_percent as burden, burdened_cost_per_hour as loaded
           from labor_rates where id = $1`, [rate]);
      expect(Number(row.burden)).toBe(0.42);
      expect(Number(row.loaded)).toBeCloseTo(48 * 1.42, 2);
    });

    it('refuses a burden somebody typed as a percentage', async () => {
      /* 35 means 3,500%. The hint says so rather than storing it. */
      await expect(asOwner(() => h.sql(`select public.set_labor_rate($1,null,null,35)`, [rate])))
        .rejects.toThrow(/between 0 and 3/);
    });

    it('refuses a rate with no classification', async () => {
      await expect(asOwner(() => h.sql(
        `select public.create_labor_rate($1,'  ',30)`, [company])))
        .rejects.toThrow(/needs a classification/);
    });
  });

  describe('a material’s unit', () => {
    it('will not change without the cost being restated', async () => {
      /*
       * The whole reason this function takes both. $12.40 a ton is not $12.40 a
       * cubic yard, and the second figure would look exactly as trustworthy.
       */
      await expect(asOwner(() => h.sql(
        `select public.set_material_unit($1,'CY',null)`, [material])))
        .rejects.toThrow(/restating the cost in that unit/);
      const row = await one<{ unit: string; cost: string }>(
        `select unit::text as unit, unit_cost as cost from materials where id = $1`, [material]);
      expect(row.unit).toBe('TON');
      expect(Number(row.cost)).toBe(12.4);
    });

    it('changes both together', async () => {
      await asOwner(() => h.sql(`select public.set_material_unit($1,'CY',18.75)`, [material]));
      const row = await one<{ unit: string; cost: string }>(
        `select unit::text as unit, unit_cost as cost from materials where id = $1`, [material]);
      expect(row.unit).toBe('CY');
      expect(Number(row.cost)).toBe(18.75);
    });

    it('changes the name and waste without touching the unit', async () => {
      await asOwner(() => h.sql(
        `select public.set_material($1,'Crushed limestone',null,null,0.08,'installed')`,
        [material]));
      const row = await one<{ name: string; waste: string; unit: string }>(
        `select name, default_waste_percent as waste, unit::text as unit
           from materials where id = $1`, [material]);
      expect(row.name).toBe('Crushed limestone');
      expect(Number(row.waste)).toBe(0.08);
      expect(row.unit).toBe('CY');
    });

    it('refuses waste somebody typed as a percentage', async () => {
      await expect(asOwner(() => h.sql(`select public.set_material($1,null,null,null,10)`, [material])))
        .rejects.toThrow(/between 0 and 1/);
    });

    it('refuses a waste figure that does not say what it is a share of', async () => {
      /*
       * Eight percent *of what*. Waste against the installed quantity and waste
       * against the ordered quantity are different numbers, and the constraint
       * has required the pair since 0004 — the door was not carrying the rule,
       * so it failed with the constraint's own words instead.
       */
      const fresh = (await one<{ id: string }>(
        `insert into materials (company_id, code, name, unit, unit_cost, approved_by, approved_at)
         values ($1,'MAT-SAND','Bedding sand','TON',9.50,$2,now()) returning id`,
        [company, OWNER])).id;
      await expect(asOwner(() => h.sql(
        `select public.set_material($1,null,null,null,0.05)`, [fresh])))
        .rejects.toThrow(/what the waste is a share of/);
    });
  });

  describe('equipment', () => {
    it('changes the name, class, fuel burn and mobilization', async () => {
      await asOwner(() => h.sql(
        `select public.set_equipment($1,'Excavator 210 LC','Excavation',7.5,650)`, [machine]));
      const row = await one<{ name: string; klass: string; fuel: string; mob: string }>(
        `select name, equipment_class as klass, fuel_gallons_per_hour as fuel,
                mobilization_cost as mob from equipment where id = $1`, [machine]);
      expect(row.name).toBe('Excavator 210 LC');
      expect(row.klass).toBe('Excavation');
      expect(Number(row.fuel)).toBe(7.5);
      expect(Number(row.mob)).toBe(650);
    });

    it('prices it by the hour, day, week and month', async () => {
      /* Four figures, because a week is not seven times the daily rate. */
      await asOwner(() => h.sql(
        `select public.set_equipment_rate($1,185,1400,4200,11000)`, [machine]));
      const row = await one<{ h: string; d: string; w: string; m: string; source: string }>(
        `select hourly_rate as h, daily_rate as d, weekly_rate as w, monthly_rate as m,
                source::text as source
           from equipment_rates where equipment_id = $1`, [machine]);
      expect([row.h, row.d, row.w, row.m].map(Number)).toEqual([185, 1400, 4200, 11000]);
      /* RULE-003: a company's own figure, above regional and shipped. */
      expect(row.source).toBe('tenant_approved');
    });

    it('updates the same rate rather than stacking a second one', async () => {
      await asOwner(() => h.sql(`select public.set_equipment_rate($1,195)`, [machine]));
      const rows = await asOwner(() => h.sql<{ h: string; d: string }>(
        `select hourly_rate as h, daily_rate as d from equipment_rates where equipment_id = $1`,
        [machine]));
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.h)).toBe(195);
      /* The periods not mentioned are left exactly as they were. */
      expect(Number(rows[0]!.d)).toBe(1400);
    });

    it('leaves a period null rather than inventing it from another', async () => {
      const other = (await one<{ id: string }>(
        `insert into equipment (company_id, code, name, approved_by, approved_at)
         values ($1,'EQ-D6','Dozer D6',$2,now()) returning id`, [company, OWNER])).id;
      await asOwner(() => h.sql(`select public.set_equipment_rate($1,140)`, [other]));
      const row = await one<{ d: string | null; w: string | null; m: string | null }>(
        `select daily_rate as d, weekly_rate as w, monthly_rate as m
           from equipment_rates where equipment_id = $1`, [other]);
      expect(row.d).toBeNull();
      expect(row.w).toBeNull();
      expect(row.m).toBeNull();
    });
  });

  describe('what none of them will do', () => {
    it('refuses to change a row GrounUp ships', async () => {
      const shipped = await one<{ id: string }>(
        `select id from labor_rates where company_id is null limit 1`);
      await expect(asOwner(() => h.sql(
        `select public.set_labor_rate($1,null,99)`, [shipped.id])))
        .rejects.toThrow(/shipped with GrounUp/);
    });

    it('refuses a production rate of zero', async () => {
      const pr = (await one<{ id: string }>(
        `insert into production_rates (company_id, code, rate_per_hour, rate_unit, approved_by, approved_at)
         values ($1,'PR-TEST',120,'CY',$2,now()) returning id`, [company, OWNER])).id;
      await expect(asOwner(() => h.sql(`select public.set_production_rate($1,0)`, [pr])))
        .rejects.toThrow(/greater than zero/);
      await asOwner(() => h.sql(`select public.set_production_rate($1,150,0.83)`, [pr]));
      const row = await one<{ r: string; u: string }>(
        `select rate_per_hour as r, utilization_factor as u from production_rates where id = $1`, [pr]);
      expect(Number(row.r)).toBe(150);
      expect(Number(row.u)).toBe(0.83);
    });
  });
});
