#!/usr/bin/env node
/**
 * The authoritative GES requirement baseline, built from the governed sources.
 *
 * Per the governance ruling of 19 September 2026:
 *
 *   * The baseline is the deduplicated union of the governed *phase* registries.
 *     Identity is the governed requirement ID together with its home phase.
 *   * The P21 and P22 master registers are consolidated and reconciled control
 *     views of phases 01-20. They do not supersede the originals and they are
 *     not counted as requirements; their `reconciliation_state`,
 *     `finding_severity` and `disposition_rule` are joined onto the original IDs.
 *   * P99's incorporated register is the enterprise umbrella layer. It is not
 *     independently exhaustive, and a valid phase requirement absent from it
 *     stays in scope. Its omissions are recorded as a register-completeness
 *     defect against P99 and are not repaired here.
 *
 * Nothing is merged, renamed or dropped. Every source occurrence keeps its
 * provenance: the file it came from and the row it sat on.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

const ROOT = process.cwd();
const SOURCE = 'governance/ges-source';
const OUT = 'governance/governed';

/* ------------------------------------------------------------------ CSV */
/**
 * A CSV reader that honors quoting, because the governed registries carry
 * requirement prose with commas, quotes and newlines inside single fields. A
 * split on commas loses rows silently, which is the one failure this whole
 * exercise exists to stop.
 */
export function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Header names differ across the packages — `Requirement_ID`, `Requirement ID`
 * and `requirement_id` all appear, and the difference is exactly what caused
 * P99 to skip ten registries. Compared with separators and case removed so a
 * registry is never missed for punctuation.
 */
const norm = (h) => h.trim().toLowerCase().replace(/[\s_-]+/g, '');

function columns(header) {
  const at = header.map(norm);
  const find = (...names) => {
    for (const n of names) { const i = at.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  return {
    id: find('requirementid'),
    requirement: find('requirement', 'description'),
    acceptance: find('acceptancecriteria'),
    priority: find('priority'),
    status: find('status'),
    domain: find('domain', 'category', 'area', 'module', 'topic', 'capability'),
    testCase: find('testcaseid', 'testcase', 'testid'),
  };
}

function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const next = join(dir, entry.name);
    if (entry.isDirectory()) walk(next, out);
    else out.push(next);
  }
  return out;
}

const files = walk(SOURCE);

/*
 * The packages ship each CSV twice, at the package root and inside its folder.
 * Kept once per phase and basename, with the shorter path preferred, so a row
 * is not counted because it was shipped in two places.
 */
function oncePerPhase(candidates) {
  const kept = new Map();
  for (const f of candidates) {
    const phase = f.split('/')[2];
    const key = `${phase}|${basename(f)}`;
    const prev = kept.get(key);
    if (!prev || f.length < prev.length) kept.set(key, f);
  }
  return [...kept.entries()].map(([key, file]) => ({ phase: key.split('|')[0], file }));
}

const MASTER = /Master_Requirements_Register|Final_Requirements_Register|Incorporated_Unique/i;
const isRequirementCsv = (f) => /\.csv$/i.test(f) && /requirement/i.test(basename(f));

const registries = oncePerPhase(files.filter(isRequirementCsv));
const phaseRegistries = registries.filter((r) => !MASTER.test(basename(r.file)));
const masterRegisters = registries.filter((r) => MASTER.test(basename(r.file)));

/* ------------------------------------------------- the requirement population */
const population = [];
const provenance = [];
const registryReport = [];

for (const { phase, file } of phaseRegistries.sort((a, b) => a.phase.localeCompare(b.phase))) {
  const rows = parseCsv(readFileSync(join(ROOT, file), 'utf8'));
  const col = columns(rows[0]);
  if (col.id < 0) {
    registryReport.push({ phase, file, rows: 0, note: 'NO REQUIREMENT ID COLUMN — not read' });
    continue;
  }
  const body = rows.slice(1).filter((r) => r.length > 1 && r.join('').trim());
  let withAcceptance = 0;
  for (const [i, r] of body.entries()) {
    const id = (r[col.id] ?? '').trim();
    if (!id) continue;
    const acceptance = col.acceptance >= 0 ? (r[col.acceptance] ?? '').trim() : '';
    if (acceptance) withAcceptance += 1;
    population.push({
      id,
      homePhase: phase,
      sourceArtifact: basename(file),
      sourceLocation: `${relative(SOURCE, file)}#row${i + 2}`,
      requirement: col.requirement >= 0 ? (r[col.requirement] ?? '').trim() : '',
      acceptance,
      priority: col.priority >= 0 ? (r[col.priority] ?? '').trim() : '',
      sourceStatus: col.status >= 0 ? (r[col.status] ?? '').trim() : '',
      domain: col.domain >= 0 ? (r[col.domain] ?? '').trim() : '',
      testCaseId: col.testCase >= 0 ? (r[col.testCase] ?? '').trim() : '',
    });
    provenance.push({ id, phase, file: relative(SOURCE, file), row: i + 2 });
  }
  registryReport.push({
    phase, file: relative(SOURCE, file), rows: body.length, withAcceptance,
    header: rows[0].join(','),
  });
}

