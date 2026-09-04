import { describe, expect, it } from 'vitest';
import {
  captureSnapshot, verifySnapshot, resolveFromSnapshot, snapshotHas, digestOf,
  compareSnapshotToLive, driftDelta, SnapshotIntegrityError, SnapshotMissingEntryError,
  type SnapshotEntry, type LibrarySnapshot,
} from '../src/snapshot.js';
import { calculateEstimate, type EstimateInput } from '../src/estimate.js';
import { standardProfile } from '../src/pricing.js';
import { resolveEquipmentRate, type LaborClassification, type EquipmentItem } from '../src/resources.js';
import type { ProductionRate } from '../src/production.js';

const OPTS = { id: 'SNAP-1', capturedAt: '2026-09-02T12:00:00Z', engineVersion: '1.0.0' };

const laborRow = (wage: number) => ({
  id: 'LAB-OP1', classification: 'Heavy Equipment Operator I', group: 'Operator',
  baseWagePerHour: wage, burdenPercent: 0.35, overtimeMultiplier: 1.5, doubletimeMultiplier: 2,
});
const entry = (over: Partial<SnapshotEntry> = {}): SnapshotEntry => ({
  kind: 'labor_rate', sourceId: 'LAB-OP1', sourceUpdatedAt: '2026-01-15T09:00:00Z',
  scope: 'company', payload: laborRow(40), ...over,
});

describe('capture', () => {
  it('records what priced the estimate, with scope and source timestamp', () => {
    const s = captureSnapshot([entry()], OPTS);
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]!.scope).toBe('company');
    expect(s.entries[0]!.sourceUpdatedAt).toBe('2026-01-15T09:00:00Z');
    expect(s.digest).toMatch(/^[0-9a-f]{16}$/);
  });

  it('reads no clock of its own', () => {
    expect(() => captureSnapshot([entry()], { ...OPTS, capturedAt: 'now' })).toThrow(/ISO/);
  });

  it('requires an engine version', () => {
    expect(() => captureSnapshot([entry()], { ...OPTS, engineVersion: ' ' })).toThrow(/engineVersion/);
  });

  it('copies the row rather than referencing it', () => {
    const row = laborRow(40);
    const s = captureSnapshot([entry({ payload: row })], OPTS);
    row.baseWagePerHour = 99;
    // A referenced row can be edited or deleted, and a deleted rate leaves an
    // old estimate unreproducible exactly when somebody needs to defend it.
    expect((s.entries[0]!.payload as { baseWagePerHour: number }).baseWagePerHour).toBe(40);
  });

  it('hashes identically whatever order the entries arrived in', () => {
    const a = entry();
    const b = entry({ kind: 'production_rate', sourceId: 'PR-1', payload: { id: 'PR-1', ratePerHour: 100 } });
    expect(captureSnapshot([a, b], OPTS).digest).toBe(captureSnapshot([b, a], OPTS).digest);
  });

  it('hashes identically whatever order the columns arrived in', () => {
    const a = captureSnapshot([entry({ payload: { x: 1, y: 2 } })], OPTS);
    const b = captureSnapshot([entry({ payload: { y: 2, x: 1 } })], OPTS);
    expect(a.digest).toBe(b.digest);
  });

  it('refuses the same row captured twice with different content', () => {
    // Reading the library twice and getting two answers is a fault. Keeping
    // one of them silently would hide it.
    expect(() => captureSnapshot([entry(), entry({ payload: laborRow(42) })], OPTS))
      .toThrow(/captured twice with different content/);
  });

  it('accepts the same row captured twice with identical content', () => {
    expect(captureSnapshot([entry(), entry()], OPTS).entries).toHaveLength(1);
  });

  it('refuses an unknown library kind', () => {
    expect(() => captureSnapshot([entry({ kind: 'invented' as never })], OPTS)).toThrow(/Unknown snapshot kind/);
  });

  it('refuses a non-finite number in a payload', () => {
    expect(() => captureSnapshot([entry({ payload: { rate: Number.POSITIVE_INFINITY } })], OPTS))
      .toThrow(/non-finite/);
  });
});

