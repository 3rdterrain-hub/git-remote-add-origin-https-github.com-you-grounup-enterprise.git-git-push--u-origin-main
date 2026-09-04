import { describe, expect, it } from 'vitest';
import {
  calculateCrewCost, calculateEquipmentCost, EQUIPMENT_RATE_PRECEDENCE, fuelGallons,
  loadedLaborRate, resolveEquipmentRate,
  type Crew, type EquipmentItem, type LaborClassification,
} from '../src/resources.js';

const op1: LaborClassification = {
  id: 'LAB-OP1', classification: 'Heavy Equipment Operator I', group: 'Operator',
  baseWagePerHour: 40, burdenPercent: 0.35, overtimeMultiplier: 1.5, doubletimeMultiplier: 2,
};
const lab1: LaborClassification = {
  id: 'LAB-LB1', classification: 'Laborer I', group: 'Laborer',
  baseWagePerHour: 28, burdenPercent: 0.35, overtimeMultiplier: 1.5, doubletimeMultiplier: 2,
};

describe('loaded labor rate', () => {
  it('matches the seed library: $40 base at 35% burden = $54.00/hr', () => {
    const r = loadedLaborRate(op1);
    expect(r.burdenPerHour).toBe(14);
    expect(r.loadedPerHour).toBe(54);
    expect(r.derivation).toBe('40 base x (1 + 0.35 burden) = 54/hr loaded');
  });

  it('matches the seed library for Operator II: $44 at 35% = $59.40/hr', () => {
    expect(loadedLaborRate({ ...op1, id: 'LAB-OP2', baseWagePerHour: 44 }).loadedPerHour).toBe(59.4);
  });

  it('handles a zero burden', () => {
    expect(loadedLaborRate({ ...op1, burdenPercent: 0 }).loadedPerHour).toBe(40);
  });

  it('rejects negative wage or burden', () => {
    expect(() => loadedLaborRate({ ...op1, baseWagePerHour: -1 })).toThrow(RangeError);
    expect(() => loadedLaborRate({ ...op1, burdenPercent: -0.1 })).toThrow(RangeError);
  });
});

