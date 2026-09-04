import { describe, expect, it } from 'vitest';
import {
  averageEndArea, compareSurfaces, gridFrom, progressAgainstDesign, stockpileVolume,
  type CrossSection, type Grid,
} from '../src/surfaces.js';

/** 10 × 10 grid of 25 ft cells = 62,500 SF, at a constant elevation. */
const flat = (elevation: number | null, rows = 10, cols = 10, cellSize = 25): Grid =>
  gridFrom(Array<number | null>(rows * cols).fill(elevation), rows, cols, cellSize);

/** First `n` cells at `a`, the rest at `b`. */
const split = (n: number, a: number, b: number, rows = 10, cols = 10): Grid =>
  gridFrom(Array.from({ length: rows * cols }, (_, i) => (i < n ? a : b)), rows, cols, 25);

describe('surface comparison', () => {
  it('computes a uniform cut', () => {
    // 100 cells × 625 SF × 2 ft = 125,000 CF ÷ 27 = 4,629.6296 BCY
    const r = compareSurfaces(flat(100), flat(98));
    expect(r.cutBcy).toBe(4629.6296);
    expect(r.fillCcy).toBe(0);
    expect(r.cutAreaSf).toBe(62_500);
    expect(r.averageCutDepth).toBe(2);
    expect(r.maxCutDepth).toBe(2);
  });

  it('computes a uniform fill', () => {
    const r = compareSurfaces(flat(96), flat(98));
    expect(r.fillCcy).toBe(4629.6296);
    expect(r.cutBcy).toBe(0);
    expect(r.netBcy).toBe(-4629.6296);
  });

  it('separates cut from fill across one surface', () => {
    // 50 cells 2 ft above design, 50 cells 3 ft below.
    const existing = split(50, 100, 95);
    const r = compareSurfaces(existing, flat(98));
    expect(r.cutBcy).toBe(2314.8148);   // 50 × 625 × 2 ÷ 27
    expect(r.fillCcy).toBe(3472.2222);  // 50 × 625 × 3 ÷ 27
    expect(r.netBcy).toBe(-1157.4074);
    expect(r.cutAreaSf).toBe(31_250);
    expect(r.fillAreaSf).toBe(31_250);
  });

  it('reports zero volume where the surfaces already match', () => {
    const r = compareSurfaces(flat(98), flat(98));
    expect(r.cutBcy).toBe(0);
    expect(r.fillCcy).toBe(0);
    expect(r.cellsCompared).toBe(100);
    expect(r.coverage).toBe(1);
  });

  it('excludes a cell rather than treating missing data as zero', () => {
    // A null elevation against a design at 98 would otherwise invent 98 ft of fill.
    const existing = gridFrom(
      Array.from({ length: 100 }, (_, i) => (i < 10 ? null : 100)), 10, 10, 25,
    );
    const r = compareSurfaces(existing, flat(98));
    expect(r.cellsSkipped).toBe(10);
    expect(r.cellsCompared).toBe(90);
    expect(r.cutBcy).toBe(4166.6667);   // 90 × 625 × 2 ÷ 27
    expect(r.coverage).toBe(0.9);
  });

  it('warns when coverage is too low to price from', () => {
    const existing = gridFrom(
      Array.from({ length: 100 }, (_, i) => (i < 30 ? 100 : null)), 10, 10, 25,
    );
    const r = compareSurfaces(existing, flat(98));
    expect(r.coverage).toBe(0.3);
    expect(r.warnings.some((w) => w.includes('not a reliable basis for pricing'))).toBe(true);
  });

  it('warns on a depth that is almost certainly a datum mismatch', () => {
    const existing = gridFrom([...Array(99).fill(100), 900], 10, 10, 25);
    const r = compareSurfaces(existing, flat(98));
    expect(r.warnings.some((w) => w.includes('survey artefact or a datum mismatch'))).toBe(true);
  });

  it('reports no overlap rather than a silent zero', () => {
    const r = compareSurfaces(flat(null), flat(98));
    expect(r.cellsCompared).toBe(0);
    expect(r.warnings.some((w) => w.includes('do not overlap anywhere'))).toBe(true);
  });

  it('refuses to compare surfaces on different grids', () => {
    expect(() => compareSurfaces(flat(100, 10, 10, 25), flat(98, 10, 10, 10)))
      .toThrow(/must share a grid/);
    expect(() => compareSurfaces(flat(100, 10, 10), flat(98, 8, 10)))
      .toThrow(/must share a grid/);
  });

  it('rejects a grid whose cell count does not match its dimensions', () => {
    expect(() => compareSurfaces(gridFrom([1, 2, 3], 10, 10, 25), flat(98)))
      .toThrow(/has 3 elevations but 10 × 10 = 100 cells/);
  });

  it('scales with cell size', () => {
    // The same 2 ft depth over 5 ft cells covers 1/25 the area of 25 ft cells.
    const fine = compareSurfaces(flat(100, 10, 10, 5), flat(98, 10, 10, 5));
    expect(fine.cutAreaSf).toBe(2500);
    expect(fine.cutBcy).toBe(185.1852);
  });
});

