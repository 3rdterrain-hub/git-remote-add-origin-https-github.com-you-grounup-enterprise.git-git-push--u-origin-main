import { describe, expect, it } from 'vitest';
import {
  analyzeBottleneck, analyzeProduction, calculateDuration, resolveModifiers,
  SOURCE_RELIABILITY, type ConditionModifier, type ProductionRate,
} from '../src/production.js';

const access: ConditionModifier = {
  id: 'MOD-ACCESS', name: 'Restricted access', factors: { production: 0.75 },
  applicationRule: 'Explicit estimator selection with explanation',
};
const weather: ConditionModifier = {
  id: 'MOD-WEATHER', name: 'Adverse weather', factors: { production: 0.8 },
  applicationRule: 'Explicit estimator selection with explanation',
};
const rock: ConditionModifier = {
  id: 'MOD-ROCK', name: 'Rock', factors: { labor_cost: 1.35, equipment_cost: 1.35, production: 0.65 },
  applicationRule: 'Geotechnical report indicates rock',
};
const winter: ConditionModifier = {
  id: 'MOD-WINTER', name: 'Winter', factors: { labor_cost: 1.12 },
  applicationRule: 'Work scheduled in winter months',
};

const j = 'Site visit 2026-03-04 confirmed the condition';

describe('condition modifiers (RULE-006)', () => {
  it('compounds production impediments multiplicatively', () => {
    // Restricted access (0.75) inside adverse weather (0.80) = 0.60, not 0.55.
    const r = resolveModifiers([
      { modifier: access, justification: j },
      { modifier: weather, justification: j },
    ]);
    expect(r.combined.production).toBe(0.6);
  });

  it('adds independent cost causes rather than compounding them', () => {
    // Rock (+35%) and winter (+12%) on labor = +47%, not 1.35 x 1.12 = +51.2%.
    const r = resolveModifiers([
      { modifier: rock, justification: j },
      { modifier: winter, justification: j },
    ]);
    expect(r.combined.labor_cost).toBe(1.47);
    expect(r.combined.equipment_cost).toBe(1.35);
    expect(r.combined.production).toBe(0.65);
  });

  it('leaves undeclared targets untouched — no implicit spillover', () => {
    const r = resolveModifiers([{ modifier: winter, justification: j }]);
    expect(r.combined.labor_cost).toBe(1.12);
    expect(r.combined.equipment_cost).toBe(1);
    expect(r.combined.material_cost).toBe(1);
    expect(r.combined.production).toBe(1);
    expect(r.combined.trucking_cost).toBe(1);
  });

  it('resolves to all-ones when nothing is selected', () => {
    const r = resolveModifiers([]);
    expect(Object.values(r.combined).every((v) => v === 1)).toBe(true);
    expect(r.applied).toEqual([]);
  });

  it('requires a justification for every modifier', () => {
    expect(() => resolveModifiers([{ modifier: access, justification: '  ' }])).toThrow(/requires an explicit justification/);
  });

  it('applies a duplicated modifier once and warns', () => {
    const r = resolveModifiers([
      { modifier: access, justification: j },
      { modifier: access, justification: j },
    ]);
    expect(r.combined.production).toBe(0.75);
    expect(r.warnings.some((w) => w.includes('selected more than once'))).toBe(true);
  });

  it('warns when a retired modifier is used', () => {
    const retired: ConditionModifier = { ...access, id: 'MOD-OLD', status: 'retired' };
    const r = resolveModifiers([{ modifier: retired, justification: j }]);
    expect(r.warnings.some((w) => w.includes('is retired'))).toBe(true);
  });

  it('warns when the combined production factor becomes implausible', () => {
    const brutal: ConditionModifier = { id: 'M', name: 'Brutal', factors: { production: 0.2 }, applicationRule: 'r' };
    const r = resolveModifiers([
      { modifier: brutal, justification: j },
      { modifier: { ...brutal, id: 'M2' }, justification: j },
    ]);
    expect(r.combined.production).toBe(0.04);
    expect(r.warnings.some((w) => w.includes('under 15% of base rate'))).toBe(true);
  });

  it('clamps a cost bucket that additive discounts drive below zero', () => {
    const huge: ConditionModifier = { id: 'D1', name: 'Discount', factors: { material_cost: 0.2 }, applicationRule: 'r' };
    const r = resolveModifiers([
      { modifier: huge, justification: j },
      { modifier: { ...huge, id: 'D2' }, justification: j },
    ]);
    // (1 - 0.8) + (1 - 0.8) surcharges = -1.6 -> 1 - 1.6 = -0.6, clamped to 0.
    expect(r.combined.material_cost).toBe(0);
    expect(r.warnings.some((w) => w.includes('not physical'))).toBe(true);
  });

  it('rejects a non-positive factor', () => {
    const bad: ConditionModifier = { id: 'B', name: 'Bad', factors: { production: 0 }, applicationRule: 'r' };
    expect(() => resolveModifiers([{ modifier: bad, justification: j }])).toThrow(RangeError);
  });

  it('records the derivation per target', () => {
    const r = resolveModifiers([
      { modifier: access, justification: j },
      { modifier: weather, justification: j },
    ]);
    expect(r.derivation.some((d) => d.startsWith('production: 1 x 0.75 (Restricted access) x 0.8 (Adverse weather) = 0.6'))).toBe(true);
  });
});

