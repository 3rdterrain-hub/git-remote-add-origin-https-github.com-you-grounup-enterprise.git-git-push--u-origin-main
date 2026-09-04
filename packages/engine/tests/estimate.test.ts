import { describe, expect, it } from 'vitest';
import { calculateEstimate, calculateEstimateLine, type EstimateLineInput } from '../src/estimate.js';
import { resolveEquipmentRate, type LaborClassification } from '../src/resources.js';
import { standardProfile } from '../src/pricing.js';
import { totalDirectCost } from '../src/pricing.js';
import type { ConditionModifier, ProductionRate } from '../src/production.js';

const OP1: LaborClassification = {
  id: 'LAB-OP1', classification: 'Heavy Equipment Operator I', group: 'Operator',
  baseWagePerHour: 40, burdenPercent: 0.35, overtimeMultiplier: 1.5, doubletimeMultiplier: 2,
};
const LAB1: LaborClassification = {
  id: 'LAB-LB1', classification: 'Laborer I', group: 'Laborer',
  baseWagePerHour: 28, burdenPercent: 0.35, overtimeMultiplier: 1.5, doubletimeMultiplier: 2,
};

const rate100 = (over: Partial<ProductionRate> = {}): ProductionRate => ({
  id: 'PR-TEST', ratePerHour: 100, unit: 'CY', utilizationFactor: 1, shiftHours: 8,
  sourceType: 'company_actual', confidence: 0.95, approvalStatus: 'approved', ...over,
});

const machine = (hourly: number, gph: number, count = 1) => ({
  id: 'EQ-1', name: 'Excavator', equipmentClass: 'Excavator',
  rate: resolveEquipmentRate([{ source: 'tenant_approved' as const, hourlyRate: hourly }], '2026-06-01'),
  count, fuelGallonsPerHour: gph, operatorRequired: true,
});

/**
 * A deliberately round scenario so every number below is verifiable by hand:
 * 800 CY at 100 CY/hr and 100% utilization is exactly 8 hours = exactly 1 shift.
 */
const GOLDEN: EstimateLineInput = {
  id: 'L-001',
  description: 'Mass excavation — golden reference line',
  quantity: {
    measured: 800, unit: 'CY', method: 'explicit_dimension',
    sources: ['C-201, Sta. 10+00-14+00', 'C-202 cross sections'],
  },
  productionRate: rate100(),
  crew: { id: 'CRW-1', name: 'Excavation crew', shiftHours: 8, members: [{ classification: OP1, count: 1 }] },
  equipment: [machine(100, 5)],
  fuelPricePerGallon: 4,
  verification: { primarySource: true, crossSource: true, mathematicalReconciliation: true },
};

describe('golden reference line — every value hand-verifiable', () => {
  const r = calculateEstimateLine(GOLDEN);

  it('resolves quantity with no adjustments', () => {
    expect(r.quantity.adjusted).toBe(800);
    expect(r.quantity.gross).toBe(800);
    expect(r.quantity.warnings).toEqual([]);
  });

  it('derives exactly one 8-hour shift', () => {
    // 800 CY / (100 CY/hr x 1.00 utilization) = 8 hr = 1.00 day
    expect(r.production!.recommendedPerHour).toBe(100);
    expect(r.duration!.productiveHours).toBe(8);
    expect(r.duration!.practicalDays).toBe(1);
  });

  it('costs labor as 8 hours of one operator, wage and burden split', () => {
    // 8 hr x $40 = $320 wage; x 35% = $112 burden
    expect(r.laborHours).toBe(8);
    expect(r.directCost.laborWage).toBe(320);
    expect(r.directCost.laborBurden).toBe(112);
  });

  it('costs equipment and fuel separately', () => {
    // 8 hr x $100 = $800 ownership; 8 hr x 5 gal = 40 gal x $4 = $160 fuel
    expect(r.equipmentHours).toBe(8);
    expect(r.directCost.equipmentOwnership).toBe(800);
    expect(r.fuelGallons).toBe(40);
    expect(r.directCost.fuel).toBe(160);
  });

  it('totals direct cost to the sum of its buckets', () => {
    // 320 + 112 + 800 + 160 = 1,392
    expect(r.totalDirectCost).toBe(1392);
    expect(totalDirectCost(r.directCost)).toBe(1392);
  });

  it('computes unit cost against the produced quantity', () => {
    expect(r.unitCost).toBe(1.74);   // 1,392 / 800
  });

  it('scores full confidence and auto-accepts', () => {
    expect(r.confidence.score).toBe(100);
    expect(r.confidence.verificationStatus).toBe('verified');
    expect(r.approval.gate).toBe('auto_accept');
    expect(r.warnings).toEqual([]);
  });

  it('records a complete derivation chain', () => {
    const joined = r.derivation.join('\n');
    for (const section of ['QUANTITY:', 'PRODUCTION:', 'DURATION:', 'CREW:', 'EQUIPMENT:', 'DIRECT COST:']) {
      expect(joined).toContain(section);
    }
  });
});

