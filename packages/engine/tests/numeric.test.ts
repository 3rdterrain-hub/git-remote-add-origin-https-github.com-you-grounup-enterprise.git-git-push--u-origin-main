import { describe, expect, it } from 'vitest';
import {
  assertFinite, assertNonNegative, assertPositive, clamp, factor, money,
  qty, roundTo, safeDivide, sumMoney, unitRate, hours, SCALE,
} from '../src/numeric.js';

describe('roundTo — half away from zero, corrected for binary error', () => {
  it('rounds the classic float-error cases the way an estimator writes them', () => {
    // 1.005 * 100 === 100.49999999999999 in IEEE-754. Math.round gives 1.00.
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(2.675, 2)).toBe(2.68);
    expect(roundTo(1.045, 2)).toBe(1.05);
    expect(roundTo(8.165, 2)).toBe(8.17);
  });

  it('rounds negatives away from zero, not toward +Infinity', () => {
    // Math.round(-0.5) === -0, which silently loses a cent on credits.
    expect(roundTo(-0.5, 0)).toBe(-1);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(roundTo(-2.5, 0)).toBe(-3);
  });

  it('never returns -0', () => {
    expect(Object.is(roundTo(-0.004, 2), 0)).toBe(true);
    expect(Object.is(roundTo(-0, 2), 0)).toBe(true);
  });

  it('is idempotent', () => {
    const once = roundTo(123.456789, 2);
    expect(roundTo(once, 2)).toBe(once);
  });

  it('handles zero and exact values without drift', () => {
    expect(roundTo(0, 2)).toBe(0);
    expect(roundTo(100, 2)).toBe(100);
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
  });

  it('rejects non-finite input rather than producing NaN money', () => {
    expect(() => roundTo(NaN, 2)).toThrow(RangeError);
    expect(() => roundTo(Infinity, 2)).toThrow(RangeError);
    expect(() => roundTo(-Infinity, 2)).toThrow(RangeError);
  });
});

describe('scale helpers', () => {
  it('applies the documented scales', () => {
    expect(SCALE.MONEY).toBe(2);
    expect(money(1.2345)).toBe(1.23);
    expect(unitRate(1.23456)).toBe(1.2346);
    expect(qty(1.23456)).toBe(1.2346);
    expect(hours(1.23456)).toBe(1.2346);
    expect(factor(1.2345678)).toBe(1.234568);
  });

  it('sums money with a single rounding at the end', () => {
    // Rounding each term first would give 0.34; rounding once gives 0.33.
    expect(sumMoney([0.111, 0.111, 0.111])).toBe(0.33);
    expect(sumMoney([])).toBe(0);
    expect(sumMoney([1.005, 1.005])).toBe(2.01);
  });
});

describe('safeDivide', () => {
  it('returns 0 for a zero denominator instead of Infinity', () => {
    expect(safeDivide(100, 0)).toBe(0);
    expect(safeDivide(0, 0)).toBe(0);
  });
  it('divides normally otherwise', () => {
    expect(safeDivide(100, 4)).toBe(25);
    expect(safeDivide(-100, 4)).toBe(-25);
  });
});

describe('input guards', () => {
  it('assertFinite rejects NaN, Infinity and non-numbers', () => {
    expect(() => assertFinite(NaN, 'x')).toThrow(/x must be a finite number/);
    expect(() => assertFinite(Infinity, 'x')).toThrow(RangeError);
    expect(assertFinite(5, 'x')).toBe(5);
  });
  it('assertNonNegative rejects negatives but allows zero', () => {
    expect(() => assertNonNegative(-0.01, 'qty')).toThrow(/qty must be >= 0/);
    expect(assertNonNegative(0, 'qty')).toBe(0);
  });
  it('assertPositive rejects zero', () => {
    expect(() => assertPositive(0, 'rate')).toThrow(/rate must be > 0/);
    expect(assertPositive(0.0001, 'rate')).toBe(0.0001);
  });
});

describe('clamp', () => {
  it('bounds inclusively', () => {
    expect(clamp(150, 0, 100)).toBe(100);
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(50, 0, 100)).toBe(50);
  });
});

describe('money carries a guard digit', () => {
  it('recovers a product that lands just below the cent boundary', () => {
    // 12,150 x 7.25% is exactly 880.875, but the float product is
    // 880.8749999999999. Rounding that straight to cents gives 880.87 — a cent
    // short of the arithmetic anyone checking the estimate by hand will do.
    expect(12150 * 0.0725).toBe(880.8749999999999);
    expect(money(12150 * 0.0725)).toBe(880.88);
  });

  it('still rounds a value that is genuinely below the boundary down', () => {
    expect(money(880.8749)).toBe(880.87);
    expect(money(0.014)).toBe(0.01);
  });

  it('keeps half-away-from-zero on exact halves, including negatives', () => {
    expect(money(880.875)).toBe(880.88);
    expect(money(-880.875)).toBe(-880.88);
    expect(money(-0.005)).toBe(-0.01);
  });

  it('does not shift a value away from the cent it already is', () => {
    for (const v of [0, 1, 12.34, -12.34, 1000000.01, 0.1 + 0.2]) {
      expect(money(money(v))).toBe(money(v));
    }
  });
});
