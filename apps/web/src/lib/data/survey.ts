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
import { supabase, callFunction } from '@/lib/supabase';

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
  surfaces: SurfaceRow[];
}

export interface SurfaceRow {
  id: string;
  surveyId: string;
  name: string;
  role: string;
  cellSizeFt: number;
  gridRows: number;
  gridCols: number;
  cellCount: number;
  /** Whether the elevations are loaded, or only a file reference is on record. */
  hasGrid: boolean;
  minElevation: number | null;
  maxElevation: number | null;
  originEasting: number | null;
  originNorthing: number | null;
  /**
   * The published machine control file cut from this surface, if there is one.
   *
   * A surface a machine is cutting to cannot have its geometry moved — 0048
   * refuses it — and a screen that does not say so beforehand turns a rule into
   * an error message. This is how it says so beforehand.
   */
  frozenByFile: string | null;
  comparisonCount: number;
  projectId: string | null;
  surveyName: string;
  verticalDatum: string;
  units: string;
}

/**
 * Every capture, with the surfaces built out of it.
 *
 * Two reads rather than an embed, because `my_surfaces` carries the two facts
 * the table alone cannot answer — whether a surface's elevations are actually
 * loaded, and which published file has frozen it — and a screen that has to say
 * "you cannot move this" needs to know before somebody tries.
 */
export const loadSurveys: Query<SurveyRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_surveys')
    .select('id, name, capture_method, captured_on, captured_by, horizontal_datum, '
      + 'vertical_datum, coordinate_system, units, point_count, area_sf, project_id, '
      + 'project_number')
    .order('captured_on', { ascending: false })) as unknown as Array<Record<string, unknown>>;

  const surfaces = await loadSurfaces(client);
  const bySurvey = new Map<string, SurfaceRow[]>();
  for (const f of surfaces) {
    const list = bySurvey.get(f.surveyId) ?? [];
    list.push(f);
    bySurvey.set(f.surveyId, list);
  }

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
    projectNumber: (s.project_number as string | null) ?? null,
    surfaces: bySurvey.get(String(s.id)) ?? [],
  }));
};

/** Every surface the caller can see, whichever capture it came out of. */
export const loadSurfaces: Query<SurfaceRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_surfaces')
    .select('id, survey_id, name, surface_role, cell_size_ft, grid_rows, grid_cols, '
      + 'cell_count, has_grid, min_elevation, max_elevation, origin_easting, '
      + 'origin_northing, frozen_by_file, comparison_count, project_id, survey_name, '
      + 'vertical_datum, units')
    .order('name')) as unknown as Array<Record<string, unknown>>;
  return rows.map((f) => ({
    id: String(f.id),
    surveyId: String(f.survey_id),
    name: String(f.name),
    role: String(f.surface_role),
    cellSizeFt: num(f.cell_size_ft),
    gridRows: num(f.grid_rows),
    gridCols: num(f.grid_cols),
    cellCount: num(f.cell_count),
    hasGrid: f.has_grid === true,
    minElevation: maybeNum(f.min_elevation),
    maxElevation: maybeNum(f.max_elevation),
    originEasting: maybeNum(f.origin_easting),
    originNorthing: maybeNum(f.origin_northing),
    frozenByFile: (f.frozen_by_file as string | null) ?? null,
    comparisonCount: num(f.comparison_count),
    projectId: (f.project_id as string | null) ?? null,
    surveyName: String(f.survey_name),
    verticalDatum: String(f.vertical_datum),
    units: String(f.units),
  }));
};

export interface MachineAssignmentRow {
  id: string;
  assetId: string;
  assetNumber: string;
  assetName: string;
  fileId: string;
  fileName: string;
  fileFormat: string;
  vendor: string | null;
  version: number;
  fileStatus: string;
  projectId: string | null;
  projectNumber: string | null;
  supersededByName: string | null;
  isCurrent: boolean;
  /** Sent and acknowledged are different facts, and only one of them is a machine. */
  acknowledgedAt: string | null;
  awaitingAcknowledgement: boolean;
  fileWithdrawnOrSuperseded: boolean;
  assignedAt: string;
}

