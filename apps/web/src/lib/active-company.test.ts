/**
 * Choosing between the companies somebody belongs to.
 *
 * The rule this covers is the one that used to be "answer null and let every
 * screen quietly disable itself". A person in two companies must land in one of
 * them, and it must be the same one every morning.
 */
import { describe, expect, it } from 'vitest';
import { chooseCompany } from './active-company';

describe('choosing the active company', () => {
  it('has no answer for somebody who belongs to nothing', () => {
    expect(chooseCompany([], null)).toBe(null);
    expect(chooseCompany([], 'c-9')).toBe(null);
  });

  it('takes the only company without asking', () => {
    expect(chooseCompany(['c-1'], null)).toBe('c-1');
  });

  it('keeps the remembered choice when it is still one of theirs', () => {
    expect(chooseCompany(['c-1', 'c-2'], 'c-2')).toBe('c-2');
  });

  it('falls back to the first when the remembered one is no longer theirs', () => {
    // Somebody removed from a company should land somewhere, not nowhere —
    // which is what returning null did.
    expect(chooseCompany(['c-1', 'c-2'], 'c-9')).toBe('c-1');
  });

  it('falls back to the first when nothing has been remembered', () => {
    expect(chooseCompany(['c-1', 'c-2'], null)).toBe('c-1');
  });

  it('never invents a company that was not offered', () => {
    const available = ['c-1', 'c-2'];
    for (const remembered of [null, 'c-1', 'c-2', 'c-3', '']) {
      const chosen = chooseCompany(available, remembered);
      expect(available).toContain(chosen);
    }
  });
});
