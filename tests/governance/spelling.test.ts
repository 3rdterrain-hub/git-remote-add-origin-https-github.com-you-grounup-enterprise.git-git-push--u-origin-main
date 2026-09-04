/**
 * American English, enforced.
 *
 * The platform was corrected once already — 260 British spellings across 78
 * files — and 47 more appeared in a single session of new writing afterwards,
 * including one inside a SQL enum value (`estimator_judgement`) where the
 * spelling would have reached stored data. A correction pass that is not
 * enforced is a correction pass you get to do again.
 *
 * Two rules, because British spelling is not one pattern:
 *
 *  1. The -ise/-isation family, matched generatively rather than by list, so a
 *     word nobody thought of ("prioritisation") still fails. The false
 *     positives are a small, closed set of English words that legitimately end
 *     in -ise ("premise", "otherwise"), and they are named below.
 *  2. Everything else — -our, -re, -ence, doubled-l, and the construction and
 *     fleet vocabulary where the difference actually shows up on screen
 *     ("kerb", "tyre", "storey", "levelling", "mould", "aluminium").
 *
 * Markdown inline code and fenced blocks are skipped. A word in backticks is
 * a quoted token — an external API field name, or a word being discussed as a
 * word — not the platform's own prose. Identifiers are checked in the source
 * files they live in, where nothing is stripped.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.vite']);
const SCANNED = /\.(ts|tsx|js|jsx|mjs|cjs|sql|json|md|css|html)$/;
// This file is the one exemption, and it has to be: it names every British
// spelling in order to reject it, so scanning itself it would always fail.
// Nothing else is exempt, including generated files and documentation.
const SKIP_FILES = new Set(['package-lock.json', 'spelling.test.ts']);

/** Words that legitimately end in -ise/-ised/-ising in American English. */
const ALLOWED_ISE_STEMS = [
  'advertis', 'advis', 'apprais', 'aris', 'bruis', 'chastis', 'circumcis',
  'clockwis', 'compris', 'compromis', 'concis', 'counterclockwis', 'cris',
  'cruis', 'demis', 'despis', 'devis', 'disabl', 'enterpris', 'exercis',
  'expertis', 'franchis', 'guis', 'improvis', 'incis', 'likewis', 'merchandis',
  'nois', 'otherwis', 'pairwis', 'paradis', 'pois', 'prais', 'precis',
  'premis', 'promis', 'rais', 'revis', 'ris', 'stepwis', 'supervis', 'surmis',
  'surpris', 'televis', 'treatis', 'wis',
];

const ISE_FAMILY = /\b[A-Za-z]+is(?:e|es|ed|ing|ation|ations|able)\b/g;

/** -yse verbs. "analyses" is excluded: it is the American plural of analysis. */
const YSE_FAMILY = /\b[A-Za-z]+lys(?:e|ed|ing)\b/g;

/** Everything the -ise rule cannot see. Ordered by family, not alphabetically. */
const BRITISH_WORDS = [
  // -our
  'colour', 'honour', 'favour', 'labour', 'behaviour', 'neighbour', 'harbour',
  'humour', 'rumour', 'savour', 'vapour', 'odour', 'valour', 'armour',
  'parlour', 'endeavour', 'flavour', 'splendour', 'candour', 'clamour',
  // -re
  'centre', 'metre', 'litre', 'fibre', 'calibre', 'theatre', 'sombre',
  'lustre', 'spectre', 'sceptre', 'manoeuvr', 'meagre', 'ochre',
  // -ence / -ise noun-verb pairs
  'defence', 'offence', 'pretence', 'licence', 'practise',
  // doubled consonant
  'labelled', 'labelling', 'modelling', 'modelled', 'travelled', 'travelling',
  'cancelled', 'cancelling', 'fuelled', 'fuelling', 'levelled', 'levelling',
  'signalled', 'signalling', 'marvellous', 'enrolment', 'instalment',
  'fulfilment', 'skilful', 'wilful', 'woollen', 'tranquillity',
  // -gue / -ment
  'catalogue', 'analogue', 'programme', 'judgement', 'acknowledgement',
  // trades, sites, fleet — where this shows up in front of a customer
  'aluminium', 'kerb', 'storey', 'plough', 'draught', 'mould', 'tyre',
  'grey', 'ageing', 'dependant', 'speciality', 'cheque', 'jewellery',
  // -ae / -oe and general prose
  'anaemi', 'oedema', 'foetus', 'encyclopaedia', 'whilst', 'amongst', 'gaol',
  'sulphur', 'aeroplane', 'moustache', 'pyjamas',
];