describe('production analysis (Section 25)', () => {
  const rate: ProductionRate = {
    id: 'PR-1', ratePerHour: 100, unit: 'CY', utilizationFactor: 0.83, shiftHours: 8,
    sourceType: 'company_actual', confidence: 0.9, approvalStatus: 'approved',
  };

  it('reports theoretical, practical and recommended as three numbers', () => {
    // 100 theoretical -> x0.83 utilization = 83 practical -> x0.6 conditions = 49.8 recommended
    const r = analyzeProduction(rate, 0.6);
    expect(r.theoreticalPerHour).toBe(100);
    expect(r.practicalPerHour).toBe(83);
    expect(r.recommendedPerHour).toBe(49.8);
    expect(r.recommendedPerShift).toBe(398.4);   // 49.8 x 8
  });

  it('never lets the raw theoretical rate be the estimating rate', () => {
    const r = analyzeProduction(rate);
    // Even with no site conditions, utilization still applies.
    expect(r.recommendedPerHour).toBe(83);
    expect(r.recommendedPerHour).toBeLessThan(r.theoreticalPerHour);
  });

  it('warns that a seed benchmark is not a company standard', () => {
    const r = analyzeProduction({ ...rate, sourceType: 'seed_benchmark' });
    expect(r.warnings.some((w) => w.includes('seed benchmark'))).toBe(true);
  });

  it('warns on a draft catalog rate', () => {
    const r = analyzeProduction({ ...rate, approvalStatus: 'draft' });
    expect(r.warnings.some((w) => w.includes('draft catalog rate'))).toBe(true);
  });

  it('warns on a utilization factor above 1.0', () => {
    const r = analyzeProduction({ ...rate, utilizationFactor: 1.2 });
    expect(r.warnings.some((w) => w.includes('exceeds 1.0'))).toBe(true);
  });

  it('warns on an implausible shift length', () => {
    const r = analyzeProduction({ ...rate, shiftHours: 20 });
    expect(r.warnings.some((w) => w.includes('exceeds 16'))).toBe(true);
  });

  it('rejects invalid rates', () => {
    expect(() => analyzeProduction({ ...rate, ratePerHour: 0 })).toThrow(RangeError);
    expect(() => analyzeProduction({ ...rate, shiftHours: 0 })).toThrow(RangeError);
    expect(() => analyzeProduction({ ...rate, utilizationFactor: 0 })).toThrow(RangeError);
  });

  it('ranks data sources by reliability', () => {
    expect(SOURCE_RELIABILITY.company_actual).toBeGreaterThan(SOURCE_RELIABILITY.regional_benchmark);
    expect(SOURCE_RELIABILITY.regional_benchmark).toBeGreaterThan(SOURCE_RELIABILITY.seed_benchmark);
  });
});

