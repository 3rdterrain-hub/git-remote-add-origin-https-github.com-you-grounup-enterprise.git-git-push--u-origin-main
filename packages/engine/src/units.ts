/**
 * Units of measure and earthwork volume-state conversion.
 *
 * The engine refuses to add a BCY to a CCY. Section 11 of the Master AI
 * specification is explicit: bank, loose and compacted cubic yards are three
 * different physical states of the same soil and must never be mixed without
 * an explicit, recorded conversion.
 */

import { assertNonNegative, assertPositive, qty, factor } from './numeric.js';

/** Units the catalog and estimate lines are allowed to use. */
export const UNITS = [
  'LS', 'EA', 'LF', 'SF', 'SY', 'CY', 'TON', 'HR', 'DAY', 'ACRE', 'GAL', 'LB', 'MO', 'WK',
] as const;
export type Unit = (typeof UNITS)[number];

export function isUnit(value: string): value is Unit {
  return (UNITS as readonly string[]).includes(value);
}

/** Dimension family a unit belongs to. Conversions only happen inside a family. */
export type Dimension = 'lumpsum' | 'count' | 'length' | 'area' | 'volume' | 'mass' | 'time' | 'liquid';

export const UNIT_DIMENSION: Readonly<Record<Unit, Dimension>> = {
  LS: 'lumpsum',
  EA: 'count',
  LF: 'length',
  SF: 'area',
  SY: 'area',
  ACRE: 'area',
  CY: 'volume',
  TON: 'mass',
  LB: 'mass',
  HR: 'time',
  DAY: 'time',
  WK: 'time',
  MO: 'time',
  GAL: 'liquid',
};

/** Factor to the family's base unit (SF for area, CY for volume, LB for mass, HR for time). */
const TO_BASE: Readonly<Record<Unit, number>> = {
  LS: 1,
  EA: 1,
  LF: 1,
  SF: 1,
  SY: 9,          // 1 SY = 9 SF
  ACRE: 43_560,   // 1 acre = 43,560 SF
  CY: 1,
  TON: 2000,      // 1 ton = 2,000 lb
  LB: 1,
  HR: 1,
  DAY: 8,         // nominal shift; schedule math uses the estimate's own shift hours
  WK: 40,
  MO: 173.33,
  GAL: 1,
};

/**
 * Convert between two units in the same dimension.
 *
 * Cross-dimension conversion (CY -> TON, SF -> CY) is deliberately not
 * available here because it always requires a physical property the caller
 * must supply and the estimate must record — density for mass, thickness for
 * volume. Use `tonsFromVolume` / `volumeFromArea` in `quantity.ts` instead so
 * the assumption is captured on the line.
 */
export function convertUnit(value: number, from: Unit, to: Unit): number {
  assertNonNegative(value, 'value');
  if (from === to) return qty(value);
  const fromDim = UNIT_DIMENSION[from];
  const toDim = UNIT_DIMENSION[to];
  if (fromDim !== toDim) {
    throw new RangeError(
      `Cannot convert ${from} (${fromDim}) to ${to} (${toDim}) without a physical property. ` +
        `Use an explicit conversion that records its assumption.`,
    );
  }
  return qty((value * TO_BASE[from]) / TO_BASE[to]);
}

// ---------------------------------------------------------------------------
// Earthwork volume states (Master AI spec Section 11)
// ---------------------------------------------------------------------------

/**
 * BCY — bank cubic yard: soil in place, undisturbed, as measured by cut.
 * LCY — loose cubic yard: soil after excavation, as it rides in a truck.
 * CCY — compacted cubic yard: soil placed and compacted in fill.
 */
export type VolumeState = 'BCY' | 'LCY' | 'CCY';
export const VOLUME_STATES: readonly VolumeState[] = ['BCY', 'LCY', 'CCY'];

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

export const DEFAULT_SOIL_FACTORS: Readonly<SoilFactors> = Object.freeze({
  swellPercent: 0.25,
  shrinkPercent: 0.1,
});

