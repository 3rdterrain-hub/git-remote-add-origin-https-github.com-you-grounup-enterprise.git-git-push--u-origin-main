/**
 * Every door a browser can open, and whether anything opens it.
 *
 * This build's most expensive defect is not a wrong answer. It is a complete,
 * tested, governed feature that no screen reaches — and it has happened at
 * least eleven times: lead intake, assemblies, unit cost, resource suggestions,
 * the equipment-rate importer, `document_sheets`, the parametric rate, the
 * line-price write-back, the whole Plans & Specs subsystem, `line_unit_note`,
 * and the services with no breakdown.
 *
 * Nothing catches it. Every layer has its own tests and every layer passes: the
 * migration is tested, the function is tested, the payload is tested, the
 * component is tested. What is not tested is the *joint* — that something in
 * the application actually calls the thing. Four thousand two hundred green
 * tests shipped a page showing every customer somebody else's sample findings.
 *
 * So it is counted here, from the tree, on every run. A `public.*` function or
 * a `my_*` view is a door: it exists to be opened from a browser, it was
 * granted to `authenticated` on purpose, and one with no caller is either an
 * unfinished feature or a deliberate exception that should say so.
 *
 * `--check` fails the build when `governance/DOORS.md` stops matching the tree,
 * so a new door arrives with either a reader or a stated reason, on the commit
 * that adds it rather than on the day somebody goes looking.
 *
 * Exceptions live in `SERVER_SIDE` below, each with the reason it is not a
 * browser door. An entry with no reason is a defect being written down.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const OUT = 'governance/DOORS.md';

/**
 * Doors a browser is not supposed to open, and why.
 *
 * Each of these is a decision. A name added here without a reason is a defect
 * being recorded rather than fixed.
 */
const SERVER_SIDE = {
  record_engine_result:
    'The only writer of engine outputs. Granted to service_role alone, because '
    + 'the engine runs in an Edge Function and a browser must not hand the '
    + 'platform a price of its own.',
  has_entitlement: 'Read by SQL and by Edge Functions; a screen asks `can_use` instead.',
  can_use: 'Entitlement and authorization together, called from SQL policy and function bodies.',
  current_usage: 'Metering helper, called by the entitlement and allowance functions.',
  ai_request_allowed: 'Called by the AI Edge Functions before they spend a credit.',
  billable_seats: 'Billing arithmetic, read through reporting views rather than directly.',
  storage_bytes: 'Measurement helper behind the storage allowance.',
  storage_within_allowance: 'Called by the upload path before a file is accepted.',
  claim_event_replay: 'Operator tooling: the replay worker claims a row, not a person.',
  finish_event_replay: 'Operator tooling: the replay worker closes the row it claimed.',
  claim_refund: 'Operator tooling: the refund worker claims a row.',
  finish_refund: 'Operator tooling: the refund worker closes the row it claimed.',
  record_cancellation: 'Written by the Stripe webhook, never by a browser.',
  record_payment_failure: 'Written by the Stripe webhook, never by a browser.',
  line_resource_suggestions:
    'Returns `setof record`, which PostgREST cannot shape, so no browser could '
    + 'call it even if it wanted to. Migration 0126 superseded it with the view '
    + '`my_line_resource_suggestions`, which the estimate line reads, and '
    + '`apply_line_resource_suggestions`, which it writes through.',
};

function walk(dir, test, out = []) {
  let entries;
  try { entries = readdirSync(join(ROOT, dir), { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const rel = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'coverage') continue;
      walk(rel, test, out);
    } else if (test(e.name)) out.push(rel);
  }
  return out;
}

// ---------------------------------------------------------------- the doors
const migrations = walk('supabase/migrations', (n) => n.endsWith('.sql')).sort();
const doors = new Map();

