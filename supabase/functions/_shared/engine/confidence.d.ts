/**
 * Confidence scoring, verification status and approval gates.
 *
 * Implements Master AI specification Sections 7, 44 and 45. This module is the
 * governor that keeps AI output out of an approved estimate: nothing reaches
 * `auto_accept` without a verified, referenced, conflict-free basis, and
 * anything below the senior-review floor is blocked from issue regardless of
 * how confident the model that produced it claimed to be.
 */
import { type MeasurementMethod } from './quantity.js';
import { type ProductionSourceType } from './production.js';
/** The three independent checks a critical quantity must survive. */
export interface VerificationChecks {
    /** Check 1 — the value was read from its primary drawing source. */
    primarySource: boolean;
    /** Check 2 — confirmed against a second, independent document. */
    crossSource: boolean;
    /** Check 3 — reproduced by an independent calculation or geometry. */
    mathematicalReconciliation: boolean;
}
export type VerificationStatus = 'verified' | 'high_confidence' | 'moderate_confidence' | 'low_confidence' | 'do_not_price';
export declare function verificationStatus(checks: VerificationChecks, hasUnresolvedConflict?: boolean): VerificationStatus;
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
    factors: readonly {
        label: string;
        effect: number;
        detail: string;
    }[];
    explanation: string;
}
/**
 * Every confidence boundary this engine routes on, in one frozen object.
 *
 * These were literals scattered across two modules and typed a third time into
 * the Company Settings screen, which rendered them as "governed values" beside
 * a caption saying so. Three copies of the same four numbers, none of which
 * knew about the others: change a band here and the screen kept showing the old
 * one, with nothing to catch the disagreement.
 *
 * So there is one source, and the screen reads it. Same principle as RULE-003
 * for rates — the number a screen shows must be the number that acts. Nothing
 * here is tenant-configurable, and that is deliberate rather than unfinished: a
 * company that could set its own auto-accept floor to zero would have a
 * confidence gate that passes everything, which is not a preference but the
 * removal of the control. The screen says exactly that, where the numbers are.
 */
export declare const CONFIDENCE_THRESHOLDS: Readonly<{
    /** At or above this, an item may be accepted without a person (Section 7.2). */
    readonly autoAcceptFloor: 95;
    /** Band floors, highest first. */
    readonly strong: 90;
    readonly reliable: 80;
    readonly assumption: 70;
    readonly uncertain: 50;
    /** Below this, a senior estimator must sign off. */
    readonly seniorReviewCeiling: 80;
    /** At or below this, sign-off cannot be waived. */
    readonly seniorReviewFloor: 69;
    /** An item above this share of estimate value is a major cost impact. */
    readonly majorCostImpactShare: 0.1;
    /** Section 45 requires every score below this to be explained. */
    readonly explanationFloor: 90;
}>;
/** Section 7.2: at or below this score, senior review is mandatory. */
export declare const SENIOR_REVIEW_FLOOR: 69;
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
export declare function scoreConfidence(input: ConfidenceInput): ConfidenceResult;
export declare function confidenceBand(score: number): ConfidenceResult['band'];
/**
 * Section 7.2 confidence-to-contingency banding.
 *
 * Lower confidence buys more contingency, which is the only honest way to price
 * an item that is genuinely less certain. Boundaries are inclusive at the top of
 * each band, matching the locked-in Section 7.2 table exactly.
 */
export declare function confidenceToContingency(score: number): number;
export declare function requiresSeniorReview(score: number): boolean;
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
export declare const MAJOR_COST_IMPACT_SHARE: 0.1;
/**
 * Route an item to the correct human.
 *
 * Every path is evaluated and the *most restrictive* one wins, so a
 * 98-confidence item that happens to sit on an unresolved document conflict
 * still goes to an RFI rather than being auto-accepted on its score. An
 * AI-generated line can never reach `auto_accept`: RULE-008 forbids silent
 * writeback, so the floor for anything a model produced is estimator review.
 */
export declare function evaluateApprovalGate(input: ApprovalGateInput): ApprovalGateResult;
