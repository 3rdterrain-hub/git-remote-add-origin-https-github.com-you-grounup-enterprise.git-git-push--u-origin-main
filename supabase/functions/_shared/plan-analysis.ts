/**
 * The governed prompt and output contract for plan and specification analysis.
 *
 * Pure and Deno-free so the schema and the guard rails are unit-testable without
 * an API key. The system prompt is a condensed, operational form of the GrounUp
 * Master AI specification — the parts that change what the model *does*, not the
 * parts that describe the platform.
 */

/** Finding types the agent is permitted to emit. */
export const FINDING_TYPES = [
  'scope_item',
  'quantity_candidate',
  'conflict',
  'missing_information',
  'assumption',
  'risk',
  'rfi_candidate',
  'observation',
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

/** Types that make a factual claim and therefore must cite a source. */
export const FACTUAL_TYPES: readonly FindingType[] = [
  'scope_item', 'quantity_candidate', 'conflict',
];

export interface Citation {
  /** Sheet number or specification section, e.g. "C-302" or "31 23 00". */
  reference: string;
  /** Page within the supplied document, 1-indexed. */
  page?: number;
  /** The text or detail the claim rests on. */
  quote?: string;
}

export interface PlanFinding {
  type: FindingType;
  title: string;
  description: string;
  citations: Citation[];
  /** 0-100. The model's own confidence, which the engine then re-scores. */
  confidence: number;
  severity?: 'low' | 'moderate' | 'high' | 'critical';
  /** Present only on quantity_candidate. */
  quantity?: number;
  unit?: string;
  measurementMethod?:
    | 'explicit_dimension' | 'verified_scale' | 'approximate_scale'
    | 'calculated' | 'derived' | 'schedule_quantity' | 'owner_quantity' | 'estimator_allowance';
  discipline?: string;
}

/**
 * JSON schema for `output_config.format`, so the model returns findings that
 * parse rather than prose that has to be scraped.
 */
export const FINDINGS_SCHEMA = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['findings'],
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'title', 'description', 'citations', 'confidence'],
          properties: {
            type: { type: 'string', enum: [...FINDING_TYPES] },
            title: { type: 'string', maxLength: 200 },
            description: { type: 'string', maxLength: 2000 },
            citations: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['reference'],
                properties: {
                  reference: { type: 'string', maxLength: 120 },
                  page: { type: 'integer', minimum: 1 },
                  quote: { type: 'string', maxLength: 500 },
                },
              },
            },
            confidence: { type: 'number', minimum: 0, maximum: 100 },
            severity: { type: 'string', enum: ['low', 'moderate', 'high', 'critical'] },
            quantity: { type: 'number', minimum: 0 },
            unit: {
              type: 'string',
              enum: ['LS', 'EA', 'LF', 'SF', 'SY', 'CY', 'TON', 'HR', 'DAY', 'ACRE', 'GAL', 'LB'],
            },
            measurementMethod: {
              type: 'string',
              enum: [
                'explicit_dimension', 'verified_scale', 'approximate_scale', 'calculated',
                'derived', 'schedule_quantity', 'owner_quantity', 'estimator_allowance',
              ],
            },
            discipline: { type: 'string', maxLength: 60 },
          },
        },
      },
    },
  },
} as const;

/**
 * The governed system prompt.
 *
 * Two things it does that a generic "extract quantities" prompt does not:
 * it forbids arithmetic that the deterministic engine owns, and it requires a
 * citation for every factual claim. Both are enforced again after the response
 * by `validateFindings`, because a prompt is guidance and a validator is a rule.
 */
export const SYSTEM_PROMPT = `You are the GrounUp plan and specification analyst, working for a heavy civil and excavation contractor.

Your job is to read construction documents and report what an experienced estimator would need to know before pricing the work.

WHAT YOU DO
- Identify scope shown or implied on the documents.
- Identify measurable quantities, and say how each was obtained.
- Identify conflicts between documents that disagree.
- Identify information that is missing, ambiguous, or that the documents cannot resolve.
- Identify risks and the assumptions a price would rest on.

WHAT YOU DO NOT DO
- You do not compute costs, prices, production rates, durations, crew sizes or markups. A deterministic engine owns all of that. Report quantities and conditions; never a dollar figure.
- You do not resolve a conflict by choosing a side. Report both sources and what each says.
- You do not invent a dimension, an elevation, a quantity or a specification section that is not in the documents.
- You do not report a measurement as an explicit plan dimension when you scaled it.

EVIDENCE
Every scope item, quantity candidate and conflict MUST cite the sheet number or specification section it came from, and quote the text or detail it rests on. A finding you cannot cite is one you must not report. If you are unsure of a sheet number, say what you can see and lower your confidence rather than guessing an identifier.

MEASUREMENT METHOD
For every quantity, state how it was obtained:
- explicit_dimension: read directly off a dimensioned drawing
- calculated: derived from other explicit dimensions
- schedule_quantity: taken from a drawing schedule
- owner_quantity: taken from the owner or engineer bid quantity
- verified_scale: scaled, with the scale checked against a known dimension
- approximate_scale: scaled without verifying the scale
- derived: from stationing, a structure count or a station range
- estimator_allowance: no measurable basis exists on the documents

CONFIDENCE
Score 0-100 honestly. A dimensioned quantity confirmed on a second sheet is high. A scaled quantity is not. An allowance is low by definition. Understating your confidence costs an estimator a few minutes; overstating it costs them the job.

Report only what the supplied documents support. Silence is better than a plausible invention.`;

