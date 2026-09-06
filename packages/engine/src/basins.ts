/**
 * Ponds, basins and anything else with a sloped side.
 *
 * `measure` handles a volume as plan area times depth, which is right for a
 * slab, a base course or a trench of constant section and wrong for every hole
 * dug in the ground. A detention pond does not have vertical walls: it is cut
 * at 3:1 or 4:1, so the bottom is very much smaller than the top, and taking it
 * off as area times depth overstates the excavation — badly. A one-acre pond
 * eight feet deep on 3:1 slopes is about 9,400 cubic yards; area times depth
 * says 12,900. Thirty-seven percent high, on the largest single line in the
 * bid.
 *
 * So this computes what an engineer computes:
 *
 *   * the bottom footprint, by offsetting the traced top-of-bank ring inward
 *     by the slope run times the depth;
 *   * the volume by the **prismoidal formula**, V = (h/6)(A_top + 4·A_mid +
 *     A_bot), which is exact for a solid whose area varies quadratically with
 *     depth — which a constant side slope does;
 *   * the **sloped face area**, because somebody has to line it, rip-rap it or
 *     seed it, and that quantity is not the plan area of anything;
 *   * a **stage-storage table**, because a detention pond is designed by how
 *     much water it holds at each depth, and that is the number the civil
 *     drawing states and the estimator has to be able to check.
 *
 * Benches are lifts. A pond cut 4:1 to a six-foot safety bench and 3:1 below it
 * is two lifts, and the arithmetic is the same one twice.
 */
import type { Point, ResolvedScale } from './takeoff.js';
import { distance } from './takeoff.js';
import { qty, roundTo, assertPositive, assertNonNegative } from './numeric.js';

/** One cut, from the ring above it down to the ring below. */
export interface BasinLift {
  /** Vertical cut of this lift, in feet. */
  depthFeet: number;
  /**
   * Horizontal run per one foot of fall. A 3:1 slope is `3`. Zero is a
   * vertical face — a wall, a shaft — and is allowed because some basins have
   * them.
   */
  sideSlopeRun: number;
  /**
   * A level shelf at the bottom of this lift, before the next one starts.
   * A safety bench on a stormwater pond is the usual reason.
   */
  benchWidthFeet?: number;
  /** What this lift is, for the derivation. */
  label?: string;
}

export interface BasinInput {
  /** The top-of-bank ring, traced in plan, in the space the scale calibrated. */
  points: readonly Point[];
  scale: ResolvedScale;
  /** Top down. At least one. */
  lifts: readonly BasinLift[];
  /**
   * Depth from the top of bank down to the design water surface. Storage is
   * reported below that line; excavation is the whole hole.
   */
  freeboardFeet?: number;
  /** Identical basins. Four infiltration cells to one detail. */
  multiplier?: number;
}

/** One rung of the stage-storage table, measured up from the basin floor. */
export interface BasinStage {
  /** Depth of water above the floor, in feet. */
  depthFeet: number;
  /** Water surface area at that depth, in square feet. */
  surfaceAreaSquareFeet: number;
  /** Everything held at or below that depth, in cubic feet. */
  cumulativeCubicFeet: number;
  /** The same, in the unit a pond is discussed in. */
  cumulativeAcreFeet: number;
}

export interface BasinResult {
  /** The whole hole, in bank cubic yards. */
  excavationBankCubicYards: number;
  excavationCubicFeet: number;
  topAreaSquareFeet: number;
  bottomAreaSquareFeet: number;
  topPerimeterFeet: number;
  /** Total depth of all lifts, in feet. */
  totalDepthFeet: number;
  /**
   * The sloped faces, in square feet. What gets lined, rip-rapped or seeded —
   * and not the plan area of anything, which is why it is reported separately.
   */
  slopeFaceAreaSquareFeet: number;
  /** Level shelves, in square feet. */
  benchAreaSquareFeet: number;
  /** Storage below the design water surface, when a freeboard was given. */
  storageCubicFeet: number;
  storageAcreFeet: number;
  /** One rung per foot of depth, floor upward. */
  stageStorage: readonly BasinStage[];
  derivation: readonly string[];
  warnings: readonly string[];
}

