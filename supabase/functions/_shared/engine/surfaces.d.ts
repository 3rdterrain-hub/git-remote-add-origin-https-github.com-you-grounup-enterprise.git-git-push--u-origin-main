/**
 * Surface-to-surface earthwork volumes.
 *
 * This is where a drone flight or a survey becomes a quantity. Two elevation
 * surfaces — existing ground and design subgrade — produce cut and fill by
 * comparing them cell by cell over a grid.
 *
 * The output feeds `analyzeCutFill` in `trucking.ts`: this module produces bank
 * cubic yards from geometry, and that one converts them into the loose and
 * compacted volumes an estimate actually prices. Keeping the two separate is
 * deliberate — a surveyor's volume is a measurement, and what it costs to move
 * depends on soil properties the surface knows nothing about.
 */
/**
 * A regular elevation grid.
 *
 * `elevations` is row-major, `rows × cols`. A cell may be null where the
 * surface has no data — outside the survey boundary, or a hole in the point
 * cloud. A null on either surface excludes the cell from the volume rather than
 * treating the missing elevation as zero, which would invent an enormous cut.
 */
/**
 * Where a grid sits on the ground.
 *
 * In the survey's own coordinate system and units — this engine never projects
 * anything, it only refuses to difference two grids that disagree about where
 * they are.
 */
export interface GridOrigin {
    /** Easting of the center of cell (0,0). */
    easting: number;
    /** Northing of the center of cell (0,0). */
    northing: number;
}
export interface Grid {
    /** Cell size in feet. Square cells; a rectangular grid is not supported. */
    cellSize: number;
    rows: number;
    cols: number;
    /** Row-major elevations in feet. `null` means no data at that cell. */
    elevations: (number | null)[];
    /**
     * Where cell (0,0) is. Optional, because a caller may legitimately hold two
     * grids it already knows are aligned — but when both grids carry one and they
     * disagree, the comparison is refused, and when either is missing the result
     * says so. Two grids of equal shape over different ground produce a volume
     * that is entirely fictitious and entirely plausible.
     */
    origin?: GridOrigin;
    name?: string;
}
export interface CellResult {
    row: number;
    col: number;
    existing: number;
    design: number;
    /** Positive means cut (existing above design); negative means fill. */
    depth: number;
}
export interface SurfaceVolumeResult {
    /**
     * Raw cubic feet, before conversion and rounding.
     *
     * Exposed because any figure derived by subtracting two rounded yardages —
     * completed work, a remaining balance — accumulates the rounding of both. A
     * caller doing that arithmetic should do it here and round once at the end.
     */
    cutCf: number;
    fillCf: number;
    /** Material removed, in bank cubic yards. */
    cutBcy: number;
    /** Material placed, in compacted cubic yards as designed. */
    fillCcy: number;
    /** cut − fill, in the units above. Positive means surplus before shrink. */
    netBcy: number;
    /** Plan area of cells in cut, in square feet. */
    cutAreaSf: number;
    fillAreaSf: number;
    /** Cells that contributed to the volume. */
    cellsCompared: number;
    /** Cells skipped because one surface had no data there. */
    cellsSkipped: number;
    /** Coverage: compared ÷ total. Low coverage makes the volume unreliable. */
    coverage: number;
    maxCutDepth: number;
    maxFillDepth: number;
    averageCutDepth: number;
    averageFillDepth: number;
    cellSize: number;
    derivation: string;
    warnings: readonly string[];
}
/**
 * Compare two surfaces and return the earthwork between them.
 *
 * Volumes use the average-depth method over each cell: a cell's contribution is
 * its plan area times the depth at that cell. On a grid fine enough to resolve
 * the terrain this converges on the true volume, and it is the method a
 * surveyor's report will have used — which matters more than a marginally more
 * accurate one an estimator cannot reconcile against their own paperwork.
 */
