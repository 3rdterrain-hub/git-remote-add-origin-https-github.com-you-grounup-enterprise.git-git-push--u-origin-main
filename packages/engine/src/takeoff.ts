/**
 * On-screen takeoff: measuring quantities off a drawing.
 *
 * Not earthwork. `surfaces.ts` does earthwork from elevation grids, which is a
 * different problem with a different input. This is the measuring every other
 * trade does — a pipe run traced along a plan, a slab outlined, a fixture
 * counted, a roof plane taken off and corrected for pitch.
 *
 * Three things make this GrounUp's takeoff rather than a ruler:
 *
 *   1. **A scale knows what it was calibrated against.** A drawing scaled off
 *      the title block's stated ratio and one calibrated against a dimension
 *      string printed on the sheet are not equally trustworthy, and the
 *      difference is the commonest source of a quietly wrong bid — plans get
 *      reduced when they are printed and reissued, and the stated scale keeps
 *      saying what it always said. So a calibration records its basis, and that
 *      basis resolves to `verified_scale` or `approximate_scale`, which the
 *      confidence engine already scores differently and the approval gate
 *      already routes on. A measurement taken off an unverified scale cannot
 *      quietly become a bid.
 *   2. **Every measurement carries its derivation.** The same rule as the rest
 *      of the engine: a number a person cannot check is a number they have to
 *      trust, and Section 23 forbids hiding the calculation.
 *   3. **Nothing is assumed.** A polygon with two points, a scale with two
 *      identical calibration points, a pitch of zero — each is refused rather
 *      than defaulted into a quantity.
 *
 * Pure geometry over points in sheet space. It knows nothing about pixels,
 * PDFs, zoom or the viewer; the caller supplies coordinates in whatever
 * consistent space the calibration was taken in, and the scale converts.
 */
import { roundTo, safeDivide } from './numeric.js';
import { convertUnit, UNIT_DIMENSION, type Unit } from './units.js';
import type { MeasurementMethod } from './quantity.js';

/** A point in sheet space. The units are the caller's; the scale converts them. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Where a scale came from.
 *
 * Ordered by how much it deserves to be believed, and the reason this type
 * exists at all: the three are routinely treated as interchangeable and are
 * not.
 */
export type ScaleBasis =
  /** Calibrated against a dimension printed on the drawing. */
  | 'known_dimension'
  /** Calibrated against a graphic scale bar drawn on the sheet. */
  | 'graphic_scale_bar'
  /** Taken from the scale stated in the title block, unverified. */
  | 'stated_scale';

export interface ScaleCalibration {
  /** Two points spanning something whose real length is known. */
  from: Point;
  to: Point;
  /** The real-world distance between them. */
  knownDistance: number;
  /** The unit that distance is in. Must be a length. */
  knownUnit: Unit;
  basis: ScaleBasis;
  /** What was measured, in words. Required for a verified calibration. */
  reference?: string;
}

export interface ResolvedScale {
  /** Real-world `unit` per one unit of sheet space. */
  unitsPerPoint: number;
  unit: Unit;
  basis: ScaleBasis;
  /**
   * How a quantity measured at this scale should be described.
   *
   * Only a calibration against a known dimension earns `verified_scale`. A
   * graphic scale bar is drawn on the sheet and reduces with it, which sounds
   * like verification and is not: it confirms the print is internally
   * consistent, not that it is at the scale it claims.
   */
  measurementMethod: MeasurementMethod;
  derivation: string;
  warnings: readonly string[];
}

/** Distance between two points in sheet space. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Resolve a scale from a calibration.
 *
 * The unit is fixed to feet. Every length unit in the catalog is either feet
 * (LF) or derived from it, and carrying a second length unit through the
 * geometry would double the ways a conversion can go wrong for no benefit.
 */
export function resolveScale(c: ScaleCalibration): ResolvedScale {
  const warnings: string[] = [];

  if (UNIT_DIMENSION[c.knownUnit] !== 'length') {
    throw new RangeError(
      `A scale must be calibrated against a length, received ${c.knownUnit}`);
  }
  if (!(c.knownDistance > 0)) {
    throw new RangeError('A scale calibration needs a positive known distance');
  }

  const span = distance(c.from, c.to);
  if (span <= 0) {
    throw new RangeError(
      'The two calibration points are the same point, so they span no distance');
  }

  // Everything is carried in feet; LF is the catalog's length unit.
  const knownFeet = convertUnit(c.knownDistance, c.knownUnit, 'LF');
  const unitsPerPoint = safeDivide(knownFeet, span);

  /*
   * A calibration taken across a very short span multiplies its own click error
   * across the whole sheet: two pixels of slop over a 40-point span is a 5%
   * error on every quantity taken from it.
   */
  if (span < 50) {
    warnings.push(
      `Calibrated across ${roundTo(span, 1)} points of sheet space. A short calibration `
      + 'span magnifies click error across every measurement taken at this scale — '
      + 'calibrate against the longest known dimension on the sheet.');
  }

  const verified = c.basis === 'known_dimension';
  if (verified && !c.reference) {
    warnings.push(
      'This calibration claims a known dimension and does not say which one. '
      + 'It is recorded as an approximate scale until it names its reference.');
  }
  if (c.basis === 'stated_scale') {
    warnings.push(
      'Scaled from the title block without verification. Reissued and reduced prints '
      + 'keep stating the scale they were drawn at.');
  }

  const measurementMethod: MeasurementMethod =
    verified && c.reference ? 'verified_scale' : 'approximate_scale';

  return {
    unitsPerPoint,
    unit: 'LF',
    basis: c.basis,
    measurementMethod,
    derivation:
      `${roundTo(knownFeet, 4)} ft over ${roundTo(span, 2)} sheet units `
      + `= ${roundTo(unitsPerPoint, 6)} ft per unit`
      + (c.reference ? ` (${c.reference})` : ''),
    warnings,
  };
}