const CUBIC_FEET_PER_YARD = 27;
const SQUARE_FEET_PER_ACRE = 43_560;

/** Shoelace. Absolute, so winding direction does not decide the sign. */
function ringArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function ringPerimeter(points: readonly Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    total += distance(points[i]!, points[(i + 1) % points.length]!);
  }
  return total;
}

/**
 * The sum of cot(θ/2) over a polygon's interior angles.
 *
 * This is the correction term that makes an inward offset exact rather than
 * approximate. Offsetting a convex polygon inward by `d` with mitered corners
 * gives area A − P·d + d²·Σcot(θ/2); on a square that is s² − 4sd + 4d², which
 * is (s − 2d)² — the right answer, not one close to it. Straight-line offsets
 * with no corner term would be short by exactly the corner squares.
 */
function cornerTerm(points: readonly Point[]): number {
  const n = points.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]!;
    const here = points[i]!;
    const next = points[(i + 1) % n]!;
    const ax = prev.x - here.x, ay = prev.y - here.y;
    const bx = next.x - here.x, by = next.y - here.y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la === 0 || lb === 0) continue;
    const cos = Math.min(1, Math.max(-1, (ax * bx + ay * by) / (la * lb)));
    const theta = Math.acos(cos);
    // A straight run contributes nothing; a corner contributes cot(half angle).
    const half = theta / 2;
    if (half <= 1e-9 || Math.abs(Math.PI / 2 - half) < 1e-12) continue;
    sum += Math.cos(half) / Math.sin(half);
  }
  return sum;
}

/**
 * The geometry of one closed ring, in feet, and how it shrinks when offset in.
 *
 * Held as three numbers so an offset at any depth is arithmetic rather than a
 * re-trace: area(d) = A − P·d + C·d².
 */
interface Ring {
  area: number;
  perimeter: number;
  corner: number;
}

function offsetArea(ring: Ring, d: number): number {
  if (d <= 0) return ring.area;
  return ring.area - ring.perimeter * d + ring.corner * d * d;
}

function offsetPerimeter(ring: Ring, d: number): number {
  // The perimeter of a mitered inward offset falls at the same rate the area's
  // first derivative implies: dP/dd = −2·C.
  return Math.max(ring.perimeter - 2 * ring.corner * d, 0);
}

/**
 * The inward offset at which the ring closes up entirely.
 *
 * Past this the basin is a wedge or a point — the bottom has pinched out — and
 * the caller is told rather than handed a negative area.
 */
function pinchDepth(ring: Ring): number {
  const { area: A, perimeter: P, corner: C } = ring;
  if (C <= 1e-9) return P > 0 ? A / P : Infinity;
  const disc = P * P - 4 * C * A;
  if (disc < 0) return Infinity;
  return (P - Math.sqrt(disc)) / (2 * C);
}

/**
 * Take off a basin.
 *
 * Refuses rather than guesses, in the same places `measure` does: a ring that
 * is not a ring, a lift with no depth, a slope that runs backward.
 */
