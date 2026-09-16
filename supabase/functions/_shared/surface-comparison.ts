/**
 * Database rows into the surfaces engine, and the engine's result back out.
 *
 * Extracted from the handler for the same reason `estimate-pricing.ts` was:
 * since migration 0193 nothing else may write a cut or fill yardage, so a
 * mistake here is not a display bug — it is a wrong quantity on a bid, produced
 * by the one component permitted to produce quantities.
 *
 * Two properties this file holds and its tests check:
 *
 *   1. **It computes nothing.** Every figure it emits is one the engine
 *      returned. The engine has its own suite for the arithmetic, and a second
 *      opinion about what a volume is would be worse than none.
 *   2. **The keys it emits are exactly the keys the recorder accepts.** A key
 *      that matches nothing writes nothing and reports success — 0136 and 0139
 *      learned that twice — so `app.record_surface_comparison` refuses an
 *      unknown one, and the test pins this payload against the list in the
 *      migration rather than against a copy of it.
 */
import type { Grid, SurfaceVolumeResult } from './engine/surfaces.d.ts';

/** A PostgREST row, once past the client's own view of what a select returns. */
export type SurfaceRow = Record<string, unknown>;

/**
 * One `surfaces` row as the engine wants it.
 *
 * Numerics arrive as strings over PostgREST, which is why every one of these
 * goes through `Number` rather than being trusted as it stands: a cell size of
 * `"25.000"` multiplied by a depth is `NaN`, and `NaN` cubic yards renders as a
 * dash rather than as an error.
 */
export function toGrid(row: SurfaceRow): Grid {
  const raw = row.elevations;
  const cells = Array.isArray(raw) ? raw : [];
  const easting = row.origin_easting;
  return {
    cellSize: Number(row.cell_size_ft),
    rows: Number(row.grid_rows),
    cols: Number(row.grid_cols),
    elevations: cells.map((v) => (v === null || v === undefined ? null : Number(v))),
    origin: easting === null || easting === undefined
      ? undefined
      : { easting: Number(easting), northing: Number(row.origin_northing) },
    name: String(row.name),
  };
}

/** Whether a surface has its elevations loaded, or only a file reference. */
export function hasGrid(row: SurfaceRow): boolean {
  return Array.isArray(row.elevations) && (row.elevations as unknown[]).length > 0;
}

/** The engine's result in the shape `record_surface_comparison` accepts. */
export function toComparisonPayload(result: SurfaceVolumeResult): Record<string, unknown> {
  return {
    cut_bcy: result.cutBcy,
    fill_ccy: result.fillCcy,
    net_bcy: result.netBcy,
    cut_area_sf: result.cutAreaSf,
    fill_area_sf: result.fillAreaSf,
    max_cut_depth_ft: result.maxCutDepth,
    max_fill_depth_ft: result.maxFillDepth,
    average_cut_depth_ft: result.averageCutDepth,
    average_fill_depth_ft: result.averageFillDepth,
    cells_compared: result.cellsCompared,
    cells_skipped: result.cellsSkipped,
    coverage: result.coverage,
    warnings: [...result.warnings],
  };
}
