import { describe, expect, it } from 'vitest';
import {
  priceScenarios, applyScenario, analyzeSensitivity, ScenarioSetError,
  SCENARIO_DRIVERS, DRIVER_LABELS, type Scenario,
} from '../src/scenarios.js';
import { calculateEstimate, type EstimateInput } from '../src/estimate.js';
import { standardProfile } from '../src/pricing.js';
import { resolveEquipmentRate, type LaborClassification, type EquipmentItem } from '../src/resources.js';
import type { ProductionRate } from '../src/production.js';

const OP1: LaborClassification = {
  id: 'LAB-OP1', classification: 'Operator I', group: 'Operator',
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
const ESTIMATE: EstimateInput = {
  id: 'E-1', number: 'EST-1001', name: 'Scenario estimate', version: 1, status: 'draft',
  pricingProfile: standardProfile('PP-1', 'Standard', 'parallel',
    { overhead: 0.1, profit: 0.12, contingency: 0.03 }),
  lines: [{
    id: 'L-001', description: 'Mass excavation',
    quantity: { measured: 800, unit: 'CY', method: 'explicit_dimension', sources: ['C-201'] },
    productionRate: RATE,
    crew: { id: 'CRW-1', name: 'Excavation crew', shiftHours: 8, members: [{ classification: OP1, count: 1 }] },
    equipment: [MACHINE], fuelPricePerGallon: 4,
    verification: { primarySource: true, crossSource: true, mathematicalReconciliation: true },
  }],
};

const base: Scenario = { id: 'S-BASE', name: 'Base', kind: 'base', adjustments: [] };
const low: Scenario = {
  id: 'S-LOW', name: 'Favorable', kind: 'low',
  adjustments: [
    { driver: 'production', factor: 1.1, rationale: 'Dry ground and a full working face' },
    { driver: 'fuel_price', factor: 0.95, rationale: 'Fuel contract held through the season' },
  ],
};
const high: Scenario = {
  id: 'S-HIGH', name: 'Adverse', kind: 'high',
  adjustments: [
    { driver: 'production', factor: 0.85, rationale: 'Wet ground, single haul road' },
    { driver: 'fuel_price', factor: 1.25, rationale: 'Fuel exposure over a long schedule' },
    { driver: 'labor_wage', factor: 1.04, rationale: 'Agreement settles in the third quarter' },
  ],
};

describe('the base scenario is the estimate', () => {
  const c = priceScenarios(ESTIMATE, [base, low, high]);

  it('prices the base exactly as the unadjusted estimate', () => {
    // If the base drifts, every other scenario is measured against a number
    // that is already wrong.
    expect(c.base.bidPrice).toBe(calculateEstimate(ESTIMATE).bidPrice);
    expect(c.base.deltaFromBase).toBe(0);
  });

  it('refuses a set with no base', () => {
    expect(() => priceScenarios(ESTIMATE, [low, high])).toThrow(ScenarioSetError);
  });

  it('refuses a set with two bases', () => {
    expect(() => priceScenarios(ESTIMATE, [base, { ...base, id: 'S-BASE-2' }]))
      .toThrow(/exactly one base/);
  });

  it('refuses duplicate scenario ids', () => {
    expect(() => priceScenarios(ESTIMATE, [base, { ...low, id: 'S-BASE' }]))
      .toThrow(/Duplicate scenario id/);
  });

  it('leaves the input estimate untouched', () => {
    const before = JSON.stringify(ESTIMATE);
    priceScenarios(ESTIMATE, [base, low, high]);
    expect(JSON.stringify(ESTIMATE)).toBe(before);
  });
});

describe('direction', () => {
  const c = priceScenarios(ESTIMATE, [base, low, high]);

  it('prices the favorable case below the base', () => {
    expect(c.scenarios.find((s) => s.scenario.kind === 'low')!.bidPrice).toBeLessThan(c.base.bidPrice);
  });

  it('prices the adverse case above the base', () => {
    expect(c.scenarios.find((s) => s.scenario.kind === 'high')!.bidPrice).toBeGreaterThan(c.base.bidPrice);
  });

  it('treats better production as cheaper, not dearer', () => {
    // Production moves inversely to cost. Getting it backwards produces a low
    // case more expensive than the high, which is the classic scenario bug.
    const faster = applyScenario(ESTIMATE, {
      id: 'X', name: 'Faster', kind: 'custom',
      adjustments: [{ driver: 'production', factor: 1.25, rationale: 'probe' }],
    });
    expect(calculateEstimate(faster).bidPrice).toBeLessThan(calculateEstimate(ESTIMATE).bidPrice);
  });

  it('warns when the low case prices above the high case', () => {
    const inverted = priceScenarios(ESTIMATE, [
      base,
      { id: 'S-L', name: 'Wrong way low', kind: 'low',
        adjustments: [{ driver: 'production', factor: 0.7, rationale: 'applied backwards' }] },
      { id: 'S-H', name: 'Wrong way high', kind: 'high',
        adjustments: [{ driver: 'production', factor: 1.3, rationale: 'applied backwards' }] },
    ]);
    expect(inverted.warnings.join(' ')).toContain('prices above the high scenario');
  });

  it('warns when the range is too wide to be a price', () => {
    const wide = priceScenarios(ESTIMATE, [
      base,
      { id: 'S-L', name: 'Very low', kind: 'low',
        adjustments: [{ driver: 'production', factor: 2, rationale: 'probe' }] },
      { id: 'S-H', name: 'Very high', kind: 'high',
        adjustments: [{ driver: 'production', factor: 0.4, rationale: 'probe' }] },
    ]);
    expect(wide.warnings.join(' ')).toContain('usually means an assumption needs resolving');
  });
});

describe('the comparison', () => {
  const c = priceScenarios(ESTIMATE, [base, low, high]);

  it('reports the spread between the cheapest and dearest', () => {
    expect(c.spread).toBe(Number((c.highest.bidPrice - c.lowest.bidPrice).toFixed(2)));
    expect(c.lowest.scenario.kind).toBe('low');
    expect(c.highest.scenario.kind).toBe('high');
  });

  it('states each scenario delta against the base', () => {
    for (const s of c.scenarios) {
      expect(s.deltaFromBase).toBe(Number((s.bidPrice - c.base.bidPrice).toFixed(2)));
    }
  });

  it('names the adjustments in each derivation rather than a bare multiplier', () => {
    const adverse = c.scenarios.find((s) => s.scenario.kind === 'high')!;
    // "High is base plus 20%" tells an estimator nothing they can defend.
    expect(adverse.derivation).toContain('production rate x0.85');
    expect(adverse.derivation).toContain('fuel price x1.25');
    expect(adverse.derivation).toContain('labor wage x1.04');
  });
});

describe('adjustment validation', () => {
  const withAdj = (a: { driver: string; factor: number; rationale: string }): Scenario =>
    ({ id: 'X', name: 'X', kind: 'custom', adjustments: [a] } as unknown as Scenario);

  it('refuses an adjustment with no rationale', () => {
    // A factor nobody can explain is not an assumption, it is noise.
    expect(() => applyScenario(ESTIMATE, withAdj({ driver: 'production', factor: 0.9, rationale: '  ' })))
      .toThrow(/no rationale/);
  });

  it('refuses an unknown driver', () => {
    expect(() => applyScenario(ESTIMATE, withAdj({ driver: 'vibes', factor: 1.1, rationale: 'x' })))
      .toThrow(/Unknown scenario driver/);
  });

  it('refuses an impossible factor', () => {
    expect(() => applyScenario(ESTIMATE, withAdj({ driver: 'production', factor: 0, rationale: 'x' })))
      .toThrow(RangeError);
    expect(() => applyScenario(ESTIMATE, withAdj({ driver: 'production', factor: 1000, rationale: 'x' })))
      .toThrow(RangeError);
  });

  it('refuses the same driver adjusted twice', () => {
    // Two factors on one driver could mean compounded or replaced. Refusing
    // beats picking one and being quietly wrong.
    expect(() => applyScenario(ESTIMATE, {
      id: 'X', name: 'X', kind: 'custom',
      adjustments: [
        { driver: 'fuel_price', factor: 1.1, rationale: 'a' },
        { driver: 'fuel_price', factor: 1.2, rationale: 'b' },
      ],
    })).toThrow(/adjusts fuel price twice/);
  });

  it('never lets calendar efficiency exceed one', () => {
    const applied = applyScenario(
      { ...ESTIMATE, lines: [{ ...ESTIMATE.lines[0]!, calendarEfficiency: 0.9 }] },
      { id: 'X', name: 'X', kind: 'custom',
        adjustments: [{ driver: 'calendar_efficiency', factor: 1.5, rationale: 'probe' }] });
    // Efficiency is the fraction of a day actually worked. There is no 135%.
    expect(applied.lines[0]!.calendarEfficiency).toBe(1);
  });
});

describe('sensitivity', () => {
  const s = analyzeSensitivity(ESTIMATE, { factor: 1.1 });

  it('varies one driver at a time', () => {
    expect(s.entries).toHaveLength(SCENARIO_DRIVERS.length);
    expect(new Set(s.entries.map((e) => e.driver)).size).toBe(SCENARIO_DRIVERS.length);
  });

  it('ranks by the size of the price movement', () => {
    for (let i = 1; i < s.entries.length; i++) {
      expect(Math.abs(s.entries[i]!.delta)).toBeLessThanOrEqual(Math.abs(s.entries[i - 1]!.delta));
    }
  });

  it('names the driver actually worth managing', () => {
    // On this line the crew and machine dominate, so quantity and production
    // move the price more than fuel does.
    expect(s.mostSensitive).not.toBeNull();
    expect(Math.abs(s.mostSensitive!.delta))
      .toBeGreaterThan(Math.abs(s.entries.find((e) => e.driver === 'fuel_price')!.delta));
  });

  it('reports a comparable per-percent elasticity', () => {
    for (const e of s.entries) {
      // A 10% move: elasticity is the price change per 1%.
      expect(e.elasticity).toBe(Number((e.delta / 10).toFixed(2)));
    }
  });

  it('measures a driver the estimate does not use as zero', () => {
    // No subcontract cost on this line, so moving it must not move the price.
    expect(s.entries.find((e) => e.driver === 'subcontract_cost')!.delta).toBe(0);
  });

  it('refuses a factor that moves nothing', () => {
    expect(() => analyzeSensitivity(ESTIMATE, { factor: 1 })).toThrow(/moves nothing/);
  });

  it('can probe a chosen subset of drivers', () => {
    const only = analyzeSensitivity(ESTIMATE, { factor: 1.15, drivers: ['fuel_price', 'labor_wage'] });
    expect(only.entries.map((e) => e.driver).sort()).toEqual(['fuel_price', 'labor_wage']);
  });

  it('labels every driver in words', () => {
    for (const d of SCENARIO_DRIVERS) expect(DRIVER_LABELS[d].length).toBeGreaterThan(3);
  });
});
