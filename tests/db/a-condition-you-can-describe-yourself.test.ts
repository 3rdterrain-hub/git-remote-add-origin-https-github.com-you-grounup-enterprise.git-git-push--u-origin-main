/**
 * A condition you can describe yourself.
 *
 * The last library tab with no way to create anything. Twenty shipped
 * modifiers and no way to add the one your own ground gives you.
 *
 * A condition is the sharpest tool on an estimate — "Difficult material"
 * applied to a line raises that line's equipment cost by 2.077×, because 1.35
 * lands on the hourly rate and 0.65 on production, so the machine is on the job
 * half again as long and dearer. The refusals below exist because a factor that
 * looks right and prices nothing is worse than no factor at all.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = 'de4de4de-4de4-4de4-8de4-de4de4de4de4';

describe('a condition you can describe yourself', () => {
  let h: Harness;
  let company = '';

  const asOwner = <T>(fn: () => Promise<T>) => h.asUser(OWNER, fn);
  const one = <T>(sql: string, args: unknown[] = []) =>
    asOwner(() => h.sql<T>(sql, args)).then((r) => r[0]!);
  const create = (name: string, factors: string, category = 'Subsurface') =>
    asOwner(() => h.sql(
      `select public.create_condition_modifier($1,$2,$3::jsonb,$4)`,
      [company, name, factors, category]));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [OWNER, 'o@cond.test']);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [OWNER, 'o@cond.test']);
    company = (await asOwner(() => h.sql<{ id: string }>(
      `select app.provision_company('Cond Civil','cond-civil','enterprise') as id`)))[0]!.id;
    /* Categories are a maintained list, not free text (0113). */
    for (const name of ['Subsurface', 'Access']) {
      await asOwner(() => h.sql(
        `select app.add_library_category('modifier_category',$1,null,$2)`, [name, company]));
    }
  }, 180_000);

  it('records the factors exactly as they were written', async () => {
    await create('Toledo blue clay', '{"production":0.7,"equipment_cost":1.25}');
    const row = await one<{ name: string; factors: Record<string, number>; status: string }>(
      `select name, factors, status::text from condition_modifiers
        where company_id = $1 and name = 'Toledo blue clay'`, [company]);
    expect(row.name).toBe('Toledo blue clay');
    expect(row.factors).toEqual({ production: 0.7, equipment_cost: 1.25 });
    expect(row.status).toBe('active');
  });

  it('takes a condition that only slows the work', async () => {
    await create('Working around traffic', '{"production":0.85}', 'Access');
    const row = await one<{ factors: Record<string, number> }>(
      `select factors from condition_modifiers where company_id = $1
        and name = 'Working around traffic'`, [company]);
    expect(row.factors).toEqual({ production: 0.85 });
  });

  describe('what it refuses', () => {
    it('refuses a target the engine does not price', async () => {
      /*
       * The rule 0136 and 0139 settled for jsonb field names, with a price
       * attached: `fuel_cost` would sit in the record looking exactly like the
       * factors beside it and move nothing.
       */
      await expect(create('Fuel surcharge', '{"fuel_cost":1.2}'))
        .rejects.toThrow(/does not price fuel_cost/);
    });

    it('names every unknown target, not just the first', async () => {
      await expect(create('Nonsense', '{"fuel_cost":1.2,"weather_cost":1.1}'))
        .rejects.toThrow(/fuel_cost|weather_cost/);
    });

    it('refuses a condition with no factors at all', async () => {
      await expect(create('Does nothing', '{}'))
        .rejects.toThrow(/changes nothing/);
    });

    it('refuses a factor of zero — work that never finishes', async () => {
      await expect(create('Impossible', '{"production":0}'))
        .rejects.toThrow(/multiplier above zero/);
    });

    it('refuses a negative factor', async () => {
      await expect(create('Backwards', '{"production":-1}'))
        .rejects.toThrow(/multiplier above zero/);
    });

    it('refuses a factor somebody typed as a percentage', async () => {
      /* 20 means two thousand percent. The hint says what 20% looks like. */
      await expect(create('Twenty percent', '{"equipment_cost":20}'))
        .rejects.toThrow(/multiplier above zero/);
    });

    it('refuses one with no name', async () => {
      await expect(create('   ', '{"production":0.9}'))
        .rejects.toThrow(/needs a name/);
    });
  });

  it('will not create one in a company the caller is not in', async () => {
    const other = 'ef5ef5ef-5ef5-4ef5-8ef5-ef5ef5ef5ef5';
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [other, 'x@cond.test']);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [other, 'x@cond.test']);
    await h.asUser(other, () => h.sql(
      `select app.provision_company('Rival Cond','rival-cond','enterprise')`));

    await expect(h.asUser(other, () => h.sql(
      `select public.create_condition_modifier($1,'Sneaky','{"production":0.5}'::jsonb)`,
      [company]))).rejects.toThrow(/No such company|permission/i);
  });
});
