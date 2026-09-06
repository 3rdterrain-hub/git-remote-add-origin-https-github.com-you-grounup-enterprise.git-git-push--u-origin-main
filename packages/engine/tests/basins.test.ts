/**
 * Ponds, basins, and the difference a side slope makes.
 *
 * Every expectation below is computed independently — by closed form for the
 * shapes that have one, and against a published stage-storage method for the
 * one that does not. A test that asserts whatever the code returned would pass
 * forever and prove nothing.
 */
import { describe, expect, it } from 'vitest';
import { measureBasin, resolveScale, type Point } from '../src/index.js';

/** One drawing unit is one foot, so the geometry below reads in feet. */
const SCALE = resolveScale({
  basis: 'known_dimension',
  from: { x: 0, y: 0 },
  to: { x: 1, y: 0 },
  knownDistance: 1,
  knownUnit: 'LF',
  reference: 'One drawing unit is one foot',
});

const rect = (w: number, h: number): Point[] =>
  [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

describe('measuring a basin', () => {
  it('offsets a rectangle inward exactly, corners included', () => {
    /*
     * 200 x 100 at the top, 8 ft deep, 3:1. The floor is inset 24 ft all round,
     * so it is 152 x 52 = 7,904 sf. A straight-line offset with no corner term
     * would say 20,000 − 600(24) = 5,600 sf, short by the four corner squares
     * (4 x 24² = 2,304). That difference is the whole reason the corner term is
     * there.
     */
    const r = measureBasin({
      points: rect(200, 100), scale: SCALE,
      lifts: [{ depthFeet: 8, sideSlopeRun: 3 }],
    });
    expect(r.topAreaSquareFeet).toBeCloseTo(20_000, 6);
    expect(r.bottomAreaSquareFeet).toBeCloseTo(152 * 52, 6);
  });

  it('computes the volume of a rectangular frustum exactly', () => {
    /*
     * The prismoidal formula is exact for this solid. Checked against the
     * closed form for a rectangular frustum with equal side slopes:
     *
     *   V = h·[ W·L − (W+L)·s·h + (4/3)·s²·h² ]
     *
     * with W=200, L=100, s=3, h=8:
     *   200·100 = 20,000
     *   (300)(3)(8) = 7,200
     *   (4/3)(9)(64) = 768
     *   V = 8 · (20,000 − 7,200 + 768) = 8 · 13,568 = 108,544 cf
     *     = 4,020.15 cy
     */
    const r = measureBasin({
      points: rect(200, 100), scale: SCALE,
      lifts: [{ depthFeet: 8, sideSlopeRun: 3 }],
    });
    expect(r.excavationCubicFeet).toBeCloseTo(108_544, 4);
    expect(r.excavationBankCubicYards).toBeCloseTo(108_544 / 27, 2);
  });

  it('is the number a vertical-walled takeoff gets badly wrong', () => {
    // Plan area times depth would say 160,000 cf. The truth is 108,544.
    const r = measureBasin({
      points: rect(200, 100), scale: SCALE,
      lifts: [{ depthFeet: 8, sideSlopeRun: 3 }],
    });
    const naive = 20_000 * 8;
    expect(naive / r.excavationCubicFeet).toBeCloseTo(1.474, 3);
    expect(r.derivation.join(' ')).toMatch(/47\.4% high, because the sides slope/);
  });

  it('agrees with area times depth when the walls are vertical', () => {
    // A shaft has no slope, so the two methods must not disagree at all.
    const r = measureBasin({
      points: rect(50, 40), scale: SCALE,
      lifts: [{ depthFeet: 10, sideSlopeRun: 0 }],
    });
    expect(r.excavationCubicFeet).toBeCloseTo(50 * 40 * 10, 6);
    expect(r.bottomAreaSquareFeet).toBeCloseTo(2_000, 6);
    expect(r.slopeFaceAreaSquareFeet).toBeCloseTo(180 * 10, 6);
  });

  it('reports the sloped face, which is nobody else\'s number', () => {
    /*
     * What gets lined, rip-rapped or seeded. Mean perimeter times slope length:
     * top perimeter 600, bottom perimeter 600 − 2(4)(24) = 408, mean 504;
     * slope length 8·sqrt(10) = 25.298. 504 x 25.298 = 12,750.2 sf.
     *
     * The plan area of the same slope band is 20,000 − 7,904 = 12,096 sf, so
     * treating it as a plan area would under-buy the liner by five percent.
     */
    const r = measureBasin({
      points: rect(200, 100), scale: SCALE,
      lifts: [{ depthFeet: 8, sideSlopeRun: 3 }],
    });
    expect(r.slopeFaceAreaSquareFeet).toBeCloseTo(504 * 8 * Math.sqrt(10), 1);
    expect(r.slopeFaceAreaSquareFeet).toBeGreaterThan(20_000 - 7_904);
  });

  it('cuts a bench between two slopes', () => {
    /*
     * 4:1 for the top 4 ft, a 6 ft safety bench, then 3:1 for 4 ft more.
     * Offsets: 16 ft, then 6 ft of bench, then 12 ft — 34 ft in total. On a
     * 300 x 200 top the floor is 232 x 132.
     */
    const r = measureBasin({
      points: rect(300, 200), scale: SCALE,
      lifts: [
        { depthFeet: 4, sideSlopeRun: 4, benchWidthFeet: 6, label: 'Upper' },
        { depthFeet: 4, sideSlopeRun: 3, label: 'Lower' },
      ],
    });
    expect(r.totalDepthFeet).toBe(8);
    expect(r.bottomAreaSquareFeet).toBeCloseTo(232 * 132, 6);
    // The bench is the plan area between the ring at 16 ft in and at 22 ft in.
    const at = (d: number) => (300 - 2 * d) * (200 - 2 * d);
    expect(r.benchAreaSquareFeet).toBeCloseTo(at(16) - at(22), 6);
    expect(r.derivation.join(' ')).toMatch(/Upper: 4 ft at 4:1/);
    expect(r.derivation.join(' ')).toMatch(/Lower: 4 ft at 3:1/);
  });

  it('builds a stage-storage table a civil drawing can be checked against', () => {
    const r = measureBasin({
      points: rect(200, 100), scale: SCALE,
      lifts: [{ depthFeet: 8, sideSlopeRun: 3 }],
    });
    expect(r.stageStorage).toHaveLength(9);           // floor plus eight feet
    expect(r.stageStorage[0]!.depthFeet).toBe(0);
    expect(r.stageStorage[0]!.cumulativeCubicFeet).toBe(0);
    expect(r.stageStorage[0]!.surfaceAreaSquareFeet).toBeCloseTo(152 * 52, 4);

    // At four feet above the floor the water surface is inset 12 ft from the
    // top: 176 x 76 = 13,376 sf.
    const four = r.stageStorage.find((s) => s.depthFeet === 4)!;
    expect(four.surfaceAreaSquareFeet).toBeCloseTo(176 * 76, 4);

    // And the top rung is the whole basin.
    const top = r.stageStorage[r.stageStorage.length - 1]!;
    expect(top.depthFeet).toBe(8);
    expect(top.cumulativeCubicFeet).toBeCloseTo(r.excavationCubicFeet, 2);
    expect(top.cumulativeAcreFeet).toBeCloseTo(108_544 / 43_560, 4);
  });

  it('holds less than it is dug, by exactly the freeboard', () => {
    /*
     * Two feet of freeboard leaves six feet of water. The frustum from the
     * floor up six feet, by the same closed form on the floor rectangle
     * 152 x 52 with s=3, h=6:
     *   152·52 = 7,904; (204)(3)(6) = 3,672; (4/3)(9)(36) = 432
     *   V = 6 · (7,904 + 3,672 + 432) = 6 · 12,008 = 72,048 cf
     */
    const r = measureBasin({
      points: rect(200, 100), scale: SCALE,
      lifts: [{ depthFeet: 8, sideSlopeRun: 3 }],
      freeboardFeet: 2,
    });
    expect(r.storageCubicFeet).toBeCloseTo(72_048, 0);
    expect(r.storageAcreFeet).toBeCloseTo(72_048 / 43_560, 3);
    // And it is less than the hole, which is the point of freeboard.
    expect(r.storageCubicFeet).toBeLessThan(r.excavationCubicFeet);
  });

  it('handles a basin traced as something other than a rectangle', () => {
    /*
     * A regular hexagon 100 ft across the flats. Area = 2·sqrt(3)·a² where a is
     * the circumradius; perimeter 6a. Offsetting inward by d on a regular
     * n-gon reduces the apothem by d, and area scales as the apothem squared —
     * so the result is checkable without trusting the implementation.
     */
    const a = 100;
    const hex: Point[] = Array.from({ length: 6 }, (_, i) => ({
      x: a * Math.cos((Math.PI / 3) * i),
      y: a * Math.sin((Math.PI / 3) * i),
    }));
    const apothem = a * Math.cos(Math.PI / 6);
    const area = (ap: number) => 6 * ap * ap * Math.tan(Math.PI / 6);

    const r = measureBasin({
      points: hex, scale: SCALE, lifts: [{ depthFeet: 6, sideSlopeRun: 3 }],
    });
    expect(r.topAreaSquareFeet).toBeCloseTo(area(apothem), 3);
    expect(r.bottomAreaSquareFeet).toBeCloseTo(area(apothem - 18), 3);
  });

  it('counts identical basins without re-tracing them', () => {
    const one = measureBasin({
      points: rect(80, 60), scale: SCALE, lifts: [{ depthFeet: 5, sideSlopeRun: 2 }],
    });
    const four = measureBasin({
      points: rect(80, 60), scale: SCALE, lifts: [{ depthFeet: 5, sideSlopeRun: 2 }],
      multiplier: 4,
    });
    // Both sides are already rounded to the quantity scale, so four times a
    // rounded figure and a rounded four-times figure can differ in the last
    // place. Compared at the precision a quantity is actually carried to.
    expect(four.excavationCubicFeet).toBeCloseTo(one.excavationCubicFeet * 4, 3);
    expect(four.slopeFaceAreaSquareFeet).toBeCloseTo(one.slopeFaceAreaSquareFeet * 4, 3);
    expect(four.derivation.join(' ')).toMatch(/x 4 identical basins/);
  });

  it('refuses a cut that closes the basin up rather than returning a negative floor', () => {
    // 60 x 40 at 3:1 pinches at 20 ft of inset — under 7 ft of depth. Asking
    // for 12 is asking for a bottom that does not exist.
    expect(() => measureBasin({
      points: rect(60, 40), scale: SCALE, lifts: [{ depthFeet: 12, sideSlopeRun: 3 }],
    })).toThrow(/closes up/);
  });

  it('refuses a bench wider than the basin has left', () => {
    expect(() => measureBasin({
      points: rect(60, 40), scale: SCALE,
      lifts: [{ depthFeet: 4, sideSlopeRun: 2, benchWidthFeet: 40 }],
    })).toThrow(/wider than the basin has left/);
  });

  it('refuses a ring that is not one', () => {
    expect(() => measureBasin({
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], scale: SCALE,
      lifts: [{ depthFeet: 4, sideSlopeRun: 3 }],
    })).toThrow(/at least three points/);
  });

  it('refuses a basin with no lift, rather than assuming a depth', () => {
    expect(() => measureBasin({ points: rect(50, 50), scale: SCALE, lifts: [] }))
      .toThrow(/at least one lift/);
  });

  it('says so when the freeboard swallows the whole basin', () => {
    const r = measureBasin({
      points: rect(200, 100), scale: SCALE,
      lifts: [{ depthFeet: 4, sideSlopeRun: 3 }],
      freeboardFeet: 4,
    });
    expect(r.storageCubicFeet).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/it holds nothing/);
  });

  it('warns when the shape is nearly a cone', () => {
    const r = measureBasin({
      points: rect(100, 100), scale: SCALE, lifts: [{ depthFeet: 8, sideSlopeRun: 3 }],
    });
    // 100 − 48 = 52 a side: 2,704 sf against 10,000, just over a quarter — fine.
    expect(r.warnings.join(' ')).not.toMatch(/close to a cone/);

    const tight = measureBasin({
      points: rect(100, 100), scale: SCALE, lifts: [{ depthFeet: 15, sideSlopeRun: 3 }],
    });
    expect(tight.warnings.join(' ')).toMatch(/close to a cone/);
  });
});
