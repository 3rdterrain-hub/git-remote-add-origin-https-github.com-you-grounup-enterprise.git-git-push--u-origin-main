/**
 * The arithmetic an estimator does in their head.
 *
 * A quantity is almost never a number somebody knows — it is 120 by 4 by 8
 * inches, or 42 footings at 1.2 cubic yards, or a takeoff less what is already
 * in place. That arithmetic happens somewhere, and if it does not happen in the
 * cell it happens where nobody can check it.
 *
 * Two properties carry the weight here, and both are about refusing rather than
 * computing. Nothing is executed, so an estimator's text is never a code path.
 * And a expression that cannot be read produces no quantity at all — a
 * calculator that silently dropped the tail of `120 * 4 +` would be worse than
 * no calculator, because the wrong number would look like an answer.
 */
import { describe, expect, it } from 'vitest';
import { evaluateQuantity, looksCalculated } from '../src/arithmetic.js';

const value = (s: string) => {
  const r = evaluateQuantity(s);
  if (!r.ok) throw new Error(`${s} → ${r.error.message}`);
  return r.value;
};
const error = (s: string) => {
  const r = evaluateQuantity(s);
  if (r.ok) throw new Error(`${s} unexpectedly evaluated to ${r.value}`);
  return r.error;
};

describe('the arithmetic an estimator actually types', () => {
  it('reads a plain number', () => {
    expect(value('1800')).toBe(1800);
    expect(value('1800.5')).toBe(1800.5);
    expect(value('  42  ')).toBe(42);
  });

  it('works out a volume the way it is measured on a drawing', () => {
    // 120 ft by 4 ft by 8 inches, in cubic feet.
    expect(value('120 * 4 * 0.667')).toBeCloseTo(320.16, 2);
  });

  it('takes off what is already in place', () => {
    expect(value('3180 - 240')).toBe(2940);
  });

  it('multiplies a count by an each-quantity', () => {
    expect(value('42 * 1.2')).toBeCloseTo(50.4, 4);
  });

  it('respects the order operations are written in', () => {
    expect(value('2 + 3 * 4')).toBe(14);
    expect(value('(2 + 3) * 4')).toBe(20);
    expect(value('100 / 4 / 5')).toBe(5);
    expect(value('2 ^ 3 ^ 2')).toBe(512);   // right associative
  });

  it('takes the multiplication signs a phone keyboard produces', () => {
    expect(value('12 × 4')).toBe(48);
    expect(value('48 ÷ 4')).toBe(12);
  });

  it('takes thousands separators, which is how a takeoff is written down', () => {
    expect(value('3,180 - 240')).toBe(2940);
    expect(value('1,000,000 / 1000')).toBe(1000);
  });

  it('ignores a foot mark, because the line already carries its unit', () => {
    expect(value("120' * 4'")).toBe(480);
  });

  it('rounds to the four decimals the column holds, so what is shown is what is stored', () => {
    expect(value('1 / 3')).toBe(0.3333);
    expect(value('2 / 3')).toBe(0.6667);
  });
});

describe('refusing rather than guessing', () => {
  it('refuses an expression that stops in the middle', () => {
    expect(error('120 * 4 +').message).toMatch(/stops before it is finished/i);
  });

  it('refuses a bracket that was never closed', () => {
    expect(error('(120 * 4').message).toMatch(/never closed/i);
  });

  it('refuses a bracket that was never opened', () => {
    expect(error('120 * 4)').message).toMatch(/never opened/i);
  });

  it('refuses two numbers with nothing between them', () => {
    expect(error('120 4').message).toMatch(/left over at the end/i);
  });

  it('refuses division by zero rather than returning infinity', () => {
    expect(error('120 / 0').message).toMatch(/dividing by zero/i);
    expect(error('120 % 0').message).toMatch(/dividing by zero/i);
  });

  it('refuses a negative quantity, which is not a thing to build', () => {
    expect(error('240 - 300').message).toMatch(/cannot be negative/i);
  });

  it('refuses a number with two decimal points', () => {
    expect(error('1.2.3').message).toMatch(/more than one decimal point/i);
  });

  it('refuses nothing at all', () => {
    expect(error('').message).toMatch(/nothing to work out/i);
    expect(error('   ').message).toMatch(/nothing to work out/i);
  });

  it('says where the problem is, so it can be pointed at', () => {
    expect(error('120 * $ 4').position).toBe(6);
    expect(error('120 * 4)').position).toBe(7);
  });

  it('executes nothing, whatever is typed into it', () => {
    /*
     * The reason this is a parser and not `eval`. Each of these is text an
     * estimator could paste by accident, and every one is refused as text
     * rather than run.
     */
    for (const attack of [
      'process.exit(1)',
      'globalThis.fetch("http://x")',
      '__proto__',
      'constructor.constructor("return 1")()',
      '1;alert(1)',
      'require("fs")',
      '`${1}`',
    ]) {
      const r = evaluateQuantity(attack);
      expect(r.ok).toBe(false);
    }
  });

  it('refuses an expression longer than a quantity calculation should be', () => {
    expect(error('1+'.repeat(150) + '1').message).toMatch(/longer than/i);
  });
});

describe('knowing when to calculate at all', () => {
  it('leaves a plain number alone', () => {
    expect(looksCalculated('1800')).toBe(false);
    expect(looksCalculated('1800.55')).toBe(false);
    expect(looksCalculated('-5')).toBe(false);
  });

  it('spots an expression', () => {
    expect(looksCalculated('120 * 4')).toBe(true);
    expect(looksCalculated('(120)')).toBe(true);
    expect(looksCalculated('3180-240')).toBe(true);
    expect(looksCalculated('12 × 4')).toBe(true);
  });
});
