/**
 * The unit list on the screen is the unit list in the database.
 *
 * `app.unit_code` is the closed set of units this platform can express, and
 * `UNITS` in `@grounup/engine` is what every dropdown, converter and dimension
 * check reads. Nothing held them together, and the cost of that showed up the
 * first time a real
 * materials export arrived: framing lumber quoted in board feet, PT lumber in
 * board feet, architectural shingles in squares and a solar allowance in
 * kilowatts. The importer refused all four, correctly — the platform had no
 * such units — and the conclusion very nearly drawn was that the spreadsheet
 * was wrong. It was not. The enum was short.
 *
 * The two drift in both directions and both are silent. A unit in the enum and
 * missing from `UNITS` is a unit nobody can pick. A unit in `UNITS` and missing
 * from the enum is a dropdown entry that fails on save, at the moment somebody
 * presses it.
 *
 * Read as text rather than imported, because the constant lives in a `.tsx`
 * file next to React components and the enum lives in SQL. Neither needs to be
 * evaluated to be compared.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const ENGINE = join(ROOT, 'packages/engine/src/units.ts');
const UNIT_SELECT = join(ROOT, 'apps/web/src/components/ui/unit-select.tsx');

/**
 * Every value `app.unit_code` has after the last migration runs — the ones the
 * type was created with, plus every one added since. Reading only the `create
 * type` would miss exactly the units this test was written about.
 */
function unitsInTheDatabase(): string[] {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql') && !f.includes('_catalog_')).sort();
  const found: string[] = [];
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');

    const created = /create type app\.unit_code as enum\s*\(([\s\S]*?)\)/.exec(sql);
    if (created) {
      for (const m of created[1]!.matchAll(/'([^']+)'/g)) found.push(m[1]!);
    }
    for (const m of sql.matchAll(
      /alter type app\.unit_code add value(?: if not exists)? '([^']+)'/g)) {
      found.push(m[1]!);
    }
  }
  return found;
}

/** The list the engine offers, in the order it offers it. */
function unitsInTheEngine(): string[] {
  const src = readFileSync(ENGINE, 'utf8');
  const block = /export const UNITS = \[([\s\S]*?)\] as const;/.exec(src);
  expect(block, 'UNITS is no longer declared the way this test reads it').not.toBeNull();
  return [...block![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

/** Every unit the picker can name. A unit with no label renders as a blank. */
function unitsWithALabel(): string[] {
  const src = readFileSync(UNIT_SELECT, 'utf8');
  const block = /export const UNIT_LABEL: Readonly<Record<Unit, string>> = \{([\s\S]*?)\};/
    .exec(src);
  expect(block, 'UNIT_LABEL is no longer declared the way this test reads it').not.toBeNull();
  return [...block![1]!.matchAll(/(\w+):\s*'/g)].map((m) => m[1]!);
}

describe('units', () => {
  it('offers in the engine exactly what the database will accept', () => {
    expect(unitsInTheEngine()).toEqual(unitsInTheDatabase());
  });

  it('has a plain-words label for every one of them', () => {
    expect([...unitsWithALabel()].sort()).toEqual([...unitsInTheEngine()].sort());
  });

  it('has the units a real materials export arrived in', () => {
    // Board foot, roofing square, kilowatt: lumber, roofing and solar.
    expect(unitsInTheDatabase()).toEqual(expect.arrayContaining(['BF', 'SQ', 'KW']));
  });

  it('names each unit once', () => {
    const all = unitsInTheDatabase();
    expect(new Set(all).size).toBe(all.length);
  });

  it('found the enum at all, rather than passing on two empty lists', () => {
    expect(unitsInTheDatabase().length).toBeGreaterThan(10);
  });
});
