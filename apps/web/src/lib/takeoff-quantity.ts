/**
 * What a saved measurement comes to. ENGINE (a reader of one).
 *
 * A shape kept on a sheet stores everything the answer is made of — the traced
 * points, the openings deducted, the pitch, the depth, the width, what each
 * marker counts for, how many times it repeats — and the calibration it was
 * traced against. It does **not** store the answer, because a stored quantity
 * is a number nobody can reproduce once the geometry is edited.
 *
 * So the answer is recomputed, through the same `measure` and `measureBasin`
 * the panel calls while the shape is being drawn. This is not a second
 * arithmetic path: it is the same call with the same inputs, which is the only
 * way the figure on the line and the figure beside it cannot drift.
 *
 * Until this existed, `TakenOff` applied `multiplier × countPer` — which is
 * `1` on any measurement that never went straight onto a line — so a traced
 * four thousand square foot pad landed on the estimate as one square foot.
 */
import {
  measure, measureBasin, resolveScale,
  type BasinResult, type ResolvedScale,
} from '@grounup/engine';
import type { CalibrationRow, MeasurementRow } from '@/lib/data/takeoff';

/**
 * A basin's quantity in the unit asked for.
 *
 * `measureBasin` reports the hole from every angle at once — the excavation,
 * the sloped faces, the top area, the storage — because they are different
 * questions about one shape. Which of them is *the* quantity is the unit's
 * answer, and it is given here rather than at each call site so the number
 * applied to a line and the number shown beside it come from one mapping.
 */
export function basinQuantity(b: BasinResult, unit: string): number {
  return unit === 'CY' ? b.excavationBankCubicYards
    : unit === 'SF' ? b.slopeFaceAreaSquareFeet
    : unit === 'SY' ? b.slopeFaceAreaSquareFeet / 9
    : unit === 'ACRE' ? b.topAreaSquareFeet / 43_560
    : unit === 'GAL' ? b.storageCubicFeet * 7.48052
    : b.excavationBankCubicYards;
}

/** A scale that measures nothing, for the one kind that needs none. */
const UNSCALED: ResolvedScale = {
  unitsPerPoint: 1, unit: 'LF', basis: 'stated_scale',
  measurementMethod: 'approximate_scale', derivation: 'not scaled', warnings: [],
};

export type Resolved =
  | { quantity: number; unit: string; measurementMethod: string }
  | { error: string };

/**
 * Work out what one kept measurement measured.
 *
 * A count needs no scale — markers are markers. Everything else does, and when
 * the calibration behind it cannot be found the caller is told so rather than
 * handed a number, because a length with no scale is a number of pixels.
 */
export function quantityOf(
  m: MeasurementRow, calibration: CalibrationRow | null,
): Resolved {
  let scale: ResolvedScale;
  if (m.kind === 'count') {
    scale = UNSCALED;
  } else if (!calibration) {
    return { error: 'The calibration this was traced against is gone, so it has no scale.' };
  } else {
    try {
      scale = resolveScale({
        from: calibration.from, to: calibration.to,
        knownDistance: calibration.knownDistanceFeet, knownUnit: 'LF',
        basis: calibration.basis,
        ...(calibration.reference ? { reference: calibration.reference } : {}),
      });
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'That calibration is not usable.' };
    }
  }

  try {
    if (m.kind === 'basin') {
      if (m.lifts.length === 0) {
        return { error: 'A basin with no lifts has no depth to excavate.' };
      }
      const b = measureBasin({
        points: m.geometry, scale,
        lifts: m.lifts.map((l) => ({
          depthFeet: l.depth_feet, sideSlopeRun: l.side_slope_run,
          ...(l.bench_width_feet ? { benchWidthFeet: l.bench_width_feet } : {}),
        })),
        ...(m.freeboardFeet == null ? {} : { freeboardFeet: m.freeboardFeet }),
        multiplier: m.multiplier,
      });
      return {
        quantity: basinQuantity(b, m.unit),
        unit: m.unit,
        measurementMethod: scale.measurementMethod,
      };
    }

    const r = measure({
      kind: m.kind,
      points: m.geometry,
      unit: m.unit as Parameters<typeof measure>[0]['unit'],
      scale,
      closed: m.isClosed,
      ...(m.deductions.length ? { deductions: m.deductions } : {}),
      ...(m.widthFeet == null ? {} : { widthFeet: m.widthFeet }),
      ...(m.depthFeet == null ? {} : { depthFeet: m.depthFeet }),
      ...(m.pitchRise == null ? {} : { pitch: { rise: m.pitchRise, run: m.pitchRun ?? 12 } }),
      countPer: m.countPer,
      multiplier: m.multiplier,
    });
    return { quantity: r.quantity, unit: r.unit, measurementMethod: r.measurementMethod };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'That shape cannot be measured.' };
  }
}
