import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Building an estimate from the top down, in the database.
 *
 * `parent_line_id` has been here since migration 0006 and nothing computed with
 * it, so the structure was stored, copied by every revision, and meaningless.
 * These are the rules that make it mean something — and the ones that stop it
 * being used to say something untrue.
 */
describe('estimate hierarchy', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let version = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test') on conflict (id) do nothing`, [owner]);
    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','business') as id`)))[0]!.id;
    await h.asUser(owner, async () => {
      const est = (await h.sql<{ id: string }>(
        `insert into estimates (company_id, number, name) values ($1,'EST-H','Kingsway')
         returning id`, [company]))[0]!.id;
      version = (await h.sql<{ id: string }>(
        `insert into estimate_versions (company_id, estimate_id, version_number)
         values ($1,$2,1) returning id`, [company, est]))[0]!.id;
    });
  });

  afterAll(async () => { await h?.db.close(); });

  const line = (over: Record<string, unknown> = {}) => h.asUser(owner, () =>
    h.sql<{ id: string }>(
      `insert into estimate_line_items
         (company_id, estimate_version_id, parent_line_id, description, unit,
          measured_quantity, sort_order, quantity_basis, per_parent_unit,
          parametric_cost_per_unit, parametric_basis, measurement_method)
       values ($1,$2,$3,$4,$5::app.unit_code,$6,$7,coalesce($8,'measured'),$9,$10,$11,
               coalesce($12,'explicit_dimension')::app.measurement_method)
       returning id`,
      [company, version, over.parent ?? null, over.description ?? 'Line',
       over.unit ?? 'EA', over.qty ?? 0, over.sort ?? 0, over.basis ?? null,
       over.perUnit ?? null, over.rate ?? null, over.rateBasis ?? null,
       over.method ?? null]));

  describe('the structure is a tree', () => {
    it('accepts a parent and a child', async () => {
      const site = (await line({ description: 'Site', qty: 40 }))[0]!.id;
      const storm = (await line({ parent: site, description: 'Storm', qty: 1 }))[0]!.id;
      expect(storm).toBeTruthy();
    });

    it('refuses a line that would be its own ancestor', async () => {
      /*
       * A cycle does not produce a wrong total — it hangs the roll-up, which is
       * harder to notice in a test and impossible to miss in production.
       */
      const a = (await line({ description: 'A' }))[0]!.id;
      const b = (await line({ parent: a, description: 'B' }))[0]!.id;
      const c = (await line({ parent: b, description: 'C' }))[0]!.id;
      await expect(h.asUser(owner, () => h.sql(
        `update estimate_line_items set parent_line_id = $2 where id = $1`, [a, c])))
        .rejects.toThrow(/its own ancestor/);
    });

    it('refuses a line that is its own parent', async () => {
      const a = (await line({ description: 'Self' }))[0]!.id;
      await expect(h.asUser(owner, () => h.sql(
        `update estimate_line_items set parent_line_id = $1 where id = $1`, [a])))
        .rejects.toThrow(/eli_no_self_parent|its own ancestor/);
    });
  });

  describe('quantities that flow down', () => {
    it('records the factor a child is driven by', async () => {
      const site = (await line({ description: 'Subdivision', qty: 40 }))[0]!.id;
      const [c] = await line({
        parent: site, description: 'Sanitary', unit: 'LF',
        basis: 'per_parent_unit', perUnit: 85,
      });
      const [row] = await h.asUser(owner, () => h.sql<{
        quantity_basis: string; per_parent_unit: string;
      }>(`select quantity_basis, per_parent_unit from estimate_line_items where id = $1`,
        [c!.id]));
      expect(row!.quantity_basis).toBe('per_parent_unit');
      expect(Number(row!.per_parent_unit)).toBe(85);
    });

    it('refuses a driven line with no parent to be driven by', async () => {
      await expect(line({ description: 'Orphan', basis: 'per_parent_unit', perUnit: 2 }))
        .rejects.toThrow(/eli_driven_quantity/);
    });

    it('refuses a driven line with no factor', async () => {
      const p = (await line({ description: 'P', qty: 1 }))[0]!.id;
      await expect(line({ parent: p, description: 'No factor', basis: 'per_parent_unit' }))
        .rejects.toThrow(/eli_driven_quantity/);
    });

    it('refuses a factor of zero', async () => {
      const p = (await line({ description: 'P2', qty: 1 }))[0]!.id;
      await expect(line({ parent: p, description: 'Zero', basis: 'per_parent_unit', perUnit: 0 }))
        .rejects.toThrow(/per_parent_unit/);
    });
  });

  describe('a line priced at a rate', () => {
    it('is accepted with a basis and an allowance method', async () => {
      const [r] = await line({
        description: 'Building pad', unit: 'SF', qty: 12000,
        rate: 4.25, rateBasis: 'Three comparable pads, 2025-2026',
        method: 'estimator_allowance',
      });
      expect(r!.id).toBeTruthy();
    });

    it('refuses a rate with no attribution', async () => {
      await expect(line({
        description: 'Guess', unit: 'SF', qty: 100, rate: 5,
        method: 'estimator_allowance',
      })).rejects.toThrow(/eli_parametric_basis/);
    });

    it('refuses to be labeled anything stronger than an allowance', async () => {
      /*
       * The honesty of top-down estimating in one constraint. measurement_method
       * is an estimator input rather than an engine output, so without this a
       * rate per square foot could be labeled an explicit dimension and pass
       * the approval gate that the label decides.
       */
      await expect(line({
        description: 'Dressed up', unit: 'SF', qty: 100,
        rate: 5, rateBasis: 'Feels about right', method: 'explicit_dimension',
      })).rejects.toThrow(/eli_parametric_is_an_allowance/);
    });

    it('refuses to be a rate and a rollup at once', async () => {
      // Allowing both would count the rate and the children.
      const p = (await line({
        description: 'Rate parent', unit: 'SF', qty: 100,
        rate: 3, rateBasis: 'Historic average', method: 'estimator_allowance',
      }))[0]!.id;
      await expect(line({ parent: p, description: 'Child' }))
        .rejects.toThrow(/priced at a rate, so it cannot also have lines beneath it/);
    });

    it('refuses a rate on a line that already has work beneath it', async () => {
      // The same rule from the other direction.
      const p = (await line({ description: 'Has children', qty: 1 }))[0]!.id;
      await line({ parent: p, description: 'Some work' });
      await expect(h.asUser(owner, () => h.sql(
        `update estimate_line_items
            set parametric_cost_per_unit = 5, parametric_basis = 'Historic',
                measurement_method = 'estimator_allowance'
          where id = $1`, [p])))
        .rejects.toThrow(/has work beneath it/);
    });
  });

  describe('reading the structure back', () => {
    it('derives depth and path by walking the parents', async () => {
      const a = (await line({ description: 'Depth root', qty: 1, sort: 900 }))[0]!.id;
      const b = (await line({ parent: a, description: 'Middle', sort: 1 }))[0]!.id;
      const c = (await line({ parent: b, description: 'Leaf', sort: 1 }))[0]!.id;

      const [row] = await h.asUser(owner, () => h.sql<{ depth: number; path: string[] }>(
        `select depth, path from reporting_estimate_structure where id = $1`, [c]));
      expect(row!.depth).toBe(2);
      expect(row!.path).toEqual(['Depth root', 'Middle', 'Leaf']);
    });

    it('says which lines have work beneath them', async () => {
      const p = (await line({ description: 'Rollup probe', qty: 1 }))[0]!.id;
      const k = (await line({ parent: p, description: 'Beneath' }))[0]!.id;
      const rows = await h.asUser(owner, () => h.sql<{ id: string; is_rollup: boolean }>(
        `select id, is_rollup from reporting_estimate_structure where id in ($1,$2)`, [p, k]));
      expect(rows.find((r) => r.id === p)!.is_rollup).toBe(true);
      expect(rows.find((r) => r.id === k)!.is_rollup).toBe(false);
    });

    it('shows one company nothing of another estimate structure', async () => {
      const stranger = '22222222-2222-4222-8222-222222222222';
      await h.sql(`insert into auth.users (id, email) values ($1,'s@r.test')`, [stranger]);
      await h.sql(`insert into user_profiles (id, email) values ($1,'s@r.test') on conflict (id) do nothing`, [stranger]);
      await h.asUser(stranger, () => h.sql(`select app.provision_company('Other','other','business')`));
      const rows = await h.asUser(stranger, () => h.sql(
        `select 1 from reporting_estimate_structure where company_id = $1`, [company]));
      expect(rows).toEqual([]);
    });
  });
});
