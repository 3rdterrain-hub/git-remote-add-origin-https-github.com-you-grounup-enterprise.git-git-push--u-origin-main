/**
 * Builds the Master Traceability Matrix from the requirements register, the
 * artifact catalog and the mapping rules.
 *
 * Generated rather than hand-maintained, for the same reason the OpenAPI spec
 * is: a hand-maintained matrix drifts from the code, and a traceability matrix
 * that lies is worse than none — it is the document people stop checking things
 * against.
 *
 * `npm run verify` regenerates it and fails if the committed matrix differs, so
 * the matrix and the codebase cannot separate.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const G = join(ROOT, 'governance');

function readCsv(path) {
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const CHECK = process.argv.includes('--check');
const drift = [];

function writeCsv(path, rows, columns) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
  if (CHECK) {
    let current = '';
    try { current = readFileSync(path, 'utf8'); } catch { /* not generated yet */ }
    if (current !== body) drift.push(path);
  } else writeFileSync(path, body);
}

function writeJson(path, value) {
  const body = JSON.stringify(value, null, 2) + '\n';
  if (CHECK) {
    let current = '';
    try { current = readFileSync(path, 'utf8'); } catch { /* not generated yet */ }
    if (current !== body) drift.push(path);
  } else writeFileSync(path, body);
}

/*
 * The artifact catalog is derived, never hand-listed: an artifact that exists
 * only in a CSV is exactly the kind of thing a traceability matrix should not
 * be able to claim.
 */
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e === 'coverage' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

function buildArtifacts() {
  const reg = JSON.parse(readFileSync(join(G, 'registry.json'), 'utf8'));
  const spec = JSON.parse(readFileSync(join(ROOT, 'docs/openapi.json'), 'utf8'));
  const out = [];
  const add = (kind, id, name, path, category) =>
    out.push({ artifact_id: id, kind, name, path, category });

  for (const e of reg.engines) add('engine', e.id, e.name, e.path, 'ENGINE');
  for (const a of reg.ai_agents) add('ai_agent', a.id, a.name, a.path, 'AI_AGENT');
  for (const [t, c] of Object.entries(reg.tables).sort()) {
    add('table', `TBL-${t}`, t, `supabase/migrations (table ${t})`, c);
  }

  let n = 0;
  for (const [p, ops] of Object.entries(spec.paths)) {
    for (const m of Object.keys(ops)) {
      add('api', `API-${String(++n).padStart(3, '0')}`, `${m.toUpperCase()} /v1${p}`,
        'supabase/functions/api', 'ENGINE');
    }
  }

  for (const f of readdirSync(join(ROOT, 'apps/web/src/pages/app')).sort()) {
    if (!f.endsWith('.tsx') || f.endsWith('.test.tsx')) continue;
    const id = f.replace(/\.tsx$/, '');
    add('ui', `UI-${id}`, id, `apps/web/src/pages/app/${f}`, 'ENTITY');
  }

  for (const v of ['reporting_project_financials', 'reporting_labor_productivity',
                   'reporting_safety_summary', 'reporting_bid_performance']) {
    add('report', `RPT-${v}`, v, 'supabase/migrations/0025_semantic_layer.sql', 'ENGINE');
  }

  // Test suites, qualified by layer: a web `network.test.tsx` and a database
  // `network.test.ts` are different evidence and must not share an id.
  const layers = [
    ['engine', 'packages/engine/tests'], ['pdf', 'packages/pdf/tests'],
    ['db', 'tests/db'], ['fn', 'tests/functions'], ['gov', 'tests/governance'],
    ['web', 'apps/web/src'],
  ];
  for (const [layer, dir] of layers) {
    for (const p of walk(join(ROOT, dir)).sort()) {
      if (!/\.test\.tsx?$/.test(p)) continue;
      const stem = basename(p).replace(/\.test\.tsx?$/, '');
      add('test', `TST-${layer}-${stem}`, `${layer}/${basename(p)}`,
        relative(ROOT, p), 'ENGINE');
    }
  }
  return out;
}

/*
 * Verification ledgers, where they exist.
 *
 * Tracing is derived; verification is not. A ledger row is a judgment somebody
 * made against a requirement's acceptance criteria, citing a named test, and it
 * overrides the derived status for that requirement.
 */