export function measureBasin(input: BasinInput): BasinResult {
  const { points, scale, lifts, freeboardFeet, multiplier = 1 } = input;
  const warnings: string[] = [...scale.warnings];
  const derivation: string[] = [scale.derivation];

  if (points.length < 3) {
    throw new RangeError('A basin needs at least three points around its top of bank');
  }
  if (lifts.length === 0) throw new RangeError('A basin needs at least one lift');
  assertPositive(multiplier, 'multiplier');

  const f = scale.unitsPerPoint;
  const top: Ring = {
    area: ringArea(points) * f * f,
    perimeter: ringPerimeter(points) * f,
    corner: cornerTerm(points),
  };
  if (!(top.area > 0)) throw new RangeError('The traced top of bank encloses no area');

  derivation.push(
    `Top of bank: ${qty(top.area)} sf, perimeter ${qty(top.perimeter)} ft`);

  let excavationCubicFeet = 0;
  let slopeFaceArea = 0;
  let benchArea = 0;
  let offset = 0;            // how far in we are from the top ring, in feet
  let totalDepth = 0;

  lifts.forEach((lift, i) => {
    const name = lift.label ?? `Lift ${i + 1}`;
    const h = assertPositive(lift.depthFeet, `${name} depth`);
    const run = assertNonNegative(lift.sideSlopeRun, `${name} side slope`);

    const inward = run * h;
    const upperOffset = offset;
    const lowerOffset = offset + inward;

    const pinch = pinchDepth(top);
    if (lowerOffset >= pinch) {
      throw new RangeError(
        `${name} cuts past the point where the basin closes up. `
        + `At ${run}:1 this shape has ${roundTo(Math.max(pinch - upperOffset, 0) / (run || 1), 2)} ft `
        + 'of depth left before the bottom pinches out. Flatten the slope, or cut less.');
    }

    const aUpper = offsetArea(top, upperOffset);
    const aLower = offsetArea(top, lowerOffset);
    const aMid = offsetArea(top, upperOffset + inward / 2);

    // Prismoidal. Exact for a section whose area is quadratic in depth, which
    // a constant side slope makes it — so this is not an approximation here.
    const volume = (h / 6) * (aUpper + 4 * aMid + aLower);
    excavationCubicFeet += volume;

    // The sloped face: mean perimeter times the slope length per foot of fall.
    const meanPerimeter =
      (offsetPerimeter(top, upperOffset) + offsetPerimeter(top, lowerOffset)) / 2;
    const slopeLength = h * Math.hypot(run, 1);
    slopeFaceArea += meanPerimeter * slopeLength;

    derivation.push(
      `${name}: ${h} ft at ${run}:1 — ${qty(aUpper)} sf down to ${qty(aLower)} sf, `
      + `prismoidal ${qty(volume / CUBIC_FEET_PER_YARD)} cy`);

    offset = lowerOffset;
    totalDepth += h;

    const bench = lift.benchWidthFeet ?? 0;
    if (bench > 0) {
      const before = offsetArea(top, offset);
      const after = offsetArea(top, offset + bench);
      if (offset + bench >= pinch) {
        throw new RangeError(`${name}'s bench is wider than the basin has left at that depth.`);
      }
      benchArea += before - after;
      derivation.push(`${name}: ${bench} ft bench, ${qty(before - after)} sf`);
      offset += bench;
    }
  });

  const bottomArea = offsetArea(top, offset);

  /*
   * Stage storage, floor upward. Built by the same prismoidal arithmetic run in
   * reverse, one foot at a time, because that is the interval a civil drawing
   * tabulates and the one an estimator checks against it.
   */
  const stageStorage: BasinStage[] = [];
  {
    let cumulative = 0;
    // Offsets measured from the top ring, so depth d above the floor sits at
    // offset (totalOffset − the inward travel of those d feet). Benches make
    // that non-linear, so it is walked rather than solved.
    const offsetAtDepthAboveFloor = (d: number): number => {
      let remaining = totalDepth - d;    // depth below the top of bank
      let o = 0;
      for (const lift of lifts) {
        const h = lift.depthFeet;
        if (remaining <= 0) break;
        const used = Math.min(h, remaining);
        o += lift.sideSlopeRun * used;
        remaining -= used;
        if (remaining > 0) o += lift.benchWidthFeet ?? 0;
      }
      return o;
    };

    let previousArea = bottomArea;
    stageStorage.push({
      depthFeet: 0,
      surfaceAreaSquareFeet: qty(bottomArea * multiplier),
      cumulativeCubicFeet: 0,
      cumulativeAcreFeet: 0,
    });
    for (let d = 1; d <= Math.ceil(totalDepth); d++) {
      const depth = Math.min(d, totalDepth);
      const area = offsetArea(top, offsetAtDepthAboveFloor(depth));
      const step = depth - (stageStorage[stageStorage.length - 1]!.depthFeet);
      const midArea = offsetArea(top, offsetAtDepthAboveFloor(depth - step / 2));
      cumulative += (step / 6) * (previousArea + 4 * midArea + area);
      stageStorage.push({
        depthFeet: roundTo(depth, 2),
        surfaceAreaSquareFeet: qty(area * multiplier),
        cumulativeCubicFeet: qty(cumulative * multiplier),
        cumulativeAcreFeet: roundTo(cumulative * multiplier / SQUARE_FEET_PER_ACRE, 4),
      });
      previousArea = area;
      if (depth >= totalDepth) break;
    }
  }

  /*
   * Storage below the design water surface. Freeboard is measured down from the
   * top of bank, so the water stands `totalDepth − freeboard` above the floor.
   */
  let storageCubicFeet = 0;
  if (freeboardFeet != null) {
    assertNonNegative(freeboardFeet, 'freeboard');
    const waterDepth = totalDepth - freeboardFeet;
    if (waterDepth <= 0) {
      warnings.push(
        `The freeboard given (${freeboardFeet} ft) is as deep as the basin, so it holds nothing.`);
    } else {
      // Interpolated off the stage table rather than recomputed, so the storage
      // figure and the table a reviewer reads cannot disagree.
      const above = stageStorage.find((s) => s.depthFeet >= waterDepth);
      const below = [...stageStorage].reverse().find((s) => s.depthFeet <= waterDepth);
      if (above && below) {
        const span = above.depthFeet - below.depthFeet;
        storageCubicFeet = span === 0
          ? below.cumulativeCubicFeet
          : below.cumulativeCubicFeet
            + (above.cumulativeCubicFeet - below.cumulativeCubicFeet)
              * ((waterDepth - below.depthFeet) / span);
      }
      derivation.push(
        `Storage below the water surface at ${qty(waterDepth)} ft: `
        + `${qty(storageCubicFeet)} cf (${roundTo(storageCubicFeet / SQUARE_FEET_PER_ACRE, 3)} ac-ft)`);
    }
  }

  const excavation = excavationCubicFeet * multiplier;

  if (multiplier > 1) derivation.push(`x ${multiplier} identical basins`);
  derivation.push(
    `Excavation ${qty(excavation / CUBIC_FEET_PER_YARD)} bcy over ${qty(totalDepth)} ft of cut`);

  /*
   * The comparison worth stating, because it is the mistake this module exists
   * to prevent and an estimator should see the size of it.
   */
  const naive = top.area * totalDepth * multiplier;
  if (naive > excavation * 1.02) {
    derivation.push(
      `Plan area times depth would say ${qty(naive / CUBIC_FEET_PER_YARD)} bcy — `
      + `${roundTo(((naive - excavation) / excavation) * 100, 1)}% high, because the sides slope.`);
  }

  if (bottomArea < top.area * 0.05) {
    warnings.push(
      'The floor is under five percent of the top area, so this is close to a cone. '
      + 'Check the depth and the side slope against the section.');
  }

  return {
    excavationBankCubicYards: qty(excavation / CUBIC_FEET_PER_YARD),
    excavationCubicFeet: qty(excavation),
    topAreaSquareFeet: qty(top.area * multiplier),
    bottomAreaSquareFeet: qty(bottomArea * multiplier),
    topPerimeterFeet: qty(top.perimeter),
    totalDepthFeet: roundTo(totalDepth, 2),
    slopeFaceAreaSquareFeet: qty(slopeFaceArea * multiplier),
    benchAreaSquareFeet: qty(benchArea * multiplier),
    storageCubicFeet: qty(storageCubicFeet * multiplier),
    storageAcreFeet: roundTo(storageCubicFeet * multiplier / SQUARE_FEET_PER_ACRE, 4),
    stageStorage,
    derivation,
    warnings,
  };
}
