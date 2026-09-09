/**
 * A screen shows the company's data, or it says it is a demonstration.
 *
 * Never both. That combination produced the worst defect of its kind in this
 * codebase and produced it twice.
 *
 * The Libraries screen rendered `EQUIPMENT_SPECS` — eight demonstration
 * machines with invented hourly rates — under a heading that said Equipment and
 * a badge that said "Tenant approved", while `loadEquipmentOptions` sat unused
 * in the data layer reading the real library. And the Fleet screen took the
 * same constant, looked up a *live* asset's equipment code in it, and
 * subtracted the asset's ownership cost from whatever came back. A real code
 * never appears in that constant, so the lookup fell through to zero and every
 * machine read as losing money in proportion to what it cost to buy.
 *
 * Neither looked wrong. That is the whole difficulty: the page renders, the
 * numbers are plausible, and they are nobody's.
 *
 * So the rule is mechanical. A screen that calls `useQuery` — that reads the
 * company's own data — may not also import a sample constant. A screen that is
 * wholly a demonstration may, and several legitimately are: the marketing
 * pages, and the screens that fall back to sample data when no database is
 * configured and say so with `DemonstrationNotice`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = join(ROOT, 'apps/web/src');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.isFile() && full.endsWith('.tsx') && !full.endsWith('.test.tsx') ? [full] : [];
  });
}

/**
 * Screens that read live data *and* import a sample constant.
 *
 * The exceptions are named rather than pattern-matched, because every one of
 * them is a judgment somebody has to make again if the file changes.
 */
const ALLOWED = new Map<string, string>([
  [
    'components/layout/app-shell.tsx',
    'The shell falls back to a sample company and user before a session exists, '
      + 'so the frame renders while the real one is still loading.',
  ],
]);

describe('demonstration data', () => {
  const offenders = walk(SRC)
    .map((f) => ({ file: relative(SRC, f), text: readFileSync(f, 'utf8') }))
    .filter(({ text }) => /from '@\/data\/(demo|catalog|fleet|operations|field)'/.test(text))
    .filter(({ text }) => /\buseQuery\(/.test(text))
    .map(({ file }) => file)
    .sort();

  it('finds the screens at all, so an empty pass means nothing', () => {
    // The exceptions themselves prove the detection works.
    expect(offenders.length).toBeGreaterThan(0);
  });

  it('never mixes a sample constant into a screen that reads real data', () => {
    const unexpected = offenders.filter((f) => !ALLOWED.has(f));
    expect(unexpected, 'a screen showing real data may not also show sample data')
      .toEqual([]);
  });

  it('keeps the list of exceptions honest, with a reason on each', () => {
    // An exception for a file that no longer mixes them is a stale license.
    for (const [file, reason] of ALLOWED) {
      expect(offenders, `${file} no longer mixes them — remove its exception`)
        .toContain(file);
      expect(reason.length, `${file} has no reason`).toBeGreaterThan(40);
    }
  });

  /*
   * Checked as an import rather than as a word. Both files name the constant in
   * a comment explaining why they no longer use it, and that comment is worth
   * more than the assertion would be if it forbade the name outright.
   */
  const imports = (file: string, name: string) => {
    const text = readFileSync(join(SRC, file), 'utf8');
    return new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\}`).test(text);
  };

  it('keeps the fleet off the demonstration catalog, which is where this started', () => {
    expect(imports('pages/app/fleet.tsx', 'EQUIPMENT_SPECS')).toBe(false);
  });

  it('keeps the equipment library off it too', () => {
    expect(imports('pages/app/libraries.tsx', 'EQUIPMENT_SPECS')).toBe(false);
  });
});
