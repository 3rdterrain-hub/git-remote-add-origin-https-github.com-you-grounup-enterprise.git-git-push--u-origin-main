/**
 * Deterministic numeric primitives.
 *
 * Every authoritative GrounUp calculation routes through this module so that
 * two runs of the same estimate on different machines produce byte-identical
 * money. IEEE-754 doubles are used for speed, but every value that a human
 * will ever see is snapped to a defined scale with half-away-from-zero
 * rounding, which is the convention construction estimators and accountants
 * expect (0.005 -> 0.01, -0.005 -> -0.01).
 *
 * `Math.round` is NOT used directly: it is half-up (toward +Infinity), so it
 * rounds -0.5 to -0 rather than -1, and it inherits binary-representation
 * error (Math.round(1.005 * 100) === 100, not 101).
 */

/** Scales used across the engine. Rates keep more precision than totals. */
export const SCALE = {
  /** Money the user sees: costs, prices, totals. */
  MONEY: 2,
  /** Unit costs / unit prices, which are multiplied back up by quantity. */
  UNIT_RATE: 4,
  /** Quantities (CY, LF, TON...). */
  QUANTITY: 4,
  /** Hours (labor, equipment, cycle). */
  HOURS: 4,
  /** Dimensionless factors (production factors, utilization, percentages). */
  FACTOR: 6,
} as const;

const EPSILON_SCALE = 12;

/**
 * Half-away-from-zero rounding to `decimals` places, corrected for binary
 * representation error.
 *
 * The correction re-reads the scaled value at 12 significant decimals before
 * rounding, which recovers the decimal the author actually wrote
 * (1.005 * 100 === 100.49999999999999 -> 100.5 -> 101).
 */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`roundTo received a non-finite value: ${value}`);
  }
  if (value === 0) return 0;
  const factor = 10 ** decimals;
  const scaled = Number((value * factor).toFixed(EPSILON_SCALE));
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  // `+ 0` normalizes -0 to 0 so snapshots and equality checks stay stable.
  return rounded / factor + 0;
}

/**
 * Round to cents, through a guard digit.
 *
 * Money is almost always the product of two exact decimals — 12,150 x 7.25% —
 * and the product frequently lands a fraction below the true value:
 * `12150 * 0.0725` is `880.8749999999999`, not `880.875`. Rounding that
 * straight to cents gives 880.87, a cent short of the arithmetic anyone
 * checking the estimate by hand will do.
 *
 * Rounding first at six decimals recovers the intended decimal, then the cent
 * rounding is applied to it. The double rounding can only matter for values
 * within a millionth of a cent boundary, where the binary value is already
 * ambiguous — and there the decimal the author wrote is the better answer.
 */
export const money = (v: number): number => roundTo(roundTo(v, SCALE.MONEY + 4), SCALE.MONEY);
/** Round to unit-rate precision. */
export const unitRate = (v: number): number => roundTo(v, SCALE.UNIT_RATE);
/** Round to quantity precision. */
export const qty = (v: number): number => roundTo(v, SCALE.QUANTITY);
/** Round to hour precision. */
export const hours = (v: number): number => roundTo(v, SCALE.HOURS);
/** Round to factor precision. */
export const factor = (v: number): number => roundTo(v, SCALE.FACTOR);

/** Sum a list of money values, rounding once at the end. */
export function sumMoney(values: readonly number[]): number {
  return money(values.reduce((a, b) => a + b, 0));
}

/**
 * Divide, returning 0 when the denominator is zero.
 *
 * Estimating has many legitimate "not applicable yet" divisions (a line with
 * no quantity has no unit cost). Throwing there would make partially-built
 * estimates unopenable, so the engine returns 0 and the caller reports the
 * line as incomplete. Denominators that are *invalid* rather than absent
 * (negative production rate, negative capacity) are rejected at the input
 * guard instead.
 */
export function safeDivide(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/** Assert a value is a finite number, with a field name for the error. */
export function assertFinite(value: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${field} must be a finite number, received ${String(value)}`);
  }
  return value;
}

/** Assert a value is finite and >= 0. */
export function assertNonNegative(value: number, field: string): number {
  assertFinite(value, field);
  if (value < 0) {
    throw new RangeError(`${field} must be >= 0, received ${value}`);
  }
  return value;
}

/** Assert a value is finite and > 0. */
export function assertPositive(value: number, field: string): number {
  assertFinite(value, field);
  if (value <= 0) {
    throw new RangeError(`${field} must be > 0, received ${value}`);
  }
  return value;
}

/** Clamp into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
