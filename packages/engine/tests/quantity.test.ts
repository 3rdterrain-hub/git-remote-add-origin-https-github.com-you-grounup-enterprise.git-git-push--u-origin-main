import { describe, expect, it } from 'vitest';
import { METHOD_RELIABILITY, reconcileBidQuantity, resolveQuantity } from '../src/quantity.js';

describe('takeoff quantity chain', () => {
  it('runs measured -> adjusted -> waste/loss -> gross in order', () => {
    // 1,000 CY measured, +10% overdig = 1,100 adjusted,
    // then 5% waste + 2% loss = 1,100 x 1.07 = 1,177 gross.
    const r = resolveQuantity({
      measured: 1000,
      unit: 'CY',
      method: 'explicit_dimension',
      adjustments: [{ code: 'OVERDIG', label: 'Overdig', percent: 0.1, reason: 'Detail 3/C-401 requires 1 ft overdig' }],
      wastePercent: 0.05,
      lossPercent: 0.02,
      wasteBasis: 'Spec 31 23 00 placement waste',
      sources: ['C-401', 'C-402'],
    });
    expect(r.measured).toBe(1000);
    expect(r.adjusted).toBe(1100);
    expect(r.wasteQuantity).toBe(55);
    expect(r.lossQuantity).toBe(22);
    expect(r.gross).toBe(1177);
    expect(r.warnings).toEqual([]);
  });

  it('adds waste and loss rather than compounding them', () => {
    // Compounding would give 1,000 x 1.05 x 1.02 = 1,071. Additive gives 1,070.
    const r = resolveQuantity({
      measured: 1000, unit: 'CY', method: 'explicit_dimension',
      wastePercent: 0.05, lossPercent: 0.02, wasteBasis: 'x', sources: ['C-1'],
    });
    expect(r.gross).toBe(1070);
  });

  it('applies absolute-amount adjustments alongside percentages', () => {
    const r = resolveQuantity({
      measured: 500, unit: 'LF', method: 'calculated',
      adjustments: [
        { code: 'A', label: 'Percent', percent: 0.1, reason: 'r1' },
        { code: 'B', label: 'Fixed', amount: 25, reason: 'r2' },
        { code: 'C', label: 'Both', percent: 0.02, amount: -10, reason: 'r3' },
      ],
      sources: ['C-1'],
    });
    // 500 + 50 + 25 + (10 - 10) = 575
    expect(r.adjusted).toBe(575);
    expect(r.appliedAdjustments.map((a) => a.effect)).toEqual([50, 25, 0]);
  });

  it('refuses an adjustment with no reason — no silent adjustments', () => {
    expect(() =>
      resolveQuantity({
        measured: 100, unit: 'CY', method: 'explicit_dimension',
        adjustments: [{ code: 'X', label: 'Mystery', percent: 0.5, reason: '' }],
      }),
    ).toThrow(/must state a reason/);
  });

  it('refuses an adjustment with neither percent nor amount', () => {
    expect(() =>
      resolveQuantity({
        measured: 100, unit: 'CY', method: 'explicit_dimension',
        adjustments: [{ code: 'X', label: 'Empty', reason: 'because' }],
      }),
    ).toThrow(/must define percent or amount/);
  });

  it('clamps a negative result and says so instead of pricing negative work', () => {
    const r = resolveQuantity({
      measured: 100, unit: 'CY', method: 'explicit_dimension',
      adjustments: [{ code: 'DEDUCT', label: 'Deduct', amount: -500, reason: 'owner deletion' }],
      sources: ['C-1'],
    });
    expect(r.adjusted).toBe(0);
    expect(r.warnings.some((w) => w.includes('below zero'))).toBe(true);
  });

  it('flags a waste factor with no stated basis (Section 31)', () => {
    const r = resolveQuantity({
      measured: 100, unit: 'CY', method: 'explicit_dimension', wastePercent: 0.05, sources: ['C-1'],
    });
    expect(r.warnings.some((w) => w.includes('no stated basis'))).toBe(true);
  });

  it('flags an implausible waste factor', () => {
    const r = resolveQuantity({
      measured: 100, unit: 'CY', method: 'explicit_dimension',
      wastePercent: 0.6, wasteBasis: 'typo', sources: ['C-1'],
    });
    expect(r.warnings.some((w) => w.includes('data-entry error'))).toBe(true);
  });

  it('flags scaled and allowance quantities as interpretation', () => {
    const scaled = resolveQuantity({ measured: 100, unit: 'SF', method: 'approximate_scale', sources: ['C-1'] });
    expect(scaled.warnings.some((w) => w.includes('without independent scale verification'))).toBe(true);

    const allowance = resolveQuantity({ measured: 1, unit: 'LS', method: 'estimator_allowance' });
    expect(allowance.warnings.some((w) => w.includes('no measurable basis'))).toBe(true);
    // An allowance has no drawing to cite, so it is not double-penalized.
    expect(allowance.warnings.some((w) => w.includes('No drawing or specification reference'))).toBe(false);
  });

  it('flags a measured quantity with no drawing reference', () => {
    const r = resolveQuantity({ measured: 100, unit: 'CY', method: 'explicit_dimension' });
    expect(r.warnings.some((w) => w.includes('No drawing or specification reference'))).toBe(true);
  });

  it('records a readable derivation', () => {
    const r = resolveQuantity({
      measured: 1000, unit: 'CY', method: 'explicit_dimension',
      adjustments: [{ code: 'O', label: 'Overdig', percent: 0.1, reason: 'detail 3' }],
      wastePercent: 0.05, wasteBasis: 'spec', sources: ['C-401'],
    });
    expect(r.derivation).toContain('measured 1000 CY (explicit_dimension)');
    expect(r.derivation).toContain('Overdig +100 (detail 3)');
    expect(r.derivation).toContain('= 1155 gross');
  });

  it('rejects a negative measured quantity', () => {
    expect(() => resolveQuantity({ measured: -1, unit: 'CY', method: 'explicit_dimension' })).toThrow(RangeError);
  });

  it('ranks measurement methods by reliability', () => {
    expect(METHOD_RELIABILITY.explicit_dimension).toBeGreaterThan(METHOD_RELIABILITY.verified_scale);
    expect(METHOD_RELIABILITY.verified_scale).toBeGreaterThan(METHOD_RELIABILITY.approximate_scale);
    expect(METHOD_RELIABILITY.approximate_scale).toBeGreaterThan(METHOD_RELIABILITY.estimator_allowance);
  });
});

