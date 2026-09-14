/**
 * Naming the sheets of a set. ENTITY.
 *
 * `document_sheets` has carried `sheet_number`, `sheet_title`, `discipline`,
 * `drawing_scale`, `revision` and `revision_date` since migration 0005, and an
 * index on `(company_id, sheet_number)` for finding a sheet by the number
 * printed on it. Nothing ever wrote one, so a fourteen-sheet civil set listed
 * as "p.1" through "p.14" and the estimator had to remember which page was the
 * site plan.
 *
 * The title block is on the drawing. Reading it and typing it in takes ten
 * seconds a sheet and it stays read.
 */
import { unwrap, type Query } from './query';

export interface PlanSheet {
  id: string;
  companyId: string;
  documentId: string;
  documentName: string;
  documentVersionId: string;
  /** Where the file itself is, so the picker and the viewer read one row. */
  storageBucket: string;
  storagePath: string;
  pageNumber: number;
  sheetNumber: string | null;
  sheetTitle: string | null;
  discipline: string | null;
  drawingScale: string | null;
  revision: string | null;
  revisionDate: string | null;
  /** What to call this sheet — built in the view so everything calls it the same. */
  label: string;
  unnamed: boolean;
  measurementCount: number;
  calibrationCount: number;
}

type RpcCapable = {
  rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/** Every sheet this company can see, in set and page order. */
export const loadPlanSheets: Query<PlanSheet[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_plan_sheets')
    .select('id, company_id, document_id, document_name, document_version_id, storage_bucket, storage_path, page_number, sheet_number, sheet_title, discipline, drawing_scale, revision, revision_date, label, unnamed, measurement_count, calibration_count')
    .order('document_name', { ascending: true })
    .order('page_number', { ascending: true })
    .limit(1000)) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    companyId: String(r.company_id),
    documentId: String(r.document_id),
    documentName: String(r.document_name ?? ''),
    documentVersionId: String(r.document_version_id),
    storageBucket: String(r.storage_bucket ?? 'project-documents'),
    storagePath: String(r.storage_path ?? ''),
    pageNumber: Number(r.page_number ?? 0),
    sheetNumber: (r.sheet_number as string | null) ?? null,
    sheetTitle: (r.sheet_title as string | null) ?? null,
    discipline: (r.discipline as string | null) ?? null,
    drawingScale: (r.drawing_scale as string | null) ?? null,
    revision: (r.revision as string | null) ?? null,
    revisionDate: (r.revision_date as string | null) ?? null,
    label: String(r.label ?? ''),
    unnamed: Boolean(r.unnamed),
    measurementCount: Number(r.measurement_count ?? 0),
    calibrationCount: Number(r.calibration_count ?? 0),
  }));
};

export interface SheetIdentity {
  sheetNumber?: string | null;
  sheetTitle?: string | null;
  discipline?: string | null;
  drawingScale?: string | null;
  revision?: string | null;
  revisionDate?: string | null;
}

/**
 * Name a sheet, or correct one field of a named one.
 *
 * Undefined leaves a field where it was; the database reads null the same way,
 * so a form that sends only what it changed cannot blank the rest.
 */
export async function identifySheet(
  client: RpcCapable, sheetId: string, identity: SheetIdentity,
): Promise<void> {
  const t = (v: string | null | undefined) =>
    (v === undefined || v === null ? null : (v.trim() || null));
  const { error } = await client.rpc('identify_sheet', {
    p_sheet: sheetId,
    p_sheet_number: t(identity.sheetNumber),
    p_sheet_title: t(identity.sheetTitle),
    p_discipline: t(identity.discipline),
    p_drawing_scale: t(identity.drawingScale),
    p_revision: t(identity.revision),
    p_revision_date: t(identity.revisionDate),
    p_source: 'human',
  });
  if (error) throw new Error(error.message);
}

/**
 * The disciplines a civil set is divided into.
 *
 * Offered rather than enforced — the column is free text, because a set that
 * arrives with a discipline nobody listed still has to be nameable.
 */
export const DISCIPLINES = [
  'Civil', 'Survey', 'Architectural', 'Structural', 'Mechanical', 'Electrical',
  'Plumbing', 'Landscape', 'Utility', 'Demolition', 'Environmental', 'General',
] as const;
