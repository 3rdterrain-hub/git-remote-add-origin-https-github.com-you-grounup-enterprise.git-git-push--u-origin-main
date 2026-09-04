import { describe, expect, it } from 'vitest';
import {
  resolveScale, measure, pitchFactor, distance,
  type ScaleCalibration, type Point,
} from '../src/takeoff.js';

/**
 * On-screen takeoff.
 *
 * The arithmetic is easy and is not what these tests are mostly about. What
 * matters is that a measurement carries how much it deserves to be believed:
 * a drawing calibrated against a printed dimension and one scaled off the
 * title block produce the same number and are not the same claim, and the
 * difference is the commonest source of a quietly wrong bid — prints get
 * reduced when they are reissued, and the stated scale keeps saying what it
 * always said.
 *
 * So `resolveScale` resolves to `verified_scale` or `approximate_scale`, the
 * confidence engine already scores those differently, and the approval gate
 * already routes on the result. A measurement taken off an unverified scale
 * cannot quietly become a bid.
 */

/** 1" = 20', on a sheet rendered so that 100 points span 20 feet. */
const calibration = (over: Partial<ScaleCalibration> = {}): ScaleCalibration => ({
  from: { x: 0, y: 0 },
  to: { x: 100, y: 0 },
  knownDistance: 20,
  knownUnit: 'LF',
  basis: 'known_dimension',
  reference: "Dimension string 20'-0\" on C-301",
  ...over,
});

const scale = (over: Partial<ScaleCalibration> = {}) => resolveScale(calibration(over));

/** A 500 x 300 point rectangle: 100 ft x 60 ft at 0.2 ft per point. */
const rectangle: Point[] = [
  { x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 300 }, { x: 0, y: 300 },
];

describe('scale calibration', () => {
  it('converts sheet space to feet', () => {
    const s = scale();
    expect(s.unitsPerPoint).toBeCloseTo(0.2, 10);
    expect(s.unit).toBe('LF');
  });

  it('earns verified_scale only from a named known dimension', () => {
    expect(scale().measurementMethod).toBe('verified_scale');
  });

  it('will not call a calibration verified when it cannot say what it verified against', () => {
    /*
     * "I checked it" without saying against what is not a check. Recorded as
     * approximate, and the warning says why rather than silently downgrading.
     */
    const s = resolveScale({ ...calibration(), reference: undefined });
    expect(s.measurementMethod).toBe('approximate_scale');
    expect(s.warnings.join(' ')).toMatch(/does not say which one/);
  });

  it('treats the title block as approximate, and says why', () => {
    const s = scale({ basis: 'stated_scale', reference: undefined });
    expect(s.measurementMethod).toBe('approximate_scale');
    expect(s.warnings.join(' ')).toMatch(/Reissued and reduced prints/);
  });

  it('treats a graphic scale bar as approximate too', () => {
    /*
     * The one that looks like verification and is not: a scale bar is drawn on
     * the sheet and reduces with it, so it confirms the print is internally
     * consistent, never that it is at the scale it claims.
     */
    const s = scale({ basis: 'graphic_scale_bar' });
    expect(s.measurementMethod).toBe('approximate_scale');
  });

  it('warns when the calibration span is too short to trust', () => {
    // Two points of click slop over a 40-point span is 5% on every quantity
    // taken at that scale.
    const s = scale({ to: { x: 40, y: 0 }, knownDistance: 8 });
    expect(s.warnings.join(' ')).toMatch(/short calibration span/i);
  });

  it('refuses a calibration that spans nothing', () => {
    expect(() => scale({ to: { x: 0, y: 0 } })).toThrow(/same point/);
  });

  it('refuses to be calibrated against something that is not a length', () => {
    expect(() => scale({ knownUnit: 'SF' })).toThrow(/must be calibrated against a length/);
  });

  it('refuses a known distance of zero', () => {
    expect(() => scale({ knownDistance: 0 })).toThrow(/positive known distance/);
  });

  it('accepts a diagonal calibration', () => {
    // Nobody clicks a perfectly horizontal dimension string.
    const s = scale({ to: { x: 60, y: 80 }, knownDistance: 20 });
    expect(distance({ x: 0, y: 0 }, { x: 60, y: 80 })).toBe(100);
    expect(s.unitsPerPoint).toBeCloseTo(0.2, 10);
  });
});

