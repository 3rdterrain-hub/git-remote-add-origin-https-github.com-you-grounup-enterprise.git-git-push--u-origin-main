/**
 * Confidence scoring, verification status and approval gates.
 *
 * Implements Master AI specification Sections 7, 44 and 45. This module is the
 * governor that keeps AI output out of an approved estimate: nothing reaches
 * `auto_accept` without a verified, referenced, conflict-free basis, and
 * anything below the senior-review floor is blocked from issue regardless of
 * how confident the model that produced it claimed to be.
 */

import { clamp, factor, roundTo } from './numeric.js';
import { METHOD_RELIABILITY, type MeasurementMethod } from './quantity.js';
import { SOURCE_RELIABILITY, type ProductionSourceType } from './production.js';

// ---------------------------------------------------------------------------
// Verification (Section 7)
// ---------------------------------------------------------------------------

/** The three independent checks a critical quantity must survive. */
export interface VerificationChecks {
  /** Check 1 — the value was read from its primary drawing source. */
  primarySource: boolean;
  /** Check 2 — confirmed against a second, independent document. */
  crossSource: boolean;
  /** Check 3 — reproduced by an independent calculation or geometry. */
  mathematicalReconciliation: boolean;
}

export type VerificationStatus =
  | 'verified'            // three-way confirmation
  | 'high_confidence'     // two independent confirmations
  | 'moderate_confidence' // usable, requires assumptions
  | 'low_confidence'      // material uncertainty
  | 'do_not_price';       // materially incomplete

export function verificationStatus(checks: VerificationChecks, hasUnresolvedConflict = false): VerificationStatus {
  if (hasUnresolvedConflict) return 'do_not_price';
  const passed = Number(checks.primarySource) + Number(checks.crossSource) + Number(checks.mathematicalReconciliation);
  if (!checks.primarySource) return passed === 0 ? 'do_not_price' : 'low_confidence';
  if (passed === 3) return 'verified';
  if (passed === 2) return 'high_confidence';
  return 'moderate_confidence';
}

// ---------------------------------------------------------------------------
// Confidence score (Section 45)
// ---------------------------------------------------------------------------

export interface ConfidenceInput {
  measurementMethod: MeasurementMethod;
  checks: VerificationChecks;
  /** Trust in the production/price data behind the line. */
  dataSource?: ProductionSourceType;
  /** Unresolved conflicts between documents affecting this item. */
  conflictCount?: number;
  /** Assumptions the line depends on. */
  assumptionCount?: number;
  /** Drawing/spec references recorded on the line. */
  sourceCount?: number;
  /** Engine warnings raised anywhere in the line's calculation chain. */
  warningCount?: number;
  /** An open RFI blocks the item from being priced with confidence. */
  hasOpenRfi?: boolean;
}

export interface ConfidenceResult {
  /** 0-100. */
  score: number;
  band: 'verified' | 'strong' | 'reliable' | 'assumption' | 'uncertain' | 'do_not_price';
  verificationStatus: VerificationStatus;
  /** Contingency percent this confidence justifies (Section 7.2). */
  recommendedContingency: number;
  requiresSeniorReview: boolean;
  /** Every factor that moved the score, so a sub-90 score can be explained. */
  factors: readonly { label: string; effect: number; detail: string }[];
  explanation: string;
}

/** Section 45 requires every score below 90 to be explained. */
const EXPLANATION_FLOOR = 90;
/** Section 7.2: at or below this score, senior review is mandatory. */
export const SENIOR_REVIEW_FLOOR = 69;

/**
 * Composite confidence score.
 *
 * The score starts from how the quantity was obtained — a scaled measurement
 * can never score as well as a dimensioned one — and is then moved by
 * verification depth, data provenance, conflicts and open questions. Penalties
 * are deliberately asymmetric: a single unresolved conflict costs far more than
 * a second cross-check earns, because a conflict means the documents disagree
 * about what is being built, and no amount of arithmetic resolves that.
 */