describe('condition modifiers reach cost and production correctly', () => {
  const rock: ConditionModifier = {
    id: 'MOD-ROCK', name: 'Rock', applicationRule: 'Geotech boring B-4 indicates rock at 6 ft',
    factors: { production: 0.5, labor_cost: 1.35, equipment_cost: 1.35 },
  };

  const r = calculateEstimateLine({
    ...GOLDEN,
    modifiers: [{ modifier: rock, justification: 'Geotech boring B-4 shows rock across the cut area' }],
  });

  it('halves production and therefore doubles the hours', () => {
    expect(r.production!.recommendedPerHour).toBe(50);
    expect(r.duration!.productiveHours).toBe(16);
    expect(r.duration!.practicalDays).toBe(2);
  });

  it('applies the cost surcharge on top of the extra hours', () => {
    // 16 hr x $40 = $640 wage, then x1.35 rock = $864
    expect(r.directCost.laborWage).toBe(864);
    // 16 hr x $100 = $1,600 ownership, x1.35 = $2,160
    expect(r.directCost.equipmentOwnership).toBe(2160);
    // Fuel follows equipment: 80 gal x $4 = $320, x1.35 = $432
    expect(r.directCost.fuel).toBe(432);
  });

  it('keeps the pre-modifier cost visible for comparison', () => {
    expect(r.rawDirectCost.laborWage).toBe(640);
    expect(r.directCost.laborWage).toBe(864);
  });
});

describe('controlling resource governs the line', () => {
  it('slows the line to the haul fleet and says so', () => {
    const r = calculateEstimateLine({
      ...GOLDEN,
      constrainingResources: [{ id: 'TRK', name: 'Haul fleet', kind: 'trucking', capacityPerHour: 60 }],
    });
    expect(r.bottleneck!.controllingResourceId).toBe('TRK');
    // 800 CY / 60 CY/hr = 13.3333 hr, not the 8 hr the excavator alone implies.
    expect(r.duration!.productiveHours).toBe(13.3333);
    expect(r.warnings.some((w) => w.includes('Production is governed by Haul fleet'))).toBe(true);
  });
});

describe('haul integration', () => {
  it('sizes the fleet against the line production and prices the trip', () => {
    const r = calculateEstimateLine({
      ...GOLDEN,
      haul: {
        quantity: 1000, unit: 'LCY', truckCapacity: 14,
        oneWayMiles: 6, loadedSpeedMph: 30, emptySpeedMph: 35,
        dumpMinutes: 2, delayMinutes: 3, truckHourlyRate: 95, disposalFeePerUnit: 8.5,
      },
    });
    // Loader production defaults to the line's 100 CY/hr.
    expect(r.haul!.trucksRequired).toBeGreaterThan(0);
    expect(r.directCost.trucking).toBe(r.haul!.truckingCost);
    expect(r.directCost.disposal).toBe(8500);
  });

  it('refuses to price a haul it cannot size, rather than guessing', () => {
    const { productionRate: _drop, ...noRate } = GOLDEN;
    const r = calculateEstimateLine({
      ...noRate,
      haul: {
        quantity: 1000, unit: 'LCY', truckCapacity: 14, oneWayMiles: 6,
        loadedSpeedMph: 30, emptySpeedMph: 35, dumpMinutes: 2, truckHourlyRate: 95,
      },
    });
    expect(r.haul).toBeUndefined();
    expect(r.directCost.trucking).toBe(0);
    expect(r.warnings.some((w) => w.includes('no loading production is available'))).toBe(true);
  });
});

