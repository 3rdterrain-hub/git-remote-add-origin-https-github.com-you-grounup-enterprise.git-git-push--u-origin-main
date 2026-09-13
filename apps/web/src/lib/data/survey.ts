/**
 * Entity — what was measured on site, and what it implies about moving dirt.
 *
 * `survey.tsx` read `SURVEYS`, `MC_FILES`, `SURFACE_COMPARISON`,
 * `EXISTING_SURFACE` and `DESIGN_SURFACE` from `@/data/survey`. Five governed
 * tables sat behind it — `surveys`, `surfaces`, `surface_comparisons`,
 * `machine_control_files`, `machine_assignments` — and none had a reader.
 *
 * Two things this module is careful about.
 *
 * **The volumes are read, not recomputed.** `surface_comparisons` stores the
 * cut, the fill, the net and the areas as computed, and a browser recomputing
 * them from the grids would eventually disagree with the record the company
 * kept. The guard behind that record is worth knowing about:
 * `enforce_surface_datum_match` refuses to compare two surfaces on different
 * vertical datums, because the volume between them would be wrong by exactly
 * the datum offset, and refuses mismatched units or grids.
 *
 * **The soil properties come from the company, and the ones nobody recorded
 * are not invented.** Swell and shrink are stored (`companies`, 0002). The
 * unsuitable fraction is a judgment about a particular site and no column
 * holds it, so the balance assumes none and the screen says so — a assumed
 * six percent would move thousands of yards of import on a number nobody
 * chose.
 */
import { unwrap, type Query } from './query';

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const maybeNum = (v: unknown): number | null =>
  (v === null || v === undefined ? null : Number(v));
const one = <T,>(v: unknown): T | null =>
  (Array.isArray(v) ? (v[0] as T | undefined) ?? null : (v as T | null));

export interface SurveyRow {
  id: string;
  name: string;
  captureMethod: string;
  capturedOn: string;
  capturedBy: string | null;
  horizontalDatum: string;
  verticalDatum: string;
  coordinateSystem: string | null;
  units: string;
  pointCount: number | null;
  areaSf: number | null;
  projectNumber: string | null;
  projectId: string | null;
  /** The surfaces built from this capture, by the role each one plays. */
  surfaces: Array<{ id: string; name: string; role: string; cellSizeFt: number }>;
}

export const loadSurveys: Query<SurveyRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('surveys')
    .select('id, name, capture_method, captured_on, captured_by, horizontal_datum, '
      + 'vertical_datum, coordinate_system, units, point_count, area_sf, project_id, '
      + 'projects(number), surfaces(id, name, surface_role, cell_size_ft)')
    .order('captured_on', { ascending: false })) as unknown as Array<Record<string, unknown>>;

  return rows.map((s) => ({
    id: String(s.id),
    name: String(s.name),
    captureMethod: String(s.capture_method),
    capturedOn: String(s.captured_on),
    capturedBy: (s.captured_by as string | null) ?? null,
    horizontalDatum: String(s.horizontal_datum),
    verticalDatum: String(s.vertical_datum),
    coordinateSystem: (s.coordinate_system as string | null) ?? null,
    units: String(s.units),
    pointCount: maybeNum(s.point_count),
    areaSf: maybeNum(s.area_sf),
    projectId: (s.project_id as string | null) ?? null,
    projectNumber: one<{ number: string }>(s.projects)?.number ?? null,
    surfaces: ((s.surfaces ?? []) as Array<Record<string, unknown>>).map((f) => ({
      id: String(f.id),
      name: String(f.name),
      role: String(f.surface_role),
      cellSizeFt: num(f.cell_size_ft),
    })),
  }));
};

