import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareSurfaces } from '@grounup/engine';
import {
  toGrid, hasGrid, toComparisonPayload, type SurfaceRow,
} from '../../supabase/functions/_shared/surface-comparison.ts';

/**
 * Database rows into the surfaces engine.
 *
 * Since migration 0193 nothing else may write a cut or fill yardage, so a
 * mistake in this mapping is not a display bug — it is a wrong quantity on a
 * bid, produced by the one component permitted to produce quantities.
 *
 * The test that earns its place is the last one. A jsonb key the recorder does
 * not recognize is refused rather than ignored, which means a renamed field
 * here becomes a failure rather than a silent zero — but only if the two lists
 * agree, so this reads the list out of the migration rather than restating it.
 */
const ROOT = join(import.meta.dirname, '../..');

const surface = (over: Partial<SurfaceRow> = {}): SurfaceRow => ({
  id: 's-1',
  name: 'Existing ground',
  /* Numerics arrive from PostgREST as strings. That is the point of the test. */
  cell_size_ft: '25.000',
  grid_rows: '2',
  grid_cols: '2',
  elevations: [100, 100, 99, 99],
  storage_path: null,
  origin_easting: '1500000.0000',
  origin_northing: '700000.0000',
  company_id: 'c-1',
  ...over,
});

describe('a surface row as the engine wants it', () => {
  it('turns PostgREST strings into numbers', () => {
    const g = toGrid(surface());
    expect(g.cellSize).toBe(25);
    expect(g.rows).toBe(2);
    expect(g.cols).toBe(2);
    expect(g.origin).toEqual({ easting: 1_500_000, northing: 700_000 });
    expect(g.name).toBe('Existing ground');
  });

  it('keeps a cell with no data as no data rather than as zero', () => {
    // A null read as zero is a hundred feet of cut that nobody dug.
    const g = toGrid(surface({ elevations: [100, null, 99, 99] }));
    expect(g.elevations).toEqual([100, null, 99, 99]);
  });

  it('leaves a surface with no georeference ungeoreferenced', () => {
    const g = toGrid(surface({ origin_easting: null, origin_northing: null }));
    expect(g.origin).toBeUndefined();
  });

  it('knows a surface that is only a file reference', () => {
    expect(hasGrid(surface())).toBe(true);
    expect(hasGrid(surface({ elevations: [] }))).toBe(false);
    expect(hasGrid(surface({ elevations: null }))).toBe(false);
  });
});

describe('the engine result as the recorder takes it', () => {
  /*
   * Two feet of cut over one cell and two of fill over another, at 25 ft
   * cells: 1,250 cubic feet each way, which is 46.30 yards. Arithmetic anybody
   * can check on paper — and the engine, not this file, is what produced it.
   */
  const result = compareSurfaces(
    toGrid(surface({ elevations: [102, 98, 100, 100] })),
    toGrid(surface({ id: 's-2', name: 'Design', elevations: [100, 100, 100, 100] })),
  );

  it('carries every figure through without arithmetic of its own', () => {
    const payload = toComparisonPayload(result);
    expect(payload.cut_bcy).toBe(result.cutBcy);
    expect(payload.fill_ccy).toBe(result.fillCcy);
    expect(payload.net_bcy).toBe(result.netBcy);
    expect(payload.cells_compared).toBe(result.cellsCompared);
    expect(payload.coverage).toBe(result.coverage);
    expect(Number(payload.cut_bcy)).toBeCloseTo(46.2963, 3);
    expect(Number(payload.fill_ccy)).toBeCloseTo(46.2963, 3);
  });

  it('emits exactly the fields the recorder accepts, and no others', () => {
    /*
     * `app.record_surface_comparison` refuses an unknown key rather than
     * ignoring it, so a field renamed on one side has to be renamed on the
     * other. Reading the list out of the migration is what makes that true
     * rather than hoped for.
     */
    const sql = readFileSync(
      join(ROOT, 'supabase/migrations/0193_a_surface_somebody_shot.sql'), 'utf8');
    const block = sql.slice(sql.indexOf('v_known constant text[] := array['));
    const accepted = [...block.slice(0, block.indexOf('];')).matchAll(/'([a-z_]+)'/g)]
      .map((m) => m[1]).sort();
    expect(accepted.length).toBeGreaterThan(0);
    expect(Object.keys(toComparisonPayload(result)).sort()).toEqual(accepted);
  });
});
