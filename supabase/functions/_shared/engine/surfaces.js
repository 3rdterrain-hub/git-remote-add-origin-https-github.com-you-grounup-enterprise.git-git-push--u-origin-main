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
import { assertFinite, assertPositive, factor, qty, roundTo, safeDivide } from './numeric.js';
/** Below this coverage the volume is not a reliable basis for pricing. */
const MIN_RELIABLE_COVERAGE = 0.85;
/** A depth beyond this is almost always a survey artefact, not real ground. */
const IMPLAUSIBLE_DEPTH_FT = 100;
function validateGrid(g, label) {
    assertPositive(g.cellSize, `${label} cellSize`);
    assertPositive(g.rows, `${label} rows`);
    assertPositive(g.cols, `${label} cols`);
    if (g.elevations.length !== g.rows * g.cols) {
        throw new RangeError(`${label} has ${g.elevations.length} elevations but ${g.rows} × ${g.cols} = ${g.rows * g.cols} cells`);
    }
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
export function compareSurfaces(existing, design) {
    validateGrid(existing, 'existing');
    validateGrid(design, 'design');
    const warnings = [];
    if (existing.cellSize !== design.cellSize || existing.rows !== design.rows || existing.cols !== design.cols) {
        throw new RangeError(`Surfaces must share a grid to be compared: existing is ${existing.rows}×${existing.cols} at ` +
            `${existing.cellSize} ft, design is ${design.rows}×${design.cols} at ${design.cellSize} ft. ` +
            `Resample one onto the other before comparing.`);
    }
    // Same shape is not the same place. Refused when both grids say where they
    // are and disagree; noted when either does not say.
    if (existing.origin && design.origin) {
        if (existing.origin.easting !== design.origin.easting ||
            existing.origin.northing !== design.origin.northing) {
            throw new RangeError(`Surfaces start at different places: existing at ${existing.origin.easting}, ` +
                `${existing.origin.northing}; design at ${design.origin.easting}, ` +
                `${design.origin.northing}. Grids of the same shape over different ground ` +
                `produce a plausible and fictitious volume.`);
        }
    }
    else {
        warnings.push('Neither surface carries a georeference, or only one does, so alignment could not be ' +
            'checked. The volume assumes the two grids cover the same ground.');
    }
    const cellArea = existing.cellSize * existing.cellSize;
    let cutVolumeCf = 0;
    let fillVolumeCf = 0;
    let cutCells = 0;
    let fillCells = 0;
    let skipped = 0;
    let maxCut = 0;
    let maxFill = 0;
    for (let i = 0; i < existing.elevations.length; i++) {
        const e = existing.elevations[i];
        const d = design.elevations[i];
        // A missing elevation on either surface excludes the cell. Treating it as
        // zero would invent hundreds of feet of cut against a real design surface.
        if (e === null || e === undefined || d === null || d === undefined) {
            skipped++;
            continue;
        }
        assertFinite(e, `existing elevation at index ${i}`);
        assertFinite(d, `design elevation at index ${i}`);
        const depth = e - d;
        if (Math.abs(depth) > IMPLAUSIBLE_DEPTH_FT) {
            warnings.push(`Cell ${Math.floor(i / existing.cols)},${i % existing.cols} shows ${roundTo(Math.abs(depth), 1)} ft of ` +
                `${depth > 0 ? 'cut' : 'fill'}, which is almost certainly a survey artefact or a datum mismatch ` +
                `between the two surfaces.`);
        }
        if (depth > 0) {
            cutVolumeCf += depth * cellArea;
            cutCells++;
            if (depth > maxCut)
                maxCut = depth;
        }
        else if (depth < 0) {
            fillVolumeCf += -depth * cellArea;
            fillCells++;
            if (-depth > maxFill)
                maxFill = -depth;
        }
        // depth === 0 contributes nothing but is still a compared cell.
    }
    const compared = existing.elevations.length - skipped;
    const coverage = safeDivide(compared, existing.elevations.length);
    if (coverage < MIN_RELIABLE_COVERAGE) {
        warnings.push(`Only ${factor(coverage * 100)}% of the grid has data on both surfaces. Below ` +
            `${MIN_RELIABLE_COVERAGE * 100}% the volume is not a reliable basis for pricing — extend the survey or ` +
            `reduce the compared boundary.`);
    }
    if (compared === 0) {
        warnings.push('The two surfaces do not overlap anywhere; no volume could be computed.');
    }
    const cutBcy = qty(cutVolumeCf / 27);
    const fillCcy = qty(fillVolumeCf / 27);
    const cutAreaSf = qty(cutCells * cellArea);
    const fillAreaSf = qty(fillCells * cellArea);
    return {
        cutCf: roundTo(cutVolumeCf, 4),
        fillCf: roundTo(fillVolumeCf, 4),
        cutBcy,
        fillCcy,
        netBcy: qty(cutBcy - fillCcy),
        cutAreaSf,
        fillAreaSf,
        cellsCompared: compared,
        cellsSkipped: skipped,
        coverage: factor(coverage),
        maxCutDepth: roundTo(maxCut, 2),
        maxFillDepth: roundTo(maxFill, 2),
        averageCutDepth: roundTo(safeDivide(cutVolumeCf, cutAreaSf), 2),
        averageFillDepth: roundTo(safeDivide(fillVolumeCf, fillAreaSf), 2),
        cellSize: existing.cellSize,
        derivation: `${compared} cells at ${existing.cellSize} ft (${cellArea} SF each); ` +
            `cut ${roundTo(cutVolumeCf, 0)} CF / 27 = ${cutBcy} BCY over ${cutAreaSf} SF; ` +
            `fill ${roundTo(fillVolumeCf, 0)} CF / 27 = ${fillCcy} CCY over ${fillAreaSf} SF; ` +
            `net ${qty(cutBcy - fillCcy)}`,
        warnings,
    };
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
export function averageEndArea(sections, usePrismoidal = false) {
    if (sections.length < 2) {
        throw new RangeError('At least two cross sections are required to compute a volume between them');
    }
    const ordered = [...sections].sort((a, b) => a.station - b.station);
    const warnings = [];
    const segments = [];
    let cutCf = 0;
    let fillCf = 0;
    let withoutMid = 0;
    for (let i = 0; i < ordered.length - 1; i++) {
        const a = ordered[i];
        const b = ordered[i + 1];
        const length = b.station - a.station;
        if (length <= 0) {
            warnings.push(`Two sections share station ${a.station}; the duplicate contributes no volume.`);
            continue;
        }
        if (length > 200) {
            warnings.push(`Sections at ${a.station} and ${b.station} are ${roundTo(length, 0)} ft apart. Beyond about 100 ft ` +
                `the average end area method loses accuracy on changing terrain.`);
        }
        let segCut;
        let segFill;
        let segMethod = 'average_end_area';
        const hasMid = a.midCutAreaSf !== undefined || a.midFillAreaSf !== undefined;
        if (usePrismoidal && hasMid) {
            // Prismoidal: (A1 + 4·Am + A2) · L / 6, using the *surveyed* mid area.
            const midCut = a.midCutAreaSf ?? (a.cutAreaSf + b.cutAreaSf) / 2;
            const midFill = a.midFillAreaSf ?? (a.fillAreaSf + b.fillAreaSf) / 2;
            segCut = ((a.cutAreaSf + 4 * midCut + b.cutAreaSf) * length) / 6;
            segFill = ((a.fillAreaSf + 4 * midFill + b.fillAreaSf) * length) / 6;
            segMethod = 'prismoidal';
        }
        else {
            if (usePrismoidal)
                withoutMid++;
            segCut = ((a.cutAreaSf + b.cutAreaSf) / 2) * length;
            segFill = ((a.fillAreaSf + b.fillAreaSf) / 2) * length;
        }
        cutCf += segCut;
        fillCf += segFill;
        segments.push({
            fromStation: a.station,
            toStation: b.station,
            lengthFt: roundTo(length, 2),
            cutBcy: qty(segCut / 27),
            fillCcy: qty(segFill / 27),
            method: segMethod,
        });
    }
    const cutBcy = qty(cutCf / 27);
    const fillCcy = qty(fillCf / 27);
    const lengthFt = roundTo(ordered[ordered.length - 1].station - ordered[0].station, 2);
    if (usePrismoidal && withoutMid > 0) {
        warnings.push(`${withoutMid} of ${segments.length} segments carry no surveyed mid-section and were computed by ` +
            `average end area. The prismoidal method only differs where a real mid area is supplied.`);
    }
    return {
        cutBcy,
        fillCcy,
        netBcy: qty(cutBcy - fillCcy),
        stations: ordered.length,
        lengthFt,
        method: usePrismoidal && withoutMid < segments.length ? 'prismoidal' : 'average_end_area',
        segments,
        segmentsWithoutMidSection: withoutMid,
        derivation: `${ordered.length} sections over ${lengthFt} ft; ` +
            `cut ${cutBcy} BCY, fill ${fillCcy} CCY, net ${qty(cutBcy - fillCcy)}` +
            (usePrismoidal ? ` (${segments.length - withoutMid} prismoidal, ${withoutMid} average end area)` : ''),
        warnings,
    };
}
/**
 * Volume of a stockpile above a base surface.
 *
 * Reported in **loose** cubic yards: a pile is material that has already been
 * excavated and dumped, so quoting it in bank measure would overstate what
 * putting it back would fill. That distinction is exactly the one Section 11
 * exists to protect.
 */
export function stockpileVolume(surface, base) {
    const r = compareSurfaces(surface, base);
    const warnings = [...r.warnings];
    if (r.fillCcy > 0) {
        warnings.push(`${r.fillCcy} CY of the compared area sits below the base surface. A stockpile should sit entirely ` +
            `above its base — check that the base was taken before the material was placed.`);
    }
    return {
        volumeLcy: r.cutBcy,
        baseAreaSf: r.cutAreaSf,
        averageHeightFt: r.averageCutDepth,
        maxHeightFt: r.maxCutDepth,
        cellsCompared: r.cellsCompared,
        derivation: `${r.derivation} — reported as LCY because stockpiled material is loose`,
        warnings,
    };
}
/**
 * Compare an as-built surface against the design to report real progress.
 *
 * Over-excavation is separated from progress rather than counted toward it: a
 * cell cut below design grade is not 110% finished, it is fill that has to be
 * brought back and recompacted. Counting it as progress is how a job reports
 * 95% complete and then loses a week.
 */
export function progressAgainstDesign(original, asBuilt, design, toleranceFt = 0.1) {
    assertPositive(toleranceFt, 'toleranceFt');
    const total = compareSurfaces(original, design);
    const remaining = compareSurfaces(asBuilt, design);
    const warnings = [...total.warnings, ...remaining.warnings];
    const cellArea = design.cellSize * design.cellSize;
    let atGrade = 0;
    let overCells = 0;
    let overCf = 0;
    for (let i = 0; i < design.elevations.length; i++) {
        const a = asBuilt.elevations[i];
        const d = design.elevations[i];
        if (a === null || a === undefined || d === null || d === undefined)
            continue;
        const diff = a - d;
        if (Math.abs(diff) <= toleranceFt) {
            atGrade++;
        }
        else if (diff < -toleranceFt) {
            overCells++;
            overCf += -diff * cellArea;
        }
    }
    // Work in cubic feet throughout, then convert once. Subtracting two rounded
    // yardages would show a foot of drift on a large site.
    const totalWorkCf = total.cutCf + total.fillCf;
    const remainingWorkCf = remaining.cutCf + remaining.fillCf;
    const percentComplete = totalWorkCf > 0 ? Math.max(0, Math.min(1, 1 - remainingWorkCf / totalWorkCf)) : 1;
    const completedCutCf = Math.max(0, total.cutCf - remaining.cutCf);
    const completedFillCf = Math.max(0, total.fillCf - remaining.fillCf);
    const overExcavationBcy = qty(overCf / 27);
    if (overExcavationBcy > 0) {
        warnings.push(`${overExcavationBcy} BCY has been cut below design grade across ${overCells} cells. That is rework — ` +
            `the material has to come back and be recompacted — and it is excluded from progress.`);
    }
    return {
        percentComplete: factor(percentComplete),
        remainingCutBcy: remaining.cutBcy,
        remainingFillCcy: remaining.fillCcy,
        completedCutBcy: qty(completedCutCf / 27),
        completedFillCcy: qty(completedFillCf / 27),
        cellsAtGrade: atGrade,
        cellsOverExcavated: overCells,
        overExcavationBcy,
        toleranceFt,
        derivation: `design work ${qty(totalWorkCf / 27)} CY; remaining ${qty(remainingWorkCf / 27)} CY; ` +
            `${factor(percentComplete * 100)}% complete; ${atGrade} cells at grade within ±${toleranceFt} ft` +
            (overCells ? `; ${overCells} cells over-excavated (${overExcavationBcy} BCY of rework)` : ''),
        warnings,
    };
}
/** Build a grid from a flat elevation array, for import from a survey file. */
export function gridFrom(elevations, rows, cols, cellSize, name) {
    return { elevations, rows, cols, cellSize, ...(name ? { name } : {}) };
}