describe('cross-section volumes', () => {
  const sections: CrossSection[] = [
    { station: 0, cutAreaSf: 40, fillAreaSf: 0 },
    { station: 100, cutAreaSf: 60, fillAreaSf: 0 },
    { station: 200, cutAreaSf: 50, fillAreaSf: 0 },
  ];

  it('computes average end area the way a DOT summary does', () => {
    // (40+60)/2 × 100 = 5,000 CF; (60+50)/2 × 100 = 5,500 CF; ÷ 27 = 388.8889 CY
    const r = averageEndArea(sections);
    expect(r.cutBcy).toBe(388.8889);
    expect(r.lengthFt).toBe(200);
    expect(r.stations).toBe(3);
    expect(r.method).toBe('average_end_area');
  });

  it('reports each segment separately', () => {
    const r = averageEndArea(sections);
    expect(r.segments).toHaveLength(2);
    expect(r.segments[0]!.cutBcy).toBe(185.1852);  // 5,000 ÷ 27
    expect(r.segments[1]!.cutBcy).toBe(203.7037);  // 5,500 ÷ 27
  });

  it('sorts sections by station rather than trusting input order', () => {
    const shuffled = [sections[2]!, sections[0]!, sections[1]!];
    expect(averageEndArea(shuffled).cutBcy).toBe(averageEndArea(sections).cutBcy);
  });

  it('falls back to average end area when no mid-section was surveyed', () => {
    // Substituting the mean of the ends into the prismoidal formula reduces it
    // exactly to average end area, so asking for prismoidal without real data
    // must not pretend to be more precise.
    const r = averageEndArea(sections, true);
    expect(r.cutBcy).toBe(388.8889);
    expect(r.segmentsWithoutMidSection).toBe(2);
    expect(r.method).toBe('average_end_area');
    expect(r.warnings.some((w) => w.includes('only differs where a real mid area is supplied'))).toBe(true);
  });

  it('corrects the volume where a mid-section really was surveyed', () => {
    // A pinch at the midpoint: 40 → 30 → 60 over 100 ft.
    // (40 + 4×30 + 60) × 100 ÷ 6 = 3,666.6667 CF = 135.8025 CY,
    // against 5,000 CF = 185.1852 CY by average end area — a 27% overstatement.
    const withMid: CrossSection[] = [
      { station: 0, cutAreaSf: 40, fillAreaSf: 0, midCutAreaSf: 30, midFillAreaSf: 0 },
      { station: 100, cutAreaSf: 60, fillAreaSf: 0 },
    ];
    const prismoidal = averageEndArea(withMid, true);
    const aea = averageEndArea(withMid, false);
    expect(prismoidal.cutBcy).toBe(135.8025);
    expect(aea.cutBcy).toBe(185.1852);
    expect(prismoidal.method).toBe('prismoidal');
    expect(prismoidal.segments[0]!.method).toBe('prismoidal');
    expect(prismoidal.segmentsWithoutMidSection).toBe(0);
  });

  it('handles cut and fill in the same run', () => {
    const mixed: CrossSection[] = [
      { station: 0, cutAreaSf: 40, fillAreaSf: 0 },
      { station: 100, cutAreaSf: 0, fillAreaSf: 30 },
    ];
    const r = averageEndArea(mixed);
    expect(r.cutBcy).toBe(74.0741);   // (40+0)/2 × 100 ÷ 27
    expect(r.fillCcy).toBe(55.5556);  // (0+30)/2 × 100 ÷ 27
  });

  it('warns when sections are too far apart to be accurate', () => {
    const sparse: CrossSection[] = [
      { station: 0, cutAreaSf: 40, fillAreaSf: 0 },
      { station: 500, cutAreaSf: 60, fillAreaSf: 0 },
    ];
    expect(averageEndArea(sparse).warnings.some((w) => w.includes('loses accuracy'))).toBe(true);
  });

  it('flags duplicate stations instead of producing a zero-length segment', () => {
    const dup: CrossSection[] = [
      { station: 100, cutAreaSf: 40, fillAreaSf: 0 },
      { station: 100, cutAreaSf: 60, fillAreaSf: 0 },
    ];
    expect(averageEndArea(dup).warnings.some((w) => w.includes('share station 100'))).toBe(true);
  });

  it('requires at least two sections', () => {
    expect(() => averageEndArea([{ station: 0, cutAreaSf: 40, fillAreaSf: 0 }]))
      .toThrow(/At least two cross sections/);
  });
});