export interface SurfaceComparisonRow {
  id: string;
  name: string;
  computedAt: string;
  projectId: string | null;
  projectNumber: string | null;
  /** As computed and stored. Never recomputed in the browser. */
  cutBcy: number;
  fillCcy: number;
  netBcy: number;
  cutAreaSf: number;
  fillAreaSf: number;
  maxCutDepthFt: number | null;
  maxFillDepthFt: number | null;
  /**
   * The fraction of the compared area the survey actually covered.
   *
   * Stored, and worth its place: a volume computed over eighty percent of a
   * site is not a volume for the site, and a partial flight read as a full one
   * is how a number ends up short by a fifth with nothing on screen saying so.
   */
  coverage: number;
  existingSurfaceId: string;
  designSurfaceId: string;
  existingSurfaceName: string | null;
  designSurfaceName: string | null;
}

export const loadSurfaceComparisons: Query<SurfaceComparisonRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('surface_comparisons')
    .select('id, name, computed_at, project_id, cut_bcy, fill_ccy, net_bcy, cut_area_sf, '
      + 'fill_area_sf, max_cut_depth_ft, max_fill_depth_ft, coverage, existing_surface_id, '
      + 'design_surface_id, projects(number), '
      + 'existing:surfaces!surface_comparisons_existing_surface_id_fkey(name), '
      + 'design:surfaces!surface_comparisons_design_surface_id_fkey(name)')
    .order('computed_at', { ascending: false })) as unknown as Array<Record<string, unknown>>;

  return rows.map((c) => ({
    id: String(c.id),
    name: String(c.name),
    computedAt: String(c.computed_at),
    projectId: (c.project_id as string | null) ?? null,
    projectNumber: one<{ number: string }>(c.projects)?.number ?? null,
    cutBcy: num(c.cut_bcy),
    fillCcy: num(c.fill_ccy),
    netBcy: num(c.net_bcy),
    cutAreaSf: num(c.cut_area_sf),
    fillAreaSf: num(c.fill_area_sf),
    maxCutDepthFt: maybeNum(c.max_cut_depth_ft),
    maxFillDepthFt: maybeNum(c.max_fill_depth_ft),
    coverage: num(c.coverage),
    existingSurfaceId: String(c.existing_surface_id),
    designSurfaceId: String(c.design_surface_id),
    existingSurfaceName: one<{ name: string }>(c.existing)?.name ?? null,
    designSurfaceName: one<{ name: string }>(c.design)?.name ?? null,
  }));
};

export interface SurfaceGrid {
  id: string;
  name: string;
  rows: number;
  cols: number;
  cellSizeFt: number;
  /** Row-major, null where the survey covered nothing. */
  elevations: Array<number | null>;
  /**
   * Where cell (0,0) sits on the ground (migration 0047).
   *
   * Without it the engine cannot tell two grids of the same shape over
   * *different ground* from two over the same ground, and the volume between
   * them would be, in 0047's words, entirely fictitious and entirely plausible.
   * Loaded so the comparison can be refused rather than reported.
   */
  origin: { easting: number; northing: number } | null;
}

/**
 * One surface's grid, for the depth map.
 *
 * Loaded separately from the comparison because the elevations are the largest
 * thing in the schema by some distance, and a list of comparisons that dragged
 * two grids along with each row would be a slow page about a fast question.
 */
export const loadSurfaceGrid = (surfaceId: string): Query<SurfaceGrid | null> =>
  async (client) => {
    const rows = unwrap(await client
      .from('surfaces')
      .select('id, name, grid_rows, grid_cols, cell_size_ft, elevations, '
        + 'origin_easting, origin_northing')
      .eq('id', surfaceId)
      .limit(1)) as unknown as Array<Record<string, unknown>>;
    const s = rows[0];
    if (!s) return null;
    return {
      id: String(s.id),
      name: String(s.name),
      rows: num(s.grid_rows),
      cols: num(s.grid_cols),
      cellSizeFt: num(s.cell_size_ft),
      elevations: (s.elevations as Array<number | null> | null) ?? [],
      origin: s.origin_easting !== null && s.origin_easting !== undefined
        && s.origin_northing !== null && s.origin_northing !== undefined
        ? { easting: num(s.origin_easting), northing: num(s.origin_northing) }
        : null,
    };
  };