describe('bid quantity reconciliation (Section 24)', () => {
  it('calls a small variance aligned and prices the bid quantity', () => {
    const r = reconcileBidQuantity('202', 'CY', 10000, 10200);
    expect(r.variance).toBe(200);
    expect(r.variancePercent).toBe(0.02);
    expect(r.severity).toBe('aligned');
  });

  it('escalates a variance past the review threshold', () => {
    const r = reconcileBidQuantity('202', 'CY', 10000, 10800);
    expect(r.variancePercent).toBe(0.08);
    expect(r.severity).toBe('review');
    expect(r.recommendation).toContain('do not adopt the bid quantity to close the gap');
  });

  it('escalates a material variance to senior review and an RFI', () => {
    const r = reconcileBidQuantity('202', 'CY', 10000, 13000);
    expect(r.variancePercent).toBe(0.3);
    expect(r.severity).toBe('material');
    expect(r.recommendation).toContain('Senior review required');
  });

  it('treats a negative variance by magnitude, not sign', () => {
    const r = reconcileBidQuantity('202', 'CY', 10000, 7000);
    expect(r.variance).toBe(-3000);
    expect(r.severity).toBe('material');
  });

  it('handles a zero owner quantity without dividing by zero', () => {
    const missing = reconcileBidQuantity('999', 'EA', 0, 5);
    expect(missing.variancePercent).toBe(1);
    expect(missing.severity).toBe('material');

    const bothZero = reconcileBidQuantity('999', 'EA', 0, 0);
    expect(bothZero.variancePercent).toBe(0);
    expect(bothZero.severity).toBe('aligned');
  });
});