const verification = new Map();
for (const phase of ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'P17', 'P18', 'P19', 'P20', 'P23', 'P24', 'P25', 'P26', 'P27', 'P28', 'P29', 'P30', 'P31', 'P32']) {
  const path = join(G, `traceability/verification/${phase}-ledger.csv`);
  for (const row of readCsv(path)) {
    verification.set(row.requirement_id, row.verification);
  }
}

const requirements = readCsv(join(G, 'requirements/ges-requirements.csv'));
const artifacts = buildArtifacts();
writeCsv(join(G, 'traceability/artifacts.csv'), artifacts,
  ['artifact_id', 'kind', 'name', 'path', 'category']);
/*
 * Declarations: an artifact saying what it implements.
 *
 * Every mapping below this point is *derived* — a rule matched a topic word and
 * concluded an artifact is relevant. That direction is mechanical and it
 * systematically over-claims, which is why this register separates tracing from
 * verification at all.
 *
 * A declaration runs the other way. A source file states `@implements
 * GES-P16-REQ-000041` in its header, and that is an author saying this file is
 * where that requirement lives. It is not verification either — nobody checked
 * a test asserts the acceptance criteria — but it is a claim somebody made
 * rather than a rule that fired, and the two are recorded in different columns
 * so they can never be added together.
 *
 * Every declared identifier must name a requirement that exists; a dangling one
 * fails the build rather than being ignored.
 */
// Deliberately permissive about shape and strict about existence: requirement
// identifiers are not uniform across the register — GOV-000001, EDM-000013,
// P16-REQ-041 — so the pattern finds candidates and the register decides which
// are real.
const DECLARATION = /@implements\s+([A-Z][A-Z0-9-]{2,}(?:\s*,\s*[A-Z][A-Z0-9-]{2,})*)/g;

function scanDeclarations(dir, out = new Map()) {
  let entries;
  try { entries = readdirSync(join(ROOT, dir), { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const rel = join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '.git', '.test-results'].includes(e.name)) continue;
      scanDeclarations(rel, out);
      continue;
    }
    if (!/\.(ts|tsx|sql|mjs)$/.test(e.name)) continue;
    const text = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of text.matchAll(DECLARATION)) {
      for (const id of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
        if (!out.has(id)) out.set(id, []);
        if (!out.get(id).includes(rel)) out.get(id).push(rel);
      }
    }
  }
  return out;
}

const declarations = scanDeclarations('.');

const { rules, method, status_definitions: statusDefs, global_exclude: globalExclude } =
  JSON.parse(readFileSync(join(G, 'traceability/mapping-rules.json'), 'utf8'));

const artifactById = new Map(artifacts.map((a) => [a.artifact_id, a]));
const testIds = new Set(artifacts.filter((a) => a.kind === 'test').map((a) => a.artifact_id));