describe('crew cost', () => {
  const crew: Crew = {
    id: 'CRW-EW-01', name: 'Earthwork crew',
    shiftHours: 8,
    members: [
      { classification: op1, count: 2 },
      { classification: lab1, count: 1 },
    ],
  };

  it('costs a straight-time crew with wage and burden separated', () => {
    // 10 shifts: operators 2 x 8 x 10 = 160 hr x $40 = $6,400
    //            laborer   1 x 8 x 10 =  80 hr x $28 = $2,240
    //            wage = $8,640; burden 35% = $3,024; total = $11,664
    const r = calculateCrewCost(crew, 10);
    expect(r.headcount).toBe(3);
    expect(r.totalLaborHours).toBe(240);
    expect(r.baseWageCost).toBe(8640);
    expect(r.burdenCost).toBe(3024);
    expect(r.overtimePremiumCost).toBe(0);
    expect(r.totalLaborCost).toBe(11664);
    expect(r.costPerCrewHour).toBe(145.8);  // 11664 / 80 crew-hours
  });

  it('prices overtime as a premium, with burden following gross pay', () => {
    // 1 operator, 1 shift, 8 ST + 2 OT.
    // wage on all 10 hr = $400; OT premium = 40 x 0.5 x 2 = $40
    // burden = (400 + 40) x 0.35 = $154; total = $594
    const r = calculateCrewCost(
      { id: 'C', name: 'C', shiftHours: 8, members: [{ classification: op1, count: 1, straightHoursPerShift: 8, overtimeHoursPerShift: 2 }] },
      1,
    );
    expect(r.baseWageCost).toBe(400);
    expect(r.overtimePremiumCost).toBe(40);
    expect(r.burdenCost).toBe(154);
    expect(r.totalLaborCost).toBe(594);
    expect(r.totalLaborHours).toBe(10);
  });

  it('prices doubletime at its own multiplier', () => {
    // 8 ST + 4 DT: wage 12 x 40 = 480; DT premium = 40 x 1.0 x 4 = 160
    const r = calculateCrewCost(
      { id: 'C', name: 'C', shiftHours: 8, members: [{ classification: op1, count: 1, straightHoursPerShift: 8, doubletimeHoursPerShift: 4 }] },
      1,
    );
    expect(r.baseWageCost).toBe(480);
    expect(r.overtimePremiumCost).toBe(160);
  });

  it('returns zero cost for zero shifts without dividing by zero', () => {
    const r = calculateCrewCost(crew, 0);
    expect(r.totalLaborCost).toBe(0);
    expect(r.costPerCrewHour).toBe(0);
  });

  it('reports per-classification lines that sum to the total', () => {
    const r = calculateCrewCost(crew, 10);
    expect(r.lines).toHaveLength(2);
    const sum = r.lines.reduce((a, l) => a + l.totalCost, 0);
    expect(sum).toBeCloseTo(r.totalLaborCost, 2);
  });

  it('warns on an implausible shift and a retired classification', () => {
    const r = calculateCrewCost(
      { id: 'C', name: 'C', shiftHours: 8, members: [{ classification: { ...op1, status: 'retired' }, count: 1, straightHoursPerShift: 20 }] },
      1,
    );
    expect(r.warnings.some((w) => w.includes('20 hr/shift'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('retired'))).toBe(true);
  });

  it('rejects an empty crew and invalid inputs', () => {
    expect(() => calculateCrewCost({ id: 'C', name: 'C', shiftHours: 8, members: [] }, 1)).toThrow(/no members/);
    expect(() => calculateCrewCost({ ...crew, shiftHours: 0 }, 1)).toThrow(RangeError);
    expect(() => calculateCrewCost(crew, -1)).toThrow(RangeError);
  });
});

describe('equipment rate hierarchy (RULE-003)', () => {
  it('declares precedence: project quote > tenant > regional > seed', () => {
    expect([...EQUIPMENT_RATE_PRECEDENCE]).toEqual(['project_quote', 'tenant_approved', 'regional', 'global_seed']);
  });

  it('picks the project quote over every lower source', () => {
    const r = resolveEquipmentRate([
      { source: 'global_seed', hourlyRate: 112.5 },
      { source: 'regional', hourlyRate: 120 },
      { source: 'project_quote', hourlyRate: 98, reference: 'Vendor quote 4471' },
      { source: 'tenant_approved', hourlyRate: 105 },
    ], '2026-06-01');
    expect(r.source).toBe('project_quote');
    expect(r.hourlyRate).toBe(98);
    expect(r.derivation).toContain('over global_seed, regional, tenant_approved');
  });

  it('falls through to the seed rate and warns that it must be replaced', () => {
    const r = resolveEquipmentRate([{ source: 'global_seed', hourlyRate: 112.5 }], '2026-06-01');
    expect(r.source).toBe('global_seed');
    expect(r.warnings.some((w) => w.includes('global seed rate'))).toBe(true);
  });

  it('excludes a rate that is not yet effective', () => {
    const r = resolveEquipmentRate([
      { source: 'project_quote', hourlyRate: 90, effectiveDate: '2026-12-01' },
      { source: 'tenant_approved', hourlyRate: 105, effectiveDate: '2026-01-01' },
    ], '2026-06-01');
    expect(r.source).toBe('tenant_approved');
    expect(r.warnings.some((w) => w.includes('not effective until 2026-12-01'))).toBe(true);
  });

  it('excludes an expired rate', () => {
    const r = resolveEquipmentRate([
      { source: 'project_quote', hourlyRate: 90, expiresOn: '2026-03-01' },
      { source: 'regional', hourlyRate: 120 },
    ], '2026-06-01');
    expect(r.source).toBe('regional');
    expect(r.warnings.some((w) => w.includes('expired 2026-03-01'))).toBe(true);
  });

  it('re-resolves a historical estimate to the rate in force at the time', () => {
    const candidates = [
      { source: 'project_quote' as const, hourlyRate: 90, effectiveDate: '2026-05-01' },
      { source: 'tenant_approved' as const, hourlyRate: 105, effectiveDate: '2026-01-01' },
    ];
    expect(resolveEquipmentRate(candidates, '2026-02-01').source).toBe('tenant_approved');
    expect(resolveEquipmentRate(candidates, '2026-06-01').source).toBe('project_quote');
  });

  it('uses the best available candidate when none is effective, and says so', () => {
    const r = resolveEquipmentRate([{ source: 'project_quote', hourlyRate: 90, expiresOn: '2020-01-01' }], '2026-06-01');
    expect(r.source).toBe('project_quote');
    expect(r.warnings.some((w) => w.includes('No rate candidate is currently effective'))).toBe(true);
  });

  it('retains every source considered for the audit trail', () => {
    const r = resolveEquipmentRate([
      { source: 'regional', hourlyRate: 120 },
      { source: 'tenant_approved', hourlyRate: 105 },
    ], '2026-06-01');
    expect([...r.consideredSources]).toEqual(['regional', 'tenant_approved']);
  });

  it('rejects an empty candidate list', () => {
    expect(() => resolveEquipmentRate([], '2026-06-01')).toThrow(/at least one rate candidate/);
  });
});

describe('equipment cost and fuel (Section 29)', () => {
  const ex20: EquipmentItem = {
    id: 'EQ-EX-20', name: 'Excavator 20-25 ton', equipmentClass: 'Excavator',
    rate: resolveEquipmentRate([{ source: 'tenant_approved', hourlyRate: 112.5 }], '2026-06-01'),
    count: 1, fuelGallonsPerHour: 0.55 * 10, defPercentOfFuel: 0.03,
    operatorRequired: true,
  };

  it('costs ownership and fuel separately (RULE-001)', () => {
    // 80 hr x $112.50 = $9,000 ownership
    // 80 hr x 5.5 gal = 440 gal x $4.25 = $1,870 fuel (reported apart)
    // DEF 3% of 440 = 13.2 gal x $12 = $158.40
    const r = calculateEquipmentCost([ex20], 80, 4.25, 12);
    expect(r.totalEquipmentHours).toBe(80);
    expect(r.ownershipCost).toBe(9000);
    expect(r.fuelGallons).toBe(440);
    expect(r.fuelCost).toBe(1870);
    expect(r.defGallons).toBe(13.2);
    expect(r.defCost).toBe(158.4);
    // Fuel deliberately stays out of totalEquipmentCost.
    expect(r.totalEquipmentCost).toBe(9000);
  });

  it('multiplies hours and cost by the unit count', () => {
    const r = calculateEquipmentCost([{ ...ex20, count: 3 }], 80, 4.25);
    expect(r.totalEquipmentHours).toBe(240);
    expect(r.ownershipCost).toBe(27000);
    expect(r.fuelGallons).toBe(1320);
  });

  it('adds mobilization per unit', () => {
    const r = calculateEquipmentCost(
      [{ ...ex20, count: 2, mobilizationRequired: true, mobilizationCost: 450 }], 80, 0,
    );
    expect(r.mobilizationCost).toBe(900);
    expect(r.totalEquipmentCost).toBe(18000 + 900);
  });

  it('warns when mobilization is required but unpriced', () => {
    const r = calculateEquipmentCost([{ ...ex20, mobilizationRequired: true }], 80, 0);
    expect(r.warnings.some((w) => w.includes('no mobilization cost'))).toBe(true);
  });

  it('surfaces rate-resolution warnings against the machine that raised them', () => {
    const seeded: EquipmentItem = {
      ...ex20, id: 'EQ-SEED', name: 'Seeded dozer',
      rate: resolveEquipmentRate([{ source: 'global_seed', hourlyRate: 100 }], '2026-06-01'),
    };
    const r = calculateEquipmentCost([seeded], 8, 4);
    expect(r.warnings.some((w) => w.startsWith('Seeded dozer:'))).toBe(true);
  });

  it('handles an empty spread', () => {
    const r = calculateEquipmentCost([], 80, 4.25);
    expect(r.totalEquipmentCost).toBe(0);
    expect(r.fuelGallons).toBe(0);
  });

  it('computes standalone fuel gallons', () => {
    expect(fuelGallons(80, 5.5)).toBe(440);
    expect(fuelGallons(0, 5.5)).toBe(0);
    expect(() => fuelGallons(-1, 5)).toThrow(RangeError);
  });

  it('rejects an invalid unit count', () => {
    expect(() => calculateEquipmentCost([{ ...ex20, count: 0 }], 8, 4)).toThrow(RangeError);
  });
});