export function scoreConfidence(input: ConfidenceInput): ConfidenceResult {
  const factors: { label: string; effect: number; detail: string }[] = [];

  const methodReliability = METHOD_RELIABILITY[input.measurementMethod];
  let score = methodReliability * 88;
  factors.push({
    label: 'Measurement method',
    effect: roundTo(score, 2),
    detail: `${input.measurementMethod} carries ${factor(methodReliability)} reliability (base ${roundTo(score, 1)})`,
  });

  const checkPoints =
    (input.checks.primarySource ? 4 : 0) +
    (input.checks.crossSource ? 5 : 0) +
    (input.checks.mathematicalReconciliation ? 5 : 0);
  score += checkPoints;
  factors.push({
    label: 'Verification checks',
    effect: checkPoints,
    detail:
      `primary ${input.checks.primarySource ? 'yes' : 'no'}, cross-source ${input.checks.crossSource ? 'yes' : 'no'}, ` +
      `reconciliation ${input.checks.mathematicalReconciliation ? 'yes' : 'no'}`,
  });

  if (input.dataSource) {
    const sourceReliability = SOURCE_RELIABILITY[input.dataSource];
    const effect = roundTo((sourceReliability - 0.8) * 12, 2);
    score += effect;
    factors.push({
      label: 'Data provenance',
      effect,
      detail: `${input.dataSource} carries ${factor(sourceReliability)} reliability`,
    });
  }

  const sourceCount = input.sourceCount ?? 0;
  if (sourceCount === 0) {
    score -= 12;
    factors.push({ label: 'Source references', effect: -12, detail: 'no drawing or specification reference recorded' });
  } else if (sourceCount >= 2) {
    score += 2;
    factors.push({ label: 'Source references', effect: 2, detail: `${sourceCount} references recorded` });
  }

  const conflicts = input.conflictCount ?? 0;
  if (conflicts > 0) {
    const effect = -Math.min(45, 22 * conflicts);
    score += effect;
    factors.push({
      label: 'Document conflicts',
      effect,
      detail: `${conflicts} unresolved conflict(s) between governing documents`,
    });
  }

  const assumptions = input.assumptionCount ?? 0;
  if (assumptions > 0) {
    const effect = -Math.min(15, 4 * assumptions);
    score += effect;
    factors.push({ label: 'Assumptions', effect, detail: `${assumptions} assumption(s) the quantity depends on` });
  }

  const warnings = input.warningCount ?? 0;
  if (warnings > 0) {
    const effect = -Math.min(10, 1.5 * warnings);
    score += effect;
    factors.push({ label: 'Engine warnings', effect: roundTo(effect, 2), detail: `${warnings} calculation warning(s)` });
  }

  if (input.hasOpenRfi) {
    score -= 20;
    factors.push({ label: 'Open RFI', effect: -20, detail: 'an unanswered RFI governs this item' });
  }

  score = roundTo(clamp(score, 0, 100), 1);

  const status = verificationStatus(input.checks, conflicts > 0);
  const band = confidenceBand(score);
  const recommendedContingency = confidenceToContingency(score);
  const requiresSeniorReview = score <= SENIOR_REVIEW_FLOOR || status === 'do_not_price';

  /*
   * The arithmetic is shown at every score, not only a poor one.
   *
   * A reviewer looking at 92 needs to see why it is not 100 just as much as a
   * reviewer looking at 48 needs to see why it is low. An explanation that
   * only restates the number is a label, not a derivation.
   */
  const workings = factors
    .map((f) => `${f.effect >= 0 ? '+' : ''}${f.effect} ${f.label}`)
    .join(' ');
  const arithmetic = workings === ''
    ? `${score} with no adjusting factors`
    : `${workings} = ${score}`;

  const explanation =
    score >= EXPLANATION_FLOOR
      ? `Score ${score}: ${band}. Verification status ${status}. ${arithmetic}.`
      : `Score ${score} is below ${EXPLANATION_FLOOR} and requires explanation. ${arithmetic}. ` +
        factors
          .filter((f) => f.effect < 0)
          .map((f) => `${f.label} ${f.effect} (${f.detail})`)
          .join('; ') +
        (factors.every((f) => f.effect >= 0)
          ? `The measurement method (${input.measurementMethod}) alone caps the achievable score.`
          : '.');

  return {
    score,
    band,
    verificationStatus: status,
    recommendedContingency,
    requiresSeniorReview,
    factors,
    explanation,
  };
}

export function confidenceBand(score: number): ConfidenceResult['band'] {
  if (score >= 95) return 'verified';
  if (score >= 90) return 'strong';
  if (score >= 80) return 'reliable';
  if (score >= 70) return 'assumption';
  if (score >= 50) return 'uncertain';
  return 'do_not_price';
}

/**
 * Section 7.2 confidence-to-contingency banding.
 *
 * Lower confidence buys more contingency, which is the only honest way to price
 * an item that is genuinely less certain. Boundaries are inclusive at the top of
 * each band, matching the locked-in Section 7.2 table exactly.
 */
export function confidenceToContingency(score: number): number {
  if (score < 0 || score > 100) {
    throw new RangeError(`confidence score must be 0-100, received ${score}`);
  }
  if (score <= 69) return 0.12;
  if (score <= 79) return 0.08;
  if (score <= 89) return 0.05;
  return 0.03;
}

export function requiresSeniorReview(score: number): boolean {
  return score <= SENIOR_REVIEW_FLOOR;
}

// ---------------------------------------------------------------------------
// Approval gates (Section 44)
// ---------------------------------------------------------------------------

export type ApprovalGate = 'auto_accept' | 'estimator_review' | 'senior_review' | 'rfi_required';