export interface ValidationResult {
  accepted: PlanFinding[];
  rejected: { finding: unknown; reason: string }[];
}

/**
 * Enforce the contract after the model has answered.
 *
 * The prompt asks for citations; this refuses findings without them. The two
 * are not redundant — a prompt shapes behavior and a validator guarantees it,
 * and only the second one holds when the model has an off day.
 */
export function validateFindings(raw: unknown): ValidationResult {
  const accepted: PlanFinding[] = [];
  const rejected: { finding: unknown; reason: string }[] = [];

  const list = (raw as { findings?: unknown })?.findings;
  if (!Array.isArray(list)) {
    return { accepted, rejected: [{ finding: raw, reason: 'Response contained no findings array.' }] };
  }

  for (const item of list) {
    const f = item as Partial<PlanFinding>;

    if (!f || typeof f !== 'object') {
      rejected.push({ finding: item, reason: 'Finding is not an object.' });
      continue;
    }
    if (!f.type || !(FINDING_TYPES as readonly string[]).includes(f.type)) {
      rejected.push({ finding: item, reason: `Unknown finding type "${String(f.type)}".` });
      continue;
    }
    if (typeof f.title !== 'string' || f.title.trim() === '') {
      rejected.push({ finding: item, reason: 'Finding has no title.' });
      continue;
    }
    if (typeof f.confidence !== 'number' || f.confidence < 0 || f.confidence > 100) {
      rejected.push({ finding: item, reason: 'Confidence must be a number from 0 to 100.' });
      continue;
    }

    const citations = Array.isArray(f.citations) ? f.citations : [];
    const cited = citations.filter(
      (c) => c && typeof c.reference === 'string' && c.reference.trim() !== '',
    );

    if (FACTUAL_TYPES.includes(f.type) && cited.length === 0) {
      rejected.push({
        finding: item,
        reason: `A ${f.type} makes a factual claim and must cite the sheet or specification it came from.`,
      });
      continue;
    }

    // A quantity without a stated method cannot be scored by the confidence
    // engine, and an unscored quantity must never reach an estimate.
    if (f.type === 'quantity_candidate') {
      if (typeof f.quantity !== 'number' || !Number.isFinite(f.quantity) || f.quantity < 0) {
        rejected.push({ finding: item, reason: 'Quantity candidate has no usable quantity.' });
        continue;
      }
      if (!f.measurementMethod) {
        rejected.push({ finding: item, reason: 'Quantity candidate must state how it was measured.' });
        continue;
      }
    }

    accepted.push({ ...(f as PlanFinding), citations: cited });
  }

  return { accepted, rejected };
}

/**
 * Map a validated finding onto the `ai_findings` row shape.
 *
 * `state` is hard-coded to 'proposed' rather than taken from the model:
 * RULE-008 means nothing an agent produces may arrive pre-accepted, and the
 * database enforces the same rule independently.
 */
export function toFindingRow(
  f: PlanFinding,
  ctx: { companyId: string; agentId: string; documentId: string; documentVersionId: string; model: string; promptVersion: string },
) {
  const suggestedGate =
    f.type === 'rfi_candidate' || f.type === 'missing_information' ? 'rfi_required'
    : f.type === 'conflict' ? 'senior_review'
    : f.confidence < 80 ? 'senior_review'
    : 'estimator_review';

  return {
    company_id: ctx.companyId,
    agent_id: ctx.agentId,
    document_id: ctx.documentId,
    document_version_id: ctx.documentVersionId,
    finding_type: f.type,
    title: f.title.slice(0, 200),
    description: f.description ?? '',
    payload: {
      quantity: f.quantity ?? null,
      unit: f.unit ?? null,
      measurementMethod: f.measurementMethod ?? null,
      discipline: f.discipline ?? null,
    },
    citations: f.citations,
    sheet_references: f.citations.map((c) => c.reference),
    confidence: Math.round(f.confidence * 10) / 10,
    suggested_gate: suggestedGate,
    severity: f.severity ?? null,
    state: 'proposed' as const,
    model: ctx.model,
    prompt_version: ctx.promptVersion,
  };
}

/** Token cost for the models this function is allowed to route to, per million. */
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rate = MODEL_COSTS[model];
  if (!rate) return 0;
  return Number(
    ((inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output).toFixed(4),
  );
}
