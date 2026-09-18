/**
 * A machine and a rate you can add.
 *
 * The owner, after the editing pass: "equipment, tasks and production rates
 * still have no way to create one." Tasks turned out to be fine. Equipment and
 * production rates were not: 709 machines and 2,190 rates shipped, and a
 * company whose yard holds something the seed does not list had nowhere to put
 * it.
 *
 * Both doors refuse rather than guess, which is most of what these test.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = 'ab1ab1ab-1ab1-4ab1-8ab1-ab1ab1ab1ab1';

describe('a machine and a rate you can add', () => {
  let h: Harness;
  let company = '';
  let task = '';

  const asOwner = <T>(fn: () => Promise<T>) => h.asUser(OWNER, fn);
  const one = <T>(sql: string, args: unknown[] = []) =>
    asOwner(() => h.sql<T>(sql, args)).then((r) => r[0]!);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [OWNER, 'o@add.test']);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [OWNER, 'o@add.test']);
    company = (await asOwner(() => h.sql<{ id: string }>(
      `select app.provision_company('Add Civil','add-civil','enterprise') as id`)))[0]!.id;
    await asOwner(() => h.sql(
      `select app.add_library_category('equipment_class','Earthmoving',null,$1)`, [company]));
    task = (await one<{ id: string }>(
      `insert into tasks (company_id, code, name, default_unit, approved_by, approved_at)
       values ($1,'TSK-TRENCH','Trench excavation','LF',$2,now()) returning id`,
      [company, OWNER])).id;
  }, 180_000);

  describe('a machine', () => {
    let machine = '';

    it('is added with what it is and what it burns', async () => {
      machine = (await one<{ id: string }>(
        `select public.create_equipment($1,'Excavator 210','Earthmoving',7.5,650) as id`,
        [company])).id;
      const row = await one<{ name: string; klass: string; fuel: string; status: string }>(
        `select name, equipment_class as klass, fuel_gallons_per_hour as fuel, status::text
           from equipment where id = $1`, [machine]);
      expect(row.name).toBe('Excavator 210');
      expect(row.klass).toBe('Earthmoving');
      expect(Number(row.fuel)).toBe(7.5);
      expect(row.status).toBe('active');
    });

    it('arrives with no rate, rather than one nobody chose', async () => {
      /*
       * Somebody adding an excavator may not know what it costs an hour until
       * they look it up. "No rate yet" is the honest state and the screen
       * already renders it; an invented hourly figure would reach an estimate.
       */
      const rates = await asOwner(() => h.sql(
        `select id from equipment_rates where equipment_id = $1`, [machine]));
      expect(rates).toEqual([]);
    });

    it('takes a rate the moment somebody has one', async () => {
      await asOwner(() => h.sql(
        `select public.set_equipment_rate($1,185,1400,4200,11000)`, [machine]));
      const row = await one<{ h: string }>(
        `select hourly_rate as h from equipment_rates where equipment_id = $1`, [machine]);
      expect(Number(row.h)).toBe(185);
    });

    it('refuses a machine with no name', async () => {
      await expect(asOwner(() => h.sql(`select public.create_equipment($1,'  ')`, [company])))
        .rejects.toThrow(/needs a name/);
    });

    it('gives each machine its own code', async () => {
      const a = (await one<{ id: string }>(
        `select public.create_equipment($1,'Dozer D6') as id`, [company])).id;
      const b = (await one<{ id: string }>(
        `select public.create_equipment($1,'Dozer D6') as id`, [company])).id;
      const codes = await asOwner(() => h.sql<{ code: string }>(
        `select code from equipment where id in ($1,$2)`, [a, b]));
      expect(new Set(codes.map((c) => c.code)).size).toBe(2);
    });
  });

  describe('a production rate', () => {
    it('is added against a task, in a unit', async () => {
      const id = (await one<{ id: string }>(
        `select public.create_production_rate($1,$2,120,'LF',0.83,10) as id`,
        [company, task])).id;
      const row = await one<{ r: string; u: string; unit: string; shift: string; src: string }>(
        `select rate_per_hour as r, utilization_factor as u, rate_unit::text as unit,
                shift_hours as shift, source_type::text as src
           from production_rates where id = $1`, [id]);
      expect(Number(row.r)).toBe(120);
      expect(Number(row.u)).toBe(0.83);
      expect(row.unit).toBe('LF');
      expect(Number(row.shift)).toBe(10);
      /*
       * A person's judgment, offered as such. Deliberately not
       * `company_actual`: that means the field measured it, and
       * `production_actuals` is what earns it. Calling a typed figure measured
       * would make it outrank a regional benchmark and quietly raise the
       * confidence of every estimate priced from it.
       */
      expect(row.src).toBe('estimator_judgment');
    });

    it('refuses a rate with no unit — a hundred and twenty of what', async () => {
      await expect(asOwner(() => h.sql(
        `select public.create_production_rate($1,$2,120,'')`, [company, task])))
        .rejects.toThrow(/what the rate is measured in/);
    });

    it('refuses a rate of zero', async () => {
      await expect(asOwner(() => h.sql(
        `select public.create_production_rate($1,$2,0,'LF')`, [company, task])))
        .rejects.toThrow(/greater than zero/);
    });

    it('refuses utilization somebody typed as a percentage', async () => {
      await expect(asOwner(() => h.sql(
        `select public.create_production_rate($1,$2,120,'LF',83)`, [company, task])))
        .rejects.toThrow(/share of the hour/);
    });

    it('refuses a task that does not exist', async () => {
      await expect(asOwner(() => h.sql(
        `select public.create_production_rate($1,'00000000-0000-4000-8000-000000000000',120,'LF')`,
        [company]))).rejects.toThrow(/No such task/);
    });
  });

  it('will not add either into a company the caller is not in', async () => {
    const other = 'bc2bc2bc-2bc2-4bc2-8bc2-bc2bc2bc2bc2';
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [other, 'x@add.test']);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [other, 'x@add.test']);
    await h.asUser(other, () => h.sql(
      `select app.provision_company('Rival Add','rival-add','enterprise')`));

    await expect(h.asUser(other, () => h.sql(
      `select public.create_equipment($1,'Sneaky loader')`, [company])))
      .rejects.toThrow(/No such company|permission/i);
  });
});