/** `fulfil` but not `fulfill`; `enrol` but not `enroll`. */
const SINGLE_L = /\b(?:fulfil|enrol|instil|distil|appal|annul(?=\b))(?!l)/gi;

const BRITISH_RE = new RegExp(`\\b(?:${BRITISH_WORDS.join('|')})[a-z]*`, 'gi');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (SCANNED.test(entry.name) && !SKIP_FILES.has(entry.name)) out.push(path);
  }
  return out;
}

/** Markdown prose only: a backticked word is a quotation, not a spelling. */
function prose(path: string, text: string): string {
  if (!path.endsWith('.md')) return text;
  return text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]*`/g, (span) => ' '.repeat(span.length));
}

type Hit = { file: string; line: number; word: string };

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const path of sourceFiles(ROOT)) {
    if (statSync(path).size > 4_000_000) continue;
    const file = relative(ROOT, path);
    const lines = prose(path, readFileSync(path, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      const record = (word: string) => hits.push({ file, line: i + 1, word });
      for (const m of line.matchAll(ISE_FAMILY)) {
        const word = m[0].toLowerCase();
        if (!ALLOWED_ISE_STEMS.some((stem) => word.startsWith(stem))) record(m[0]);
      }
      for (const m of line.matchAll(YSE_FAMILY)) record(m[0]);
      for (const m of line.matchAll(BRITISH_RE)) record(m[0]);
      for (const m of line.matchAll(SINGLE_L)) record(m[0]);
    });
  }
  return hits;
}

describe('American English', () => {
  const hits = scan();

  it('has no British spelling anywhere in the source tree', () => {
    // Report every one at once. Fixing these a test run at a time on a tree
    // this size is how the first correction pass took a day.
    expect(hits.map((h) => `${h.file}:${h.line}  ${h.word}`)).toEqual([]);
  });

  it('scans the files a reader would actually see', () => {
    const files = sourceFiles(ROOT).map((p) => relative(ROOT, p));
    expect(files).toContain('apps/web/src/pages/app/settings.tsx');
    expect(files).toContain('supabase/migrations/0001_foundation.sql');
    expect(files).toContain('governance/traceability/verification/P28-verdicts.json');
    expect(files.length).toBeGreaterThan(200);
    // The exemption is this file and the lockfile. Not a growing list.
    expect([...SKIP_FILES]).toEqual(['package-lock.json', 'spelling.test.ts']);
  });

  it('still catches a British spelling that is not in any list', () => {
    // The -ise rule has to be generative, or it only finds yesterday's words.
    const invented = 'The crew will prioritise and then decentralise the yard.';
    const found = [...invented.matchAll(ISE_FAMILY)]
      .map((m) => m[0].toLowerCase())
      .filter((w) => !ALLOWED_ISE_STEMS.some((s) => w.startsWith(s)));
    expect(found).toEqual(['prioritise', 'decentralise']);
  });

  it('does not flag American words that end in -ise or -yses', () => {
    const fine = 'Otherwise the premise of the exercise raises no noise; the analyses promise precise figures.';
    const flagged = [...fine.matchAll(ISE_FAMILY)]
      .map((m) => m[0].toLowerCase())
      .filter((w) => !ALLOWED_ISE_STEMS.some((s) => w.startsWith(s)))
      .concat([...fine.matchAll(YSE_FAMILY)].map((m) => m[0]));
    expect(flagged).toEqual([]);
  });

  it('reads a quoted word in markdown as a quotation, not a spelling', () => {
    // docs/BUILD-SUMMARY.md names the British words it corrected. Naming them
    // is the documentation; it must not be the failure.
    const md = 'The words `colour` and `utilisation` were corrected.';
    expect(prose('docs/x.md', md)).not.toContain('utilisation');
    expect(prose('src/x.ts', md)).toContain('utilisation');
  });
});
