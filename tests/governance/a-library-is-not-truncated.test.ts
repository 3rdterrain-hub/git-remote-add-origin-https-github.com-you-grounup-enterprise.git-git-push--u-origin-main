/**
 * A library screen shows what the library holds.
 *
 * Every reader in `lib/data/library.ts` once carried a hand-picked row ceiling.
 * The shipped catalog then grew past three of them, and the Master Libraries
 * screen hid 820 services, 4,532 tasks and 200 machines — with nothing on
 * screen to say so, because the tile above each list counted rows in the
 * database while the list beneath counted what had been fetched. The owner
 * found it by looking: "i dont see all the services in the library."
 *
 * The fix was to stop choosing a number. This test keeps it that way: a ceiling
 * is invisible when it is wrong, so the guard has to be the build's rather than
 * a reader's judgment.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const LIBRARY = join(ROOT, 'apps/web/src/lib/data/library.ts');

describe('the library readers', () => {
  const source = readFileSync(LIBRARY, 'utf8');

  it('bound no list with a row limit', () => {
    /*
     * `.limit()` is legitimate elsewhere — "the last 50 audit entries" is a
     * deliberate window, and says so. It is never right for a library list,
     * where the number of rows is the library's business and not the reader's.
     */
    const offenders = source
      .split('\n')
      .map((line, i) => ({ line: line.trim(), at: i + 1 }))
      .filter(({ line }) => /^\.limit\(\d+\)/.test(line));

    expect(offenders.map((o) => `library.ts:${o.at} ${o.line}`)).toEqual([]);
  });

  it('reads every page instead', () => {
    /* Whatever replaces a ceiling has to actually page, or this test passes
       while the screen shows one page and calls it the library. */
    expect(source).toContain('everyRow');
    expect(source).toMatch(/\.range\(from, from \+ PAGE_SIZE - 1\)/);
    expect(source).toMatch(/if \(page\.length < PAGE_SIZE\) return all;/);
  });

  it('pages every reader, not just the three that had overflowed', () => {
    const readers = (source.match(/export const load\w+: Query</g) ?? []).length;
    const paged = (source.match(/everyRow\(\(\) => client/g) ?? []).length;
    expect(readers).toBeGreaterThan(0);
    /* Not every export is a list — some read a single row — so this is a floor,
       set at the ten that were converted rather than at `readers`. */
    expect(paged).toBeGreaterThanOrEqual(10);
  });
});
