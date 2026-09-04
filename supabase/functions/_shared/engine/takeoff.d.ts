import { type Unit } from './units.js';
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
'known_dimension'
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
export declare function distance(a: Point, b: Point): number;
/**
 * Resolve a scale from a calibration.
 *
 * The unit is fixed to feet. Every length unit in the catalog is either feet
 * (LF) or derived from it, and carrying a second length unit through the
 * geometry would double the ways a conversion can go wrong for no benefit.
 */
export declare function resolveScale(c: ScaleCalibration): ResolvedScale;
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
    pitch?: {
        rise: number;
        run: number;
    };
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
/** The pitch multiplier for a sloped surface measured in plan. */
export declare function pitchFactor(rise: number, run: number): number;
/**
 * Measure.
 *
 * Refuses rather than guesses. Too few points for the shape asked for, a unit
 * that does not suit the kind, a volume with no depth — each is a hole in the
 * takeoff and none of them has a sensible default.
 */
export declare function measure(input: MeasurementInput): MeasurementResult;
