/**
 * Load a materials price list into a company's library.
 *
 * The spreadsheet every contractor already has, in the shape every export
 * already produces: `name, category, unit, unit_cost, density, waste_pct`. It
 * connects the way `load-seed` does — the host and user the Supabase CLI stored
 * when the project was linked, and the password typed here — so there is no URL
 * to assemble and nothing to paste.
 *
 * All the judgment lives in `public.import_materials`, in one transaction, in
 * migration 0127. This reads a file and prints what came back. That matters
 * more than it sounds: an importer whose rules live in a script is an importer
 * whose rules can be skipped by anybody who calls the database another way.
 *
 * **You probably do not need this.** Libraries → Materials → "Bring in a price
 * list" calls the same function with the session the browser already holds, and
 * asks for no password at all. This stays for the headless case — a scripted
 * load, a machine with no browser — and it is the only reason a password is
 * involved anywhere in the import path.
 *
 * Usage:
 *   npm run materials:import -- <file.csv> [--company <uuid>]
 *
 * With no company it uses the only one you belong to, and says so.
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POOLER = join(ROOT, 'supabase', '.temp', 'pooler-url');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const companyArg = args.includes('--company') ? args[args.indexOf('--company') + 1] : null;

if (!file) {
  console.error(
    'Give me a CSV.\n\n'
    + '  npm run materials:import -- ~/Downloads/materials.csv\n\n'
    + 'Columns: name, category, unit, unit_cost, density, waste_pct\n');
  process.exit(1);
}

/**
 * A CSV reader that handles quoted fields.
 *
 * A material name with a comma in it — "Pipe, ductile iron 8 inch" — is not
 * exotic, and splitting on commas would file half of it as the category.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

async function askPassword(prompt) {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl.output;
  rl._writeToOutput = function muted(text) { if (text.startsWith(prompt)) out.write(text); };
  const answer = await new Promise((resolve) => rl.question(prompt, resolve));
  rl.close();
  process.stdout.write('\n');
  return answer.trim() || null;
}

async function connection() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  let stored;
  try { stored = (await readFile(POOLER, 'utf8')).trim(); } catch { return null; }
  if (!stored.startsWith('postgres')) return null;
  const password = process.env.SUPABASE_DB_PASSWORD ?? await askPassword(
    'Database password (Supabase dashboard → Project Settings → Database): ');
  if (!password) return null;
  const at = new URL(stored);
  at.password = encodeURIComponent(password);
  return at.toString();
}

const csv = parseCsv(await readFile(file, 'utf8'));
if (csv.length < 2) {
  console.error(`${file} has no rows under its header.`);
  process.exit(1);
}

const header = csv[0].map((h) => h.trim().toLowerCase());
const rows = csv.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));

if (!header.includes('name')) {
  console.error(`${file} has no "name" column. Found: ${header.join(', ')}`);
  process.exit(1);
}

const url = await connection();
if (!url) {
  console.error(
    'No database to import into.\n\n'
    + '  Link the project once:  npx supabase link\n'
    + '  then:                   npm run materials:import -- <file.csv>\n');
  process.exit(1);
}

let Client;
try { ({ Client } = await import('pg')); } catch {
  console.error('The `pg` driver is not installed. Install it once:\n\n  npm i -D pg\n');
  process.exit(1);
}

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 5 * 60 * 1000,
});
await client.connect();

/*
 * Whose library. Asking rather than guessing when there is more than one: a
 * price list filed against the wrong company is not a mistake anybody notices
 * until an estimate uses it.
 */
let company = companyArg;
if (!company) {
  const { rows: mine } = await client.query(
    `select id, name from companies order by created_at limit 2`);
  if (mine.length === 0) {
    console.error('There are no companies in this database yet.');
    await client.end();
    process.exit(1);
  }
  if (mine.length > 1) {
    console.error('More than one company here. Say which:\n');
    for (const c of mine) console.error(`  --company ${c.id}   ${c.name}`);
    await client.end();
    process.exit(1);
  }
  company = mine[0].id;
  console.log(`Importing into ${mine[0].name}.`);
}

console.log(`${rows.length} rows from ${file}.\n`);

const { rows: result } = await client.query(
  `select import_materials($1::uuid, $2::jsonb) as report`, [company, JSON.stringify(rows)]);
const report = result[0].report;

console.log(`  imported          ${report.imported}`);
console.log(`  already there     ${report.already_there}`);
console.log(`  categories added  ${report.categories_added}`);
console.log(`  refused           ${report.rejected.length}`);
console.log(`  needs a look      ${report.needs_review.length}`);

if (!report.approved) {
  console.log(
    '\nThese landed as drafts, because the account importing them cannot approve\n'
    + 'the library. They are usable on an estimate and will not appear in anybody\n'
    + "else's search until a reviewer approves them.");
}

if (report.rejected.length) {
  console.log('\nRefused — these need changing in the spreadsheet:');
  for (const r of report.rejected) console.log(`  ${r.name}\n      ${r.reason}`);
}

if (report.needs_review.length) {
  console.log(`\nImported, and worth a look (${report.needs_review.length}):`);
  for (const r of report.needs_review.slice(0, 40)) {
    console.log(`  ${r.name} [${r.unit}]\n      ${r.why}`);
  }
  if (report.needs_review.length > 40) {
    console.log(`  … and ${report.needs_review.length - 40} more.`);
  }
}

const { rows: after } = await client.query(
  `select count(*)::int as total,
          count(*) filter (where cost_state = 'not_costed')::int as uncosted
   from materials where company_id = $1`, [company]);
console.log(
  `\nThe library now holds ${after[0].total} materials, `
  + `${after[0].uncosted} of them with no cost yet.\n`);

await client.end();