describe('integrity', () => {
  it('verifies a snapshot that has not been touched', () => {
    expect(() => verifySnapshot(captureSnapshot([entry()], OPTS))).not.toThrow();
  });

  it('detects a payload edited after capture', () => {
    const s = captureSnapshot([entry()], OPTS) as LibrarySnapshot;
    (s.entries[0]!.payload as Record<string, unknown>).baseWagePerHour = 41;
    expect(() => verifySnapshot(s)).toThrow(SnapshotIntegrityError);
  });

  it('detects an entry removed after capture', () => {
    const s = captureSnapshot([entry(), entry({ kind: 'task', sourceId: 'T-1', payload: { id: 'T-1' } })], OPTS);
    const tampered = { ...s, entries: s.entries.slice(0, 1) };
    expect(() => verifySnapshot(tampered)).toThrow(SnapshotIntegrityError);
  });

  it('changes the digest when the source timestamp changes', () => {
    const a = digestOf([entry()]);
    const b = digestOf([entry({ sourceUpdatedAt: '2026-02-01T09:00:00Z' })]);
    expect(a).not.toBe(b);
  });

  it('changes the digest when the scope changes', () => {
    // A company override and the platform row it overrode are different rows.
    expect(digestOf([entry({ scope: 'company' })])).not.toBe(digestOf([entry({ scope: 'platform' })]));
  });
});

