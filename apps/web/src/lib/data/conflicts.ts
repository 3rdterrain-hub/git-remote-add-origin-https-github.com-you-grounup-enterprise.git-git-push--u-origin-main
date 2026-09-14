/**
 * Where the documents disagree. WORKFLOW.
 *
 * `document_conflicts` has existed since migration 0006 and the confidence
 * engine has read it since 0033 — every unresolved conflict on a line takes
 * twenty-two points off that line's confidence and routes the estimate to
 * senior review. Nothing could record one, so every bid this platform has ever
 * priced was priced as though the plans, the specifications, the geotechnical
 * report and the addenda all agreed with each other.
 *
 * A conflict is stated from both sides or not at all: what document A is and
 * what it says, what document B is and what it says. Stated from one side it is
 * an opinion, and nobody but its author can settle it.
 */
import { unwrap, type Query } from './query';

export interface DocumentConflict {
  id: string;
  estimateVersionId: string | null;
  lineItemId: string | null;
  title: string;
  description: string;
  sourceA: string;
  sourceASays: string;
  sourceB: string;
  sourceBSays: string;
  discipline: string | null;
  severity: string;
  quantityImpact: boolean;
  costImpact: boolean;
  scheduleImpact: boolean;
  resolution: string | null;
  resolvedAt: string | null;
  detectedBy: string;
  createdAt: string;
  lineDescription: string | null;
  estimateNumber: string | null;
  /** How many RFIs have gone out about it. */
  rfiCount: number;
}

type RpcCapable = {
  rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const rpc = async <T,>(client: RpcCapable, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
};

/** Every conflict on this company's estimates, unresolved first. */
export const loadDocumentConflicts: Query<DocumentConflict[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_document_conflicts')
    .select('id, estimate_version_id, line_item_id, title, description, source_a, source_a_says, source_b, source_b_says, discipline, severity, quantity_impact, cost_impact, schedule_impact, resolution, resolved_at, detected_by, created_at, line_description, estimate_number, rfi_count')
    .order('resolved_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false })
    .limit(200)) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    estimateVersionId: (r.estimate_version_id as string | null) ?? null,
    lineItemId: (r.line_item_id as string | null) ?? null,
    title: String(r.title ?? ''),
    description: String(r.description ?? ''),
    sourceA: String(r.source_a ?? ''),
    sourceASays: String(r.source_a_says ?? ''),
    sourceB: String(r.source_b ?? ''),
    sourceBSays: String(r.source_b_says ?? ''),
    discipline: (r.discipline as string | null) ?? null,
    severity: String(r.severity ?? 'moderate'),
    quantityImpact: Boolean(r.quantity_impact),
    costImpact: Boolean(r.cost_impact),
    scheduleImpact: Boolean(r.schedule_impact),
    resolution: (r.resolution as string | null) ?? null,
    resolvedAt: (r.resolved_at as string | null) ?? null,
    detectedBy: String(r.detected_by ?? 'human'),
    createdAt: String(r.created_at ?? ''),
    lineDescription: (r.line_description as string | null) ?? null,
    estimateNumber: (r.estimate_number as string | null) ?? null,
    rfiCount: Number(r.rfi_count ?? 0),
  }));
};

export const SEVERITIES = ['low', 'moderate', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface NewConflict {
  title: string;
  description: string;
  sourceA: string;
  sourceASays: string;
  sourceB: string;
  sourceBSays: string;
  estimateVersionId?: string | null;
  lineItemId?: string | null;
  discipline?: string | null;
  severity?: Severity;
  quantityImpact?: boolean;
  costImpact?: boolean;
  scheduleImpact?: boolean;
}

/** Record that two documents disagree, on the line it lands on. */
export async function raiseConflict(
  client: RpcCapable, input: NewConflict,
): Promise<string> {
  return rpc<string>(client, 'raise_document_conflict', {
    p_title: input.title.trim(),
    p_description: input.description.trim(),
    p_source_a: input.sourceA.trim(),
    p_source_a_says: input.sourceASays.trim(),
    p_source_b: input.sourceB.trim(),
    p_source_b_says: input.sourceBSays.trim(),
    p_version: input.estimateVersionId ?? null,
    p_line: input.lineItemId ?? null,
    p_discipline: input.discipline?.trim() || null,
    p_severity: input.severity ?? 'moderate',
    p_quantity_impact: input.quantityImpact ?? false,
    p_cost_impact: input.costImpact ?? false,
    p_schedule_impact: input.scheduleImpact ?? false,
    p_detected_by: 'human',
  });
}

/**
 * Say how it was settled.
 *
 * The answer is required. A conflict closed with no answer is one somebody
 * finds again on the next revision and settles differently.
 */
export async function resolveConflict(
  client: RpcCapable, conflictId: string, resolution: string,
): Promise<void> {
  await rpc(client, 'resolve_document_conflict', {
    p_conflict: conflictId, p_resolution: resolution.trim(),
  });
}

/** Turn a conflict into the question it implies, carrying both sides across. */
export async function askAboutConflict(
  client: RpcCapable, conflictId: string,
  question?: string | null, priority: 'low' | 'normal' | 'high' | 'critical' = 'normal',
): Promise<string> {
  return rpc<string>(client, 'conflict_to_rfi', {
    p_conflict: conflictId,
    p_question: question?.trim() || null,
    p_priority: priority,
  });
}
