/**
 * What a load is measured in.
 *
 * A haul line carried a capacity and no unit, and the screen labeled it
 * "Tons/load" — encoding an assumption the schema never made. A tri-axle
 * hauling stone is bought by the ton; the same truck hauling topsoil is bought
 * by the yard, because topsoil is sold by the yard and nobody puts a scale on
 * it. A lowboy move goes by the load whatever is on it.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('what a load is measured in', () => {
  let h: Harness;
  const chief = '11111111-1111-4111-8111-111111111111';
  let company = '', versionId = '', lineId = '';
  let n = 0;

  const sql = <T,>(q: string, p?: unknown[]) =>
    h.asUser(chief, () => h.sql<T extends object ? T : never>(q, p));

  const haul = async (fields: Record<string, unknown> = {}) => {
    const [r] = await sql<{ id: string }>(
      `select app.save_line_resource($1, 'trucking', $2::jsonb) as id`,
      [lineId, JSON.stringify({ description: `Haul ${++n}`, ...fields })]);
    return r!.id;
  };

  const read = (id: string) => sql<{
    truck_capacity: string | null; capacity_unit: string | null; tons_per_load: string | null;
  }>(`select truck_capacity::text, capacity_unit::text, tons_per_load::text
      from estimate_line_resources where id = $1`, [id]).then((r) => r[0]!);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'c@r.test')`, [chief]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'c@r.test')
                 on conflict (id) do nothing`, [chief]);
    company = (await sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id;
    const [c] = await sql<{ id: string }>(
      `insert into customers (company_id, code, name) values ($1,'C-1','North') returning id`,
      [company]);
    const [e] = await sql<{ id: string }>(
      `insert into estimates (company_id, customer_id, number, name)
       values ($1,$2,'E-1','Yard') returning id`, [company, c!.id]);
    const [v] = await sql<{ id: string }>(
      `insert into estimate_versions (company_id, estimate_id, version_number, status)
       values ($1,$2,1,'draft') returning id`, [company, e!.id]);
    versionId = v!.id;
    const [l] = await sql<{ id: string }>(
      `insert into estimate_line_items
         (company_id, estimate_version_id, line_number, description, unit, measured_quantity)
       values ($1,$2,'1','Haul spoil','CY'::app.unit_code,500) returning id`,
      [company, versionId]);
    lineId = l!.id;
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  // ---------------------------------------------------------------------------
  describe('the units a load is bought in', () => {
    it('offers four, not fourteen', async () => {
      // Nobody hauls by the acre, and a picker offering the impossible costs a
      // reader a second look.
      const rows = await sql<{ unit: string }>(
        `select unit::text from app.haul_capacity_units() order by unit`);
      expect(rows.map((r) => r.unit).sort()).toEqual(['CY', 'EA', 'LB', 'TON']);
    });

    it('says what each one is for', async () => {
      const [r] = await sql<{ label: string; note: string }>(
        `select label, note from app.haul_capacity_units() where unit = 'CY'`);
      expect(r!.label).toBe('Yards per load');
      expect(r!.note).toMatch(/Topsoil, mulch, spoil/);
    });
  });

  // ---------------------------------------------------------------------------
  describe('setting a capacity', () => {
    it('takes yards for topsoil', async () => {
      const id = await haul();
      await sql(`select set_haul_capacity($1, 14, 'CY')`, [id]);
      const r = await read(id);
      expect(Number(r.truck_capacity)).toBe(14);
      expect(r.capacity_unit).toBe('CY');
    });

    it('does not put a yard figure into tons per load', async () => {
      /*
       * The number the trucking engine reads for a weight-based haul. Fourteen
       * yards of topsoil is not fourteen tons, and writing it there would price
       * the haul against a weight nobody stated.
       */
      const id = await haul();
      await sql(`select set_haul_capacity($1, 14, 'CY')`, [id]);
      expect((await read(id)).tons_per_load).toBeNull();
    });

    it('keeps tons per load in step when the capacity is stated in tons', async () => {
      const id = await haul();
      await sql(`select set_haul_capacity($1, 22, 'TON')`, [id]);
      const r = await read(id);
      expect(Number(r.tons_per_load)).toBe(22);
      expect(r.capacity_unit).toBe('TON');
    });

    it('takes a load as a whole thing', async () => {
      const id = await haul();
      await sql(`select set_haul_capacity($1, 1, 'EA')`, [id]);
      expect((await read(id)).capacity_unit).toBe('EA');
    });

    it('refuses a unit nobody hauls in', async () => {
      const id = await haul();
      await expect(sql(`select set_haul_capacity($1, 5, 'ACRE')`, [id]))
        .rejects.toThrow(/not a unit a load is bought in/);
    });

    it('clears the capacity rather than storing a zero', async () => {
      const id = await haul();
      await sql(`select set_haul_capacity($1, 14, 'CY')`, [id]);
      await sql(`select set_haul_capacity($1, 0, null)`, [id]);
      const r = await read(id);
      expect(r.truck_capacity).toBeNull();
      expect(r.capacity_unit).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  describe('what it refuses', () => {
    it('refuses once the version is frozen', async () => {
      const id = await haul();
      await sql(`update estimate_versions set status = 'archived' where id = $1`, [versionId]);
      await expect(sql(`select set_haul_capacity($1, 10, 'TON')`, [id]))
        .rejects.toThrow(/make a new version to change it/);
      await sql(`update estimate_versions set status = 'draft' where id = $1`, [versionId]);
    });

    it('lets nobody reach it anonymously', async () => {
      await h.asAnon(async () => {
        await expect(h.sql(
          `select set_haul_capacity('00000000-0000-4000-8000-000000000000', 1, 'TON')`))
          .rejects.toThrow(/permission denied/);
      });
    });
  });
});