describe('lines that cannot be priced say so instead of pricing at zero silently', () => {
  it('warns when a crew has no production rate to derive hours from', () => {
    const { productionRate: _drop, ...noRate } = GOLDEN;
    const r = calculateEstimateLine(noRate);
    expect(r.laborHours).toBe(0);
    expect(r.totalDirectCost).toBe(0);
    expect(r.warnings.some((w) => w.includes('No production rate is attached'))).toBe(true);
  });

  it('warns when fuel is burned but no fuel price is set', () => {
    const { fuelPricePerGallon: _drop, ...noFuelPrice } = GOLDEN;
    const r = calculateEstimateLine(noFuelPrice);
    expect(r.fuelGallons).toBe(40);
    expect(r.directCost.fuel).toBe(0);
    expect(r.warnings.some((w) => w.includes('no fuel price is set'))).toBe(true);
  });

  it('warns when a material has no quote reference', () => {
    const r = calculateEstimateLine({
      ...GOLDEN,
      materials: [{ id: 'M1', name: '#57 stone', quantity: 100, unit: 'TON', unitCost: 24 }],
    });
    expect(r.directCost.material).toBe(2400);
    expect(r.warnings.some((w) => w.includes('no quote reference'))).toBe(true);
  });

  it('adds material delivery cost outside the unit cost', () => {
    const r = calculateEstimateLine({
      ...GOLDEN,
      materials: [{ id: 'M1', name: '#57 stone', quantity: 100, unit: 'TON', unitCost: 24, deliveryCost: 350, quoteReference: 'Q-9912' }],
    });
    expect(r.directCost.material).toBe(2750);
  });
});

