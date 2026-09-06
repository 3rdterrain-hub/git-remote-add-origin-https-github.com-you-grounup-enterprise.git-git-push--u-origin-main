/**
 * Estimate templates.
 *
 * A contractor who bids the same kind of job every week should not rebuild the
 * structure every week. A template is a captured estimate version — its lines,
 * and on each line the crew, the equipment, the material and the haul — saved
 * once and started from thereafter.
 *
 * Two facts this module has to keep visible, because getting either wrong turns
 * a convenience into a bad bid:
 *
 *   * **Whether the template carries quantities.** Off by default. A template
 *     is the shape of a job, not the last one's takeoff, and 4,200 cubic yards
 *     arriving because that is what the last pond held is the kind of number
 *     that gets sent. Every screen that offers a template says which it is.
 *
 *   * **What it lost on the way in.** A template saved a year ago may name a
 *     material the company has since retired. The database keeps the line,
 *     clears the reference and reports it; these functions carry that report
 *     back rather than dropping it, because a template that quietly lost a
 *     machine is worse than one that failed.
 *
 * Applying a template never carries a price. The payload holds no engine-owned
 * column, so what arrives is an unpriced estimate the engine then prices
 * against today's rates.
 */
import { unwrap, type Query } from './query';

export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  trade: string | null;
  lineCount: number;
  /** Whether it brings the quantities it was captured with. */
  carriesQuantities: boolean;
  status: 'active' | 'archived';
  timesUsed: number;
  lastUsedAt: string | null;
  createdAt: string;
  /** How many of its lines have a crew or machine attached. */
  linesWithResources: number;
  markupCount: number;
  sourceEstimateNumber: string | null;
  sourceEstimateName: string | null;
}

export interface TemplateLine {
  position: number;
  description: string;
  unit: string;
  measuredQuantity: number;
  resourceCount: number;
  modifierCount: number;
}

/** What applying a template actually did, including what it could not bring. */
export interface ApplyResult {
  linesAdded: number;
  carriesQuantities: boolean;
  warnings: string[];
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

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/**
 * Read the apply result defensively.
 *
 * The database returns an object; a client that received something else has a
 * problem worth surfacing as zero lines rather than as a crash inside a dialog.
 */
const toApplyResult = (raw: unknown): ApplyResult => {
  const r = (raw ?? {}) as Record<string, unknown>;
  const warnings = Array.isArray(r.warnings) ? r.warnings.map(String) : [];
  return {
    linesAdded: num(r.lines_added),
    carriesQuantities: r.carries_quantities === true,
    warnings,
  };
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The templates this company can start from. Archived ones are excluded. */
export const loadTemplates: Query<TemplateRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_estimate_templates')
    .select('id, name, description, trade, line_count, carries_quantities, status, times_used, last_used_at, created_at, lines_with_resources, markup_count, source_estimate_number, source_estimate_name')
    .eq('status', 'active')
    .order('times_used', { ascending: false })
    .order('name')) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    description: (r.description as string | null) ?? null,
    trade: (r.trade as string | null) ?? null,
    lineCount: num(r.line_count),
    carriesQuantities: r.carries_quantities === true,
    status: (r.status as 'active' | 'archived') ?? 'active',
    timesUsed: num(r.times_used),
    lastUsedAt: (r.last_used_at as string | null) ?? null,
    createdAt: String(r.created_at),
    linesWithResources: num(r.lines_with_resources),
    markupCount: num(r.markup_count),
    sourceEstimateNumber: (r.source_estimate_number as string | null) ?? null,
    sourceEstimateName: (r.source_estimate_name as string | null) ?? null,
  }));
};

/** What applying this template would add, so nobody applies one blind. */
export const loadTemplateLines = (templateId: string): Query<TemplateLine[]> =>
  async (client) => {
    const rows = unwrap(await client
      .from('estimate_template_lines')
      .select('position, description, unit, measured_quantity, resource_count, modifier_count')
      .eq('template_id', templateId)
      .order('position')) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      position: num(r.position),
      description: String(r.description ?? ''),
      unit: String(r.unit ?? ''),
      measuredQuantity: num(r.measured_quantity),
      resourceCount: num(r.resource_count),
      modifierCount: num(r.modifier_count),
    }));
  };

// ---------------------------------------------------------------------------
// Writing — governed functions, never a bare insert
// ---------------------------------------------------------------------------

/** Capture a version as a template. Returns the new template's id. */
export async function saveTemplate(
  client: RpcCapable,
  input: {
    versionId: string;
    name: string;
    description?: string | null;
    trade?: string | null;
    includeQuantities?: boolean;
  },
): Promise<string> {
  return rpc<string>(client, 'save_estimate_template', {
    p_version: input.versionId,
    p_name: input.name.trim(),
    p_description: input.description?.trim() || null,
    p_trade: input.trade?.trim() || null,
    p_include_quantities: input.includeQuantities === true,
  });
}

/** Add a template's lines to an estimate that is already open. */
export async function applyTemplate(
  client: RpcCapable, versionId: string, templateId: string,
): Promise<ApplyResult> {
  return toApplyResult(await rpc<unknown>(client, 'apply_estimate_template', {
    p_version: versionId, p_template: templateId,
  }));
}

/**
 * Start a whole estimate from a template.
 *
 * One call rather than two, so a template that fails to apply does not leave an
 * empty estimate behind with a number burned on it.
 */
export async function createEstimateFromTemplate(
  client: RpcCapable,
  input: {
    templateId: string;
    name: string;
    customerId?: string | null;
    number?: string | null;
    bidDueAt?: string | null;
    companyId?: string | null;
  },
): Promise<ApplyResult & { estimateId: string; versionId: string }> {
  const raw = await rpc<Record<string, unknown>>(client, 'create_estimate_from_template', {
    p_template: input.templateId,
    p_name: input.name.trim(),
    p_customer_id: input.customerId ?? null,
    p_number: input.number?.trim() || null,
    p_bid_due_at: input.bidDueAt || null,
    p_company: input.companyId ?? null,
  });
  return {
    ...toApplyResult(raw),
    estimateId: String(raw?.estimate ?? ''),
    versionId: String(raw?.version ?? ''),
  };
}

/** Put a template away, or bring it back. Archived rather than deleted. */
export async function archiveTemplate(
  client: RpcCapable, templateId: string, archived = true,
): Promise<void> {
  await rpc(client, 'archive_estimate_template', {
    p_template: templateId, p_archived: archived,
  });
}
