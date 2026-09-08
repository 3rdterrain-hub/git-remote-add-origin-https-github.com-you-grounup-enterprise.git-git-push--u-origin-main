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
 *   npm run seed:load
 *
 * Nothing to paste. If the project has been linked — and it has, or `supabase
 * db push` would not work — the CLI has already written the host, the user and
 * the database name to `supabase/.temp/pooler-url`. This reads them and asks
 * only for the database password, which is typed here and goes nowhere else.
 *
 * That is deliberate. Asking somebody to assemble a connection string by hand
 * is asking them to get it wrong: the first two attempts at this failed on a
 * pasted `postgresql://...`, and the third on a hostname copied out of an
 * example. None of those is a mistake worth making twice, and the only part
 * that genuinely has to come from a person is the password.
 *
 * `DATABASE_URL` still wins when it is set, for CI and for anybody pointing
 * this at a database the CLI has never heard of.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED_DIR = join(ROOT, 'supabase', 'seed');
const POOLER = join(ROOT, 'supabase', '.temp', 'pooler-url');

/**
 * Ask for the password without echoing it.
 *
 * Not through an environment variable by default: an exported secret is in the
 * shell's history and in the process list, and this runs once.
 */
async function askPassword(prompt) {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const wasMuted = rl.output;
  rl._writeToOutput = function muted(text) {
    if (text.startsWith(prompt)) wasMuted.write(text);
  };
  const answer = await new Promise((resolve) => rl.question(prompt, resolve));
  rl.close();
  process.stdout.write('\n');
  const given = answer.trim();
  if (!given) return null;

  /*
   * A command typed at the password prompt.
   *
   * The prompt does not echo, so a shell that is busy looks exactly like a
   * shell that is idle — somebody types `npx supabase db push`, sees nothing,
   * presses Enter, and has just sent their intended command as a password. The
   * failure that follows says "password authentication failed", which is true
   * and unhelpful. This says what actually happened.
   */
  if (/^(npx|npm|yarn|pnpm|supabase|git|cd|ls)\s/.test(given)) {
    console.error(
      `\nThat looks like a command rather than a password: "${given}"\n\n`
      + 'This prompt does not echo, so a busy shell looks like an idle one.\n'
      + 'Press Ctrl+C to get your shell back, run the command, then start this again.\n');
    process.exit(1);
  }
  return given;
}

/** The connection the CLI already knows about, with a password put into it. */
async function linkedConnection() {
  let stored;
  try {
    stored = (await readFile(POOLER, 'utf8')).trim();
  } catch {
    return null;
  }
  if (!stored.startsWith('postgres')) return null;

  const password = process.env.SUPABASE_DB_PASSWORD ?? await askPassword(
    'Database password (Supabase dashboard → Project Settings → Database): ');
  if (!password) return null;

  const at = new URL(stored);
  at.password = encodeURIComponent(password);
  return at.toString();
}

let url = process.env.DATABASE_URL;
if (url && /^postgres(ql)?:\/\/\.{3}|\baws-0-region\b/.test(url)) {
  /*
   * The two placeholders that have actually been pasted. Saying so beats
   * `getaddrinfo ENOTFOUND ...`, which reads like a network fault.
   */
  console.error(
    `DATABASE_URL is still a placeholder: ${url}\n\n`
    + 'Unset it and run `npm run seed:load` on its own — the project is already\n'
    + 'linked, so it will ask for the database password and nothing else.\n');
  process.exit(1);
}
if (!url) url = await linkedConnection();
if (!url) {
  console.error(
    'No database to load into.\n\n'
    + '  Link the project once:  npx supabase link\n'
    + '  then:                   npm run seed:load\n\n'
    + 'Or set DATABASE_URL yourself, from the Supabase dashboard under\n'
    + 'Project Settings → Database → Connection string → URI.\n');
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

/*
 * A failed login used to arrive as a `pg` stack trace, which says
 * "password authentication failed" and nothing about which password. There are
 * two, they are unrelated, and only one of them works here.
 */
try {
  await client.connect();
} catch (err) {
  const message = String(err?.message ?? err);
  if (/password authentication failed/i.test(message)) {
    console.error(
      '\nThat password was refused by the database.\n\n'
      + 'It is the *database* password, not the one you sign in to Supabase with.\n'
      + 'Dashboard -> Project Settings -> Database -> Database password.\n\n'
      + 'It cannot be read back, only reset. Resetting it is safe and takes a moment;\n'
      + 'nothing else in the project uses it.\n\n'
      + 'To skip the prompt entirely:\n'
      + '  SUPABASE_DB_PASSWORD=\'your-password\' npm run seed:load\n');
  } else if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
    console.error(
      `\nCould not reach the database host.\n\n${message}\n\n`
      + 'If that hostname looks like an example rather than yours, unset DATABASE_URL\n'
      + 'and run this again — it reads the host from the linked project.\n');
  } else {
    console.error(`\nCould not connect: ${message}\n`);
  }
  process.exit(1);
}
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