for (const file of migrations) {
  const sql = readFileSync(join(ROOT, file), 'utf8');
  const add = (name, kind) => {
    // The migration that defines it last is the one that describes it.
    doors.set(name, { name, kind, file });
  };
  for (const m of sql.matchAll(/create or replace function public\.([a-z0-9_]+)\s*\(/g)) {
    add(m[1], 'function');
  }
  for (const m of sql.matchAll(/create (?:or replace )?view (my_[a-z0-9_]+)/g)) {
    add(m[1], 'view');
  }
}

// -------------------------------------------------------------- the readers
const appFiles = [
  ...walk('apps/web/src', (n) => /\.tsx?$/.test(n) && !n.includes('.test.')),
  ...walk('supabase/functions', (n) => /\.ts$/.test(n)),
];
/**
 * Code with the prose taken out.
 *
 * A door named in a comment is not a door that is opened. This was found the
 * honest way: a comment on the billing screen explaining where a seat price
 * comes from mentioned `seat_price_cents` in backticks, and the scan counted
 * the screen as its reader — which is exactly the false green this file exists
 * to prevent. Block comments go first (JSX `{/* … *\/}` included), then line
 * comments, guarded so the `//` in a URL survives.
 */
const withoutComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[\s;,({[])\/\/[^\n]*/g, '$1');

const sources = appFiles.map((f) => ({
  file: f,
  text: withoutComments(readFileSync(join(ROOT, f), 'utf8')),
}));

/**
 * Where a door is named, outside the migrations that define it.
 *
 * `rpc/<name>` is in here because of `submit_lead`: the public lead form is
 * posted to by a snippet on the contractor's own website, so the application
 * reaches that door by building its URL rather than by calling it. A scan that
 * missed it would report an unreachable feature that is, in fact, the one
 * strangers use.
 */
function readersOf(name) {
  const needle = new RegExp(`['"\`]${name}['"\`]|\\.from\\(['"\`]${name}|rpc\\(['"\`]${name}|rpc/${name}\\b`);
  return sources.filter((s) => needle.test(s.text)).map((s) => s.file);
}

const rows = [...doors.values()]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((d) => {
    const readers = readersOf(d.name);
    const web = readers.filter((f) => f.startsWith('apps/web'));
    const edge = readers.filter((f) => f.startsWith('supabase/functions'));
    return { ...d, web, edge, reason: SERVER_SIDE[d.name] ?? null };
  });

const open = rows.filter((r) => r.web.length === 0 && r.edge.length === 0 && !r.reason);
const edgeOnly = rows.filter((r) => r.web.length === 0 && r.edge.length > 0 && !r.reason);
const declared = rows.filter((r) => r.reason);
const wired = rows.filter((r) => r.web.length > 0);

const short = (f) => f.replace('apps/web/src/', '').replace('supabase/functions/', '');

const body = `# Doors

<!-- Generated by scripts/build-door-inventory.mjs. Do not edit by hand. -->

Every \`public.*\` function and \`my_*\` view in the schema, and whether anything
in the application opens it. A door with no reader is a feature that was built,
tested, granted to \`authenticated\` — and cannot be reached.

This exists because that is the defect this build produces most: eleven times so
far, and not one of them was caught by a test, because every layer passes on its
own and nothing checks the joint between them.

| | |
|---|---|
| Doors | **${rows.length}** |
| Opened by a screen | **${wired.length}** |
| Opened only by an Edge Function | **${edgeOnly.length}** |
| Server-side by design | **${declared.length}** |
| **No reader** | **${open.length}** |

## No reader

${open.length === 0
    ? 'None. Every door in the schema is opened by something.'
    : `These are granted to \`authenticated\` and nothing calls them. Each is either an
unfinished feature or an exception that belongs in \`SERVER_SIDE\` with its reason.

| Door | Kind | Defined in |
|---|---|---|
${open.map((r) => `| \`${r.name}\` | ${r.kind} | ${r.file.replace('supabase/migrations/', '')} |`).join('\n')}`}

## Server-side by design

| Door | Why a browser does not open it |
|---|---|
${declared.map((r) => `| \`${r.name}\` | ${r.reason} |`).join('\n')}

## Opened only by an Edge Function

${edgeOnly.length === 0 ? 'None.' : `| Door | Called from |
|---|---|
${edgeOnly.map((r) => `| \`${r.name}\` | ${r.edge.map(short).join(', ')} |`).join('\n')}`}

## Opened by a screen

| Door | Kind | Read in |
|---|---|---|
${wired.map((r) => `| \`${r.name}\` | ${r.kind} | ${r.web.slice(0, 3).map(short).join(', ')}${r.web.length > 3 ? ` +${r.web.length - 3}` : ''} |`).join('\n')}
`;

if (check) {
  let current = '';
  try { current = readFileSync(join(ROOT, OUT), 'utf8'); } catch { /* not written yet */ }
  if (current.trim() !== body.trim()) {
    console.error(`${OUT} does not match the tree. Run: npm run doors`);
    process.exit(1);
  }
  if (open.length > 0) {
    console.error(`${open.length} door(s) in the schema have no reader:`);
    for (const r of open) console.error(`  - ${r.name} (${r.kind}, ${r.file})`);
    console.error('\nGive each one a caller, or record it in SERVER_SIDE with the reason '
      + 'a browser does not open it.');
    process.exit(1);
  }
  console.log(`Doors: ${rows.length} total, ${open.length} with no reader.`);
} else {
  writeFileSync(join(ROOT, OUT), body);
  console.log(`Wrote ${OUT}: ${rows.length} doors, ${wired.length} opened by a screen, `
    + `${edgeOnly.length} by an Edge Function, ${declared.length} server-side, `
    + `${open.length} with no reader.`);
  if (open.length) for (const r of open) console.log(`  no reader: ${r.name} (${r.kind})`);
}
