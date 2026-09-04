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
import { convertUnit, UNIT_DIMENSION } from './units.js';
/** Distance between two points in sheet space. */
export function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}
/**
 * Resolve a scale from a calibration.
 *
 * The unit is fixed to feet. Every length unit in the catalog is either feet
 * (LF) or derived from it, and carrying a second length unit through the
 * geometry would double the ways a conversion can go wrong for no benefit.
 */
export function resolveScale(c) {
    const warnings = [];
    if (UNIT_DIMENSION[c.knownUnit] !== 'length') {
        throw new RangeError(`A scale must be calibrated against a length, received ${c.knownUnit}`);
    }
    if (!(c.knownDistance > 0)) {
        throw new RangeError('A scale calibration needs a positive known distance');
    }
    const span = distance(c.from, c.to);
    if (span <= 0) {
        throw new RangeError('The two calibration points are the same point, so they span no distance');
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
        warnings.push(`Calibrated across ${roundTo(span, 1)} points of sheet space. A short calibration `
            + 'span magnifies click error across every measurement taken at this scale — '
            + 'calibrate against the longest known dimension on the sheet.');
    }
    const verified = c.basis === 'known_dimension';
    if (verified && !c.reference) {
        warnings.push('This calibration claims a known dimension and does not say which one. '
            + 'It is recorded as an approximate scale until it names its reference.');
    }
    if (c.basis === 'stated_scale') {
        warnings.push('Scaled from the title block without verification. Reissued and reduced prints '
            + 'keep stating the scale they were drawn at.');
    }
    const measurementMethod = verified && c.reference ? 'verified_scale' : 'approximate_scale';
    return {
        unitsPerPoint,
        unit: 'LF',
        basis: c.basis,
        measurementMethod,
        derivation: `${roundTo(knownFeet, 4)} ft over ${roundTo(span, 2)} sheet units `
            + `= ${roundTo(unitsPerPoint, 6)} ft per unit`
            + (c.reference ? ` (${c.reference})` : ''),
        warnings,
    };
}
/** Shoelace. Absolute, so winding direction does not decide the sign. */
function ringArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
}
function pathLength(points, closed) {
    let total = 0;
    for (let i = 1; i < points.length; i++)
        total += distance(points[i - 1], points[i]);
    if (closed && points.length > 2)
        total += distance(points[points.length - 1], points[0]);
    return total;
}
/** Do any two non-adjacent segments of a closed ring cross? */
function selfIntersects(points) {
    const n = points.length;
    if (n < 4)
        return false;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const straddles = (p1, p2, p3, p4) => {
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
            if (j === i || (j + 1) % n === i || (i + 1) % n === j)
                continue;
            if (straddles(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) {
                return true;
            }
        }
    }
    return false;
}
/** The pitch multiplier for a sloped surface measured in plan. */
export function pitchFactor(rise, run) {
    if (!(run > 0))
        throw new RangeError('A pitch needs a positive run');
    if (rise < 0)
        throw new RangeError('A pitch cannot have a negative rise');
    return Math.hypot(rise, run) / run;
}
/**
 * Measure.
 *
 * Refuses rather than guesses. Too few points for the shape asked for, a unit
 * that does not suit the kind, a volume with no depth — each is a hole in the
 * takeoff and none of them has a sensible default.
 */
export function measure(input) {
    const { kind, points, scale, unit, deductions = [], countPer = 1, multiplier = 1, } = input;
    const warnings = [...scale.warnings];
    const derivation = [scale.derivation];
    if (!(multiplier > 0))
        throw new RangeError('A multiplier must be positive');
    if (!(countPer > 0))
        throw new RangeError('Each marker must represent a positive quantity');
    const f = scale.unitsPerPoint;
    const closed = input.closed ?? (kind === 'area' || kind === 'volume');
    // ------------------------------------------------------------------ count
    if (kind === 'count') {
        if (UNIT_DIMENSION[unit] !== 'count') {
            throw new RangeError(`A count must be reported in a count unit, received ${unit}`);
        }
        if (points.length === 0)
            throw new RangeError('A count needs at least one marker');
        const quantity = points.length * countPer * multiplier;
        derivation.push(`${points.length} markers x ${countPer} each x ${multiplier} = ${quantity} ${unit}`);
        return {
            kind, quantity, unit, measurementMethod: 'derived',
            lengthFeet: 0, planAreaFeet: 0, deductedAreaFeet: 0, pitchFactor: 1,
            markerCount: points.length, derivation, warnings,
        };
    }
    // ----------------------------------------------------------------- linear
    const minPoints = kind === 'linear' ? 2 : 3;
    if (points.length < minPoints) {
        throw new RangeError(`A ${kind} measurement needs at least ${minPoints} points, received ${points.length}`);
    }
    const lengthFeet = pathLength(points, closed) * f;
    derivation.push(`${points.length} points${closed ? ', closed' : ''} = ${roundTo(lengthFeet, 3)} ft traced`);
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
    let planAreaFeet;
    if (kind === 'linear') {
        // A run given a width is a strip: a paved path, a footing, a trench top.
        planAreaFeet = lengthFeet * input.widthFeet;
        derivation.push(`x ${input.widthFeet} ft wide = ${roundTo(planAreaFeet, 3)} sq ft`);
    }
    else {
        if (selfIntersects(points)) {
            warnings.push('The traced outline crosses itself. The enclosed area of a self-intersecting '
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
            throw new RangeError(`Deductions of ${roundTo(deductedAreaFeet, 2)} sq ft meet or exceed the measured `
                + `${roundTo(planAreaFeet, 2)} sq ft. One of the outlines is wrong.`);
        }
        derivation.push(`less ${roundTo(deductedAreaFeet, 3)} sq ft deducted`);
    }
    const pf = input.pitch ? pitchFactor(input.pitch.rise, input.pitch.run) : 1;
    if (input.pitch) {
        derivation.push(`x ${roundTo(pf, 5)} for ${input.pitch.rise}:${input.pitch.run} pitch `
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
    derivation.push(`x ${input.depthFeet} ft deep = ${roundTo(cubicFeet, 2)} cu ft = ${quantity} ${unit}`);
    return {
        kind: 'volume', quantity, unit, measurementMethod: scale.measurementMethod,
        lengthFeet, planAreaFeet, deductedAreaFeet, pitchFactor: pf,
        markerCount: points.length, derivation, warnings,
    };
}
