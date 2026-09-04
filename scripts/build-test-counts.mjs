/**
 * The test count in the documentation, taken from the runs rather than typed.
 *
 * `docs/BUILD-SUMMARY.md` carries a table of how many tests each suite has and
 * what they total. That table was maintained by hand and drifted — most
 * recently to 1,769 against a real 1,734, an arithmetic slip that then
 * propagated into three verification verdicts before anybody added it up.
 *
 * It is now generated. Every suite writes a JSON report as it runs, this reads
 * them, and `--check` fails the build when the table and the runs disagree.
 * The numbers a reader sees are the numbers the suites produced.
 *
 * Counting `it(` in the source would have been simpler and wrong: the engine
 * and database suites generate cases with `it.each` and with loops, so the
 * source count is 1,610 against a real 1,734. A proxy that is 7% low is worse
 * than no check, because it looks like one.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS = join(ROOT, '.test-results');
const SUMMARY = join(ROOT, 'docs/BUILD-SUMMARY.md');

/**
 * Suite order as the table reads: the report name, the label a reader sees,
 * and the description the row carries.
 *
 * The label is written out rather than derived from the name, because
 * capitalizing the first letter turns `pdf` into "Pdf" and `db` into "Db".
 */
const SUITES = [
  ['engine', 'Engine', 'estimating, surfaces, calendars, critical path'],
  ['pdf', 'PDF', 'parsing the bytes it emits'],
  ['db', 'Database', 'against real PostgreSQL 18 (PGlite)'],
  ['functions', 'Functions', 'billing, plan versioning, AI governance, API, observability'],
  ['governance', 'Governance', 'the five-category rule, traceability, verification, spelling, pipeline'],
  ['web', 'Web', 'jsdom + Testing Library'],
];

const check = process.argv.includes('--check');
const counts = [];
const missing = [];

for (const [name] of SUITES) {
  const path = join(RESULTS, `${name}.json`);
  if (!existsSync(path)) { missing.push(name); continue; }
  const report = JSON.parse(readFileSync(path, 'utf8'));
  // Vitest's JSON reporter reports totals the same way Jest's does.
  const total = report.numTotalTests ?? 0;
  const failed = report.numFailedTests ?? 0;
  if (failed > 0) {
    console.error(`${name} reported ${failed} failing tests; counts are not recorded from a red run.`);
    process.exit(1);
  }
  counts.push([name, total]);
}

if (missing.length) {
  console.error(`No run report for: ${missing.join(', ')}.`);
  console.error('Run `npm run test` first — each suite writes .test-results/<suite>.json as it runs.');
  process.exit(2);
}

const total = counts.reduce((sum, [, n]) => sum + n, 0);
// Thousands separators, so the table reads the way the prose beside it does.
const fmt = (n) => n.toLocaleString('en-US');
const labelWidth = Math.max(...SUITES.map(([, label]) => label.length));
const width = Math.max(...counts.map(([, n]) => fmt(n).length), fmt(total).length);
const pad = (n) => fmt(n).padStart(width);

const block = [
  '```',
  ...SUITES.map(([, label, note], i) =>
    label.padEnd(labelWidth) + `  ${pad(counts[i][1])} tests   ${note}`),
  ' '.repeat(labelWidth + 2) + '─'.repeat(width + 6),
  ' '.repeat(labelWidth + 2) + `${pad(total)} tests`,
  '```',
].join('\n');

const text = readFileSync(SUMMARY, 'utf8');
const fence = /```\nEngine[\s\S]*?\n```/;
if (!fence.test(text)) {
  console.error('Could not find the suite table in docs/BUILD-SUMMARY.md.');
  process.exit(2);
}

const withBlock = text.replace(fence, block);
const withTotal = withBlock.replace(
  /drift checks, [\d,]+ tests, production build/,
  `drift checks, ${total.toLocaleString('en-US')} tests, production build`);

if (check) {
  if (withTotal !== text) {
    console.error('docs/BUILD-SUMMARY.md does not state the counts the suites produced.');
    console.error(`The runs total ${total.toLocaleString('en-US')}. Run: npm run counts`);
    process.exit(1);
  }
  console.log(`Build summary matches the runs (${total.toLocaleString('en-US')} tests).`);
} else {
  writeFileSync(SUMMARY, withTotal);
  console.log(`Build summary updated from the runs: ${counts.map(([n, c]) => `${n} ${c}`).join(', ')}`);
  console.log(`Total ${total.toLocaleString('en-US')}.`);
}