describe('stockpile volume', () => {
  it('reports a pile in loose measure, not bank', () => {
    // A stockpile is material already excavated; quoting it as BCY would
    // overstate what putting it back would fill.
    const r = stockpileVolume(flat(112), flat(100));
    expect(r.volumeLcy).toBe(27_777.7778);   // 100 × 625 × 12 ÷ 27
    expect(r.averageHeightFt).toBe(12);
    expect(r.baseAreaSf).toBe(62_500);
    expect(r.derivation).toContain('reported as LCY because stockpiled material is loose');
  });

  it('flags a base surface taken after the material was placed', () => {
    // Part of the "pile" sitting below its base means the base is wrong.
    const surface = split(50, 112, 95);
    const r = stockpileVolume(surface, flat(100));
    expect(r.warnings.some((w) => w.includes('should sit entirely above its base'))).toBe(true);
  });
});

describe('progress against design', () => {
  const original = flat(100);
  const design = flat(96);   // 4 ft of cut across the site

  it('reports nothing complete before any work', () => {
    const r = progressAgainstDesign(original, flat(100), design);
    expect(r.percentComplete).toBe(0);
    expect(r.remainingCutBcy).toBe(9259.2593);   // 100 × 625 × 4 ÷ 27
  });

  it('reports half complete at half the depth', () => {
    const r = progressAgainstDesign(original, flat(98), design);
    expect(r.percentComplete).toBe(0.5);
    expect(r.completedCutBcy).toBe(4629.6296);
    expect(r.remainingCutBcy).toBe(4629.6296);
  });

  it('reports complete when the as-built reaches design', () => {
    const r = progressAgainstDesign(original, flat(96), design);
    expect(r.percentComplete).toBe(1);
    expect(r.cellsAtGrade).toBe(100);
    expect(r.remainingCutBcy).toBe(0);
  });

  it('counts over-excavation as rework, not as progress past 100%', () => {
    // Cutting a foot below design is fill to bring back, not 125% finished.
    const r = progressAgainstDesign(original, flat(95), design);
    expect(r.percentComplete).toBeLessThanOrEqual(1);
    expect(r.cellsOverExcavated).toBe(100);
    expect(r.overExcavationBcy).toBe(2314.8148);   // 100 × 625 × 1 ÷ 27
    expect(r.warnings.some((w) => w.includes('That is rework'))).toBe(true);
  });

  it('treats a cell inside tolerance as at grade', () => {
    const r = progressAgainstDesign(original, flat(96.05), design, 0.1);
    expect(r.cellsAtGrade).toBe(100);
    expect(r.cellsOverExcavated).toBe(0);
  });

  it('treats a cell outside tolerance as not at grade', () => {
    const r = progressAgainstDesign(original, flat(96.4), design, 0.1);
    expect(r.cellsAtGrade).toBe(0);
  });

  it('rejects a non-positive tolerance', () => {
    expect(() => progressAgainstDesign(original, flat(98), design, 0)).toThrow(RangeError);
  });
});
