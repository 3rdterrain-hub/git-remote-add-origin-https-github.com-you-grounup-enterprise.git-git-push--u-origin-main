/**
 * The counts the documentation states about the build itself, taken from the
 * files rather than typed.
 *
 * `docs/BUILD-SUMMARY.md` carries a table of how many files and lines each area
 * of the build has; `README.md` and `governance/README.md` state how many
 * migrations, tables, views, engines and agents there are. All of it was
 * maintained by hand, and by the time anything checked, every row had drifted:
 * the engine was recorded as 25 files against a real 38, the migrations as 39
 * against 41 and ~11,300 lines against a real 10,269 — overstated while files
 * were being added — and the two documents disagreed with each other about how
 * many views there are (five, versus nine) with neither number right.
 *
 * That is the same defect this build has now found repeatedly in the product:
 * a number asserted by prose that nothing computes. It is worse in
 * documentation than in a schema, because a reader has no way to tell.
 *
 * It is now generated. Each row names the files it counts, `--check` fails the
 * build when a document disagrees with the tree, and every pattern must match
 * something — so a rewording that would quietly drop a claim out of the check
 * fails loudly instead of passing.
 *
 * Run this *after* `build-test-counts.mjs`, which is what `npm run docs` does.
 * Both write `docs/BUILD-SUMMARY.md`, and the Documentation row here counts that
 * file's own lines — so this one has to measure the settled file or the pair
 * would need a second pass to converge.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

/** Every file under `dir` whose name matches, recursively. */
function walk(dir, test, out = []) {
  let entries;
  try { entries = readdirSync(join(ROOT, dir), { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const rel = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(rel, test, out);
    } else if (test(e.name)) out.push(rel);
  }
  return out;
}

const lines = (files) =>
  files.reduce((n, f) => n + readFileSync(join(ROOT, f), 'utf8').split('\n').length, 0);

const ts = (n) => /\.tsx?$/.test(n) ;
const sql = (n) => n.endsWith('.sql');
const md = (n) => n.endsWith('.md');
const mjs = (n) => n.endsWith('.mjs');
const isTest = (n) => /\.test\.tsx?$/.test(n);

// ---------------------------------------------------------------- the tree
const migrations = walk('supabase/migrations', sql).sort();
const migrationText = migrations.map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');

const count = (re) => (migrationText.match(re) ?? []).length;
const unique = (re) => new Set(migrationText.match(re) ?? []).size;

const tables = count(/^create table /gm);
// `create or replace view` repeats a name when a view is redefined by a later
// migration, so views are counted by distinct name rather than by statement.
const views = unique(/create or replace view [a-z_]+/g);
const reportingViews = unique(/create or replace view reporting_[a-z_]+/g);

const registry = JSON.parse(readFileSync(join(ROOT, 'governance/registry.json'), 'utf8'));
const registryTables = Object.keys(registry.tables).length;
const engines = registry.engines.length;
const agents = registry.ai_agents.length;

const appPages = walk('apps/web/src/pages/app', (n) => ts(n) && !isTest(n));
const routes = (readFileSync(join(ROOT, 'apps/web/src/App.tsx'), 'utf8')
  .match(/path="[^"]*"/g) ?? []).length;

// A deployed function is a directory; `_shared` is a module, not a function.
const deployedFunctions = readdirSync(join(ROOT, 'supabase/functions'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_')).length;

// The schema is the one place the tree and the registry must agree, and a
// mismatch means a table was added without being classified.
if (tables !== registryTables) {
  console.error(`The migrations create ${tables} tables; governance/registry.json classifies ` +
    `${registryTables}. Every table belongs to one of the five categories — add the missing ` +
    'one to the registry.');
  process.exit(1);
}

// ------------------------------------------------------------- table rows
const ROWS = [
  ['Estimating engine (source + tests)',
    [...walk('packages/engine/src', ts), ...walk('packages/engine/tests', ts)]],
  ['Document rendering (source + tests)',
    [...walk('packages/pdf/src', ts), ...walk('packages/pdf/tests', ts)]],
  [`Database migrations (${migrations.length} files, ${tables} tables, ${views} views)`,
    migrations],
  ['Edge Functions + shared modules', walk('supabase/functions', ts)],
  ['Database & function tests', [...walk('tests/db', ts), ...walk('tests/functions', ts)]],
  ['Governance & traceability tests', walk('tests/governance', ts)],
  [`Web application (${routes} routes, ${appPages.length} app screens)`, walk('apps/web/src', ts)],
  ['Documentation',
    [...walk('.', (n) => md(n) && false), ...walk('docs', md),
     ...walk('governance', md), ...['README.md']]],
  ['Seed & tooling', [...walk('tools', mjs), ...walk('scripts', mjs)]],
];

// Line counts are stated to the nearest hundred, because the exact figure is
// noise a reader cannot use and would churn the file on every edit.
const round = (n) => Math.round(n / 100) * 100;
const fmt = (n) => n.toLocaleString('en-US');

const measured = ROWS.map(([label, files]) => [label, files.length, lines(files)]);
const totalFiles = measured.reduce((n, r) => n + r[1], 0);
const totalLines = measured.reduce((n, r) => n + r[2], 0);

const table = [
  '| Area | Files | Lines |',
  '|---|---:|---:|',
  ...measured.map(([label, f, l]) => `| ${label} | ${f} | ~${fmt(round(l))} |`),
  `| **Total hand-written** | **${totalFiles}** | **~${fmt(round(totalLines))}** |`,
].join('\n');

// ------------------------------------------------------------ the rewrites
/**
 * Each edit names the file, the claim it replaces and what the claim should
 * say. A pattern that matches nothing is a failure rather than a no-op: it
 * means the sentence was reworded and the check silently stopped covering it.
 */
const EDITS = [
  ['docs/BUILD-SUMMARY.md', /\| Area \| Files \| Lines \|[\s\S]*?\n\| \*\*Total hand-written\*\*[^\n]*\|/, table],
  ['README.md', /\d+ migrations, [\d,]+ tables, \d+ reporting views/,
    `${migrations.length} migrations, ${fmt(tables)} tables, ${reportingViews} reporting views`],
  ['README.md', /every one of the [\d,]+ tables/, `every one of the ${fmt(tables)} tables`],
  ['governance/README.md', /[\d,]+ tables, \d+ engines?, \d+ agents?/,
    `${fmt(tables)} tables, ${engines} engines, ${agents} agent${agents === 1 ? '' : 's'}`],
  ['governance/traceability/verification/P20-verdicts.json', /forced on all [\d,]+ tables/,
    `forced on all ${fmt(tables)} tables`],
  ['docs/ARCHITECTURE.md', /\d+ ordered migrations/, `${migrations.length} ordered migrations`],
  ['docs/ARCHITECTURE.md', /\d+ functions — six for billing/,
    `${deployedFunctions} functions — six for billing`],
];

const problems = [];
const writes = new Map();

for (const [file, pattern, replacement] of EDITS) {
  const path = join(ROOT, file);
  const before = writes.get(file) ?? readFileSync(path, 'utf8');
  if (!pattern.test(before)) {
    console.error(`${file} no longer contains the claim this check covers: ${pattern}`);
    console.error('Restore the wording or update scripts/build-schema-counts.mjs. ' +
      'A claim that stops matching is a claim that stops being checked.');
    process.exit(2);
  }
  const after = before.replace(pattern, replacement);
  if (after !== before) problems.push(file);
  writes.set(file, after);
}

if (check) {
  if (problems.length) {
    console.error('The documentation does not state what the tree contains:');
    for (const f of [...new Set(problems)]) console.error(`  - ${f}`);
    console.error(`\nThe tree has ${migrations.length} migrations, ${tables} tables, ` +
      `${views} views (${reportingViews} reporting), ${engines} engines, ${agents} agent, ` +
      `${totalFiles} hand-written files. Run: npm run schema:counts`);
    process.exit(1);
  }
  console.log(`Documentation matches the tree: ${migrations.length} migrations, ${tables} tables, ` +
    `${views} views, ${totalFiles} files.`);
} else {
  for (const [file, text] of writes) writeFileSync(join(ROOT, file), text);
  console.log(`Updated from the tree: ${migrations.length} migrations, ${tables} tables, ` +
    `${views} views (${reportingViews} reporting), ${engines} engines, ${agents} agent.`);
  console.log(`${totalFiles} hand-written files, ~${fmt(round(totalLines))} lines.`);
}
