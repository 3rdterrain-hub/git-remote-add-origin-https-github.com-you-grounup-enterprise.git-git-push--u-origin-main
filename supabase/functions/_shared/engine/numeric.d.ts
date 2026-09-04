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
export declare const SCALE: {
    /** Money the user sees: costs, prices, totals. */
    readonly MONEY: 2;
    /** Unit costs / unit prices, which are multiplied back up by quantity. */
    readonly UNIT_RATE: 4;
    /** Quantities (CY, LF, TON...). */
    readonly QUANTITY: 4;
    /** Hours (labor, equipment, cycle). */
    readonly HOURS: 4;
    /** Dimensionless factors (production factors, utilization, percentages). */
    readonly FACTOR: 6;
};
/**
 * Half-away-from-zero rounding to `decimals` places, corrected for binary
 * representation error.
 *
 * The correction re-reads the scaled value at 12 significant decimals before
 * rounding, which recovers the decimal the author actually wrote
 * (1.005 * 100 === 100.49999999999999 -> 100.5 -> 101).
 */
export declare function roundTo(value: number, decimals: number): number;
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
export declare const money: (v: number) => number;
/** Round to unit-rate precision. */
export declare const unitRate: (v: number) => number;
/** Round to quantity precision. */
export declare const qty: (v: number) => number;
/** Round to hour precision. */
export declare const hours: (v: number) => number;
/** Round to factor precision. */
export declare const factor: (v: number) => number;
/** Sum a list of money values, rounding once at the end. */
export declare function sumMoney(values: readonly number[]): number;
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
export declare function safeDivide(numerator: number, denominator: number): number;
/** Assert a value is a finite number, with a field name for the error. */
export declare function assertFinite(value: number, field: string): number;
/** Assert a value is finite and >= 0. */
export declare function assertNonNegative(value: number, field: string): number;
/** Assert a value is finite and > 0. */
export declare function assertPositive(value: number, field: string): number;
/** Clamp into an inclusive range. */
export declare function clamp(value: number, min: number, max: number): number;