/* --------------------------------------------------------------- duplicates */
const byId = new Map();
for (const r of population) {
  if (!byId.has(r.id)) byId.set(r.id, []);
  byId.get(r.id).push(r);
}
const duplicated = [...byId.entries()].filter(([, v]) => v.length > 1);

/* ------------------------------------------- P21 / P22 reconciliation joins */
/*
 * Joined onto the original requirement, never counted as requirements of their
 * own. Both registers hold exactly the phase 01-20 population; treating them as
 * a second population would double-count 4,785 requirements.
 */
const reconciliation = new Map();
for (const { file } of masterRegisters) {
  if (/Incorporated_Unique/i.test(basename(file))) continue;
  const rows = parseCsv(readFileSync(join(ROOT, file), 'utf8'));
  const at = rows[0].map(norm);
  const col = (n) => at.indexOf(n);
  const iId = col('requirementid');
  if (iId < 0) continue;
  const iState = col('reconciliationstate');
  const iSeverity = col('findingseverity');
  const iDisposition = col('dispositionrule');
  const which = /P22/i.test(basename(file)) ? 'p22' : 'p21';
  for (const r of rows.slice(1)) {
    const id = (r[iId] ?? '').trim();
    if (!id) continue;
    const entry = reconciliation.get(id) ?? {};
    entry[which] = {
      register: basename(file),
      state: iState >= 0 ? (r[iState] ?? '').trim() : '',
      severity: iSeverity >= 0 ? (r[iSeverity] ?? '').trim() : '',
      disposition: iDisposition >= 0 ? (r[iDisposition] ?? '').trim() : '',
    };
    reconciliation.set(id, entry);
  }
}

/* ------------------------------------- the P99 register-completeness defect */
const incorporated = new Set();
{
  const inc = registries.find((r) => /Incorporated_Unique/i.test(basename(r.file)));
  if (inc) {
    const rows = parseCsv(readFileSync(join(ROOT, inc.file), 'utf8'));
    const i = rows[0].map(norm).indexOf('requirementid');
    for (const r of rows.slice(1)) { const id = (r[i] ?? '').trim(); if (id) incorporated.add(id); }
  }
}
const p99Omissions = [...byId.keys()].filter((id) => !incorporated.has(id));
const p99Phantom = [...incorporated].filter((id) => !byId.has(id));

/* ------------------------------------------- the governed test-case population */
const testFiles = oncePerPhase(files.filter((f) => /\.csv$/i.test(f) && /test[_-]?case/i.test(basename(f))));
const testCases = [];
for (const { phase, file } of testFiles) {
  const rows = parseCsv(readFileSync(join(ROOT, file), 'utf8'));
  const at = rows[0].map(norm);
  const iId = at.findIndex((h) => /^test(case)?id$/.test(h));
  const iReq = at.indexOf('requirementid');
  for (const [n, r] of rows.slice(1).entries()) {
    if (r.length < 2 || !r.join('').trim()) continue;
    testCases.push({
      phase,
      testId: iId >= 0 ? (r[iId] ?? '').trim() : '',
      requirementId: iReq >= 0 ? (r[iReq] ?? '').trim() : '',
      source: `${relative(SOURCE, file)}#row${n + 2}`,
    });
  }
}
const testsByRequirement = new Map();
for (const t of testCases) {
  if (!t.requirementId) continue;
  if (!testsByRequirement.has(t.requirementId)) testsByRequirement.set(t.requirementId, []);
  testsByRequirement.get(t.requirementId).push(t);
}

/* ------------------------------------------------------------ classification */
/*
 * From the governed sources rather than from the file type. A phase decides the
 * default — P21 and P22 govern the build, P28 is security, P20 and P32 are
 * validation — and the requirement's own domain refines it where it says so.
 * Left as `Unclassified` rather than guessed when neither speaks.
 */
