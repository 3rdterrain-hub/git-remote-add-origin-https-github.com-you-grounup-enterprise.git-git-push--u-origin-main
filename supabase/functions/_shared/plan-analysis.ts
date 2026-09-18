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
                  page: { type: 'integer' },
                  quote: { type: 'string', maxLength: 500 },
                },
              },
            },
            confidence: { type: 'number' },
            severity: { type: 'string', enum: ['low', 'moderate', 'high', 'critical'] },
            quantity: { type: 'number' },
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
      /* A quantity below zero is not a quantity. Null is the honest reading of
         a figure the model should not have produced. */
      quantity: f.quantity == null ? null : within(f.quantity, 0, Number.MAX_SAFE_INTEGER),
      unit: f.unit ?? null,
      measurementMethod: f.measurementMethod ?? null,
      discipline: f.discipline ?? null,
    },
    /* A page number below one is a citation nobody can turn to. */
    citations: f.citations.map((c) => (
      c.page == null ? c : { ...c, page: within(c.page, 1, Number.MAX_SAFE_INTEGER) ?? 1 })),
    sheet_references: f.citations.map((c) => c.reference),
    confidence: Math.round((within(f.confidence, 0, 100) ?? 0) * 10) / 10,
    suggested_gate: suggestedGate,
    severity: f.severity ?? null,
    state: 'proposed' as const,
    model: ctx.model,
    prompt_version: ctx.promptVersion,
  };
}

/**
 * Hold a number the model returned inside the range it was asked for.
 *
 * The schema used to carry `minimum` and `maximum`, and the API refuses them —
 * `output_config.format.schema: For 'integer' type, property 'minimum' is not
 * supported`. That refusal is what made the first real analysis fail, and it
 * exposed the worse half: nothing in this file enforced the bounds either. They
 * were decorative. A confidence of 500 or a negative quantity would have gone
 * into `ai_findings` and onto a screen beside figures a person had checked.
 *
 * So the range lives here now, where the model's output is untrusted anyway.
 */
function within(value: unknown, low: number, high: number): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(high, Math.max(low, n));
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

/** Pages sent in one request when the set has a text layer. */
export const TEXT_BATCH = 20;
/**
 * Pages asked about in one request when the set is scanned.
 *
 * One, and every part of that number was measured on a real fourteen-page set
 * rather than chosen.
 *
 * Four pages ran past the platform's limit before finishing anything. Two got
 * the first batch home in ninety-nine seconds — pages one and two, a cover
 * sheet and an index — and then died on pages five and six, which are dense
 * drawings. The platform said what it was: `IDLE_TIMEOUT — Request idle timeout
 * limit (150s) reached`, a 504.
 *
 * So a drawing is roughly seventy-five to a hundred seconds at high effort, and
 * the honest batch size is the one that fits the worst page rather than the
 * average one. A cover sheet read on its own costs a few seconds of overhead;
 * a dense sheet batched with another costs the whole set.
 */
export const SCAN_BATCH = 1;

/**
 * How hard the model thinks, and why it is not the same on both paths.
 *
 * High everywhere is what this asked for, and on a scan it does not fit. A
 * single dense drawing at high effort was killed three times at the platform's
 * hard limit — `IDLE_TIMEOUT — Request idle timeout limit (150s) reached`, then
 * `WORKER_RESOURCE_LIMIT` at 151 seconds — with the batch already down to one
 * page and nothing left to divide.
 *
 * So the scan path reads at medium. That is a real reduction and it is written
 * down rather than buried: a page read at medium is read less carefully than
 * one read at high, and the job records which path ran, so a finding off a scan
 * can be weighed accordingly. The alternative was a feature that reads nothing
 * at all, which is not a higher standard — it is the absence of one.
 *
 * Text keeps high. There is no image to interpret, the pages are cheap, and
 * twenty of them come back well inside the limit.
 */
export const SCAN_EFFORT = 'medium' as const;
export const TEXT_EFFORT = 'high' as const;

/**
 * How long an answer about this many pages is allowed to be.
 *
 * Flat, and deliberately generous, after a scaled version of this was tried on
 * a real set and was wrong. The reasoning was that the generation is the time,
 * so a two-page batch should be given a quarter of the room of a twenty-page
 * one. Eight thousand tokens was the result, and the run came back with
 * `findingsRejected: 1, "Response was not valid JSON"` and exactly eight
 * thousand output tokens — the model had been cut off mid-sentence.
 *
 * Two things were wrong in it. Thinking counts against this ceiling, so at high
 * effort most of the room is gone before a word of the answer is written. And
 * the time is spent thinking, not writing, so lowering the ceiling bought no
 * time at all — it only truncated the part that mattered.
 *
 * The time is controlled where it actually lives: how many pages one batch
 * asks about. This is only a stop on a runaway.
 */
export function maxTokensFor(_pages: number): number {
  return 32_000;
}

/**
 * How long one invocation may keep working before it hands the rest back.
 *
 * The platform kills a worker at its own limit without running the function's
 * error handler, so the function has to stop before that rather than be stopped
 * at it. The difference between stopping and being stopped is a job that says
 * "eight of fourteen pages, ask again" and a job that says "extracting" forever.
 */
export const BUDGET_MS = 55_000;

/**
 * The next run of pages to read, or null when there are none left.
 *
 * Expressed in pages rather than array indexes because that is what the job
 * records and what a person is shown: `pages_processed` is a count of pages
 * finished, not an offset into anything.
 */
export function nextRun(
  pagesProcessed: number, pagesTotal: number, batch: number,
): { from: number; to: number } | null {
  const from = Math.max(0, Math.floor(pagesProcessed));
  if (!(pagesTotal > 0) || from >= pagesTotal) return null;
  if (!(batch >= 1)) return null;
  return { from, to: Math.min(from + Math.floor(batch), pagesTotal) };
}

/**
 * Whether to hand the rest back rather than start another run.
 *
 * Asked *before* a run and not after, because the question is whether there is
 * time for the next one — a budget checked after the fact is a budget that has
 * already been spent. `longestRunMs` is the slowest run so far, so a set whose
 * pages are dense stops earlier than one whose pages are sparse, without
 * anybody choosing a number for either.
 */
export function shouldHandBack(
  elapsedMs: number, longestRunMs: number, budgetMs = BUDGET_MS,
): boolean {
  return elapsedMs + Math.max(longestRunMs, 1_000) > budgetMs;
}