describe('controlling resource (RULE-005)', () => {
  it('runs the operation at the slowest resource, not the primary machine', () => {
    const r = analyzeBottleneck([
      { id: 'EX', name: 'Excavator', kind: 'equipment', capacityPerHour: 200 },
      { id: 'TRK', name: 'Haul fleet', kind: 'trucking', capacityPerHour: 120 },
      { id: 'CMP', name: 'Compaction', kind: 'equipment', capacityPerHour: 160 },
    ]);
    expect(r.controllingResourceId).toBe('TRK');
    expect(r.operationCapacityPerHour).toBe(120);
    // The excavator runs at 60% and has 80 CY/hr of slack that buys nothing.
    const ex = r.utilization.find((u) => u.id === 'EX')!;
    expect(ex.utilization).toBe(0.6);
    expect(ex.slackPerHour).toBe(80);
  });

  it('names the resource that becomes controlling next', () => {
    const r = analyzeBottleneck([
      { id: 'A', name: 'Alpha', kind: 'equipment', capacityPerHour: 100 },
      { id: 'B', name: 'Bravo', kind: 'crew', capacityPerHour: 150 },
    ]);
    expect(r.improvementNote).toContain('governed by Alpha');
    expect(r.improvementNote).toContain('Bravo');
  });

  it('reports co-controlling resources within 5%', () => {
    const r = analyzeBottleneck([
      { id: 'A', name: 'Alpha', kind: 'equipment', capacityPerHour: 100 },
      { id: 'B', name: 'Bravo', kind: 'crew', capacityPerHour: 103 },
      { id: 'C', name: 'Charlie', kind: 'trucking', capacityPerHour: 200 },
    ]);
    expect(r.coControllingIds).toEqual(['A', 'B']);
    expect(r.improvementNote).toContain('will not increase production');
  });

  it('handles a single resource', () => {
    const r = analyzeBottleneck([{ id: 'A', name: 'Alpha', kind: 'equipment', capacityPerHour: 75 }]);
    expect(r.controllingResourceId).toBe('A');
    expect(r.operationCapacityPerHour).toBe(75);
  });

  it('rejects an empty or invalid resource set', () => {
    expect(() => analyzeBottleneck([])).toThrow(/at least one resource/);
    expect(() => analyzeBottleneck([{ id: 'A', name: 'A', kind: 'crew', capacityPerHour: 0 }])).toThrow(RangeError);
  });
});

describe('duration (RULE-002, Section 37)', () => {
  it('derives days from quantity and production', () => {
    // 10,000 CY / 100 CY/hr = 100 hr / 8 hr shift = 12.5 days
    const r = calculateDuration({ quantity: 10000, productionPerHour: 100, shiftHours: 8 });
    expect(r.productiveHours).toBe(100);
    expect(r.rawDays).toBe(12.5);
    expect(r.practicalDays).toBe(12.5);
  });

  it('divides by calendar efficiency rather than marking up by its complement', () => {
    // 12.5 / 0.85 = 14.71 days. Marking up by 15% would give 14.38 and
    // understate the schedule.
    const r = calculateDuration({ quantity: 10000, productionPerHour: 100, shiftHours: 8, calendarEfficiency: 0.85 });
    expect(r.practicalDays).toBe(14.71);
    expect(r.rangeDays).toEqual({ low: 12.5, high: 17.65 });
  });

  it('adds fixed hours that do not scale with quantity', () => {
    // (100 + 16) / 8 = 14.5 days
    const r = calculateDuration({ quantity: 10000, productionPerHour: 100, shiftHours: 8, fixedHours: 16 });
    expect(r.totalHours).toBe(116);
    expect(r.rawDays).toBe(14.5);
  });

  it('divides work across parallel crews', () => {
    const r = calculateDuration({ quantity: 10000, productionPerHour: 100, shiftHours: 8, parallelCrews: 2 });
    expect(r.totalHours).toBe(50);
    expect(r.rawDays).toBe(6.25);
  });

  it('refuses a production rate of zero rather than reporting zero duration', () => {
    /*
     * This previously returned zero hours and zero days, on the reasoning that
     * it avoided dividing by zero. Avoiding the division is right; returning 0
     * is not. A line with a missing production rate would cost nothing, take
     * no time, and nothing would flag it — which is how a missing rate reaches
     * a bid. Refusing is the way to avoid the division.
     */
    expect(() => calculateDuration({ quantity: 1000, productionPerHour: 0, shiftHours: 8 }))
      .toThrow(/productionPerHour must be > 0/);
  });

  it('refuses a shift longer than a day', () => {
    expect(() => calculateDuration({ quantity: 100, productionPerHour: 50, shiftHours: 25 }))
      .toThrow(/shiftHours must be at most 24/);
  });

  it('rejects an out-of-range calendar efficiency', () => {
    expect(() => calculateDuration({ quantity: 1, productionPerHour: 1, shiftHours: 8, calendarEfficiency: 0 })).toThrow(RangeError);
    expect(() => calculateDuration({ quantity: 1, productionPerHour: 1, shiftHours: 8, calendarEfficiency: 1.5 })).toThrow(RangeError);
  });

  it('records a readable derivation', () => {
    const r = calculateDuration({ quantity: 10000, productionPerHour: 100, shiftHours: 8, calendarEfficiency: 0.85 });
    expect(r.derivation).toContain('10000 / 100 per hr = 100 productive hr');
    expect(r.derivation).toContain('/ 0.85 calendar efficiency = 14.71 days');
  });
});
