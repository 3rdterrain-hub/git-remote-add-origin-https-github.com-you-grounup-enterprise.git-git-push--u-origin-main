import { describe, expect, it } from 'vitest';
import {
  confidenceBand, confidenceToContingency, evaluateApprovalGate, requiresSeniorReview,
  scoreConfidence, SENIOR_REVIEW_FLOOR, verificationStatus, MAJOR_COST_IMPACT_SHARE,
} from '../src/confidence.js';

const ALL = { primarySource: true, crossSource: true, mathematicalReconciliation: true };
const PRIMARY_ONLY = { primarySource: true, crossSource: false, mathematicalReconciliation: false };

describe('verification status (Section 7)', () => {
  it('requires all three checks for verified', () => {
    expect(verificationStatus(ALL)).toBe('verified');
  });
  it('calls two independent confirmations high confidence', () => {
    expect(verificationStatus({ primarySource: true, crossSource: true, mathematicalReconciliation: false })).toBe('high_confidence');
    expect(verificationStatus({ primarySource: true, crossSource: false, mathematicalReconciliation: true })).toBe('high_confidence');
  });
  it('calls a lone primary read moderate', () => {
    expect(verificationStatus(PRIMARY_ONLY)).toBe('moderate_confidence');
  });
  it('will not price without a primary source', () => {
    expect(verificationStatus({ primarySource: false, crossSource: false, mathematicalReconciliation: false })).toBe('do_not_price');
    // Cross-checks without a primary read are checks against nothing.
    expect(verificationStatus({ primarySource: false, crossSource: true, mathematicalReconciliation: true })).toBe('low_confidence');
  });
  it('drops to do-not-price on an unresolved conflict regardless of checks', () => {
    expect(verificationStatus(ALL, true)).toBe('do_not_price');
  });
});

