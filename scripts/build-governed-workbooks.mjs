#!/usr/bin/env node
/**
 * Control-workbook coverage, counted apart from requirements.
 *
 * Each governed phase ships one Excel control workbook, and each workbook holds
 * its phase's controls on separate sheets — Requirements, Tests, Traceability,
 * Modules, Entities, APIs, Events, Rules, Security, Quality Gates. Thirty-three
 * of them, and until 19 September 2026 nothing in this repository had opened one.
 *
 * They are reported per sheet and never summed into a requirement count. A
 * quality gate is not a requirement, an API contract is not a requirement, and
 * collapsing them into one figure is how a coverage percentage stops meaning
 * anything.
 *
 * Read by shelling out to `unzip -p`: an xlsx is a zip of XML, and a dependency
 * is not worth adding to read a manifest.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = process.cwd();
const SOURCE = 'governance/ges-source';
const OUT = 'governance/governed';

function walk(dir, out = []) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const next = join(dir, e.name);
    if (e.isDirectory()) walk(next, out);
    else out.push(next);
  }
  return out;
}

const entry = (file, name) =>
  execFileSync('unzip', ['-p', file, name], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Sheet names in workbook order, paired with the sheet XML they point at. */
function sheetsOf(file) {
  const wb = entry(file, 'xl/workbook.xml');
  /* Namespaced: the parts are written `<x:sheet>`, not `<sheet>`. A pattern
     that assumes the bare tag silently matches nothing and reports zero sheets,
     which reads exactly like a workbook with no controls in it. */
  const names = [...wb.matchAll(/<(?:\w+:)?sheet\b[^>]*name="([^"]+)"/g)].map((m) => m[1]);
  return names.map((name, i) => ({ name, part: `xl/worksheets/sheet${i + 1}.xml` }));
}

/*
 * Rows that carry a value, minus the header. `<row` appears for styled-but-empty
 * rows too, so rows are counted by the presence of a cell with content rather
 * than by the row tag — an empty row is not a control.
 */
function rowsWithContent(file, part) {
  let xml;
  try { xml = entry(file, part); } catch { return 0; }
  const rows = xml.split(/<(?:\w+:)?row\b/).slice(1);
  const filled = rows.filter((r) => /<(?:\w+:)?c\b/.test(r)
    && /<(?:\w+:)?v>|<(?:\w+:)?is>|t="inlineStr"/.test(r));
  return Math.max(0, filled.length - 1);
}

const workbooks = walk(SOURCE)
  .filter((f) => /\.xlsx$/i.test(f))
  .filter((f, i, all) => all.findIndex((g) => basename(g) === basename(f)) === i)
  .sort();

const report = [];
const sheetTotals = {};

for (const file of workbooks) {
  const phase = file.split('/')[2];
  const sheets = sheetsOf(join(ROOT, file));
  const counted = sheets.map((s) => {
    const n = rowsWithContent(join(ROOT, file), s.part);
    sheetTotals[s.name] = (sheetTotals[s.name] ?? 0) + n;
    return { sheet: s.name, controls: n };
  });
  report.push({ phase, workbook: basename(file), sheets: counted });
}

const summary = {
  generated: new Date().toISOString().slice(0, 10),
  note: 'Control-workbook contents, counted per sheet and never summed into requirements.',
  workbooks: report.length,
  sheets_seen: Object.keys(sheetTotals).length,
  controls_by_sheet: Object.fromEntries(
    Object.entries(sheetTotals).sort((a, b) => b[1] - a[1]),
  ),
};

writeFileSync(join(ROOT, OUT, 'control-workbooks.json'),
  `${JSON.stringify({ summary, workbooks: report }, null, 2)}\n`);

console.log(`control workbooks read : ${summary.workbooks}`);
console.log(`distinct sheets        : ${summary.sheets_seen}`);
for (const [k, v] of Object.entries(summary.controls_by_sheet)) {
  console.log(`  ${k.padEnd(22)} ${String(v).padStart(6)}`);
}