describe('estimate rollup', () => {
  const profile = standardProfile('PP-AVG', 'Average Market', 'parallel', {
    overhead: 0.1, profit: 0.12, contingency: 0.03,
  });

  it('sums lines and prices the total', () => {
    const e = calculateEstimate({
      id: 'E-1', number: 'EST-1001', name: 'Golden estimate', version: 1, status: 'draft',
      lines: [GOLDEN, { ...GOLDEN, id: 'L-002' }],
      pricingProfile: profile,
    });
    // Two identical $1,392 lines = $2,784 direct.
    expect(e.totalDirectCost).toBe(2784);
    // Confidence 100 -> 3% contingency, so the profile's 3% stands: x1.25.
    expect(e.appliedContingency).toBe(0.03);
    expect(e.contingencySource).toBe('profile');
    expect(e.price.totalPrice).toBe(3480);
    expect(e.bidPrice).toBe(3480);
  });

  it('keeps every cost bucket visible at the estimate level (RULE-001)', () => {
    const e = calculateEstimate({
      id: 'E-1', number: 'EST-1001', name: 'x', version: 1, status: 'draft',
      lines: [GOLDEN, { ...GOLDEN, id: 'L-002' }], pricingProfile: profile,
    });
    expect(e.directCost.laborWage).toBe(640);
    expect(e.directCost.laborBurden).toBe(224);
    expect(e.directCost.equipmentOwnership).toBe(1600);
    expect(e.directCost.fuel).toBe(320);
    expect(totalDirectCost(e.directCost)).toBe(e.totalDirectCost);
  });

  it('rolls hours, fuel and duration', () => {
    const e = calculateEstimate({
      id: 'E-1', number: 'x', name: 'x', version: 1, status: 'draft',
      lines: [GOLDEN, { ...GOLDEN, id: 'L-002' }], pricingProfile: profile,
    });
    expect(e.totalLaborHours).toBe(16);
    expect(e.totalEquipmentHours).toBe(16);
    expect(e.totalFuelGallons).toBe(80);
    expect(e.totalDurationDays).toBe(2);
  });

  it('computes indirect cost three ways and adds it to the markup basis', () => {
    const e = calculateEstimate({
      id: 'E-1', number: 'x', name: 'x', version: 1, status: 'draft',
      lines: [GOLDEN], pricingProfile: profile,
      indirects: [
        { code: 'MOB', label: 'Mobilization', amount: 2500 },
        { code: 'GC', label: 'General conditions', perDay: 400, days: 10 },
        { code: 'SUP', label: 'Supervision', percentOfDirect: 0.05 },
      ],
    });
    // 2,500 + 4,000 + (1,392 x 0.05 = 69.60) = 6,569.60
    expect(e.indirectCost).toBe(6569.6);
    expect(e.indirectDetail[1]!.basis).toBe('400/day x 10 days = 4000');
    // (1,392 + 6,569.60) x 1.25 = 9,952.00
    expect(e.price.totalPrice).toBe(9952);
  });

  it('weights confidence by money at stake, not by line count', () => {
    const bigUncertain: EstimateLineInput = {
      ...GOLDEN, id: 'L-BIG',
      quantity: { measured: 80000, unit: 'CY', method: 'approximate_scale', sources: ['C-201'] },
    };
    const e = calculateEstimate({
      id: 'E-1', number: 'x', name: 'x', version: 1, status: 'draft',
      lines: [GOLDEN, bigUncertain], pricingProfile: profile,
    });
    const [small, big] = [e.lines[0]!, e.lines[1]!];
    expect(small.confidence.score).toBe(100);
    const unweightedMean = (small.confidence.score + big.confidence.score) / 2;
    // The 100-confidence line is ~1% of the money, so the weighted score sits
    // essentially on the big uncertain line rather than at the mean of the two.
    expect(e.weightedConfidence).toBeLessThan(unweightedMean);
    expect(Math.abs(e.weightedConfidence - big.confidence.score)).toBeLessThan(0.5);
    expect(e.confidenceBand).toBe('assumption');
  });

  it('raises contingency above the profile when confidence does not justify it', () => {
    const uncertain: EstimateLineInput = {
      ...GOLDEN, id: 'L-U',
      quantity: { measured: 800, unit: 'CY', method: 'estimator_allowance' },
      verification: { primarySource: false, crossSource: false, mathematicalReconciliation: false },
    };
    const e = calculateEstimate({
      id: 'E-1', number: 'x', name: 'x', version: 1, status: 'draft',
      lines: [uncertain], pricingProfile: profile,
    });
    expect(e.recommendedContingency).toBe(0.12);
    expect(e.appliedContingency).toBe(0.12);
    expect(e.contingencySource).toBe('confidence_band');
    expect(e.warnings.some((w) => w.includes('the higher figure was applied'))).toBe(true);
  });

  it('records an explicit contingency override with who approved it', () => {
    const e = calculateEstimate({
      id: 'E-1', number: 'x', name: 'x', version: 1, status: 'draft',
      lines: [GOLDEN], pricingProfile: profile,
      contingencyOverride: { percent: 0.08, approvedBy: 'J. Okafor, Chief Estimator', reason: 'owner-directed risk share' },
    });
    expect(e.appliedContingency).toBe(0.08);
    expect(e.contingencySource).toBe('override');
    expect(e.warnings.some((w) => w.includes('J. Okafor, Chief Estimator'))).toBe(true);
  });

  it('rounds a bid up to the presentation increment', () => {
    const e = calculateEstimate({
      id: 'E-1', number: 'x', name: 'x', version: 1, status: 'draft',
      lines: [GOLDEN], pricingProfile: profile, bidRoundingIncrement: 500,
    });
    expect(e.price.totalPrice).toBe(1740);
    expect(e.bidPrice).toBe(2000);
    expect(e.bidRoundingAdjustment).toBe(260);
  });
});