function validateSoilFactors(f: SoilFactors): void {
  assertNonNegative(f.swellPercent, 'swellPercent');
  assertNonNegative(f.shrinkPercent, 'shrinkPercent');
  if (f.shrinkPercent >= 1) {
    throw new RangeError(`shrinkPercent must be < 1 (100% shrink means the soil vanishes), received ${f.shrinkPercent}`);
  }
}

/** Convert any volume state to bank cubic yards, the pivot state. */
export function toBank(value: number, from: VolumeState, f: SoilFactors): number {
  assertNonNegative(value, 'value');
  validateSoilFactors(f);
  switch (from) {
    case 'BCY':
      return qty(value);
    case 'LCY':
      return qty(value / (1 + f.swellPercent));
    case 'CCY':
      return qty(value / (1 - f.shrinkPercent));
  }
}

/** Convert bank cubic yards to any volume state. */
export function fromBank(bcy: number, to: VolumeState, f: SoilFactors): number {
  assertNonNegative(bcy, 'bcy');
  validateSoilFactors(f);
  switch (to) {
    case 'BCY':
      return qty(bcy);
    case 'LCY':
      return qty(bcy * (1 + f.swellPercent));
    case 'CCY':
      return qty(bcy * (1 - f.shrinkPercent));
  }
}

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
export function convertVolume(
  value: number,
  from: VolumeState,
  to: VolumeState,
  factors: SoilFactors = DEFAULT_SOIL_FACTORS,
): VolumeConversion {
  const bank = toBank(value, from, factors);
  const output = fromBank(bank, to, factors);
  const parts: string[] = [];
  if (from !== 'BCY') {
    parts.push(
      from === 'LCY'
        ? `${value} LCY / (1 + ${factor(factors.swellPercent)} swell) = ${bank} BCY`
        : `${value} CCY / (1 - ${factor(factors.shrinkPercent)} shrink) = ${bank} BCY`,
    );
  }
  if (to !== 'BCY') {
    parts.push(
      to === 'LCY'
        ? `${bank} BCY x (1 + ${factor(factors.swellPercent)} swell) = ${output} LCY`
        : `${bank} BCY x (1 - ${factor(factors.shrinkPercent)} shrink) = ${output} CCY`,
    );
  }
  if (parts.length === 0) parts.push(`${value} ${from} (no state change)`);
  return {
    input: qty(value),
    from,
    to,
    bankEquivalent: bank,
    output,
    swellPercent: factor(factors.swellPercent),
    shrinkPercent: factor(factors.shrinkPercent),
    basis: parts.join('; '),
  };
}

/** CY from a linear run: LF x width(ft) x depth(ft) / 27. */
export function cubicYardsFromLinear(lengthFt: number, widthFt: number, depthFt: number): number {
  assertNonNegative(lengthFt, 'lengthFt');
  assertNonNegative(widthFt, 'widthFt');
  assertNonNegative(depthFt, 'depthFt');
  return qty((lengthFt * widthFt * depthFt) / 27);
}

/** CY from an area: SF x thickness(ft) / 27. */
export function cubicYardsFromArea(areaSf: number, thicknessFt: number): number {
  assertNonNegative(areaSf, 'areaSf');
  assertNonNegative(thicknessFt, 'thicknessFt');
  return qty((areaSf * thicknessFt) / 27);
}

/** Tons from CY at a stated density in lb/CY. Density is a recorded assumption. */
export function tonsFromVolume(cy: number, densityLbPerCy: number): number {
  assertNonNegative(cy, 'cy');
  assertPositive(densityLbPerCy, 'densityLbPerCy');
  return qty((cy * densityLbPerCy) / 2000);
}

/** Inches to feet, the most common source of thickness input error. */
export function inchesToFeet(inches: number): number {
  assertNonNegative(inches, 'inches');
  return qty(inches / 12);
}

/** Asphalt tonnage: SY x thickness(in) x density(lb/SY/in) / 2000. */
export function asphaltTons(areaSy: number, thicknessIn: number, lbPerSyPerInch = 110): number {
  assertNonNegative(areaSy, 'areaSy');
  assertNonNegative(thicknessIn, 'thicknessIn');
  assertPositive(lbPerSyPerInch, 'lbPerSyPerInch');
  return qty((areaSy * thicknessIn * lbPerSyPerInch) / 2000);
}
