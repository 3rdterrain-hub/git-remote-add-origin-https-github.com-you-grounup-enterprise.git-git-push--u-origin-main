import { describe, expect, it } from 'vitest';
import {
  exportEstimate, importEstimate, serializePortable, parsePortable, portableLineIds,
  PortableImportError, PORTABLE_SCHEMA_VERSION,
} from '../src/portable.js';
import { calculateEstimate, type EstimateInput } from '../src/estimate.js';
import { standardProfile } from '../src/pricing.js';
import type { LaborClassification, EquipmentItem } from '../src/resources.js';
import { resolveEquipmentRate } from '../src/resources.js';
import type { ProductionRate } from '../src/production.js';

const OP1: LaborClassification = {
  id: 'LAB-OP1', classification: 'Heavy Equipment Operator I', group: 'Operator',
  baseWagePerHour: 40, burdenPercent: 0.35, overtimeMultiplier: 1.5, doubletimeMultiplier: 2,
};
const RATE: ProductionRate = {
  id: 'PR-1', ratePerHour: 100, unit: 'CY', utilizationFactor: 1, shiftHours: 8,
  sourceType: 'company_actual', confidence: 0.9, approvalStatus: 'approved',
};
const MACHINE: EquipmentItem = {
  id: 'EQ-1', name: 'Excavator 20t', equipmentClass: 'Excavator',
  rate: resolveEquipmentRate([{ source: 'tenant_approved', hourlyRate: 100 }], '2026-06-01'),
  count: 1, fuelGallonsPerHour: 5, operatorRequired: true,
};
const PROFILE = standardProfile('PP-1', 'Standard', 'parallel',
  { overhead: 0.1, profit: 0.12, contingency: 0.03 });

const ESTIMATE: EstimateInput = {
  id: 'E-1', number: 'EST-1001', name: 'Golden estimate', version: 1, status: 'draft',
  pricingProfile: PROFILE,
  lines: [{
    id: 'L-001', description: 'Mass excavation',
    quantity: { measured: 800, unit: 'CY', method: 'explicit_dimension', sources: ['C-201'] },
    productionRate: RATE,
    crew: { id: 'CRW-1', name: 'Excavation crew', shiftHours: 8, members: [{ classification: OP1, count: 1 }] },
    equipment: [MACHINE], fuelPricePerGallon: 4,
    verification: { primarySource: true, crossSource: true, mathematicalReconciliation: true },
  }],
};

const OPTS = { exportedAt: '2026-09-02T12:00:00Z', engineVersion: '1.0.0' };

describe('export', () => {
  it('stamps the schema version, the export time and the engine build', () => {
    const doc = exportEstimate(ESTIMATE, { ...OPTS, exportedBy: 'Alice Okafor' });
    expect(doc.schemaVersion).toBe(PORTABLE_SCHEMA_VERSION);
    expect(doc.exportedAt).toBe('2026-09-02T12:00:00Z');
    expect(doc.engineVersion).toBe('1.0.0');
    expect(doc.exportedBy).toBe('Alice Okafor');
  });

  it('reads no clock of its own', () => {
    // A document that stamped itself would make two exports of one estimate
    // differ, and the engine performs no I/O by contract.
    expect(() => exportEstimate(ESTIMATE, { ...OPTS, exportedAt: 'now' })).toThrow(/ISO date/);
  });

  it('requires an engine version, so a re-import knows what produced the figures', () => {
    expect(() => exportEstimate(ESTIMATE, { ...OPTS, engineVersion: '  ' })).toThrow(/engineVersion/);
  });

  it('detaches the document from the caller object', () => {
    const source = structuredClone(ESTIMATE);
    const doc = exportEstimate(source, OPTS);
    source.name = 'mutated after export';
    // A document is a record. A later edit to the estimate must not rewrite it.
    expect(doc.estimate.name).toBe('Golden estimate');
  });

  it('serializes to stable bytes, so two exports of one estimate match', () => {
    const a = serializePortable(exportEstimate(ESTIMATE, OPTS));
    const b = serializePortable(exportEstimate(structuredClone(ESTIMATE), OPTS));
    expect(a).toBe(b);
  });
});