export interface ApprovalGateInput {
  confidence: number;
  measurementMethod: MeasurementMethod;
  hasConflict: boolean;
  /** Documents cannot resolve the question; only the owner/engineer can. */
  documentsCannotResolve: boolean;
  /** This item's share of estimate value; > `majorCostImpactThreshold` escalates. */
  costImpactShare?: number;
  /** Geotechnical assumptions material to the quantity (Section 13). */
  materialGeotechnicalAssumption?: boolean;
  /** Major excavation / import / export decision (Section 44). */
  majorEarthworkDecision?: boolean;
  /** The line was produced or altered by an AI agent. */
  aiGenerated?: boolean;
}

export interface ApprovalGateResult {
  gate: ApprovalGate;
  reasons: readonly string[];
  /** True when this item may not enter an approved estimate as-is. */
  blocksIssue: boolean;
  requiredRole: 'none' | 'estimator' | 'senior_estimator' | 'chief_estimator';
}

/** An item above this share of estimate value is a major cost impact. */
export const MAJOR_COST_IMPACT_SHARE = 0.1;

/**
 * Route an item to the correct human.
 *
 * Every path is evaluated and the *most restrictive* one wins, so a
 * 98-confidence item that happens to sit on an unresolved document conflict
 * still goes to an RFI rather than being auto-accepted on its score. An
 * AI-generated line can never reach `auto_accept`: RULE-008 forbids silent
 * writeback, so the floor for anything a model produced is estimator review.
 */
export function evaluateApprovalGate(input: ApprovalGateInput): ApprovalGateResult {
  const GATE_ORDER: readonly ApprovalGate[] = ['auto_accept', 'estimator_review', 'senior_review', 'rfi_required'];
  const escalations: { gate: ApprovalGate; reason: string }[] = [];

  if (input.documentsCannotResolve) {
    escalations.push({
      gate: 'rfi_required',
      reason: 'The supplied documents cannot resolve this item; only the owner or engineer can.',
    });
  }
  if (input.hasConflict) {
    escalations.push({
      gate: 'senior_review',
      reason: 'Governing documents conflict on this item and the conflict is unresolved.',
    });
  }
  if (input.confidence < 80) {
    escalations.push({ gate: 'senior_review', reason: `Confidence of ${input.confidence} is below 80.` });
  } else if (input.confidence < 95) {
    escalations.push({
      gate: 'estimator_review',
      reason: `Confidence of ${input.confidence} is below the 95 auto-accept threshold.`,
    });
  }
  if (
    input.measurementMethod === 'approximate_scale' ||
    input.measurementMethod === 'verified_scale' ||
    input.measurementMethod === 'estimator_allowance'
  ) {
    escalations.push({
      gate: 'estimator_review',
      reason: `Quantity basis "${input.measurementMethod}" required interpretation rather than a plan dimension.`,
    });
  }
  if ((input.costImpactShare ?? 0) > MAJOR_COST_IMPACT_SHARE) {
    escalations.push({
      gate: 'senior_review',
      reason:
        `Item carries ${factor((input.costImpactShare ?? 0) * 100)}% of estimate value, above the ` +
        `${MAJOR_COST_IMPACT_SHARE * 100}% major-cost-impact threshold.`,
    });
  }
  if (input.materialGeotechnicalAssumption) {
    escalations.push({
      gate: 'senior_review',
      reason: 'A material geotechnical assumption drives this quantity or production rate.',
    });
  }
  if (input.majorEarthworkDecision) {
    escalations.push({
      gate: 'senior_review',
      reason: 'Item embeds a major excavation, import or export decision.',
    });
  }
  if (input.aiGenerated) {
    escalations.push({
      gate: 'estimator_review',
      reason: 'Item was generated by an AI agent; RULE-008 forbids silent writeback to an approved estimate.',
    });
  }

  // The most restrictive applicable gate always wins, so a high-confidence
  // item sitting on an unresolved conflict still routes to an RFI.
  const gate: ApprovalGate = escalations.reduce<ApprovalGate>(
    (worst, e) => (GATE_ORDER.indexOf(e.gate) > GATE_ORDER.indexOf(worst) ? e.gate : worst),
    'auto_accept',
  );

  const reasons: string[] =
    escalations.length > 0
      ? escalations.map((e) => e.reason)
      : ['Quantity is clearly dimensioned, referenced, conflict-free and scored at or above 95.'];

  const requiredRole: ApprovalGateResult['requiredRole'] =
    gate === 'auto_accept' ? 'none'
    : gate === 'estimator_review' ? 'estimator'
    : gate === 'senior_review' ? 'senior_estimator'
    : 'chief_estimator';

  return { gate, reasons, blocksIssue: gate === 'senior_review' || gate === 'rfi_required', requiredRole };
}
