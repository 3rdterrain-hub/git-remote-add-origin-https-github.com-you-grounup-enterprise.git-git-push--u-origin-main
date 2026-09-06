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
/**
 * Take off a basin.
 *
 * Refuses rather than guesses, in the same places `measure` does: a ring that
 * is not a ring, a lift with no depth, a slope that runs backward.
 */
export declare function measureBasin(input: BasinInput): BasinResult;