describe('round trip', () => {
  const doc = exportEstimate(ESTIMATE, OPTS);
  const json = serializePortable(doc);
  const back = parsePortable(json, { engineVersion: '1.0.0' });

  it('imports without complaint', () => {
    expect(back.warnings).toEqual([]);
    expect(back.estimate.id).toBe('E-1');
    expect(portableLineIds(doc)).toEqual(['L-001']);
  });

  it('prices identically after the round trip, to the cent', () => {
    // The property the whole format exists for. An export that loses a
    // modifier or a soil factor looks like a record and is not one.
    const before = calculateEstimate(ESTIMATE);
    const after = calculateEstimate(back.estimate);
    expect(after.totalDirectCost).toBe(before.totalDirectCost);
    expect(after.price.totalPrice).toBe(before.price.totalPrice);
    expect(after.bidPrice).toBe(before.bidPrice);
    expect(after.weightedConfidence).toBe(before.weightedConfidence);
  });

  it('reproduces every derivation, not just the totals', () => {
    const before = calculateEstimate(ESTIMATE);
    const after = calculateEstimate(back.estimate);
    expect(after.lines[0]!.derivation).toEqual(before.lines[0]!.derivation);
  });

  it('survives a second round trip unchanged', () => {
    const again = serializePortable(exportEstimate(back.estimate, OPTS));
    expect(again).toBe(json);
  });
});

describe('import refuses rather than repairs', () => {
  const bad = (mutate: (d: Record<string, unknown>) => void): unknown => {
    const d = JSON.parse(JSON.stringify(exportEstimate(ESTIMATE, OPTS))) as Record<string, unknown>;
    mutate(d);
    return d;
  };
  const problemsOf = (doc: unknown): string[] => {
    try { importEstimate(doc, { engineVersion: '1.0.0' }); return []; }
    catch (e) { return (e as PortableImportError).problems as string[]; }
  };

  it('refuses a document that is not an object', () => {
    expect(() => importEstimate('nope', { engineVersion: '1.0.0' })).toThrow(PortableImportError);
  });

  it('refuses a newer schema instead of partially understanding it', () => {
    // Partially reading a newer file is how a field silently goes missing.
    const p = problemsOf(bad((d) => { d.schemaVersion = '2.0.0'; }));
    expect(p.join(' ')).toContain('newer than this build understands');
  });

  it('accepts an older schema, and says so', () => {
    const d = bad((x) => { x.schemaVersion = '0.9.0'; });
    const r = importEstimate(d, { engineVersion: '1.0.0' });
    expect(r.warnings.join(' ')).toContain('schema 0.9.0');
  });

  it('warns when the document came from a different engine build', () => {
    const r = importEstimate(exportEstimate(ESTIMATE, OPTS), { engineVersion: '2.0.0' });
    // Legitimate, and sometimes the point — but it must be visible.
    expect(r.warnings.join(' ')).toContain('Recalculated figures may differ');
  });

  it('refuses a missing pricing profile rather than defaulting one', () => {
    // Defaulting a profile would produce a plausible, wrong price.
    const p = problemsOf(bad((d) => { delete (d.estimate as Record<string, unknown>).pricingProfile; }));
    expect(p.join(' ')).toContain('pricingProfile is missing');
  });

  it('refuses a line with no quantity', () => {
    const p = problemsOf(bad((d) => {
      delete ((d.estimate as Record<string, unknown>).lines as Record<string, unknown>[])[0]!.quantity;
    }));
    expect(p.join(' ')).toContain('quantity is missing');
  });

  it('refuses a non-finite measured quantity', () => {
    const p = problemsOf(bad((d) => {
      (((d.estimate as Record<string, unknown>).lines as Record<string, unknown>[])[0]!
        .quantity as Record<string, unknown>).measured = 'lots';
    }));
    expect(p.join(' ')).toContain('quantity.measured must be a finite number');
  });

  it('refuses duplicate line ids', () => {
    const p = problemsOf(bad((d) => {
      const lines = (d.estimate as Record<string, unknown>).lines as Record<string, unknown>[];
      lines.push({ ...lines[0]! });
    }));
    // Two lines with one id makes the estimate impossible to reconcile against
    // its own detail.
    expect(p.join(' ')).toContain('Duplicate line id(s): L-001');
  });

  it('reports every problem at once rather than one per attempt', () => {
    const p = problemsOf(bad((d) => {
      const e = d.estimate as Record<string, unknown>;
      delete e.id; delete e.name; delete e.pricingProfile;
    }));
    expect(p.length).toBeGreaterThanOrEqual(3);
  });

  it('refuses a file that is not JSON, naming the parse failure', () => {
    expect(() => parsePortable('{ not json', { engineVersion: '1.0.0' }))
      .toThrow(/not valid JSON/);
  });

  it('warns rather than refusing an estimate with no lines', () => {
    const r = importEstimate(
      bad((d) => { (d.estimate as Record<string, unknown>).lines = []; }),
      { engineVersion: '1.0.0' });
    expect(r.warnings.join(' ')).toContain('no lines');
  });
});
