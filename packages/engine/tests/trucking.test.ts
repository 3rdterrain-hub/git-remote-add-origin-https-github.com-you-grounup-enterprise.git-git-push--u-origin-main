import { describe, expect, it } from 'vitest';
import { analyzeCutFill, analyzeHaulCycle, preliminaryHaulCost, type HaulCycleInput } from '../src/trucking.js';

const base: HaulCycleInput = {
  quantity: 10000, unit: 'LCY', truckCapacity: 14,
  oneWayMiles: 6, loadedSpeedMph: 30, emptySpeedMph: 35,
  dumpMinutes: 2, delayMinutes: 3,
  loaderProductionPerHour: 200, shiftHours: 8, truckHourlyRate: 95,
};

describe('trip-based haul cycle (Section 28, RULE-004)', () => {
  it('builds the cycle from its five components', () => {
    // load  = (14 LCY / 200 LCY/hr) x 60 = 4.2000 min
    // haul  = (6 mi / 30 mph)       x 60 = 12.0000 min
    // dump  =                              2.0000 min
    // return= (6 mi / 35 mph)       x 60 = 10.2857 min
    // delay =                              3.0000 min
    // cycle =                             31.4857 min
    const r = analyzeHaulCycle(base);
    expect(r.loadMinutes).toBe(4.2);
    expect(r.haulMinutes).toBe(12);
    expect(r.returnMinutes).toBe(10.2857);
    expect(r.cycleMinutes).toBe(31.4857);
  });

  it('derives per-truck production from the cycle', () => {
    // 60 / 31.4857 = 1.9056 cycles/hr x 14 LCY = 26.6788 LCY/truck/hr
    const r = analyzeHaulCycle(base);
    expect(r.productionPerTruckPerHour).toBe(26.6788);
    expect(r.productionPerTruckPerShift).toBe(213.4304);
    expect(r.cyclesPerTruckPerShift).toBe(15.245);
  });

  it('sizes the fleet from the loader and rounds up to whole trucks', () => {
    // 200 LCY/hr loader / 26.6788 LCY/truck/hr = 7.4966 -> 8 trucks
    const r = analyzeHaulCycle(base);
    expect(r.trucksToBalanceLoader).toBe(7.4966);
    expect(r.trucksRequired).toBe(8);
  });

  it('counts loads and rounds partial loads up', () => {
    // 10,000 / 14 = 714.2857 -> 715 truck loads actually driven
    const r = analyzeHaulCycle(base);
    expect(r.loads).toBe(714.2857);
    expect(r.wholeLoads).toBe(715);
  });

  it('caps effective production at the loader, not the fleet', () => {
    // 8 trucks could carry 213.43 LCY/hr but the loader only makes 200.
    const r = analyzeHaulCycle(base);
    expect(r.effectiveProductionPerHour).toBe(200);
    expect(r.balance).toBe('trucks_queueing');
    expect(r.balanceNote).toContain('waits about');
  });

  it('detects an undersized fleet and names the idle cost', () => {
    // 5 trucks x 26.6788 = 133.39 LCY/hr against a 200 LCY/hr loader.
    const r = analyzeHaulCycle({ ...base, availableTrucks: 5 });
    expect(r.balance).toBe('loader_starved');
    expect(r.effectiveProductionPerHour).toBe(133.394);
    expect(r.balanceNote).toContain('loading unit idles');
    expect(r.warnings.some((w) => w.includes('loading equipment is the paid resource sitting idle'))).toBe(true);
  });

  it('reports a balanced fleet within tolerance', () => {
    // 7 trucks x 26.6788 = 186.75 -> ratio 0.9338, outside 5%; 
    // a loader matched to 7 trucks is balanced.
    const r = analyzeHaulCycle({ ...base, availableTrucks: 7, loaderProductionPerHour: 186.7516 });
    expect(r.balance).toBe('balanced');
  });

  it('pays trucks for the whole operation, including queue time', () => {
    // 10,000 LCY / 200 LCY/hr = 50 operation hours x 8 trucks = 400 truck-hours
    // 400 x $95 = $38,000
    const r = analyzeHaulCycle(base);
    expect(r.totalTruckHours).toBe(400);
    expect(r.truckingCost).toBe(38000);
  });

  it('prices disposal per unit and folds it into the unit cost', () => {
    // disposal 10,000 x $8.50 = $85,000; ($38,000 + $85,000) / 10,000 = $12.30/LCY
    const r = analyzeHaulCycle({ ...base, disposalFeePerUnit: 8.5 });
    expect(r.disposalCost).toBe(85000);
    expect(r.costPerUnit).toBe(12.3);
  });

  it('honors an explicit load time over the derived one', () => {
    const r = analyzeHaulCycle({ ...base, loadMinutes: 6 });
    expect(r.loadMinutes).toBe(6);
    expect(r.cycleMinutes).toBe(33.2857);
  });

  it('flags a zero-distance haul as an on-site relocation', () => {
    const r = analyzeHaulCycle({ ...base, oneWayMiles: 0 });
    expect(r.warnings.some((w) => w.includes('on-site relocation'))).toBe(true);
  });

  it('rejects physically impossible inputs', () => {
    expect(() => analyzeHaulCycle({ ...base, truckCapacity: 0 })).toThrow(RangeError);
    expect(() => analyzeHaulCycle({ ...base, loadedSpeedMph: 0 })).toThrow(RangeError);
    expect(() => analyzeHaulCycle({ ...base, loaderProductionPerHour: 0 })).toThrow(RangeError);
    expect(() => analyzeHaulCycle({ ...base, availableTrucks: 0 })).toThrow(RangeError);
  });

  it('rejects a degenerate zero-length cycle', () => {
    expect(() =>
      analyzeHaulCycle({ ...base, loadMinutes: 0, oneWayMiles: 0, dumpMinutes: 0, delayMinutes: 0 }),
    ).toThrow(/cycle time resolved to zero/);
  });
});

