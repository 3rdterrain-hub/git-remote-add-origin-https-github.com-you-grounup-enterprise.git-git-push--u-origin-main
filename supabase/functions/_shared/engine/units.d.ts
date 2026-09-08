/**
 * Units of measure and earthwork volume-state conversion.
 *
 * The engine refuses to add a BCY to a CCY. Section 11 of the Master AI
 * specification is explicit: bank, loose and compacted cubic yards are three
 * different physical states of the same soil and must never be mixed without
 * an explicit, recorded conversion.
 */
/**
 * Units the catalog and estimate lines are allowed to use.
 *
 * The same values as `app.unit_code`, in the same order, and a governance test
 * holds them to it. A unit the database accepts and this list does not know is
 * a unit no dropdown offers; a unit here and not in the enum is a dropdown
 * entry that fails on save.
 *
 * BF, SQ and KW arrived with a real materials export: lumber quoted in board
 * feet, shingles in squares, a solar allowance in kilowatts. The importer
 * refused all three kinds, correctly, and the fix was the enum rather than the
 * spreadsheet.
 */
export declare const UNITS: readonly ["LS", "EA", "LF", "SF", "SY", "CY", "TON", "HR", "DAY", "ACRE", "GAL", "LB", "MO", "WK", "BF", "SQ", "KW"];
export type Unit = (typeof UNITS)[number];
export declare function isUnit(value: string): value is Unit;
/** Dimension family a unit belongs to. Conversions only happen inside a family. */
export type Dimension = 'lumpsum' | 'count' | 'length' | 'area' | 'volume' | 'mass' | 'time' | 'liquid'
/**
 * A board foot is 144 cubic inches of *nominal* lumber, and a two-by-four is
 * an inch and a half by three and a half. So it is a volume that does not
 * convert to one, and it gets a family of its own rather than a factor into
 * CY that would be arithmetically defensible and wrong at the lumberyard.
 */
 | 'lumber'
/** Kilowatts: solar arrays, generators, temporary power. */
 | 'power';
export declare const UNIT_DIMENSION: Readonly<Record<Unit, Dimension>>;
/**
 * Convert between two units in the same dimension.
 *
 * Cross-dimension conversion (CY -> TON, SF -> CY) is deliberately not
 * available here because it always requires a physical property the caller
 * must supply and the estimate must record — density for mass, thickness for
 * volume. Use `tonsFromVolume` / `volumeFromArea` in `quantity.ts` instead so
 * the assumption is captured on the line.
 */
export declare function convertUnit(value: number, from: Unit, to: Unit): number;
/**
 * BCY — bank cubic yard: soil in place, undisturbed, as measured by cut.
 * LCY — loose cubic yard: soil after excavation, as it rides in a truck.
 * CCY — compacted cubic yard: soil placed and compacted in fill.
 */
export type VolumeState = 'BCY' | 'LCY' | 'CCY';
export declare const VOLUME_STATES: readonly VolumeState[];
export interface SoilFactors {
    /**
     * Swell: fractional volume increase from bank to loose. 0.25 means
     * 1 BCY becomes 1.25 LCY. Typical common earth ~0.25, sand ~0.12, rock ~0.50.
     */
    swellPercent: number;
    /**
     * Shrink: fractional volume decrease from bank to compacted. 0.10 means
     * 1 BCY becomes 0.90 CCY. Also expressible as a load factor by the caller.
     */
    shrinkPercent: number;
}
export declare const DEFAULT_SOIL_FACTORS: Readonly<SoilFactors>;
/** Convert any volume state to bank cubic yards, the pivot state. */
export declare function toBank(value: number, from: VolumeState, f: SoilFactors): number;
/** Convert bank cubic yards to any volume state. */
export declare function fromBank(bcy: number, to: VolumeState, f: SoilFactors): number;
export interface VolumeConversion {
    input: number;
    from: VolumeState;
    to: VolumeState;
    bankEquivalent: number;
    output: number;
    swellPercent: number;
    shrinkPercent: number;
    /** Human-readable derivation, carried onto the estimate line for audit. */
    basis: string;
}
/**
 * Convert between volume states, returning the full derivation rather than a
 * bare number so the estimate can show its work (Master AI spec Section 23:
 * "Never hide calculations").
 */
export declare function convertVolume(value: number, from: VolumeState, to: VolumeState, factors?: SoilFactors): VolumeConversion;
/** CY from a linear run: LF x width(ft) x depth(ft) / 27. */
export declare function cubicYardsFromLinear(lengthFt: number, widthFt: number, depthFt: number): number;
/** CY from an area: SF x thickness(ft) / 27. */
export declare function cubicYardsFromArea(areaSf: number, thicknessFt: number): number;
/** Tons from CY at a stated density in lb/CY. Density is a recorded assumption. */
export declare function tonsFromVolume(cy: number, densityLbPerCy: number): number;
/** Inches to feet, the most common source of thickness input error. */
export declare function inchesToFeet(inches: number): number;
/** Asphalt tonnage: SY x thickness(in) x density(lb/SY/in) / 2000. */
export declare function asphaltTons(areaSy: number, thicknessIn: number, lbPerSyPerInch?: number): number;