describe('approval routing and the Section 59 executive decision', () => {
  const profile = standardProfile('P', 'P', 'parallel', { overhead: 0.1, profit: 0.12, contingency: 0.03 });
  const base = { id: 'E-1', number: 'x', name: 'x', version: 1, status: 'draft' as const, pricingProfile: profile };

  it('declares ready for estimating when every line auto-accepts', () => {
    const e = calculateEstimate({ ...base, lines: [GOLDEN] });
    expect(e.approvalSummary.auto_accept).toEqual(['L-001']);
    expect(e.executiveDecision).toBe('ready_for_estimating');
    expect(e.blockedFromIssue).toBe(false);
  });

  it('declares ready with assumptions when a line needed interpretation', () => {
    const e = calculateEstimate({
      ...base,
      lines: [{
        ...GOLDEN, id: 'L-S',
        quantity: { measured: 800, unit: 'CY', method: 'verified_scale', sources: ['C-201'] },
        assumptions: ['Scale verified against the 100 ft bar on C-201'],
      }],
    });
    expect(e.executiveDecision).toBe('ready_with_assumptions');
    expect(e.executiveDecisionReason).toContain('assumption(s) are recorded');
  });

  it('demands senior review when documents conflict', () => {
    const e = calculateEstimate({ ...base, lines: [{ ...GOLDEN, id: 'L-C', conflictCount: 1 }] });
    expect(e.approvalSummary.senior_review).toEqual(['L-C']);
    expect(e.executiveDecision).toBe('senior_review_required');
    expect(e.blockedFromIssue).toBe(true);
  });

  it('demands RFI resolution above everything else', () => {
    const e = calculateEstimate({
      ...base,
      lines: [
        { ...GOLDEN, id: 'L-C', conflictCount: 1 },
        { ...GOLDEN, id: 'L-R', documentsCannotResolve: true },
      ],
    });
    expect(e.executiveDecision).toBe('rfi_resolution_required');
    expect(e.executiveDecisionReason).toContain('L-R');
  });

  it('reports an empty estimate as an incomplete document set', () => {
    const e = calculateEstimate({ ...base, lines: [] });
    expect(e.executiveDecision).toBe('document_set_incomplete');
    expect(e.totalDirectCost).toBe(0);
    expect(e.weightedConfidence).toBe(0);
  });

  it('flags an issued estimate that still contains blocking lines (RULE-009)', () => {
    const e = calculateEstimate({
      ...base, status: 'issued',
      lines: [{ ...GOLDEN, id: 'L-C', conflictCount: 1 }],
    });
    expect(e.warnings.some((w) => w.includes('RULE-009'))).toBe(true);
  });

  it('never auto-accepts an AI-generated line', () => {
    const e = calculateEstimate({ ...base, lines: [{ ...GOLDEN, id: 'L-AI', aiGenerated: true }] });
    expect(e.approvalSummary.auto_accept).toEqual([]);
    expect(e.approvalSummary.estimator_review).toEqual(['L-AI']);
  });
});

describe('documented use case EX-001 — mass excavation, two-dozer method', () => {
  const e = calculateEstimate({
    id: 'E-EX001', number: 'EST-2001', name: 'EX-001 Mass excavation', version: 1, status: 'draft',
    pricingProfile: standardProfile('PP-AVG', 'Average Market', 'parallel', { overhead: 0.1, profit: 0.12, contingency: 0.03 }),
    lines: [{
      id: 'EX-001',
      description: 'Mass excavation — excavator cuts and loads, two D6 spread and shape',
      serviceId: 'SVC-0010', discipline: 'Earthwork',
      quantity: {
        measured: 10000, unit: 'CY', method: 'explicit_dimension',
        sources: ['C-201 grading plan', 'C-210 cross sections'],
      },
      productionRate: {
        id: 'PR-EW-MASS', ratePerHour: 180, unit: 'CY', utilizationFactor: 0.83, shiftHours: 8,
        sourceType: 'company_historical', confidence: 0.86, approvalStatus: 'approved',
      },
      crew: {
        id: 'CRW-EW-02', name: 'Mass excavation crew', shiftHours: 8,
        members: [{ classification: OP1, count: 3 }, { classification: LAB1, count: 1 }],
      },
      equipment: [
        { ...machine(112.5, 5.5), id: 'EQ-EX-20', name: 'Excavator 20-25 ton' },
        { ...machine(95, 4.2, 2), id: 'EQ-DZ-D6', name: 'Dozer D6' },
      ],
      fuelPricePerGallon: 4.25,
      verification: { primarySource: true, crossSource: true, mathematicalReconciliation: true },
    }],
  });
  const line = e.lines[0]!;

  it('runs at practical rather than theoretical production', () => {
    expect(line.production!.theoreticalPerHour).toBe(180);
    expect(line.production!.practicalPerHour).toBe(149.4);   // 180 x 0.83
    expect(line.production!.recommendedPerHour).toBe(149.4);
  });

  it('produces a duration consistent with quantity and production', () => {
    // 10,000 / 149.4 = 66.9344 hr -> 8.37 days at 8 hr
    expect(line.duration!.productiveHours).toBe(66.9344);
    expect(line.duration!.rawDays).toBe(8.37);
  });

  it('staffs four workers across that duration', () => {
    // 4 workers x 8 hr x 8.37 days = 267.84 man-hours
    expect(line.crew!.headcount).toBe(4);
    expect(line.laborHours).toBe(267.84);
  });

  it('runs three machines for the operation duration', () => {
    // (1 excavator + 2 dozers) x 66.9344 hr = 200.8032 equipment-hours
    expect(line.equipmentHours).toBe(200.8032);
  });

  it('burns fuel proportional to machine hours', () => {
    // excavator 66.9344 x 5.5 = 368.1392; dozers 133.8688 x 4.2 = 562.249
    expect(line.fuelGallons).toBe(930.39);
  });

  it('produces a costed, priced, auditable result', () => {
    expect(line.totalDirectCost).toBeGreaterThan(0);
    expect(totalDirectCost(line.directCost)).toBe(line.totalDirectCost);
    expect(e.price.totalPrice).toBeGreaterThan(e.totalDirectCost);
    expect(line.unitCost).toBeCloseTo(line.totalDirectCost / 10000, 4);
  });
});

