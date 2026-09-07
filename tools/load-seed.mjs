/**
 * Load the seed catalog into a remote database.
 *
 * `psql` is the obvious way and it is not a reasonable requirement. It is not
 * installed on a Mac by default, it arrives through Homebrew as part of a
 * package most people do not otherwise want, and a contractor setting up their
 * own instance should not have to install PostgreSQL locally to put a service
 * catalog into a database that is already running.
 *
 * So this does what `psql -f` would do, over the same connection string, using
 * the Postgres driver PGlite already brings for the test harness. No new
 * dependency, no binary to install.
 *
 * Every seed file is idempotent — `on conflict do nothing` throughout, and a
 * test proves the whole catalog can be applied twice without changing size —
 * so running this again is safe and is the normal way to pick up new trades.
 *
 * Usage:
 *   DATABASE_URL="postgresql://…" npm run seed:load
 *
 * The connection string is on the Supabase dashboard under
 * Project Settings → Database → Connection string → URI. Use the pooler on
 * port 6543 or the direct connection on 5432; both work.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEED_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'seed');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'Set DATABASE_URL first.\n\n'
    + '  Supabase dashboard → Project Settings → Database → Connection string → URI\n\n'
    + '  DATABASE_URL="postgresql://…" npm run seed:load\n');
  process.exit(1);
}

/*
 * `pg` rather than the Supabase client: this is a pile of SQL statements, not a
 * set of REST calls, and PostgREST has no way to run one.
 */
let Client;
try {
  ({ Client } = await import('pg'));
} catch {
  console.error(
    'The `pg` driver is not installed. Install it once:\n\n  npm i -D pg\n');
  process.exit(1);
}

const files = (await readdir(SEED_DIR))
  .filter((f) => f.endsWith('.sql') && !f.includes('.example.'))
  .sort();

const client = new Client({
  connectionString: url,
  // Supabase terminates TLS with its own chain; this is the documented setting.
  ssl: { rejectUnauthorized: false },
  // A 23,000-line catalog takes longer than the default statement timeout.
  statement_timeout: 10 * 60 * 1000,
});

await client.connect();
console.log(`Connected. ${files.length} seed file${files.length === 1 ? '' : 's'} to apply.\n`);

let applied = 0;
for (const file of files) {
  const sql = await readFile(join(SEED_DIR, file), 'utf8');
  process.stdout.write(`  ${file} … `);
  const started = Date.now();
  try {
    await client.query(sql);
    console.log(`ok (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    applied += 1;
  } catch (err) {
    console.log('failed');
    console.error(`\n${file}: ${err.message}\n`);
    await client.end();
    process.exit(1);
  }
}

/*
 * Report what is actually there rather than that the statements ran. A seed
 * that inserted nothing because every row conflicted looks identical to one
 * that worked, and the difference is the whole point of running it.
 */
const { rows } = await client.query(`
  select
    (select count(*) from services            where company_id is null) as services,
    (select count(distinct industry) from services where company_id is null) as industries,
    (select count(*) from tasks               where company_id is null) as tasks,
    (select count(*) from production_rates    where company_id is null) as rates,
    (select count(*) from library_categories  where company_id is null) as categories
`);
const c = rows[0];
console.log(
  `\n${applied} applied. The shipped catalog now holds:\n`
  + `  ${c.services} services across ${c.industries} industries\n`
  + `  ${c.tasks} tasks, ${c.rates} production rates, ${c.categories} categories\n`);

await client.end();