// Every artifact and test a rule names must exist, or the rule is a claim about
// something that is not there.
const problems = [];
for (const rule of rules) {
  for (const a of rule.artifacts) {
    if (!artifactById.has(a)) problems.push(`${rule.id} references unknown artifact ${a}`);
  }
  for (const t of rule.tests) {
    if (!testIds.has(t)) problems.push(`${rule.id} references unknown test suite ${t}`);
  }
}
if (problems.length) {
  console.error('Mapping rules reference things that do not exist:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

// `exclude` is how a rule states the boundary of what it actually implements.
// Without it, "machine control" claims automatic grade control, and a table
// that stores a design file appears to guide a dozer.
const globalRe = new RegExp(globalExclude.pattern, 'i');
const globalOptOut = new Set(globalExclude.opt_out ?? []);

const compiled = rules.map((r) => ({
  ...r,
  re: new RegExp(r.match, 'i'),
  ex: r.exclude ? new RegExp(r.exclude, 'i') : null,
}));

/** The module a requirement belongs to, recovered where the column is blank. */
function moduleOf(r) {
  if (r.domain) return r.domain;
  const m = /the platform shall \w+ (.+?) (?:canonical model|configurable rules|auditability|permissions|import\/export|validation and testing)\b/i
    .exec(r.requirement);
  if (m) return m[1].trim();
  return (r.name || '').replace(
    /\s+(canonical model|configurable rules|auditability|permissions|import\/export|validation and testing)$/i, '').trim();
}

const matrix = [];
for (const r of requirements) {
  const mod = moduleOf(r);
  /*
   * Match on the module topic only, never the free-text statement.
   *
   * Matching the statement produced 99.1% "verified" on the first run, because
   * words like "permissions", "audit" and "project" appear in nearly every
   * generated requirement. A matrix that claims near-total coverage is worse
   * than no matrix: it is the number people stop checking.
   */
  const subject = `${mod} ${r.name}`.trim();
  // A module naming a capability class this repository does not have is
  // untraceable no matter which topic word it contains.
  const globallyExcluded = globalRe.test(subject);
  const hits = compiled.filter((c) =>
    c.re.test(subject)
    && !(c.ex && c.ex.test(subject))
    && !(globallyExcluded && !globalOptOut.has(c.id)));
  const arts = [...new Set(hits.flatMap((h) => h.artifacts))];
  const tests = [...new Set(hits.flatMap((h) => h.tests))];
  matrix.push({
    requirement_id: r.requirement_id,
    phase: r.phase,
    module: mod,
    requirement: r.requirement,
    /*
     * "traced", never "verified". Tracing says an artifact exists that
     * implements this topic and that the artifact is covered by tests. It does
     * not say anyone read this requirement's acceptance criteria and confirmed
     * a test asserts it — that is per-requirement work, recorded separately in
     * the `verification` column, and none has been done yet.
     */
    status: arts.length === 0 ? 'untraced' : tests.length ? 'traced_tested' : 'traced',
    verification: verification.get(r.requirement_id) ?? 'none',
    // Derived, not hand-audited. See `method` in mapping-rules.json.
    mapping_method: arts.length ? 'derived' : '',
    rules: hits.map((h) => h.id).join(' '),
    artifacts: arts.join(' '),
    tests: tests.join(' '),
    // Kept in its own column, never merged into `artifacts`: a rule firing and
    // an author saying so are different kinds of claim.
    declared_by: (declarations.get(r.requirement_id) ?? []).join(' '),
  });
}

const known = new Set(requirements.map((r) => r.requirement_id));
const dangling = [...declarations.keys()].filter((id) => !known.has(id));
if (dangling.length) {
  console.error('These files declare requirements that do not exist in the register:');
  for (const id of dangling) console.error(`  ${id} — ${declarations.get(id).join(', ')}`);
  console.error('\nA declaration naming nothing is worse than no declaration.');
  process.exit(1);
}

writeCsv(join(G, 'traceability/traceability-matrix.csv'), matrix,
  ['requirement_id', 'phase', 'module', 'status', 'verification', 'mapping_method',
   'declared_by', 'rules', 'artifacts', 'tests', 'requirement']);

// Reverse index: which requirements does each artifact answer for?
const reverse = new Map();
for (const row of matrix) {
  for (const a of row.artifacts.split(' ').filter(Boolean)) {
    if (!reverse.has(a)) reverse.set(a, []);
    reverse.get(a).push(row.requirement_id);
  }
}
const reverseRows = [...reverse.entries()]
  .map(([id, reqs]) => ({
    artifact_id: id,
    kind: artifactById.get(id).kind,
    name: artifactById.get(id).name,
    category: artifactById.get(id).category,
    requirement_count: reqs.length,
    requirements: reqs.join(' '),
  }))
  .sort((a, b) => b.requirement_count - a.requirement_count);
writeCsv(join(G, 'traceability/artifact-coverage.csv'), reverseRows,
  ['artifact_id', 'kind', 'name', 'category', 'requirement_count', 'requirements']);

// A rule that matches a large share of everything is matching on a common
// word rather than a topic, and is reported rather than silently trusted.
const ruleHits = {};
for (const m of matrix) {
  for (const id of m.rules.split(' ').filter(Boolean)) ruleHits[id] = (ruleHits[id] ?? 0) + 1;
}
const overbroad = Object.entries(ruleHits)
  .filter(([, n]) => n / matrix.length > 0.08)
  .map(([id, n]) => ({ rule: id, matched: n, share: Number(((n / matrix.length) * 100).toFixed(1)) }));

const count = (s) => matrix.filter((m) => m.status === s).length;
const byPhase = {};
for (const m of matrix) {
  byPhase[m.phase] ??= { total: 0, traced_tested: 0, traced: 0, untraced: 0, verified: 0 };
  byPhase[m.phase].total++;
  byPhase[m.phase][m.status]++;
  if (m.verification === 'verified') byPhase[m.phase].verified++;
}
const unmappedModules = {};
for (const m of matrix) {
  if (m.status !== 'untraced') continue;
  unmappedModules[m.module] = (unmappedModules[m.module] ?? 0) + 1;
}

const summary = {
  generated_from: 'governance/requirements/ges-requirements.csv + governance/traceability/mapping-rules.json',
  method, status_definitions: statusDefs,
  declarations: {
    note: 'Requirements a source file states it implements, in its own header, using @implements. Derived tracing runs requirement-to-artifact by rule and over-claims; a declaration runs artifact-to-requirement and is a claim somebody made. Neither is verification, and the two are never added together.',
    declared: declarations.size,
    files: [...new Set([...declarations.values()].flat())].length,
  },
  totals: {
    requirements: matrix.length,
    traced_tested: count('traced_tested'),
    traced: count('traced'),
    untraced: count('untraced'),
    traced_percent: Number(((((count('traced_tested') + count('traced'))) / matrix.length) * 100).toFixed(1)),
    // Per-requirement verification against acceptance criteria, reported
    // separately from tracing because they are different claims.
    verified: matrix.filter((m) => m.verification === 'verified').length,
    verification_attempted: matrix.filter((m) => m.verification !== 'none').length,
    not_verified: matrix.filter((m) => m.verification === 'not_verified').length,
  },
  artifacts: { total: artifacts.length, referenced: reverse.size, unreferenced: artifacts.length - reverse.size },
  rule_hits: Object.fromEntries(Object.entries(ruleHits).sort(([, a], [, b]) => b - a)),
  overbroad_rules: overbroad,
  per_phase: Object.fromEntries(
    Object.entries(byPhase).sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)))),
  largest_unmapped_modules: Object.fromEntries(
    Object.entries(unmappedModules).sort(([, a], [, b]) => b - a).slice(0, 30)),
};
writeJson(join(G, 'traceability/summary.json'), summary);