describe('documented use case EX-002 — 12-inch storm sewer', () => {
  const e = calculateEstimate({
    id: 'E-EX002', number: 'EST-2002', name: 'EX-002 Storm sewer', version: 1, status: 'draft',
    pricingProfile: standardProfile('PP-AVG', 'Average Market', 'parallel', { overhead: 0.1, profit: 0.12, contingency: 0.03 }),
    lines: [{
      id: 'EX-002',
      description: '12-inch storm sewer, 6-8 ft depth — excavate, bed, install, test, backfill, restore',
      serviceId: 'SVC-0075', discipline: 'Utilities',
      quantity: {
        measured: 1000, unit: 'LF', method: 'derived',
        adjustments: [{ code: 'STRUCT', label: 'Structure deduction', amount: -24, reason: '6 structures at 4 ft each per C-401' }],
        sources: ['C-301 storm plan', 'C-302 storm profile'],
      },
      productionRate: {
        id: 'PR-UTL-12', ratePerHour: 22, unit: 'LF', utilizationFactor: 0.8, shiftHours: 8,
        sourceType: 'company_actual', confidence: 0.9, approvalStatus: 'approved',
      },
      crew: {
        id: 'CRW-UTL-01', name: 'Utility crew', shiftHours: 8,
        members: [{ classification: OP1, count: 1 }, { classification: LAB1, count: 3 }],
      },
      equipment: [{ ...machine(112.5, 5.5), id: 'EQ-EX-20', name: 'Excavator 20-25 ton' }],
      materials: [
        { id: 'M-PIPE', name: '12" RCP', quantity: 976, unit: 'LF', unitCost: 32.5, quoteReference: 'Q-4471' },
        { id: 'M-BED', name: '#57 bedding stone', quantity: 310, unit: 'TON', unitCost: 24, deliveryCost: 0, quoteReference: 'Q-4472' },
      ],
      fuelPricePerGallon: 4.25,
      verification: { primarySource: true, crossSource: true, mathematicalReconciliation: true },
      materialGeotechnicalAssumption: true,
      assumptions: ['Trench depth averaged 7 ft from the C-302 profile'],
    }],
  });
  const line = e.lines[0]!;

  it('deducts structure length from the measured pipe run', () => {
    expect(line.quantity.measured).toBe(1000);
    expect(line.quantity.adjusted).toBe(976);
    expect(line.quantity.derivation).toContain('Structure deduction -24');
  });

  it('prices pipe and bedding material', () => {
    // 976 x 32.50 = 31,720; 310 x 24 = 7,440 -> 39,160
    expect(line.directCost.material).toBe(39160);
  });

  it('derives duration from the utility production rate', () => {
    // 22 x 0.8 = 17.6 LF/hr; 976 / 17.6 = 55.4545 hr -> 6.93 days
    expect(line.production!.recommendedPerHour).toBe(17.6);
    expect(line.duration!.productiveHours).toBe(55.4545);
    expect(line.duration!.rawDays).toBe(6.93);
  });

  it('escalates to senior review on the material geotechnical assumption', () => {
    expect(line.approval.gate).toBe('senior_review');
    expect(e.executiveDecision).toBe('senior_review_required');
    expect(e.blockedFromIssue).toBe(true);
  });
});
