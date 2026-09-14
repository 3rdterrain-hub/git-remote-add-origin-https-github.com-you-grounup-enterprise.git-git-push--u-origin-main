/**
 * Deducting an opening, and getting back to the shape it came out of.
 *
 * The Deduct tool took a traced opening, said "1 opening(s) will be
 * subtracted", and subtracted nothing: stepping into it cleared the outline,
 * stepping back cleared the openings, and `measure` was called with neither.
 */
import { describe, expect, it } from 'vitest';
import { afterToolChange, type TraceState } from './takeoff-tools';

const SLAB = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 31 }, { x: 0, y: 31 }];
const OPENING = [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }];

const state = (over: Partial<TraceState> = {}): TraceState =>
  ({ points: [], outline: [], deductions: [], ...over });

describe('switching tools mid-measurement', () => {
  it('parks the outline on the way into deduct, and hands back an empty trace', () => {
    const after = afterToolChange('area', 'deduct', state({ points: SLAB }));
    expect(after.outline).toEqual(SLAB);
    expect(after.points).toEqual([]);
  });

  it('brings the outline back, with the openings still on it', () => {
    const after = afterToolChange('deduct', 'area',
      state({ outline: SLAB, points: OPENING, deductions: [OPENING] }));
    expect(after.points).toEqual(SLAB);
    expect(after.deductions).toEqual([OPENING]);
  });

  it('keeps banked openings while a second one is traced', () => {
    const after = afterToolChange('area', 'deduct',
      state({ points: SLAB, deductions: [OPENING] }));
    expect(after.deductions).toEqual([OPENING]);
  });

  it('does not park two points as an outline, because that is not a shape', () => {
    const after = afterToolChange('area', 'deduct',
      state({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], outline: SLAB }));
    expect(after.outline).toEqual(SLAB);
  });

  it('drops everything when the next tool is a different measurement', () => {
    // An opening traced for a slab means nothing on a pipe run.
    const after = afterToolChange('deduct', 'linear',
      state({ outline: SLAB, deductions: [OPENING] }));
    expect(after).toEqual({ points: [], outline: [], deductions: [] });
  });

  it('drops everything when leaving an area for a count', () => {
    const after = afterToolChange('area', 'count',
      state({ points: SLAB, deductions: [OPENING] }));
    expect(after).toEqual({ points: [], outline: [], deductions: [] });
  });

  it('subtracts from an area and from the area under a volume, and nothing else', () => {
    expect(afterToolChange('deduct', 'volume',
      state({ outline: SLAB, deductions: [OPENING] })).deductions).toEqual([OPENING]);
    expect(afterToolChange('deduct', 'basin',
      state({ outline: SLAB, deductions: [OPENING] })).deductions).toEqual([]);
  });
});