export type MeasurementKind = 'count' | 'linear' | 'area' | 'volume';

export interface MeasurementInput {
  kind: MeasurementKind;
  /** Traced points, in the same space the scale was calibrated in. */
  points: readonly Point[];
  scale: ResolvedScale;
  /** The unit the answer is wanted in. Must suit the kind. */
  unit: Unit;

  /** Close the traced path. Areas are always closed; a linear run may be. */
  closed?: boolean;

  /**
   * Openings subtracted from an area — a door in a wall, a skylight in a roof.
   * Each is its own closed ring in the same space.
   */
  deductions?: readonly (readonly Point[])[];

  /**
   * Roof or ramp slope, as rise over run. A plan view shows the horizontal
   * projection, and a roofer buys the sloped area — a 6:12 roof is 11.8% more
   * material than its footprint. Applied to areas only.
   */
  pitch?: { rise: number; run: number };

  /** Depth or thickness, in feet, turning a measured area into a volume. */
  depthFeet?: number;

  /** Width in feet, turning a measured run into an area — a paved path, a footing. */
  widthFeet?: number;

  /** Quantity each placed marker represents. Three fixtures on one symbol. */
  countPer?: number;

  /** Repeats: the same detail on four identical elevations. */
  multiplier?: number;
}

export interface MeasurementResult {
  kind: MeasurementKind;
  quantity: number;
  unit: Unit;
  /** How the quantity should be described on the estimate line. */
  measurementMethod: MeasurementMethod;
  /** Traced length in feet, before any width is applied. */
  lengthFeet: number;
  /** Enclosed plan area in square feet, before pitch or deductions. */
  planAreaFeet: number;
  /** Area deducted, in square feet. */
  deductedAreaFeet: number;
  /** The slope factor applied, 1 when none. */
  pitchFactor: number;
  markerCount: number;
  derivation: readonly string[];
  warnings: readonly string[];
}

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

function pathLength(points: readonly Point[], closed: boolean): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1]!, points[i]!);
  if (closed && points.length > 2) total += distance(points[points.length - 1]!, points[0]!);
  return total;
}

/** Do any two non-adjacent segments of a closed ring cross? */
function selfIntersects(points: readonly Point[]): boolean {
  const n = points.length;
  if (n < 4) return false;
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const straddles = (p1: Point, p2: Point, p3: Point, p4: Point) => {
    const d1 = cross(p3, p4, p1);
    const d2 = cross(p3, p4, p2);
    const d3 = cross(p1, p2, p3);
    const d4 = cross(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
      && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Adjacent segments share an endpoint and always "touch".
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (straddles(points[i]!, points[(i + 1) % n]!, points[j]!, points[(j + 1) % n]!)) {
        return true;
      }
    }
  }
  return false;
}

/** The pitch multiplier for a sloped surface measured in plan. */
export function pitchFactor(rise: number, run: number): number {
  if (!(run > 0)) throw new RangeError('A pitch needs a positive run');
  if (rise < 0) throw new RangeError('A pitch cannot have a negative rise');
  return Math.hypot(rise, run) / run;
}

/**
 * Measure.
 *
 * Refuses rather than guesses. Too few points for the shape asked for, a unit
 * that does not suit the kind, a volume with no depth — each is a hole in the
 * takeoff and none of them has a sensible default.
 */
