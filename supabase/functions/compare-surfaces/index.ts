/**
 * POST /functions/v1/compare-surfaces
 *
 * Compute the earthwork between two surfaces and record it.
 *
 * This is the only path by which a cut or fill yardage comes to exist. Since
 * migration 0193 every reported column on `surface_comparisons` — the cut, the
 * fill, the net, the areas, the depths, the coverage and the warnings — refuses
 * a hand-written value, and `app.record_surface_comparison` is granted to
 * `service_role` alone. A browser holds the anon key and a user's JWT and can
 * reach neither. The same boundary 0058 drew around a price and 0158 drew
 * around float, for the same reason: this is the number the job is bid and paid
 * on, and a number somebody typed is a number nobody can reproduce.
 *
 * The checks stand in the same order as `recalculate-schedule`:
 *
 *   1. **Authentication.** No caller, no volume.
 *   2. **Authorization**, asked of the database through the caller's own client.
 *   3. **Loading through the caller's client**, so a surface they cannot see is
 *      a surface they cannot cause to be measured. The service role is used for
 *      the write and for nothing else.
 *
 * What is deliberately not done here: guessing. A surface whose grid lives in
 * storage rather than inline is refused by name rather than compared on a
 * partial array, and the datum, unit, grid and georeference agreement is left
 * to the database guards from 0023 and 0047 — they refuse the insert, and their
 * message is the one that reaches the screen.
 *
 * Deploy: supabase functions deploy compare-surfaces
 */
import { getCaller, requirePermission, isUuid, adminClient } from '../_shared/auth.ts';
import { fail, json, preflight } from '../_shared/http.ts';
import { compareSurfaces } from '../_shared/engine/surfaces.js';
import {
  toGrid, hasGrid, toComparisonPayload, type SurfaceRow as Row,
} from '../_shared/surface-comparison.ts';

/** The engine's own version, reported so a volume names what produced it. */
const ENGINE_VERSION = 'grounup-engine/surfaces@1';

const SURFACE_COLUMNS =
  'id, name, cell_size_ft, grid_rows, grid_cols, elevations, storage_path, '
  + 'origin_easting, origin_northing, company_id';

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405, origin);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const existingId = typeof body.existingSurfaceId === 'string' ? body.existingSurfaceId : '';
  const designId = typeof body.designSurfaceId === 'string' ? body.designSurfaceId : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!isUuid(companyId)) return fail('bad_request', 'companyId must be a uuid.', 400, origin);
  if (!isUuid(projectId)) return fail('bad_request', 'projectId must be a uuid.', 400, origin);
  if (!isUuid(existingId)) return fail('bad_request', 'existingSurfaceId must be a uuid.', 400, origin);
  if (!isUuid(designId)) return fail('bad_request', 'designSurfaceId must be a uuid.', 400, origin);
  if (existingId === designId) {
    return fail('bad_request', 'A surface compared with itself has no volume between it.', 400, origin);
  }
  if (name.length === 0) return fail('bad_request', 'A volume needs a name.', 400, origin);

  const caller = await getCaller(req);
  if (!caller) return fail('unauthenticated', 'Sign in first.', 401, origin);

  const allowed = await requirePermission(caller, companyId, 'projects.write');
  if (!allowed.ok) return fail('forbidden', allowed.reason, 403, origin);

  const client = caller.client;

  const { data: surfaces, error: readError } = await client
    .from('surfaces')
    .select(SURFACE_COLUMNS)
    .in('id', [existingId, designId]);
  if (readError) return fail('read_failed', readError.message, 400, origin);

  const rows = (surfaces ?? []) as unknown as Row[];
  const existingRow = rows.find((r) => String(r.id) === existingId);
  const designRow = rows.find((r) => String(r.id) === designId);
  if (!existingRow || !designRow) {
    return fail('not_found', 'One of those surfaces is not yours to compare.', 404, origin);
  }

  /*
   * A surface whose grid was never loaded is named rather than compared. An
   * empty array is a legal row — the file may not have been gridded yet — and
   * comparing it would report a volume of zero over zero cells, which reads
   * exactly like flat ground.
   */
  for (const row of [existingRow, designRow]) {
    if (!hasGrid(row)) {
      return json({ error: {
        code: 'no_grid',
        message: `"${String(row.name)}" has no elevations loaded, only a file reference. `
          + 'A volume over a surface with no grid would come out as zero, which reads exactly like flat ground.',
      } }, 422, origin);
    }
  }

  let result;
  try {
    result = compareSurfaces(toGrid(existingRow), toGrid(designRow));
  } catch (e) {
    return fail('bad_request', e instanceof Error ? e.message : String(e), 422, origin);
  }

  const { data: id, error: writeError } = await adminClient()
    .rpc('record_surface_comparison', {
      p_company: companyId,
      p_project: projectId,
      p_existing: existingId,
      p_design: designId,
      p_name: name,
      p_engine_version: ENGINE_VERSION,
      p_result: toComparisonPayload(result),
    });
  if (writeError) return fail('write_failed', writeError.message, 400, origin);

  return json({
    comparisonId: id,
    engineVersion: ENGINE_VERSION,
    cutBcy: result.cutBcy,
    fillCcy: result.fillCcy,
    netBcy: result.netBcy,
    cutAreaSf: result.cutAreaSf,
    fillAreaSf: result.fillAreaSf,
    cellsCompared: result.cellsCompared,
    cellsSkipped: result.cellsSkipped,
    coverage: result.coverage,
    derivation: result.derivation,
    warnings: [...result.warnings],
  }, 200, origin);
});