export interface MachineFileRow {
  id: string;
  name: string;
  fileFormat: string;
  vendor: string | null;
  version: number;
  status: string;
  publishedAt: string | null;
  supersededById: string | null;
  projectNumber: string | null;
  surfaceName: string | null;
  /** Machines currently carrying this file. */
  assignedTo: Array<{ assetCode: string; assetId: string; acknowledged: boolean }>;
}

export const loadMachineFiles: Query<MachineFileRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('machine_control_files')
    .select('id, name, file_format, vendor, version, status, published_at, superseded_by_id, '
      + 'projects(number), surfaces(name), '
      + 'machine_assignments(is_current, acknowledged_at, assets(id, code))')
    .order('name')) as unknown as Array<Record<string, unknown>>;

  return rows.map((f) => {
    const assignments = ((f.machine_assignments ?? []) as Array<Record<string, unknown>>)
      .filter((a) => a.is_current === true);
    return {
      id: String(f.id),
      name: String(f.name),
      fileFormat: String(f.file_format),
      vendor: (f.vendor as string | null) ?? null,
      version: num(f.version),
      status: String(f.status),
      publishedAt: (f.published_at as string | null) ?? null,
      supersededById: (f.superseded_by_id as string | null) ?? null,
      projectNumber: one<{ number: string }>(f.projects)?.number ?? null,
      surfaceName: one<{ name: string }>(f.surfaces)?.name ?? null,
      assignedTo: assignments.map((a) => {
        const asset = one<{ id: string; code: string }>(a.assets);
        return {
          assetId: asset?.id ?? '',
          assetCode: asset?.code ?? '—',
          /*
           * Sent and acknowledged are different facts. A file the machine has
           * not confirmed is a file the operator may not be cutting to.
           */
          acknowledged: a.acknowledged_at !== null && a.acknowledged_at !== undefined,
        };
      }),
    };
  });
};

export interface SoilDefaults { swellPercent: number; shrinkPercent: number }

/**
 * The company's own soil properties.
 *
 * Read rather than assumed: swell and shrink decide how much bank cut becomes
 * truckloads and how much fill a yard of it makes, and a wrong default moves
 * real money. There is deliberately no unsuitable fraction here — no column
 * holds one, it is a judgment about a particular site, and assuming a number
 * would import dirt nobody asked for.
 */
export const loadSoilDefaults: Query<SoilDefaults | null> = async (client) => {
  const rows = unwrap(await client
    .from('companies')
    .select('default_swell_percent, default_shrink_percent')
    .limit(1)) as Array<Record<string, unknown>>;
  const c = rows[0];
  if (!c) return null;
  return {
    swellPercent: num(c.default_swell_percent),
    shrinkPercent: num(c.default_shrink_percent),
  };
};

/**
 * The as-built surface for a survey's project, if one has been captured.
 *
 * Progress is not stored anywhere and should not be: it is the comparison of
 * three surfaces at a moment, and the moment moves. What the schema holds is
 * the surfaces — `surface_role` includes `as_built` — and the engine's
 * `progressAgainstDesign` does the rest.
 *
 * Why it matters more than a percentage: over-excavation is separated from
 * progress rather than counted toward it. A cell cut below design grade is not
 * a hundred and ten percent finished, it is fill that has to be brought back
 * and recompacted, and counting it as progress is how a job reports ninety-five
 * percent complete and then loses a week.
 */
export const loadAsBuiltSurfaceId = (projectId: string): Query<string | null> =>
  async (client) => {
    const rows = unwrap(await client
      .from('surfaces')
      .select('id, surface_role, surveys!inner(project_id, captured_on)')
      .eq('surface_role', 'as_built')
      .eq('surveys.project_id', projectId)
      .order('id')) as unknown as Array<Record<string, unknown>>;
    /* The most recent capture, because progress is a statement about now. */
    const latest = rows
      .map((r) => ({
        id: String(r.id),
        capturedOn: String(one<{ captured_on: string }>(r.surveys)?.captured_on ?? ''),
      }))
      .sort((a, b) => (a.capturedOn < b.capturedOn ? 1 : -1))[0];
    return latest?.id ?? null;
  };
