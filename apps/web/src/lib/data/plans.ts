/**
 * Handing the plans over, and getting quantities back.
 *
 * `ai-analyze-document` has existed since migration 0019 — it reads a plan set
 * with Claude, writes cited findings in state `proposed`, refuses a factual
 * finding with no citation, and is told in its own prompt that it does not
 * compute cost, price, production or duration. None of it could be reached,
 * because the function takes a `documentVersionId` and nothing in the platform
 * ever created one.
 *
 * Three steps, and the middle one is the one nobody can skip: upload the file,
 * ask the model to read it, and have a person accept or reject each finding.
 * The model proposes and a person decides — RULE-008 — which is why
 * `acceptFinding` is a separate call a human makes rather than something the
 * analysis does on its way past.
 */
import { unwrap, type Query } from './query';
import { callFunction } from '@/lib/supabase';

export interface PlanDocument {
  id: string;
  name: string;
  documentType: string;
  fileName: string;
  byteSize: number | null;
  pageCount: number | null;
  currentVersionId: string;
  processingState: string;
  createdAt: string;
  findingCount: number;
  awaitingReview: number;
}

export interface Finding {
  id: string;
  findingType: string;
  title: string;
  description: string;
  /** The model's own score. Never the line's — that is the engine's to compute. */
  confidence: number;
  state: string;
  severity: string | null;
  quantity: number | null;
  unit: string | null;
  /** How the quantity was obtained: dimensioned, scaled, calculated, allowance… */
  method: string | null;
  sheetReferences: string[];
  specificationReferences: string[];
  citations: Array<{ sheet?: string; section?: string; quote?: string }>;
  model: string | null;
  documentName: string | null;
  reviewNote: string | null;
  appliedEntityId: string | null;
  createdAt: string;
}

type RpcCapable = {
  rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
type StorageCapable = {
  storage: {
    from: (bucket: string) => {
      upload: (path: string, file: File, options?: Record<string, unknown>) =>
        PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

const rpc = async <T,>(client: RpcCapable, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
};

const num = (v: unknown): number | null => (v == null ? null : Number(v));

/** The plan sets this company has uploaded, and what came of each. */
export const loadPlanDocuments: Query<PlanDocument[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_documents')
    .select('id, name, document_type, file_name, byte_size, page_count, current_version_id, processing_state, created_at, finding_count, awaiting_review')
    .order('created_at', { ascending: false })
    .limit(100)) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    documentType: String(r.document_type),
    fileName: String(r.file_name ?? ''),
    byteSize: num(r.byte_size),
    pageCount: num(r.page_count),
    currentVersionId: String(r.current_version_id),
    processingState: String(r.processing_state ?? 'pending'),
    createdAt: String(r.created_at),
    findingCount: Number(r.finding_count ?? 0),
    awaitingReview: Number(r.awaiting_review ?? 0),
  }));
};

/** What the model found in one document, newest first. */
export const loadFindings = (documentVersionId: string): Query<Finding[]> =>
  async (client) => {
    const rows = unwrap(await client
      .from('my_ai_findings')
      .select('id, finding_type, title, description, confidence, state, severity, quantity, unit, method, sheet_references, specification_references, citations, model, document_name, review_note, applied_entity_id, created_at')
      .eq('document_version_id', documentVersionId)
      .order('confidence', { ascending: false })) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      findingType: String(r.finding_type),
      title: String(r.title),
      description: String(r.description ?? ''),
      confidence: Number(r.confidence ?? 0),
      state: String(r.state),
      severity: (r.severity as string | null) ?? null,
      quantity: num(r.quantity),
      unit: (r.unit as string | null) ?? null,
      method: (r.method as string | null) ?? null,
      sheetReferences: (r.sheet_references as string[]) ?? [],
      specificationReferences: (r.specification_references as string[]) ?? [],
      citations: Array.isArray(r.citations)
        ? (r.citations as Finding['citations']) : [],
      model: (r.model as string | null) ?? null,
      documentName: (r.document_name as string | null) ?? null,
      reviewNote: (r.review_note as string | null) ?? null,
      appliedEntityId: (r.applied_entity_id as string | null) ?? null,
      createdAt: String(r.created_at),
    }));
  };

/**
 * Put a file in storage and file the rows that make it a document.
 *
 * The path begins with the company id because that is what the storage policy
 * reads to decide whose file it is; `app.register_document_version` refuses a
 * path that says otherwise, so a document nobody can open cannot be created.
 */
export async function uploadPlanSet(
  client: RpcCapable & StorageCapable,
  input: { companyId: string; file: File; name?: string;
           documentType?: string; estimateId?: string | null },
): Promise<string> {
  const safe = input.file.name.replace(/[^A-Za-z0-9._-]/g, '-');
  const path = `${input.companyId}/${crypto.randomUUID()}-${safe}`;

  const { error } = await client.storage
    .from('project-documents')
    .upload(path, input.file, { contentType: input.file.type || undefined, upsert: false });
  if (error) throw new Error(error.message);

  return rpc<string>(client, 'register_document_version', {
    p_company: input.companyId,
    p_name: input.name?.trim() || input.file.name,
    p_storage_path: path,
    p_file_name: input.file.name,
    p_mime_type: input.file.type || null,
    p_byte_size: input.file.size,
    p_document_type: input.documentType ?? 'plan_set',
    p_estimate_id: input.estimateId ?? null,
    p_page_count: null,
  });
}

export interface AnalysisOutcome {
  status: 'read' | 'refused' | 'failed';
  message: string;
  findings: number;
  rejected: number;
}

/**
 * Ask the model to read a document.
 *
 * Reports what happened rather than throwing, because every one of these
 * outcomes is a thing an estimator needs told: it read the plans and found
 * nothing, the plan does not include AI plan review, the model is not
 * configured, the document could not be opened.
 */
export async function analyzeDocument(
  companyId: string, documentVersionId: string,
): Promise<AnalysisOutcome> {
  try {
    const result = await callFunction<Record<string, unknown>>('ai-analyze-document', {
      companyId, documentVersionId,
    });
    return {
      status: 'read',
      message: String(result.message ?? 'The document has been read.'),
      findings: Number(result.findings ?? 0),
      rejected: Number(result.rejected ?? 0),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The document could not be read.';
    /*
     * An entitlement refusal is not a fault — it is a plan that does not
     * include plan review, and saying "failed" would send somebody looking for
     * a bug instead of at their subscription.
     */
    const refused = /entitle|not included|forbidden|permission|plan does not/i.test(message);
    return { status: refused ? 'refused' : 'failed', message, findings: 0, rejected: 0 };
  }
}

/**
 * Accept a quantity candidate onto an estimate.
 *
 * The human half of RULE-008. The line records that it came from AI and who
 * accepted it; the model's own confidence is deliberately not carried across,
 * because a line's confidence is the engine's to compute.
 */
export async function acceptFinding(
  client: RpcCapable, findingId: string, versionId: string, note?: string | null,
): Promise<string> {
  return rpc<string>(client, 'accept_finding_as_line', {
    p_finding: findingId, p_version: versionId, p_note: note?.trim() || null,
  });
}

/** Set one aside, with the reason the next reader deserves. */
export async function rejectFinding(
  client: RpcCapable, findingId: string, note: string,
): Promise<void> {
  await rpc(client, 'reject_finding', { p_finding: findingId, p_note: note.trim() });
}