const PHASE_CLASS = {
  P01: 'Governance / Build Control', P21: 'Governance / Build Control',
  P22: 'Governance / Build Control', P23: 'Governance / Build Control',
  P99: 'Governance / Build Control',
  P28: 'Security / Compliance',
  P03: 'Data / Integration', P29: 'Data / Integration',
  P20: 'Testing / Validation', P32: 'Testing / Validation',
};
const classify = (r) => {
  const d = r.domain.toLowerCase();
  if (/security|zero.?trust|privacy|threat|audit/.test(d)) return 'Security / Compliance';
  if (/test|validation|qa|acceptance/.test(d)) return 'Testing / Validation';
  if (/governance|control|compliance/.test(d)) return 'Governance / Build Control';
  if (/data|integration|api|schema|warehouse|etl/.test(d)) return 'Data / Integration';
  if (PHASE_CLASS[r.homePhase]) return PHASE_CLASS[r.homePhase];
  return d ? 'Product Behavior' : 'Unclassified';
};
for (const r of population) r.classification = classify(r);

mkdirSync(join(ROOT, OUT), { recursive: true });

const summary = {
  generated: new Date().toISOString().slice(0, 10),
  ruling: 'GES governance ruling, 19 September 2026',
  authoritative_unique_requirements: byId.size,
  source_occurrences: population.length,
  duplicate_ids: duplicated.length,
  phase_registries_read: registryReport.filter((r) => r.rows > 0).length,
  phase_registries_unreadable: registryReport.filter((r) => r.rows === 0).length,
  master_registers_joined_not_counted: masterRegisters.map((m) => relative(SOURCE, m.file)),
  by_home_phase: Object.fromEntries(
    [...new Set(population.map((r) => r.homePhase))].sort()
      .map((p) => [p, population.filter((r) => r.homePhase === p).length]),
  ),
  acceptance_criteria: {
    with: population.filter((r) => r.acceptance).length,
    without: population.filter((r) => !r.acceptance).length,
  },
  reconciliation_joins: {
    requirements_with_p21_metadata: [...reconciliation.values()].filter((v) => v.p21).length,
    requirements_with_p22_metadata: [...reconciliation.values()].filter((v) => v.p22).length,
    note: 'Joined onto original requirement IDs. Not counted as requirements.',
  },
  p99_register_completeness_defect: {
    incorporated: incorporated.size,
    omitted_from_p99: p99Omissions.length,
    present_in_p99_but_in_no_phase_registry: p99Phantom.length,
    note: 'Recorded per ruling 1. Not repaired in this pass.',
  },
  governed_test_cases: {
    total: testCases.length,
    registries: testFiles.length,
    linked_to_a_requirement: testCases.filter((t) => t.requirementId).length,
    distinct_requirement_ids_referenced: testsByRequirement.size,
    /* The intersection, which is the number that means anything: a test naming
       an id that is in no governed registry covers nothing. */
    baseline_requirements_with_a_governed_test:
      [...byId.keys()].filter((id) => testsByRequirement.has(id)).length,
    tests_naming_an_id_outside_the_baseline:
      [...testsByRequirement.keys()].filter((id) => !byId.has(id)).length,
  },
  by_classification: Object.fromEntries(
    [...new Set(population.map((r) => r.classification))].sort()
      .map((c) => [c, population.filter((r) => r.classification === c).length]),
  ),
};

writeFileSync(join(ROOT, OUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(ROOT, OUT, 'registries.json'), `${JSON.stringify(registryReport, null, 2)}\n`);

console.log(`authoritative unique requirements : ${summary.authoritative_unique_requirements}`);
console.log(`source occurrences                : ${summary.source_occurrences}`);
console.log(`duplicate ids                     : ${summary.duplicate_ids}`);
console.log(`phase registries read             : ${summary.phase_registries_read}`);
console.log(`registries with no id column      : ${summary.phase_registries_unreadable}`);
console.log(`with governed acceptance criteria : ${summary.acceptance_criteria.with}`);
console.log(`without                           : ${summary.acceptance_criteria.without}`);
console.log(`governed test cases               : ${summary.governed_test_cases.total}`);
console.log(`  linked to a requirement         : ${summary.governed_test_cases.linked_to_a_requirement}`);
console.log(`  baseline reqs with a test       : ${summary.governed_test_cases.baseline_requirements_with_a_governed_test}`);
console.log(`  tests naming an unknown id      : ${summary.governed_test_cases.tests_naming_an_id_outside_the_baseline}`);
console.log(`P99 omissions (defect, unrepaired): ${summary.p99_register_completeness_defect.omitted_from_p99}`);
console.log(`P21 metadata joined               : ${summary.reconciliation_joins.requirements_with_p21_metadata}`);
console.log(`P22 metadata joined               : ${summary.reconciliation_joins.requirements_with_p22_metadata}`);
console.log('classification:', JSON.stringify(summary.by_classification));

writeFileSync(join(ROOT, OUT, 'p99-omissions.json'),
  `${JSON.stringify({ note: 'Ruling 1: P99 register-completeness defect. In scope, not repaired.', count: p99Omissions.length, ids: p99Omissions }, null, 2)}\n`);