describe('confidence scoring (Section 45)', () => {
  it('scores a fully verified, referenced, company-actual quantity in the top band', () => {
    const r = scoreConfidence({
      measurementMethod: 'explicit_dimension', checks: ALL,
      dataSource: 'company_actual', sourceCount: 3,
    });
    // 1.0 x 88 base + 14 checks + 2.4 provenance + 2 references = 106.4 -> capped 100
    expect(r.score).toBe(100);
    expect(r.band).toBe('verified');
    expect(r.verificationStatus).toBe('verified');
    expect(r.recommendedContingency).toBe(0.03);
    expect(r.requiresSeniorReview).toBe(false);
  });

  it('penalizes a scaled measurement below the auto-accept line', () => {
    const r = scoreConfidence({
      measurementMethod: 'approximate_scale', checks: PRIMARY_ONLY, sourceCount: 1,
    });
    // 0.72 x 88 = 63.36 + 4 = 67.36 -> 67.4
    expect(r.score).toBe(67.4);
    expect(r.band).toBe('uncertain');
    expect(r.requiresSeniorReview).toBe(true);
  });

  // Penalty magnitudes are measured from a 'derived' base (0.86 x 88 = 75.68)
  // rather than an 'explicit_dimension' one, because the latter saturates the
  // 100 cap and would compress the very differences under test.
  it('costs a document conflict far more than a cross-check earns', () => {
    const clean = scoreConfidence({ measurementMethod: 'derived', checks: ALL, sourceCount: 2 });
    const conflicted = scoreConfidence({ measurementMethod: 'derived', checks: ALL, sourceCount: 2, conflictCount: 1 });
    expect(clean.score).toBe(91.7);          // 75.68 + 14 + 2 = 91.68
    expect(clean.score - conflicted.score).toBe(22);
    expect(conflicted.verificationStatus).toBe('do_not_price');
  });

  it('caps the conflict penalty so the score stays interpretable', () => {
    const five = scoreConfidence({ measurementMethod: 'derived', checks: ALL, sourceCount: 2, conflictCount: 5 });
    const one = scoreConfidence({ measurementMethod: 'derived', checks: ALL, sourceCount: 2, conflictCount: 1 });
    expect(one.score - five.score).toBe(23);   // 45 cap vs 22 for a single conflict
  });

  it('penalizes a missing drawing reference', () => {
    const withRef = scoreConfidence({ measurementMethod: 'derived', checks: ALL, sourceCount: 1 });
    const noRef = scoreConfidence({ measurementMethod: 'derived', checks: ALL, sourceCount: 0 });
    expect(withRef.score - noRef.score).toBe(12);
  });

  it('penalizes an open RFI', () => {
    const open = scoreConfidence({ measurementMethod: 'derived', checks: ALL, sourceCount: 2, hasOpenRfi: true });
    const closed = scoreConfidence({ measurementMethod: 'derived', checks: ALL, sourceCount: 2 });
    expect(closed.score - open.score).toBe(20);
  });

  it('caps assumption and warning penalties', () => {
    const r = scoreConfidence({
      measurementMethod: 'explicit_dimension', checks: ALL, sourceCount: 2,
      assumptionCount: 20, warningCount: 40,
    });
    const assumptions = r.factors.find((f) => f.label === 'Assumptions')!;
    const warnings = r.factors.find((f) => f.label === 'Engine warnings')!;
    expect(assumptions.effect).toBe(-15);
    expect(warnings.effect).toBe(-10);
  });

  it('rewards better data provenance', () => {
    const actual = scoreConfidence({ measurementMethod: 'explicit_dimension', checks: ALL, dataSource: 'company_actual', sourceCount: 1 });
    const seed = scoreConfidence({ measurementMethod: 'explicit_dimension', checks: ALL, dataSource: 'seed_benchmark', sourceCount: 1 });
    expect(actual.score).toBeGreaterThan(seed.score);
  });

  it('explains every score below 90, as Section 45 requires', () => {
    const low = scoreConfidence({ measurementMethod: 'approximate_scale', checks: PRIMARY_ONLY, sourceCount: 0 });
    expect(low.score).toBeLessThan(90);
    expect(low.explanation).toContain('requires explanation');
    expect(low.explanation).toContain('Source references');
  });

  it('explains a low score that comes purely from the measurement method', () => {
    const r = scoreConfidence({ measurementMethod: 'approximate_scale', checks: ALL, sourceCount: 2 });
    expect(r.score).toBeLessThan(90);
    expect(r.explanation).toContain('alone caps the achievable score');
  });

  it('clamps the score to 0-100', () => {
    const floor = scoreConfidence({
      measurementMethod: 'estimator_allowance',
      checks: { primarySource: false, crossSource: false, mathematicalReconciliation: false },
      sourceCount: 0, conflictCount: 3, assumptionCount: 10, warningCount: 20, hasOpenRfi: true,
    });
    expect(floor.score).toBe(0);
    expect(floor.band).toBe('do_not_price');
  });
});

describe('confidence bands and contingency (Section 7.2)', () => {
  it('maps the banding table exactly at its boundaries', () => {
    expect(confidenceToContingency(69)).toBe(0.12);
    expect(confidenceToContingency(70)).toBe(0.08);
    expect(confidenceToContingency(79)).toBe(0.08);
    expect(confidenceToContingency(80)).toBe(0.05);
    expect(confidenceToContingency(89)).toBe(0.05);
    expect(confidenceToContingency(90)).toBe(0.03);
    expect(confidenceToContingency(100)).toBe(0.03);
    expect(confidenceToContingency(0)).toBe(0.12);
  });

  it('rejects an out-of-range score', () => {
    expect(() => confidenceToContingency(-1)).toThrow(RangeError);
    expect(() => confidenceToContingency(101)).toThrow(RangeError);
  });

  it('names the bands at their boundaries', () => {
    expect(confidenceBand(95)).toBe('verified');
    expect(confidenceBand(94.9)).toBe('strong');
    expect(confidenceBand(90)).toBe('strong');
    expect(confidenceBand(89.9)).toBe('reliable');
    expect(confidenceBand(80)).toBe('reliable');
    expect(confidenceBand(79.9)).toBe('assumption');
    expect(confidenceBand(70)).toBe('assumption');
    expect(confidenceBand(69.9)).toBe('uncertain');
    expect(confidenceBand(50)).toBe('uncertain');
    expect(confidenceBand(49.9)).toBe('do_not_price');
  });

  it('mandates senior review at or below 69', () => {
    expect(SENIOR_REVIEW_FLOOR).toBe(69);
    expect(requiresSeniorReview(69)).toBe(true);
    expect(requiresSeniorReview(69.1)).toBe(false);
  });
});

