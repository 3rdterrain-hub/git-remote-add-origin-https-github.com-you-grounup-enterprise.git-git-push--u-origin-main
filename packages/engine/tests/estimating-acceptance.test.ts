/**
 * P05 acceptance evidence — the engine half.
 *
 * Every GES Phase 05 requirement carries the same acceptance criterion:
 *
 *   "Demonstrate {module} {aspect} with tenant-specific configuration, role
 *    controls, version history, and traceable output."
 *
 * Two of those four are properties of the engine and are asserted here:
 * **traceable output**, and the input **validation** half of "validation and
 * testing". The other two — tenant configuration and role controls — are
 * database properties and live in `tests/db/estimating-acceptance.test.ts`.
 *
 * These are written at platform scope rather than per module on purpose. A
 * guarantee that holds for eight estimating modules but not the ninth is not a
 * guarantee, and a per-module test would let the ninth slip through.
 */
import { describe, expect, it } from 'vitest';
import {
  resolveQuantity, analyzeProduction, calculateDuration, resolveModifiers,
  loadedLaborRate, calculateCrewCost, resolveEquipmentRate, calculateEquipmentCost,
  analyzeHaulCycle, analyzeCutFill, convertVolume, calculatePrice, standardProfile,
  scoreConfidence, calculateEstimateLine, compareSurfaces, gridFrom,
  type LaborClassification, type Crew, type ProductionRate, type EquipmentItem,
  type EstimateLineInput,
} from '../src/index.js';

// ------------------------------------------------------------------ fixtures
// Shapes lifted from the existing engine suites, so these tests exercise the
// same interfaces the rest of the engine is verified against.
const OP1: LaborClassification = {
  id: 'LAB-OP1', classification: 'Heavy Equipment Operator I', group: 'Operator',
  baseWagePerHour: 40, burdenPercent: 0.35, overtimeMultiplier: 1.5, doubletimeMultiplier: 2,
};
const CREW: Crew = {
  id: 'CRW-1', name: 'Excavation crew', shiftHours: 8,
  members: [{ classification: OP1, count: 2 }],
};
const MACHINE: EquipmentItem = {
  id: 'EQ-EX20', name: 'Excavator 20t', equipmentClass: 'Excavator',
  // A resolved rate, not a raw one: the hierarchy decision is part of the
  // record, and the warnings it produced travel with it.
  rate: resolveEquipmentRate([{ source: 'tenant_approved', hourlyRate: 112.5 }], '2026-06-01'),
  count: 1, fuelGallonsPerHour: 5.5, defPercentOfFuel: 0.03, operatorRequired: true,
};
const RATE: ProductionRate = {
  id: 'PR-1', ratePerHour: 100, unit: 'CY', utilizationFactor: 0.83, shiftHours: 8,
  sourceType: 'company_actual', confidence: 0.9, approvalStatus: 'approved',
};
const LINE: EstimateLineInput = {
  id: 'L-001', description: 'Mass excavation',
  quantity: { measured: 800, unit: 'CY', method: 'explicit_dimension', sources: ['C-201'] },
  productionRate: RATE, crew: CREW, equipment: [MACHINE], fuelPricePerGallon: 4,
  verification: { primarySource: true, crossSource: true, mathematicalReconciliation: true },
};
const HAUL = {
  quantity: 15_500, unit: 'LCY', truckCapacity: 16, oneWayMiles: 6.2,
  loadedSpeedMph: 28, emptySpeedMph: 34, loadMinutes: 4.5, dumpMinutes: 2,
  loaderProductionPerHour: 186.75, shiftHours: 8, truckHourlyRate: 95,
  availableTrucks: 7,
};

const PROFILE = standardProfile('PP-1', 'Standard', 'parallel',
  { overhead: 0.1, profit: 0.08, contingency: 0.03 });

const CONFIDENCE = scoreConfidence({
  measurementMethod: 'explicit_dimension',
  checks: { primarySource: true, crossSource: true, mathematicalReconciliation: true },
  dataSource: 'company_actual', sourceCount: 3,
});

/**
 * Every authoritative figure, with the field that must carry its derivation.
 * A new engine function producing a priced number belongs in this list.
 */