/** What each machine is carrying, and whether what it carries is still current. */
export const loadMachineAssignments: Query<MachineAssignmentRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_machine_assignments')
    .select('id, asset_id, asset_number, asset_name, machine_control_file_id, file_name, '
      + 'file_format, vendor, version, file_status, project_id, project_number, '
      + 'superseded_by_name, is_current, acknowledged_at, awaiting_acknowledgement, '
      + 'file_withdrawn_or_superseded, assigned_at')
    .order('assigned_at', { ascending: false })) as unknown as Array<Record<string, unknown>>;
  return rows.map((a) => ({
    id: String(a.id),
    assetId: String(a.asset_id),
    assetNumber: String(a.asset_number),
    assetName: String(a.asset_name),
    fileId: String(a.machine_control_file_id),
    fileName: String(a.file_name),
    fileFormat: String(a.file_format),
    vendor: (a.vendor as string | null) ?? null,
    version: num(a.version),
    fileStatus: String(a.file_status),
    projectId: (a.project_id as string | null) ?? null,
    projectNumber: (a.project_number as string | null) ?? null,
    supersededByName: (a.superseded_by_name as string | null) ?? null,
    isCurrent: a.is_current === true,
    acknowledgedAt: (a.acknowledged_at as string | null) ?? null,
    awaitingAcknowledgement: a.awaiting_acknowledgement === true,
    fileWithdrawnOrSuperseded: a.file_withdrawn_or_superseded === true,
    assignedAt: String(a.assigned_at),
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
      /* `asset_number`, not `code`: the wrong name makes PostgREST refuse the
         whole request, so this list came back empty rather than wrong. */
      + 'machine_assignments(is_current, acknowledged_at, assets(id, asset_number))')
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
        const asset = one<{ id: string; asset_number: string }>(a.assets);
        return {
          assetId: asset?.id ?? '',
          assetCode: asset?.asset_number ?? '—',
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

/* ---------------------------------------------------------------------------
 * Writers — migration 0193
 *
 * Every table this module reads had a reader and no writer, which is the defect
 * this repository keeps producing with the last layer missing. A screen listing
 * surveys that nobody could add a survey to is a screen that is empty forever,
 * and an empty list looks exactly like a broken one.
 * ------------------------------------------------------------------------- */

export interface SurveyInput {
  projectId: string;
  name: string;
  captureMethod: string;
  capturedOn: string;
  capturedBy?: string | null;
  horizontalDatum: string;
  verticalDatum: string;
  coordinateSystem?: string | null;
  units: string;
  pointCount?: number | null;
  areaSf?: number | null;
  storagePath?: string | null;
  notes?: string | null;
}

/** The capture methods the schema accepts, in the order a list should offer them. */
export const CAPTURE_METHODS = [
  'gps_rover', 'total_station', 'drone_photogrammetry', 'lidar',
  'design_model', 'as_built', 'imported',
] as const;

/** The roles a surface can play in a comparison. */
export const SURFACE_ROLES = [
  'existing', 'design', 'subgrade', 'as_built', 'stockpile_base', 'stockpile',
] as const;

export const SURVEY_UNITS = ['us_survey_feet', 'international_feet', 'meters'] as const;

export const MACHINE_FORMATS = ['ttm', 'dxf', 'xml_landxml', 'gc3', 'svd', 'csv_points'] as const;

export const MACHINE_VENDORS = [
  'trimble', 'topcon', 'leica', 'komatsu', 'caterpillar', 'other',
] as const;

export async function recordSurvey(input: SurveyInput): Promise<string> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { data, error } = await supabase.rpc('record_survey', {
    p_project: input.projectId,
    p_name: input.name.trim(),
    p_capture_method: input.captureMethod,
    p_captured_on: input.capturedOn,
    p_captured_by: input.capturedBy?.trim() || null,
    p_horizontal_datum: input.horizontalDatum.trim(),
    p_vertical_datum: input.verticalDatum.trim(),
    p_coordinate_system: input.coordinateSystem?.trim() || null,
    p_units: input.units,
    p_point_count: input.pointCount ?? null,
    p_area_sf: input.areaSf ?? null,
    p_storage_path: input.storagePath ?? null,
    p_notes: input.notes?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function updateSurvey(surveyId: string, changes: Partial<{
  name: string; captureMethod: string; capturedOn: string; capturedBy: string;
  horizontalDatum: string; verticalDatum: string; coordinateSystem: string;
  units: string; pointCount: number; areaSf: number; notes: string;
}>): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('update_survey', {
    p_survey: surveyId,
    p_name: changes.name ?? null,
    p_capture_method: changes.captureMethod ?? null,
    p_captured_on: changes.capturedOn ?? null,
    p_captured_by: changes.capturedBy ?? null,
    p_horizontal_datum: changes.horizontalDatum ?? null,
    p_vertical_datum: changes.verticalDatum ?? null,
    p_coordinate_system: changes.coordinateSystem ?? null,
    p_units: changes.units ?? null,
    p_point_count: changes.pointCount ?? null,
    p_area_sf: changes.areaSf ?? null,
    p_notes: changes.notes ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * Add a surface to a capture.
 *
 * `elevations` is the row-major grid, one value per cell, `null` where there is
 * no data. The database checks it against the grid it claims to be — an array
 * of the wrong length is the one mistake here that produces a plausible answer
 * instead of an error.
 */
export async function createSurface(input: {
  surveyId: string; name: string; surfaceRole: string;
  cellSizeFt: number; gridRows: number; gridCols: number;
  elevations?: Array<number | null> | null;
  storagePath?: string | null;
  originEasting?: number | null;
  originNorthing?: number | null;
}): Promise<string> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { data, error } = await supabase.rpc('create_surface', {
    p_survey: input.surveyId,
    p_name: input.name.trim(),
    p_surface_role: input.surfaceRole,
    p_cell_size_ft: input.cellSizeFt,
    p_grid_rows: input.gridRows,
    p_grid_cols: input.gridCols,
    p_elevations: input.elevations ?? null,
    p_storage_path: input.storagePath ?? null,
    p_origin_easting: input.originEasting ?? null,
    p_origin_northing: input.originNorthing ?? null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function updateSurface(surfaceId: string, changes: Partial<{
  name: string; surfaceRole: string; originEasting: number; originNorthing: number;
  storagePath: string;
}>): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('update_surface', {
    p_surface: surfaceId,
    p_name: changes.name ?? null,
    p_surface_role: changes.surfaceRole ?? null,
    p_origin_easting: changes.originEasting ?? null,
    p_origin_northing: changes.originNorthing ?? null,
    p_storage_path: changes.storagePath ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function removeSurface(surfaceId: string): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('remove_surface', { p_surface: surfaceId });
  if (error) throw new Error(error.message);
}

export interface ComputedVolume {
  comparisonId: string;
  cutBcy: number;
  fillCcy: number;
  netBcy: number;
  cellsCompared: number;
  cellsSkipped: number;
  coverage: number;
  derivation: string;
  warnings: string[];
}

/**
 * Compute the volume between two surfaces.
 *
 * The engine does this, not the browser and not a second implementation in SQL.
 * Since 0193 every reported column on `surface_comparisons` refuses a
 * hand-written value and the recorder is granted to the service role alone, so
 * this Edge Function is the only way a cut yardage comes to exist — the same
 * boundary that stands around a price and around float.
 */
export async function computeVolume(input: {
  companyId: string; projectId: string;
  existingSurfaceId: string; designSurfaceId: string; name: string;
}): Promise<ComputedVolume> {
  return callFunction<ComputedVolume>('compare-surfaces', input);
}

export async function removeSurfaceComparison(comparisonId: string): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('remove_surface_comparison', {
    p_comparison: comparisonId,
  });
  if (error) throw new Error(error.message);
}

export async function recordMachineControlFile(input: {
  projectId: string; name: string; fileFormat: string; storagePath: string;
  surfaceId?: string | null; vendor?: string | null; checksum?: string | null;
}): Promise<string> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { data, error } = await supabase.rpc('record_machine_control_file', {
    p_project: input.projectId,
    p_name: input.name.trim(),
    p_file_format: input.fileFormat,
    p_storage_path: input.storagePath.trim(),
    p_surface: input.surfaceId ?? null,
    p_vendor: input.vendor ?? null,
    p_checksum: input.checksum?.trim().toLowerCase() || null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

/** Publish a design to the machines. The digest is what makes it verifiable. */
export async function publishMachineControlFile(
  fileId: string, checksum?: string | null,
): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('publish_machine_control_file', {
    p_file: fileId, p_checksum: checksum?.trim().toLowerCase() || null,
  });
  if (error) throw new Error(error.message);
}

export async function supersedeMachineControlFile(
  fileId: string, replacementId: string,
): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('supersede_machine_control_file', {
    p_file: fileId, p_replacement: replacementId,
  });
  if (error) throw new Error(error.message);
}

export async function withdrawMachineControlFile(fileId: string): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('withdraw_machine_control_file', { p_file: fileId });
  if (error) throw new Error(error.message);
}

/** O-022, closed: a published file goes to a machine, and only a published one. */
export async function sendFileToMachine(assetId: string, fileId: string): Promise<string> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { data, error } = await supabase.rpc('send_file_to_machine', {
    p_asset: assetId, p_file: fileId,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function acknowledgeMachineFile(assignmentId: string): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('acknowledge_machine_file', {
    p_assignment: assignmentId,
  });
  if (error) throw new Error(error.message);
}
