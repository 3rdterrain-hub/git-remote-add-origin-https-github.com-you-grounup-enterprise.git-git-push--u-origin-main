/**
 * Pricing an estimate, from the browser's side.
 *
 * The browser does not price anything. It asks. Since migration 0058 the
 * engine-output columns refuse a hand-written value and the one function
 * permitted to write them is granted to `service_role` alone — which a browser
 * never holds — so this module's whole job is to make the request, and to
 * report honestly what came back.
 *
 * Reporting honestly is most of the work. A pricing run has four outcomes and
 * three of them are not errors:
 *
 *   * it priced;
 *   * it could not, because the estimate is missing something — a rate, a
 *     profile, a line with nothing on it — and the holes are listed;
 *   * it could not, because the engine refused the inputs it was given;
 *   * the version is frozen, and repricing it is not a thing that happens.
 *
 * Collapsing those into "pricing failed" would leave an estimator guessing at
 * an estimate they are about to bid.
 */
import { callFunction } from '@/lib/supabase';

/** A hole the engine found. Each names the line it is on, where there is one. */
export interface PricingProblem {
  lineId: string | null;
  field: string;
  detail: string;
}

export interface PricingResult {
  engineVersion: string;
  directCost: number;
  indirectCost: number;
  totalPrice: number;
  bidPrice: number;
  grossMarginPercent: number;
  weightedConfidence: number;
  confidenceBand: string;
  recommendedContingency: number;
  appliedContingency: number;
  executiveDecision: string;
  executiveDecisionReason: string;
  blockedFromIssue: boolean;
  totalLaborHours: number;
  totalDurationDays: number;
  warnings: string[];
  lineCount: number;
}

export type PricingOutcome =
  | { status: 'priced'; result: PricingResult }
  | { status: 'incomplete'; message: string; problems: PricingProblem[] }
  | { status: 'frozen'; message: string }
  | { status: 'failed'; message: string };

/**
 * Ask the engine to price a version.
 *
 * `asOf` decides which rates are in force. Passing the estimate's own date
 * rather than today's is what lets an old version reprice to what it actually
 * cost then, instead of being silently repriced against the current rate sheet.
 */
export async function priceEstimateVersion(
  estimateVersionId: string,
  asOf?: string,
): Promise<PricingOutcome> {
  try {
    const result = await callFunction<PricingResult>('price-estimate', {
      estimateVersionId, ...(asOf ? { asOf } : {}),
    });
    return { status: 'priced', result };
  } catch (err) {
    const e = err as Error & { code?: string; details?: PricingProblem[] | null };
    if (e.code === 'incomplete') {
      return { status: 'incomplete', message: e.message, problems: e.details ?? [] };
    }
    if (e.code === 'conflict') return { status: 'frozen', message: e.message };
    return { status: 'failed', message: e.message };
  }
}