const AUTHORITATIVE: readonly { module: string; label: string; run: () => string }[] = [
  { module: 'Quantity Intelligence', label: 'resolveQuantity', run: () =>
      resolveQuantity({ measured: 1000, unit: 'CY', method: 'explicit_dimension', wastePercent: 0.05 }).derivation },
  { module: 'Quantity Intelligence', label: 'convertVolume', run: () =>
      convertVolume(1000, 'BCY', 'LCY').basis },
  { module: 'Quantity Intelligence', label: 'compareSurfaces', run: () => {
      const g = (v: number) => gridFrom(Array.from({ length: 16 }, () => v), 4, 4, 25);
      return compareSurfaces(g(632), g(628)).derivation;
    } },
  { module: 'Production', label: 'analyzeProduction', run: () =>
      analyzeProduction(RATE, 0.6).derivation },
  { module: 'Production', label: 'calculateDuration', run: () =>
      calculateDuration({ quantity: 800, productionPerHour: 83, shiftHours: 8, calendarEfficiency: 0.85 }).derivation },
  { module: 'Production', label: 'resolveModifiers', run: () =>
      resolveModifiers([{
        modifier: { id: 'M1', name: 'Restricted access', factors: { production: 0.75 },
                    applicationRule: 'Access is restricted to a single haul road' },
        justification: 'Site visit 2026-03-04 confirmed the condition',
      }]).derivation.join(' | ') },
  { module: 'Labor Cost', label: 'loadedLaborRate', run: () => loadedLaborRate(OP1).derivation },
  { module: 'Labor Cost', label: 'calculateCrewCost', run: () => calculateCrewCost(CREW, 10).derivation },
  { module: 'Equipment Cost', label: 'resolveEquipmentRate', run: () =>
      resolveEquipmentRate([{ source: 'global_seed', hourlyRate: 150 },
                            { source: 'tenant_approved', hourlyRate: 112.5 }], '2026-06-01').derivation },
  { module: 'Equipment Cost', label: 'calculateEquipmentCost', run: () =>
      calculateEquipmentCost([MACHINE], 80, 4.25, 12).derivation },
  { module: 'Hauling & Disposal', label: 'analyzeHaulCycle', run: () =>
      analyzeHaulCycle(HAUL).derivation },
  { module: 'Hauling & Disposal', label: 'analyzeCutFill', run: () =>
      analyzeCutFill({ cutBcy: 40_000, fillCcy: 40_000, swellPercent: 0.25, shrinkPercent: 0.1 }).derivation },
  { module: 'Markup & Margin', label: 'calculatePrice', run: () =>
      calculatePrice(404_000, 18_000, PROFILE).derivation.join(" | ") },
  // The confidence engine names its derivation `explanation`, and additionally
  // exposes every factor that moved the score as structured data.
  { module: 'Risk & Confidence', label: 'scoreConfidence', run: () => CONFIDENCE.explanation },
  { module: 'Estimate Core', label: 'calculateEstimateLine', run: () =>
      calculateEstimateLine(LINE).derivation.join(' | ') },
];

describe('P05 traceable output — every authoritative figure shows its work', () => {
  for (const c of AUTHORITATIVE) {
    it(`${c.module}: ${c.label} returns a derivation`, () => {
      const text = c.run();
      // Master AI specification section 23: never hide calculations. A number a
      // customer cannot check is a number they cannot defend to an owner.
      expect(typeof text, c.label).toBe('string');
      expect(text.trim().length, c.label).toBeGreaterThan(20);
    });

    it(`${c.module}: ${c.label} derivation carries arithmetic, not a label`, () => {
      const text = c.run();
      // A derivation reading "calculated from the rate" explains nothing. It
      // has to carry numbers and an operator.
      expect(/\d/.test(text), `${c.label}: ${text}`).toBe(true);
      expect(/[x×*/+=-]|÷|per\b/.test(text), `${c.label}: ${text}`).toBe(true);
    });
  }

  it('covers every estimating module that produces an authoritative figure', () => {
    const covered = new Set(AUTHORITATIVE.map((c) => c.module));
    expect([...covered].sort()).toEqual([
      'Equipment Cost', 'Estimate Core', 'Hauling & Disposal', 'Labor Cost',
      'Markup & Margin', 'Production', 'Quantity Intelligence', 'Risk & Confidence',
    ]);
  });

  it('exposes every factor that moved the confidence score, not just the number', () => {
    // A sub-90 score that cannot be explained is a gate nobody can argue with.
    expect(CONFIDENCE.factors.length).toBeGreaterThan(0);
    for (const f of CONFIDENCE.factors) {
      expect(f.label.length).toBeGreaterThan(2);
      expect(f.detail.length).toBeGreaterThan(5);
      expect(Number.isFinite(f.effect)).toBe(true);
    }
  });

  it('never emits a non-finite value into a derivation', () => {
    for (const c of AUTHORITATIVE) {
      const text = c.run();
      expect(text.includes('NaN'), c.label).toBe(false);
      expect(text.includes('Infinity'), c.label).toBe(false);
    }
  });
});

describe('P05 validation — the engine refuses bad input rather than pricing it', () => {
  const REFUSALS: readonly { module: string; label: string; run: () => unknown }[] = [
    { module: 'Quantity Intelligence', label: 'a negative measured quantity',
      run: () => resolveQuantity({ measured: -5, unit: 'CY', method: 'explicit_dimension' }) },
    { module: 'Quantity Intelligence', label: 'a non-finite quantity',
      run: () => resolveQuantity({ measured: Number.NaN, unit: 'CY', method: 'explicit_dimension' }) },
    { module: 'Production', label: 'a production rate of zero',
      run: () => calculateDuration({ quantity: 100, productionPerHour: 0, shiftHours: 8 }) },
    { module: 'Production', label: 'a shift longer than a day',
      run: () => calculateDuration({ quantity: 100, productionPerHour: 50, shiftHours: 25 }) },
    { module: 'Labor Cost', label: 'a negative wage',
      run: () => loadedLaborRate({ ...OP1, baseWagePerHour: -1 }) },
    { module: 'Equipment Cost', label: 'no rate candidate at all',
      run: () => resolveEquipmentRate([], '2026-06-01') },
    { module: 'Equipment Cost', label: 'an asOf that is not a date',
      run: () => resolveEquipmentRate([{ source: 'global_seed', hourlyRate: 100 }], 'yesterday') },
    { module: 'Hauling & Disposal', label: 'a truck with no capacity',
      run: () => analyzeHaulCycle({ ...HAUL, truckCapacity: 0 }) },
    { module: 'Hauling & Disposal', label: 'a shrink factor of 1, which makes soil vanish',
      run: () => convertVolume(100, 'BCY', 'CCY', { swellPercent: 0.25, shrinkPercent: 1 }) },
  ];

  for (const c of REFUSALS) {
    it(`${c.module}: refuses ${c.label}`, () => {
      // Refusing is the point. Returning NaN money, or a duration of Infinity,
      // is how a bad input reaches a bid.
      expect(c.run, c.label).toThrow();
    });
  }
});
