/**
 * An assembly and a profile you can start.
 *
 * The last two library tabs with no way to create anything. Both could only be
 * copied — `customize_assembly` clones a shipped build-up, `adopt_profile_markups`
 * takes somebody else's markups — so a company doing work the catalog has never
 * heard of, or marking up the way they have for twenty years, had to start from
 * the nearest shipped thing and edit it into shape.
 *
 * The tests worth most here are about what each one does *not* arrive with.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = 'cd3cd3cd-3cd3-4cd3-8cd3-cd3cd3cd3cd3';

describe('an assembly and a profile you can start', () => {
  let h: Harness;
  let company = '';

  const asOwner = <T>(fn: () => Promise<T>) => h.asUser(OWNER, fn);
  const one = <T>(sql: string, args: unknown[] = []) =>
    asOwner(() => h.sql<T>(sql, args)).then((r) => r[0]!);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [OWNER, 'o@start.test']);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [OWNER, 'o@start.test']);
    company = (await asOwner(() => h.sql<{ id: string }>(
      `select app.provision_company('Start Civil','start-civil','enterprise') as id`)))[0]!.id;
  }, 180_000);

  describe('a work sequence', () => {
    let assembly = '';

    it('is created empty, because nobody has said what the work is', async () => {
      assembly = (await one<{ id: string }>(
        `select public.create_assembly($1,'Trench, bed and backfill','LF') as id`,
        [company])).id;
      const row = await one<{ name: string; unit: string; origin: string }>(
        `select name, quantity_unit as unit, origin from assemblies where id = $1`, [assembly]);
      expect(row.name).toBe('Trench, bed and backfill');
      expect(row.unit).toBe('LF');
      expect(row.origin).toBe('company');

      /* No invented first step. `add_assembly_step` is what fills it. */
      const steps = await asOwner(() => h.sql(
        `select id from assembly_components where assembly_id = $1`, [assembly]));
      expect(steps).toEqual([]);
    });

    it('takes steps once somebody adds them', async () => {
      const task = (await one<{ id: string }>(
        `insert into tasks (company_id, code, name, default_unit, approved_by, approved_at)
         values ($1,'TSK-BED','Bed the pipe','LF',$2,now()) returning id`,
        [company, OWNER])).id;
      await asOwner(() => h.sql(
        `insert into assembly_components (company_id, assembly_id, component_kind, task_id,
                                          quantity_per_unit, unit)
         values ($1,$2,'task',$3,1,'LF')`, [company, assembly, task]));
      const steps = await asOwner(() => h.sql(
        `select id from assembly_components where assembly_id = $1`, [assembly]));
      expect(steps).toHaveLength(1);
    });

    it('refuses one with no name', async () => {
      await expect(asOwner(() => h.sql(`select public.create_assembly($1,'   ')`, [company])))
        .rejects.toThrow(/needs a name/);
    });
  });

  describe('a pricing profile', () => {
    let profile = '';

    it('arrives with no markup at all, rather than a helpful ten percent', async () => {
      /*
       * The one that matters. A markup nobody chose is a price nobody chose,
       * applied to every line the profile touches.
       */
      profile = (await one<{ id: string }>(
        `select public.create_pricing_profile($1,'Public work','parallel','Northwest Ohio') as id`,
        [company])).id;
      const markups = await asOwner(() => h.sql(
        `select id from markup_components where pricing_profile_id = $1`, [profile]));
      expect(markups).toEqual([]);
    });

    it('takes markups once somebody states them', async () => {
      await asOwner(() => h.sql(
        `select public.set_markup_component($1,'OVERHEAD','Overhead',0.12,'direct_cost',10)`,
        [profile]));
      await asOwner(() => h.sql(
        `select public.set_markup_component($1,'PROFIT','Profit',0.10,'running_total',20)`,
        [profile]));
      const rows = await asOwner(() => h.sql<{ code: string; percent: string }>(
        `select code, percent from markup_components where pricing_profile_id = $1
          order by sequence`, [profile]));
      expect(rows.map((r) => r.code)).toEqual(['OVERHEAD', 'PROFIT']);
      expect(rows.map((r) => Number(r.percent))).toEqual([0.12, 0.1]);
    });

    it('changes a markup rather than adding a second with the same code', async () => {
      await asOwner(() => h.sql(
        `select public.set_markup_component($1,'PROFIT','Profit',0.15,'running_total',20)`,
        [profile]));
      const rows = await asOwner(() => h.sql<{ percent: string }>(
        `select percent from markup_components where pricing_profile_id = $1 and code = 'PROFIT'`,
        [profile]));
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.percent)).toBe(0.15);
    });

    it('refuses a markup somebody typed as a percentage', async () => {
      await expect(asOwner(() => h.sql(
        `select public.set_markup_component($1,'BOND','Bond',10)`, [profile])))
        .rejects.toThrow(/between 0 and 5/);
    });

    it('refuses a method that is neither parallel nor stacked', async () => {
      await expect(asOwner(() => h.sql(
        `select public.create_pricing_profile($1,'Odd','sideways')`, [company])))
        .rejects.toThrow(/parallel or stacked/);
    });

    it('steps the old default down when a new one claims it', async () => {
      /* Two rows both claiming to be the default is the kind of thing noticed
         only when two estimates disagree. */
      const first = (await one<{ id: string }>(
        `select public.create_pricing_profile($1,'House standard','parallel',null,true) as id`,
        [company])).id;
      const second = (await one<{ id: string }>(
        `select public.create_pricing_profile($1,'Negotiated','stacked',null,true) as id`,
        [company])).id;
      const defaults = await asOwner(() => h.sql<{ id: string }>(
        `select id from pricing_profiles where company_id = $1 and is_default`, [company]));
      expect(defaults.map((d) => d.id)).toEqual([second]);
      expect(defaults.map((d) => d.id)).not.toContain(first);
    });
  });
});