describe('approval gates (Section 44)', () => {
  const clean = {
    confidence: 98, measurementMethod: 'explicit_dimension' as const,
    hasConflict: false, documentsCannotResolve: false,
  };

  it('auto-accepts a dimensioned, referenced, conflict-free, 95+ item', () => {
    const r = evaluateApprovalGate(clean);
    expect(r.gate).toBe('auto_accept');
    expect(r.blocksIssue).toBe(false);
    expect(r.requiredRole).toBe('none');
  });

  it('routes 80-94 confidence to estimator review', () => {
    expect(evaluateApprovalGate({ ...clean, confidence: 90 }).gate).toBe('estimator_review');
    expect(evaluateApprovalGate({ ...clean, confidence: 94.9 }).gate).toBe('estimator_review');
  });

  it('routes sub-80 confidence to senior review and blocks issue', () => {
    const r = evaluateApprovalGate({ ...clean, confidence: 79 });
    expect(r.gate).toBe('senior_review');
    expect(r.blocksIssue).toBe(true);
    expect(r.requiredRole).toBe('senior_estimator');
  });

  it('routes an unresolvable question to an RFI even at perfect confidence', () => {
    const r = evaluateApprovalGate({ ...clean, confidence: 100, documentsCannotResolve: true });
    expect(r.gate).toBe('rfi_required');
    expect(r.requiredRole).toBe('chief_estimator');
  });

  it('lets the most restrictive path win, not the last one evaluated', () => {
    // 98 confidence would auto-accept, but an unresolved conflict governs.
    const r = evaluateApprovalGate({ ...clean, hasConflict: true });
    expect(r.gate).toBe('senior_review');
    expect(r.reasons.some((x) => x.includes('conflict'))).toBe(true);
  });

  it('escalates a scaled measurement to estimator review at any score', () => {
    expect(evaluateApprovalGate({ ...clean, confidence: 99, measurementMethod: 'verified_scale' }).gate).toBe('estimator_review');
    expect(evaluateApprovalGate({ ...clean, confidence: 99, measurementMethod: 'approximate_scale' }).gate).toBe('estimator_review');
    expect(evaluateApprovalGate({ ...clean, confidence: 99, measurementMethod: 'estimator_allowance' }).gate).toBe('estimator_review');
  });

  it('escalates an item carrying a major share of estimate value', () => {
    expect(MAJOR_COST_IMPACT_SHARE).toBe(0.1);
    expect(evaluateApprovalGate({ ...clean, costImpactShare: 0.1 }).gate).toBe('auto_accept');
    expect(evaluateApprovalGate({ ...clean, costImpactShare: 0.11 }).gate).toBe('senior_review');
  });

  it('escalates material geotechnical assumptions and major earthwork decisions', () => {
    expect(evaluateApprovalGate({ ...clean, materialGeotechnicalAssumption: true }).gate).toBe('senior_review');
    expect(evaluateApprovalGate({ ...clean, majorEarthworkDecision: true }).gate).toBe('senior_review');
  });

  it('never auto-accepts AI-generated work (RULE-008)', () => {
    const r = evaluateApprovalGate({ ...clean, confidence: 100, aiGenerated: true });
    expect(r.gate).toBe('estimator_review');
    expect(r.reasons.some((x) => x.includes('RULE-008'))).toBe(true);
  });

  it('states why an item auto-accepted', () => {
    expect(evaluateApprovalGate(clean).reasons[0]).toContain('conflict-free and scored at or above 95');
  });
});