describe('measuring a run', () => {
  it('measures a pipe run in linear feet', () => {
    const r = measure({
      kind: 'linear', unit: 'LF', scale: scale(),
      points: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 300 }],
    });
    // 500 points + 300 points at 0.2 ft each = 160 ft.
    expect(r.quantity).toBe(160);
    expect(r.measurementMethod).toBe('verified_scale');
  });

  it('closes a run when asked, and not otherwise', () => {
    const open = measure({
      kind: 'linear', unit: 'LF', scale: scale(), points: rectangle,
    });
    const closed = measure({
      kind: 'linear', unit: 'LF', scale: scale(), points: rectangle, closed: true,
    });
    // Perimeter of a 100 x 60 rectangle is 320 ft; the open path omits one side.
    expect(closed.quantity).toBe(320);
    expect(open.quantity).toBe(260);
  });

  it('turns a run with a width into an area — a path, a footing, a trench top', () => {
    const r = measure({
      kind: 'linear', unit: 'SY', scale: scale(),
      points: [{ x: 0, y: 0 }, { x: 500, y: 0 }],
      widthFeet: 12,
    });
    // 100 ft x 12 ft = 1,200 sq ft = 133.3333 sq yd.
    expect(r.quantity).toBeCloseTo(133.3333, 3);
  });

  it('turns a run with a width and a depth into a volume — a trench', () => {
    const r = measure({
      kind: 'linear', unit: 'CY', scale: scale(),
      points: [{ x: 0, y: 0 }, { x: 500, y: 0 }],
      widthFeet: 3, depthFeet: 6,
    });
    // 100 x 3 x 6 = 1,800 cu ft = 66.6667 CY.
    expect(r.quantity).toBeCloseTo(66.6667, 3);
  });

  it('refuses a run of one point', () => {
    expect(() => measure({
      kind: 'linear', unit: 'LF', scale: scale(), points: [{ x: 0, y: 0 }],
    })).toThrow(/at least 2 points/);
  });

  it('refuses to report a length in an area unit', () => {
    expect(() => measure({
      kind: 'linear', unit: 'SF', scale: scale(),
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    })).toThrow(/must be reported in a length/);
  });
});

describe('measuring an area', () => {
  it('measures a slab in square feet', () => {
    const r = measure({ kind: 'area', unit: 'SF', scale: scale(), points: rectangle });
    expect(r.quantity).toBe(6000);
    expect(r.planAreaFeet).toBe(6000);
  });

  it('reports the same area in square yards without a second calculation', () => {
    const r = measure({ kind: 'area', unit: 'SY', scale: scale(), points: rectangle });
    expect(r.quantity).toBeCloseTo(666.6667, 3);
  });

  it('does not care which way the outline was traced', () => {
    // Clockwise and counter-clockwise enclose the same area; a signed shoelace
    // would report one of them as negative.
    const forward = measure({ kind: 'area', unit: 'SF', scale: scale(), points: rectangle });
    const reversed = measure({
      kind: 'area', unit: 'SF', scale: scale(), points: [...rectangle].reverse(),
    });
    expect(reversed.quantity).toBe(forward.quantity);
  });

  it('subtracts openings', () => {
    const r = measure({
      kind: 'area', unit: 'SF', scale: scale(), points: rectangle,
      // A 100 x 100 point opening: 20 ft x 20 ft = 400 sq ft.
      deductions: [[{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 150, y: 150 }, { x: 50, y: 150 }]],
    });
    expect(r.quantity).toBe(5600);
    expect(r.deductedAreaFeet).toBe(400);
  });

  it('refuses deductions that swallow the shape', () => {
    // One of the two outlines is wrong, and a negative area is not the answer.
    expect(() => measure({
      kind: 'area', unit: 'SF', scale: scale(), points: rectangle,
      deductions: [rectangle],
    })).toThrow(/meet or exceed/);
  });

  it('corrects a roof for pitch, because a plan view shows the footprint', () => {
    /*
     * The measurement that separates a takeoff tool from a ruler. A 6:12 roof
     * is 11.8% more material than the shape drawn on the plan, and a roofer
     * bidding the footprint loses that difference on every job.
     */
    const r = measure({
      kind: 'area', unit: 'SF', scale: scale(), points: rectangle,
      pitch: { rise: 6, run: 12 },
    });
    expect(r.pitchFactor).toBeCloseTo(1.118034, 6);
    expect(r.quantity).toBeCloseTo(6708.204, 2);
    expect(r.derivation.join(' ')).toMatch(/not the sloped surface/);
  });

  it('warns about an outline that crosses itself', () => {
    // A bowtie encloses an area, and not the one it looks like.
    const bowtie: Point[] = [
      { x: 0, y: 0 }, { x: 500, y: 300 }, { x: 500, y: 0 }, { x: 0, y: 300 },
    ];
    const r = measure({ kind: 'area', unit: 'SF', scale: scale(), points: bowtie });
    expect(r.warnings.join(' ')).toMatch(/crosses itself/);
  });

  it('refuses an outline of two points', () => {
    expect(() => measure({
      kind: 'area', unit: 'SF', scale: scale(),
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    })).toThrow(/at least 3 points/);
  });
});

