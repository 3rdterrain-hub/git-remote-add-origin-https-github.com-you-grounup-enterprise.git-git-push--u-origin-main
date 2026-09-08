/**
 * The catalog ships twice, and the two copies must not drift.
 *
 * The library data has always been applied by `npm run seed:load`, which
 * connects with the Postgres driver and needs the project's database password.
 * `supabase db push` needs no such thing, which is why pushing schema worked
 * every time and loading the catalog never worked once. So the catalog is also
 * generated into migrations, and goes through the door that already opens.
 *
 * Two copies of two and a half megabytes is a drift problem waiting to happen,
 * and the direction it would drift is the worst one: production quietly running
 * something the tests never saw. So the seed file stays the source, the
 * migration is generated from it, and this holds them byte-identical.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SEED_DIR = join(ROOT, 'supabase/seed');
const MIGRATIONS = join(ROOT, 'supabase/migrations');

const seeds = readdirSync(SEED_DIR).filter((f) => f.endsWith('.sql')).sort();
const generated = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql') && f.includes('_catalog_')).sort();

/** Everything after the generated header, which is the copied part. */
function body(file: string): string {
  const text = readFileSync(join(MIGRATIONS, file), 'utf8');
  const end = text.indexOf('=====\n\n');
  return end === -1 ? text : text.slice(end + '=====\n\n'.length);
}

describe('the catalog migrations are copies, not a second source', () => {
  it('has one for every seed file worth shipping', () => {
    const shippable = seeds.filter((f) => !f.includes('.example.'));
    expect(generated.length).toBe(shippable.length);
    for (const seed of shippable) {
      expect(generated.some((g) => g.endsWith(seed)), `no migration for ${seed}`).toBe(true);
    }
  });

  it('copies each one byte for byte', () => {
    const drifted = generated.filter((g) => {
      const seed = g.slice(g.indexOf('_catalog_') + '_catalog_'.length);
      return body(g) !== readFileSync(join(SEED_DIR, seed), 'utf8');
    });
    expect(drifted).toEqual([]);
  });

  it('says on its face that it is generated', () => {
    for (const g of generated) {
      const head = readFileSync(join(MIGRATIONS, g), 'utf8').slice(0, 400);
      expect(head, g).toMatch(/GENERATED — do not edit/);
      expect(head, g).toMatch(/npm run seed:migrations/);
    }
  });

  it('never ships the example price wiring', () => {
    /*
     * `0003_plan_prices.example.sql` carries placeholder Stripe price ids for
     * somebody to fill in. Applied to a real project it would write nonsense
     * into `plan_prices`, which is what a subscription is charged against.
     */
    expect(generated.filter((g) => g.includes('example'))).toEqual([]);
    expect(seeds.some((s) => s.includes('.example.'))).toBe(true);
  });

  it('sorts after every hand-written migration', () => {
    const handwritten = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql') && !f.includes('_catalog_')).sort();
    const last = handwritten[handwritten.length - 1]!;
    // The catalog references tables and guards every earlier migration builds.
    expect(generated[0]! > last).toBe(true);
  });

  it('is left out of the test harness, and says why', () => {
    /*
     * Every test builds its own PostgreSQL. Loading the catalog into all
     * eighty-five of them would put the suite back at two and a half hours.
     */
    const harness = readFileSync(join(ROOT, 'tests/db/harness.ts'), 'utf8');
    expect(harness).toContain("!f.includes('_catalog_')");
    expect(harness).toMatch(/before the seed scope was split/);
  });
});
