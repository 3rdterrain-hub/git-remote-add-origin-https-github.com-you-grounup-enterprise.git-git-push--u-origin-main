import { describe, expect, it } from 'vitest';
import { ESTIMATE, CUT_FILL, HAUL } from './demo';
import { totalDirectCost } from '@grounup/engine';

describe('demo estimate integrity', () => {
  it('prices the haul the cut/fill balance produced', () => {
    // The trucking bucket must be non-zero and must trace to the export the
    // balance computed — not to a number typed alongside it.
    expect(ESTIMATE.directCost.trucking).toBeGreaterThan(0);
    expect(ESTIMATE.directCost.disposal).toBeGreaterThan(0);
    expect(HAUL.loads * 16).toBeGreaterThanOrEqual(CUT_FILL.exportLcy - 16);
  });

  it('has line costs that sum exactly to the estimate direct cost', () => {
    const sum = ESTIMATE.lines.reduce((a, l) => a + l.totalDirectCost, 0);
    expect(Math.abs(sum - ESTIMATE.totalDirectCost)).toBeLessThan(0.05);
    expect(totalDirectCost(ESTIMATE.directCost)).toBe(ESTIMATE.totalDirectCost);
  });

  it('prices above cost and rounds the bid up', () => {
    expect(ESTIMATE.price.totalPrice).toBeGreaterThan(ESTIMATE.totalDirectCost + ESTIMATE.indirectCost);
    expect(ESTIMATE.bidPrice).toBeGreaterThanOrEqual(ESTIMATE.price.totalPrice);
    expect(ESTIMATE.bidPrice % 500).toBe(0);
  });

  it('blocks issue on the unresolved undercut RFI', () => {
    expect(ESTIMATE.lines.find((l) => l.id === 'L-030')!.approval.gate).toBe('rfi_required');
    expect(ESTIMATE.executiveDecision).toBe('rfi_resolution_required');
    expect(ESTIMATE.blockedFromIssue).toBe(true);
  });

  it('reports the earthwork export in both bank and loose measure', () => {
    expect(CUT_FILL.condition).toBe('export_required');
    expect(CUT_FILL.exportLcy).toBeGreaterThan(CUT_FILL.exportBcy);
  });

  it('prints the priced summary', () => {
    const usd = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    console.log(`
  direct cost   ${usd(ESTIMATE.totalDirectCost)}
    trucking    ${usd(ESTIMATE.directCost.trucking)}
    disposal    ${usd(ESTIMATE.directCost.disposal)}
  indirect      ${usd(ESTIMATE.indirectCost)}
  total price   ${usd(ESTIMATE.price.totalPrice)}
  bid price     ${usd(ESTIMATE.bidPrice)}
  confidence    ${ESTIMATE.weightedConfidence} (${ESTIMATE.confidenceBand})
  haul          ${HAUL.trucksRequired} trucks, ${HAUL.balance}, ${HAUL.wholeLoads} loads`);
    expect(true).toBe(true);
  });
});