describe('resolution', () => {
  const s = captureSnapshot([entry()], OPTS);

  it('reads a row back out', () => {
    expect(resolveFromSnapshot<{ baseWagePerHour: number }>(s, 'labor_rate', 'LAB-OP1').baseWagePerHour).toBe(40);
    expect(snapshotHas(s, 'labor_rate', 'LAB-OP1')).toBe(true);
  });

  it('refuses a missing row rather than reading through to the live library', () => {
    // A fallback is how a snapshot silently stops being one: the estimate
    // would reprice against a rate it was never priced with.
    expect(() => resolveFromSnapshot(s, 'labor_rate', 'LAB-OP9')).toThrow(SnapshotMissingEntryError);
    expect(snapshotHas(s, 'labor_rate', 'LAB-OP9')).toBe(false);
  });

  it('hands back a copy, so a caller cannot mutate the snapshot', () => {
    const row = resolveFromSnapshot<{ baseWagePerHour: number }>(s, 'labor_rate', 'LAB-OP1');
    row.baseWagePerHour = 99;
    expect(resolveFromSnapshot<{ baseWagePerHour: number }>(s, 'labor_rate', 'LAB-OP1').baseWagePerHour).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// The property the whole feature exists for.
// ---------------------------------------------------------------------------
describe('an issued estimate keeps its price when the library moves', () => {
  const RATE: ProductionRate = {
    id: 'PR-1', ratePerHour: 100, unit: 'CY', utilizationFactor: 1, shiftHours: 8,
    sourceType: 'company_actual', confidence: 0.9, approvalStatus: 'approved',
  };
  const machine = (hourly: number): EquipmentItem => ({
    id: 'EQ-1', name: 'Excavator 20t', equipmentClass: 'Excavator',
    rate: resolveEquipmentRate([{ source: 'tenant_approved', hourlyRate: hourly }], '2026-06-01'),
    count: 1, fuelGallonsPerHour: 5, operatorRequired: true,
  });
  const estimateWith = (wage: number, hourly: number): EstimateInput => ({
    id: 'E-1', number: 'EST-1001', name: 'Golden estimate', version: 1, status: 'draft',
    pricingProfile: standardProfile('PP-1', 'Standard', 'parallel',
      { overhead: 0.1, profit: 0.12, contingency: 0.03 }),
    lines: [{
      id: 'L-001', description: 'Mass excavation',
      quantity: { measured: 800, unit: 'CY', method: 'explicit_dimension', sources: ['C-201'] },
      productionRate: RATE,
      crew: { id: 'CRW-1', name: 'Excavation crew', shiftHours: 8,
              members: [{ classification: laborRow(wage) as LaborClassification, count: 1 }] },
      equipment: [machine(hourly)], fuelPricePerGallon: 4,
      verification: { primarySource: true, crossSource: true, mathematicalReconciliation: true },
    }],
  });

  // Priced in January, with the rates in force then.
  const AT_ISSUE = estimateWith(40, 100);
  const issuedPrice = calculateEstimate(AT_ISSUE).bidPrice;

  const snapshot = captureSnapshot([
    entry({ payload: laborRow(40) }),
    entry({ kind: 'equipment_rate', sourceId: 'EQR-1', sourceUpdatedAt: '2026-01-15T09:00:00Z',
            payload: { id: 'EQR-1', equipmentId: 'EQ-1', hourlyRate: 100 } }),
    entry({ kind: 'production_rate', sourceId: 'PR-1', sourceUpdatedAt: '2026-01-15T09:00:00Z',
            payload: { ...RATE } }),
  ], OPTS);

  // The wage settles in June and the machine rate rises.
  const liveNow = new Map([
    ['labor_rate:LAB-OP1', { updatedAt: '2026-06-01T09:00:00Z', payload: laborRow(44) }],
    ['equipment_rate:EQR-1', { updatedAt: '2026-06-01T09:00:00Z',
                              payload: { id: 'EQR-1', equipmentId: 'EQ-1', hourlyRate: 118 } }],
    ['production_rate:PR-1', { updatedAt: '2026-01-15T09:00:00Z', payload: { ...RATE } }],
  ]);

  it('reproduces the issued price exactly when priced from the snapshot', () => {
    const wage = resolveFromSnapshot<{ baseWagePerHour: number }>(snapshot, 'labor_rate', 'LAB-OP1').baseWagePerHour;
    const hourly = resolveFromSnapshot<{ hourlyRate: number }>(snapshot, 'equipment_rate', 'EQR-1').hourlyRate;
    expect(calculateEstimate(estimateWith(wage, hourly)).bidPrice).toBe(issuedPrice);
  });

  it('produces a different price when priced from the live library', () => {
    // This is the defect the snapshot exists to prevent. Without it, reopening
    // the estimate would silently show this number instead of the issued one.
    const live = calculateEstimate(estimateWith(44, 118)).bidPrice;
    expect(live).not.toBe(issuedPrice);
    expect(live).toBeGreaterThan(issuedPrice);
  });

  it('reports exactly what moved, and by how much', () => {
    const drift = compareSnapshotToLive(snapshot, liveNow, { checkedAt: '2026-09-02T12:00:00Z' });
    expect(drift.isClean).toBe(false);
    expect(drift.changed).toBe(2);
    expect(drift.unchanged).toBe(1);
    expect(drift.deleted).toBe(0);

    const labor = drift.entries.find((e) => e.kind === 'labor_rate')!;
    expect(labor.changedFields).toEqual([{ field: 'baseWagePerHour', from: 40, to: 44 }]);
    expect(driftDelta(labor, 'baseWagePerHour')).toBe(4);

    const equip = drift.entries.find((e) => e.kind === 'equipment_rate')!;
    expect(driftDelta(equip, 'hourlyRate')).toBe(18);
  });

  it('says plainly that re-pricing would give a different number', () => {
    const drift = compareSnapshotToLive(snapshot, liveNow, { checkedAt: '2026-09-02T12:00:00Z' });
    expect(drift.summary).toContain('would produce a different number');
  });

  it('reports a clean snapshot when nothing has moved', () => {
    const unchanged = new Map([
      ['labor_rate:LAB-OP1', { updatedAt: '2026-01-15T09:00:00Z', payload: laborRow(40) }],
      ['equipment_rate:EQR-1', { updatedAt: '2026-01-15T09:00:00Z',
                                 payload: { id: 'EQR-1', equipmentId: 'EQ-1', hourlyRate: 100 } }],
      ['production_rate:PR-1', { updatedAt: '2026-01-15T09:00:00Z', payload: { ...RATE } }],
    ]);
    const drift = compareSnapshotToLive(snapshot, unchanged, { checkedAt: '2026-09-02T12:00:00Z' });
    expect(drift.isClean).toBe(true);
    expect(drift.summary).toContain('All 3 library row(s) are unchanged');
  });

  it('reports a deleted library row rather than treating it as unchanged', () => {
    // `null` is how the caller says "this row no longer exists", as distinct
    // from omitting the key, which would say nothing at all.
    const withDeletion: Map<string, { updatedAt: string; payload: Record<string, unknown> } | null> =
      new Map(liveNow);
    withDeletion.set('labor_rate:LAB-OP1', null);
    const drift = compareSnapshotToLive(snapshot, withDeletion, { checkedAt: '2026-09-02T12:00:00Z' });
    expect(drift.deleted).toBe(1);
    // The estimate is still reproducible, because the row was copied in.
    expect(resolveFromSnapshot<{ baseWagePerHour: number }>(snapshot, 'labor_rate', 'LAB-OP1').baseWagePerHour).toBe(40);
  });

  it('refuses a drift check with no checked-at date', () => {
    expect(() => compareSnapshotToLive(snapshot, liveNow, { checkedAt: 'today' })).toThrow(/ISO/);
  });
});
