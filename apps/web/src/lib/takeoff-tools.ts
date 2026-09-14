/**
 * What survives a change of tool. ENGINE (of one small rule).
 *
 * Deducting an opening is two shapes and one measurement: the outline, and the
 * ring cut out of it. The screen has one set of traced points, so stepping into
 * the Deduct tool has to park the outline and stepping back has to bring it
 * back — and what was banked in between has to still be there.
 *
 * It did neither. Going in cleared `points`, so the outline you were cutting
 * out of was gone; coming back cleared `deductions`, so the openings were gone
 * too. Between them an opening could never reach `measure`, and the
 * "2 opening(s) will be subtracted" line under the button was never once true.
 *
 * Kept out of the component because it is a rule, not a rendering, and a rule
 * inside an event handler is a rule with no test.
 */
import type { Point } from '@grounup/engine';

export type ToolName =
  | 'none' | 'calibrate' | 'linear' | 'area' | 'volume' | 'count' | 'basin' | 'deduct';

/**
 * The kinds an opening can be cut out of.
 *
 * `measure` subtracts deductions from a net area, so they mean something on an
 * area and on the area under a volume, and nothing on a run or a count.
 */
export const TAKES_DEDUCTIONS: ToolName[] = ['area', 'volume'];

export interface TraceState {
  /** The points being traced right now. */
  points: readonly Point[];
  /** The shape openings are cut out of, parked while one is traced. */
  outline: readonly Point[];
  /** Openings banked so far. */
  deductions: readonly (readonly Point[])[];
}

/**
 * Where the three collections stand after switching from `from` to `to`.
 *
 * Three cases and no others: into deduct (park the outline, start a ring),
 * back to the shape it belongs to (restore the outline, keep the openings), or
 * away to a different measurement entirely (drop all of it, because an opening
 * traced for a slab means nothing on a pipe run).
 */
export function afterToolChange(
  from: ToolName, to: ToolName, state: TraceState,
): TraceState {
  if (to === 'deduct') {
    return {
      /* Fewer than three points is not a shape, so there is nothing to park. */
      outline: state.points.length >= 3 ? state.points : state.outline,
      points: [],
      deductions: state.deductions,
    };
  }
  if (from === 'deduct' && TAKES_DEDUCTIONS.includes(to)) {
    return { outline: state.outline, points: state.outline, deductions: state.deductions };
  }
  return { points: [], outline: [], deductions: [] };
}
