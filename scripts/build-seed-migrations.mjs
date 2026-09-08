/**
 * Ship the catalog as migrations.
 *
 * The library data has always been applied by `npm run seed:load`, which
 * connects with the Postgres driver and therefore needs the project's database
 * password. `supabase db push` needs no such thing — the CLI holds its own
 * credentials — which is why pushing schema has worked every time and loading
 * the catalog has not worked once.
 *
 * So the catalog goes through the door that already opens. Each seed file is
 * copied verbatim into a migration, and `db push` applies it like any other.
 *
 * **Generated, never edited.** The seed files stay the single source: the test
 * harness reads them, `seed.test.ts` proves they apply twice without changing
 * the catalog's size, and a governance test holds these copies byte-identical
 * to them. Editing a copy would put the two out of step in the one direction
 * nobody would notice — production drifting from what the tests ran against.
 *
 * The `.example.` file is deliberately not copied. It carries placeholder
 * Stripe price ids for somebody to fill in, and applying it to a real project
 * would write nonsense into `plan_prices`.
 *
 *   npm run seed:migrations
 */
import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED_DIR = join(ROOT, 'supabase', 'seed');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

/** Where the generated ones start, past every hand-written migration. */
export const CATALOG_PREFIX = '_catalog_';
const FIRST = 900;

const header = (source) => `-- =============================================================================
-- GENERATED — do not edit.
--
-- A verbatim copy of \`supabase/seed/${source}\`, so the catalog can be applied
-- by \`supabase db push\` rather than by a direct database connection. The seed
-- file is the source; this is the delivery. \`npm run seed:migrations\`
-- regenerates it and a governance test fails if the two ever differ.
--
-- Everything below is idempotent — \`on conflict do nothing\` throughout — so
-- applying it twice changes nothing, which is what makes it safe as a
-- migration.
-- =============================================================================

`;

const seeds = (await readdir(SEED_DIR))
  .filter((f) => f.endsWith('.sql') && !f.includes('.example.'))
  .sort();

/* Clear out any generated file that no longer has a seed behind it. */
for (const f of await readdir(MIGRATIONS)) {
  if (f.includes(CATALOG_PREFIX)) await unlink(join(MIGRATIONS, f));
}

let n = FIRST;
const written = [];
for (const seed of seeds) {
  const body = await readFile(join(SEED_DIR, seed), 'utf8');
  const name = `${String(n).padStart(4, '0')}${CATALOG_PREFIX}${seed}`;
  await writeFile(join(MIGRATIONS, name), header(seed) + body);
  written.push([name, body.length]);
  n += 1;
}

console.log(`${written.length} catalog migrations written:`);
for (const [name, size] of written) {
  console.log(`  ${name.padEnd(46)} ${(size / 1024).toFixed(1)} KB`);
}
console.log('\nApply them with:  npx supabase db push');