export function measure(input: MeasurementInput): MeasurementResult {
  const {
    kind, points, scale, unit, deductions = [], countPer = 1, multiplier = 1,
  } = input;
  const warnings: string[] = [...scale.warnings];
  const derivation: string[] = [scale.derivation];

  if (!(multiplier > 0)) throw new RangeError('A multiplier must be positive');
  if (!(countPer > 0)) throw new RangeError('Each marker must represent a positive quantity');

  const f = scale.unitsPerPoint;
  const closed = input.closed ?? (kind === 'area' || kind === 'volume');

  // ------------------------------------------------------------------ count
  if (kind === 'count') {
    if (UNIT_DIMENSION[unit] !== 'count') {
      throw new RangeError(`A count must be reported in a count unit, received ${unit}`);
    }
    if (points.length === 0) throw new RangeError('A count needs at least one marker');
    const quantity = points.length * countPer * multiplier;
    derivation.push(
      `${points.length} markers x ${countPer} each x ${multiplier} = ${quantity} ${unit}`);
    return {
      kind, quantity, unit, measurementMethod: 'derived',
      lengthFeet: 0, planAreaFeet: 0, deductedAreaFeet: 0, pitchFactor: 1,
      markerCount: points.length, derivation, warnings,
    };
  }

  // ----------------------------------------------------------------- linear
  const minPoints = kind === 'linear' ? 2 : 3;
  if (points.length < minPoints) {
    throw new RangeError(
      `A ${kind} measurement needs at least ${minPoints} points, received ${points.length}`);
  }

  const lengthFeet = pathLength(points, closed) * f;
  derivation.push(
    `${points.length} points${closed ? ', closed' : ''} = ${roundTo(lengthFeet, 3)} ft traced`);

  if (kind === 'linear' && input.widthFeet === undefined) {
    if (UNIT_DIMENSION[unit] !== 'length') {
      throw new RangeError(`A linear measurement must be reported in a length, received ${unit}`);
    }
    const quantity = roundTo(convertUnit(lengthFeet, 'LF', unit) * multiplier, 4);
    derivation.push(`x ${multiplier} = ${quantity} ${unit}`);
    return {
      kind, quantity, unit, measurementMethod: scale.measurementMethod,
      lengthFeet, planAreaFeet: 0, deductedAreaFeet: 0, pitchFactor: 1,
      markerCount: points.length, derivation, warnings,
    };
  }

  // ------------------------------------------------------- area and volume
  let planAreaFeet: number;
  if (kind === 'linear') {
    // A run given a width is a strip: a paved path, a footing, a trench top.
    planAreaFeet = lengthFeet * input.widthFeet!;
    derivation.push(
      `x ${input.widthFeet} ft wide = ${roundTo(planAreaFeet, 3)} sq ft`);
  } else {
    if (selfIntersects(points)) {
      warnings.push(
        'The traced outline crosses itself. The enclosed area of a self-intersecting '
        + 'outline is not what it looks like — retrace it as a simple shape.');
    }
    planAreaFeet = ringArea(points) * f * f;
    derivation.push(`enclosed ${roundTo(planAreaFeet, 3)} sq ft in plan`);
  }

  let deductedAreaFeet = 0;
  for (const ring of deductions) {
    if (ring.length < 3) {
      throw new RangeError('A deduction needs at least three points');
    }
    deductedAreaFeet += ringArea(ring) * f * f;
  }
  if (deductedAreaFeet > 0) {
    if (deductedAreaFeet >= planAreaFeet) {
      throw new RangeError(
        `Deductions of ${roundTo(deductedAreaFeet, 2)} sq ft meet or exceed the measured `
        + `${roundTo(planAreaFeet, 2)} sq ft. One of the outlines is wrong.`);
    }
    derivation.push(`less ${roundTo(deductedAreaFeet, 3)} sq ft deducted`);
  }

  const pf = input.pitch ? pitchFactor(input.pitch.rise, input.pitch.run) : 1;
  if (input.pitch) {
    derivation.push(
      `x ${roundTo(pf, 5)} for ${input.pitch.rise}:${input.pitch.run} pitch `
      + '(a plan view shows the footprint, not the sloped surface)');
  }

  const netAreaFeet = (planAreaFeet - deductedAreaFeet) * pf;

  if (kind === 'area' || (kind === 'linear' && input.depthFeet === undefined)) {
    if (UNIT_DIMENSION[unit] !== 'area') {
      throw new RangeError(`An area must be reported in an area unit, received ${unit}`);
    }
    const quantity = roundTo(convertUnit(netAreaFeet, 'SF', unit) * multiplier, 4);
    derivation.push(`= ${quantity} ${unit}`);
    return {
      kind, quantity, unit, measurementMethod: scale.measurementMethod,
      lengthFeet, planAreaFeet, deductedAreaFeet, pitchFactor: pf,
      markerCount: points.length, derivation, warnings,
    };
  }

  // ----------------------------------------------------------------- volume
  if (input.depthFeet === undefined) {
    throw new RangeError('A volume needs a depth. Measuring one without is guessing.');
  }
  if (!(input.depthFeet > 0)) {
    throw new RangeError('A depth must be positive');
  }
  if (UNIT_DIMENSION[unit] !== 'volume') {
    throw new RangeError(`A volume must be reported in a volume unit, received ${unit}`);
  }
  const cubicFeet = netAreaFeet * input.depthFeet;
  // CY is the catalog's volume unit, and 27 cubic feet make one.
  const quantity = roundTo(convertUnit(cubicFeet / 27, 'CY', unit) * multiplier, 4);
  derivation.push(
    `x ${input.depthFeet} ft deep = ${roundTo(cubicFeet, 2)} cu ft = ${quantity} ${unit}`);

  return {
    kind: 'volume', quantity, unit, measurementMethod: scale.measurementMethod,
    lengthFeet, planAreaFeet, deductedAreaFeet, pitchFactor: pf,
    markerCount: points.length, derivation, warnings,
  };
}