/*
 * The one number in the README this generator owns.
 *
 * It states how many cataloged artifacts answer for at least one requirement,
 * and it moved every time a file was added — three times by hand before it was
 * made generated, which is the same lesson every other count in this repository
 * has already taught. The pattern must match: a sentence that stops matching is
 * a sentence that stops being checked.
 */
{
  const path = join(G, 'traceability/README.md');
  const before = readFileSync(path, 'utf8');
  const pattern = /Of [\d,]+ cataloged artifacts, [\d,]+ answer for at least one requirement\./;
  if (!pattern.test(before)) {
    console.error('governance/traceability/README.md no longer states the artifact catalog size.');
    console.error('Restore the sentence or update scripts/build-traceability.mjs.');
    process.exit(2);
  }
  const after = before.replace(pattern,
    `Of ${artifacts.length} cataloged artifacts, ${summary.artifacts.referenced} answer for at least one requirement.`);
  if (CHECK) {
    if (after !== before) {
      console.error('The README does not state the artifact catalog size the generator produced.');
      console.error(`It is ${summary.artifacts.referenced} of ${artifacts.length}. Run: npm run traceability`);
      process.exit(1);
    }
  } else if (after !== before) {
    writeFileSync(path, after);
  }
}

if (CHECK) {
  if (drift.length) {
    console.error('The traceability matrix is out of date with the code. Run: npm run traceability');
    for (const f of drift) console.error(`  ${relative(ROOT, f)}`);
    process.exit(1);
  }
  console.log(`Traceability matrix matches the codebase (${matrix.length} requirements, ${artifacts.length} artifacts).`);
  process.exit(0);
}

const t = summary.totals;
console.log(`${t.requirements} requirements`);
console.log(`  traced to a tested artifact  ${String(t.traced_tested).padStart(5)}`);
console.log(`  traced to an artifact        ${String(t.traced).padStart(5)}`);
console.log(`  untraced                     ${String(t.untraced).padStart(5)}`);
console.log(`  traced                       ${t.traced_percent}%`);
console.log(`  verified against acceptance criteria  ${t.verified} of ${t.verification_attempted} judged  (tracing is not verification)`);
console.log(`artifacts referenced by at least one requirement: ${summary.artifacts.referenced}/${artifacts.length}`);
console.log(`requirements an artifact declares it implements: ${declarations.size}`);
if (overbroad.length) {
  console.log('\noverbroad rules (matching more than 8% of all requirements):');
  for (const o of overbroad) console.log(`  ${o.rule}  ${o.matched} (${o.share}%)`);
}