export declare function compareSurfaces(existing: Grid, design: Grid): SurfaceVolumeResult;
export interface CrossSection {
    /** Station in feet along the alignment. */
    station: number;
    /** Cut area at this station, in square feet. */
    cutAreaSf: number;
    /** Fill area at this station, in square feet. */
    fillAreaSf: number;
    /**
     * Optional surveyed area midway to the *next* station.
     *
     * This is what makes the prismoidal method mean anything. Without a real
     * mid-section the usual shortcut is to take the mean of the two ends, and
     * substituting that into the prismoidal formula reduces it exactly back to
     * average end area — (A1 + 4·((A1+A2)/2) + A2)·L/6 = (A1+A2)·L/2 — so it
     * would be a more complicated way to compute the same number.
     */
    midCutAreaSf?: number;
    midFillAreaSf?: number;
}
export interface EndAreaResult {
    cutBcy: number;
    fillCcy: number;
    netBcy: number;
    stations: number;
    lengthFt: number;
    method: 'average_end_area' | 'prismoidal';
    segments: readonly {
        fromStation: number;
        toStation: number;
        lengthFt: number;
        cutBcy: number;
        fillCcy: number;
        method: 'average_end_area' | 'prismoidal';
    }[];
    /** Segments that fell back to average end area for want of a mid-section. */
    segmentsWithoutMidSection: number;
    derivation: string;
    warnings: readonly string[];
}
/**
 * Volume between cross sections.
 *
 * Average end area is the default because it is what a DOT plan set's earthwork
 * summary uses, so an estimator can reconcile against the engineer's own
 * quantity rather than arguing about methodology.
 *
 * `usePrismoidal` only changes the answer for segments that carry a surveyed
 * `midCutAreaSf` / `midFillAreaSf`. Where a section changes shape sharply
 * between stations — a transition from cut to fill, a widening — average end
 * area overstates the volume, and a real mid-section corrects it. Segments
 * without one fall back to average end area and are counted in
 * `segmentsWithoutMidSection`, so the result never implies a precision it does
 * not have.
 */
export declare function averageEndArea(sections: readonly CrossSection[], usePrismoidal?: boolean): EndAreaResult;
export interface StockpileResult {
    /** Loose cubic yards, because a stockpile is loose material by definition. */
    volumeLcy: number;
    baseAreaSf: number;
    averageHeightFt: number;
    maxHeightFt: number;
    cellsCompared: number;
    derivation: string;
    warnings: readonly string[];
}
/**
 * Volume of a stockpile above a base surface.
 *
 * Reported in **loose** cubic yards: a pile is material that has already been
 * excavated and dumped, so quoting it in bank measure would overstate what
 * putting it back would fill. That distinction is exactly the one Section 11
 * exists to protect.
 */
export declare function stockpileVolume(surface: Grid, base: Grid): StockpileResult;
export interface ProgressResult {
    /** Fraction of the design volume achieved, 0-1. */
    percentComplete: number;
    remainingCutBcy: number;
    remainingFillCcy: number;
    completedCutBcy: number;
    completedFillCcy: number;
    /** Cells already at or below design grade, within tolerance. */
    cellsAtGrade: number;
    /** Cells cut past design grade — rework, not progress. */
    cellsOverExcavated: number;
    overExcavationBcy: number;
    toleranceFt: number;
    derivation: string;
    warnings: readonly string[];
}
/**
 * Compare an as-built surface against the design to report real progress.
 *
 * Over-excavation is separated from progress rather than counted toward it: a
 * cell cut below design grade is not 110% finished, it is fill that has to be
 * brought back and recompacted. Counting it as progress is how a job reports
 * 95% complete and then loses a week.
 */
export declare function progressAgainstDesign(original: Grid, asBuilt: Grid, design: Grid, toleranceFt?: number): ProgressResult;
/** Build a grid from a flat elevation array, for import from a survey file. */
export declare function gridFrom(elevations: (number | null)[], rows: number, cols: number, cellSize: number, name?: string): Grid;