describe('measuring a volume', () => {
  it('measures a slab pour in cubic yards', () => {
    const r = measure({
      kind: 'volume', unit: 'CY', scale: scale(), points: rectangle,
      depthFeet: 0.5,
    });
    // 6,000 sq ft x 0.5 ft = 3,000 cu ft = 111.1111 CY.
    expect(r.quantity).toBeCloseTo(111.1111, 3);
  });

  it('refuses a volume with no depth rather than assuming one', () => {
    expect(() => measure({
      kind: 'volume', unit: 'CY', scale: scale(), points: rectangle,
    })).toThrow(/needs a depth/);
  });

  it('refuses a depth of zero', () => {
    expect(() => measure({
      kind: 'volume', unit: 'CY', scale: scale(), points: rectangle, depthFeet: 0,
    })).toThrow(/must be positive/);
  });
});

describe('counting', () => {
  it('counts markers', () => {
    const r = measure({
      kind: 'count', unit: 'EA', scale: scale(),
      points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }],
    });
    expect(r.quantity).toBe(3);
    expect(r.markerCount).toBe(3);
  });

  it('lets one marker stand for several — three fixtures on one symbol', () => {
    const r = measure({
      kind: 'count', unit: 'EA', scale: scale(),
      points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], countPer: 3,
    });
    expect(r.quantity).toBe(6);
  });

  it('is derived rather than scaled, because a count does not use the scale', () => {
    /*
     * Counting does not depend on the calibration being right, so it should not
     * inherit the calibration's uncertainty. Reporting a count as
     * `approximate_scale` would understate it.
     */
    const r = measure({
      kind: 'count', unit: 'EA', scale: scale({ basis: 'stated_scale', reference: undefined }),
      points: [{ x: 1, y: 1 }],
    });
    expect(r.measurementMethod).toBe('derived');
  });

  it('refuses to report a count in a length', () => {
    expect(() => measure({
      kind: 'count', unit: 'LF', scale: scale(), points: [{ x: 1, y: 1 }],
    })).toThrow(/must be reported in a count unit/);
  });
});

describe('repeats and provenance', () => {
  it('multiplies for identical repeats — the same detail on four elevations', () => {
    const r = measure({
      kind: 'area', unit: 'SF', scale: scale(), points: rectangle, multiplier: 4,
    });
    expect(r.quantity).toBe(24000);
  });

  it('refuses a multiplier of zero', () => {
    expect(() => measure({
      kind: 'area', unit: 'SF', scale: scale(), points: rectangle, multiplier: 0,
    })).toThrow(/must be positive/);
  });

  it('carries the scale derivation into every measurement taken at it', () => {
    // Section 23: a number a person cannot check is a number they have to trust.
    const r = measure({ kind: 'area', unit: 'SF', scale: scale(), points: rectangle });
    expect(r.derivation[0]).toMatch(/ft per unit/);
    expect(r.derivation.join(' ')).toMatch(/Dimension string/);
  });

  it('carries the scale warnings into every measurement taken at it', () => {
    /*
     * The warning belongs on the quantity, not only on the calibration. An
     * estimator reads the line, not the scale record.
     */
    const r = measure({
      kind: 'area', unit: 'SF', points: rectangle,
      scale: scale({ basis: 'stated_scale', reference: undefined }),
    });
    expect(r.warnings.join(' ')).toMatch(/Reissued and reduced prints/);
    expect(r.measurementMethod).toBe('approximate_scale');
  });
});

describe('pitch', () => {
  it('is 1 for a flat surface', () => {
    expect(pitchFactor(0, 12)).toBe(1);
  });

  it('matches the roofer’s rule of thumb', () => {
    expect(pitchFactor(4, 12)).toBeCloseTo(1.054093, 6);
    expect(pitchFactor(12, 12)).toBeCloseTo(1.414214, 6);
  });

  it('refuses a run of zero', () => {
    expect(() => pitchFactor(6, 0)).toThrow(/positive run/);
  });
});