describe('preliminary shortcut haul rate (RULE-004)', () => {
  it('is labeled preliminary and warns that a cycle analysis is required', () => {
    const r = preliminaryHaulCost(10000, 6.5, 'LCY');
    expect(r.truckingCost).toBe(65000);
    expect(r.isPreliminary).toBe(true);
    expect(r.warnings[0]).toContain('RULE-004 requires a cycle-based haul analysis');
  });
});

describe('cut/fill balance (Section 11)', () => {
  it('converts before comparing, and reports an export condition', () => {
    // cut 50,000 BCY - 5% unsuitable (2,500) = 47,500 BCY reusable
    // 47,500 x (1 - 0.10 shrink) = 42,750 CCY available vs 40,000 CCY needed
    // surplus 2,750 CCY -> 2,750 / 0.9 = 3,055.5556 BCY
    // plus 2,500 BCY unsuitable = 5,555.5556 BCY export
    // x 1.25 swell = 6,944.4445 LCY to truck
    const r = analyzeCutFill({
      cutBcy: 50000, fillCcy: 40000, unsuitablePercent: 0.05,
      swellPercent: 0.25, shrinkPercent: 0.1,
    });
    expect(r.unsuitableBcy).toBe(2500);
    expect(r.reusableCutBcy).toBe(47500);
    expect(r.reusableAsCompactedCcy).toBe(42750);
    expect(r.condition).toBe('export_required');
    expect(r.exportBcy).toBe(5555.5556);
    expect(r.exportLcy).toBe(6944.4445);
    expect(r.importCcy).toBe(0);
  });

  it('catches the site that looks balanced but is not', () => {
    // 40,000 BCY cut vs 40,000 CCY fill looks balanced to the eye, but at 10%
    // shrink the cut only makes 36,000 CCY — a 4,000 CCY import job.
    const r = analyzeCutFill({ cutBcy: 40000, fillCcy: 40000, swellPercent: 0.25, shrinkPercent: 0.1 });
    expect(r.condition).toBe('import_required');
    expect(r.importCcy).toBe(4000);
    expect(r.importBcy).toBe(4444.4444);   // 4,000 / 0.9
  });

  it('reports a genuinely balanced site within 2%', () => {
    // 44,444 BCY x 0.9 = 39,999.6 CCY against 40,000 required.
    const r = analyzeCutFill({ cutBcy: 44444, fillCcy: 40000, swellPercent: 0.25, shrinkPercent: 0.1 });
    expect(r.condition).toBe('balanced');
    expect(r.importCcy).toBe(0);
    expect(r.exportBcy).toBe(0);
  });

  it('exports unsuitable material even when the mass balance is neutral', () => {
    const r = analyzeCutFill({
      cutBcy: 46783, fillCcy: 40000, unsuitablePercent: 0.05, swellPercent: 0.25, shrinkPercent: 0.1,
    });
    expect(r.condition).toBe('balanced');
    // The unsuitable material still has to leave.
    expect(r.exportBcy).toBeGreaterThan(0);
    expect(r.warnings.some((w) => w.includes('unsuitable material must leave the site'))).toBe(true);
  });

  it('tracks topsoil separately from mass earthwork', () => {
    // Strip 5,000 BCY, replace 6,000 CCY -> 6,000/0.9 = 6,666.6667 BCY needed
    const r = analyzeCutFill({
      cutBcy: 40000, fillCcy: 36000, topsoilStripBcy: 5000, topsoilReplaceCcy: 6000,
      swellPercent: 0.25, shrinkPercent: 0.1,
    });
    expect(r.topsoilBalanceBcy).toBe(-1666.6667);
    expect(r.warnings.some((w) => w.includes('topsoil import is required'))).toBe(true);
  });

  it('warns that a zero shrink factor is not physical for common earth', () => {
    const r = analyzeCutFill({ cutBcy: 40000, fillCcy: 40000, swellPercent: 0.25, shrinkPercent: 0 });
    expect(r.warnings.some((w) => w.includes('not physical for common earth'))).toBe(true);
  });

  it('rejects invalid factors', () => {
    expect(() => analyzeCutFill({ cutBcy: 1, fillCcy: 1, swellPercent: 0.25, shrinkPercent: 1 })).toThrow(RangeError);
    expect(() => analyzeCutFill({ cutBcy: 1, fillCcy: 1, unsuitablePercent: 1.5, swellPercent: 0.25, shrinkPercent: 0.1 })).toThrow(RangeError);
  });
});
