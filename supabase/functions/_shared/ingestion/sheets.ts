/**
 * Identifying what a drawing sheet is, from its own text.
 *
 * A construction set is organized by discipline, and the sheet number encodes
 * it: C-301 is civil, S-201 structural, E-101 electrical. That convention is
 * near-universal, which means a sheet number found in the text layer classifies
 * the sheet deterministically — no model, no cost, no possibility of a
 * confident wrong answer.
 *
 * This runs before any AI stage, and everything it establishes is withheld from
 * the model as a fact rather than asked as a question. The model is expensive
 * and occasionally wrong; a regular expression over a numbering convention is
 * neither.
 */

export type Discipline =
  | 'general' | 'civil' | 'landscape' | 'structural' | 'architectural'
  | 'mechanical' | 'electrical' | 'plumbing' | 'fire_protection'
  | 'survey' | 'demolition' | 'utility' | 'unknown';

/**
 * Sheet-number prefixes by discipline, per the US National CAD Standard.
 *
 * Longer prefixes are matched first so `FP` is not read as `F`.
 */
const PREFIXES: readonly (readonly [string, Discipline])[] = [
  ['FP', 'fire_protection'],
  ['CD', 'demolition'],
  ['AD', 'demolition'],
  ['CU', 'utility'],
  ['SV', 'survey'],
  ['G', 'general'],
  ['C', 'civil'],
  ['L', 'landscape'],
  ['S', 'structural'],
  ['A', 'architectural'],
  ['M', 'mechanical'],
  ['E', 'electrical'],
  ['P', 'plumbing'],
  ['F', 'fire_protection'],
  ['V', 'survey'],
  ['D', 'demolition'],
  ['U', 'utility'],
];

/** `C-301`, `C301`, `C 301`, `C-3.01` — every form a title block actually uses. */
const SHEET_NUMBER = /\b([A-Z]{1,2})[\s-]?(\d{1,3}(?:\.\d{1,2})?)\b/g;

export interface SheetIdentity {
  sheetNumber: string | null;
  discipline: Discipline;
  title: string | null;
  /** How the identity was reached, so a wrong one can be traced. */
  basis: string;
  confidence: 'high' | 'medium' | 'low';
}

/** Words that appear in a title block and mark the line after as the title. */
const TITLE_CUES = [
  'SHEET TITLE', 'DRAWING TITLE', 'TITLE:', 'SHEET NAME',
];

/** Phrases that identify a sheet even without a number. */
const CONTENT_CUES: readonly (readonly [RegExp, Discipline, string])[] = [
  [/\b(GRADING|DRAINAGE)\s+PLAN\b/i, 'civil', 'grading or drainage plan'],
  [/\bEROSION\s+(AND\s+SEDIMENT\s+)?CONTROL\b/i, 'civil', 'erosion control'],
  [/\b(UTILITY|UTILITIES)\s+PLAN\b/i, 'utility', 'utility plan'],
  [/\bSITE\s+PLAN\b/i, 'civil', 'site plan'],
  [/\bDEMOLITION\s+PLAN\b/i, 'demolition', 'demolition plan'],
  [/\bFOUNDATION\s+PLAN\b/i, 'structural', 'foundation plan'],
  [/\bPLAN\s+(AND|&)\s+PROFILE\b/i, 'civil', 'plan and profile'],
  [/\bCROSS\s+SECTIONS?\b/i, 'civil', 'cross sections'],
  [/\bTOPOGRAPHIC\s+SURVEY\b/i, 'survey', 'topographic survey'],
  [/\bLANDSCAPE\s+PLAN\b/i, 'landscape', 'landscape plan'],
  [/\bELECTRICAL\s+(SITE\s+)?PLAN\b/i, 'electrical', 'electrical plan'],
  [/\b(COVER|TITLE)\s+SHEET\b/i, 'general', 'cover sheet'],
  [/\bGENERAL\s+NOTES\b/i, 'general', 'general notes'],
  [/\bDETAILS?\b/i, 'general', 'details'],
];

export function disciplineFromPrefix(prefix: string): Discipline {
  const upper = prefix.toUpperCase();
  for (const [p, d] of PREFIXES) {
    if (upper === p) return d;
  }
  return 'unknown';
}

/**
 * Identify a sheet from the text extracted from it.
 *
 * Sheet numbers are searched from the end of the text because a title block
 * sits in the bottom-right corner, and content streams are usually written in
 * roughly reading order — so the last plausible number is far more often the
 * sheet's own than a cross-reference to another sheet in a callout.
 */
export function identifySheet(text: string): SheetIdentity {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean === '') {
    return {
      sheetNumber: null, discipline: 'unknown', title: null,
      basis: 'The sheet has no text layer to read.', confidence: 'low',
    };
  }

  const upper = clean.toUpperCase();
  const candidates = [...upper.matchAll(SHEET_NUMBER)]
    .map((m) => ({ prefix: m[1]!, number: m[2]!, index: m.index ?? 0 }))
    .filter((c) => disciplineFromPrefix(c.prefix) !== 'unknown');

  let sheetNumber: string | null = null;
  let discipline: Discipline = 'unknown';
  let basis = '';
  let confidence: SheetIdentity['confidence'] = 'low';

  if (candidates.length > 0) {
    const chosen = candidates[candidates.length - 1]!;
    sheetNumber = `${chosen.prefix}-${chosen.number}`;
    discipline = disciplineFromPrefix(chosen.prefix);
    // A sheet number appearing once is almost certainly the sheet's own; one
    // appearing repeatedly is usually a callout referencing another sheet.
    const occurrences = candidates.filter(
      (c) => c.prefix === chosen.prefix && c.number === chosen.number).length;
    confidence = occurrences === 1 ? 'high' : 'medium';
    basis = `Sheet number ${sheetNumber} read from the text layer; `
      + `the "${chosen.prefix}" prefix is ${discipline.replace('_', ' ')} under the National CAD Standard.`;
  }

  // Content cues corroborate, or stand in when there is no number at all.
  let title: string | null = null;
  for (const cue of TITLE_CUES) {
    const at = upper.indexOf(cue);
    if (at === -1) continue;
    const after = clean.slice(at + cue.length).trim();
    const candidate = after.split(/\s{2,}|\||\bSHEET\b|\bPROJECT\b/i)[0]?.trim();
    if (candidate && candidate.length >= 3 && candidate.length <= 80) { title = candidate; break; }
  }

  for (const [pattern, d, label] of CONTENT_CUES) {
    if (!pattern.test(clean)) continue;
    if (title === null) title = label.replace(/\b\w/g, (c) => c.toUpperCase());
    if (discipline === 'unknown') {
      discipline = d;
      confidence = 'medium';
      basis = `No sheet number found; identified as ${label} from the sheet text.`;
    } else if (d === discipline) {
      // The number and the content agree, which is the strongest signal there is.
      if (confidence === 'medium') confidence = 'high';
      basis += ` Corroborated by "${label}" appearing on the sheet.`;
    }
    break;
  }

  if (basis === '') basis = 'No sheet number or recognizable sheet type was found in the text.';

  return { sheetNumber, discipline, title, basis, confidence };
}

/** A drawing index built from the sheets, in the order they appear. */
export interface IndexEntry {
  pageNumber: number;
  sheetNumber: string | null;
  discipline: Discipline;
  title: string | null;
  confidence: SheetIdentity['confidence'];
}

export function buildDrawingIndex(pages: readonly { pageNumber: number; text: string }[]): {
  entries: IndexEntry[];
  duplicates: string[];
  byDiscipline: Record<string, number>;
} {
  const entries: IndexEntry[] = pages.map((p) => {
    const id = identifySheet(p.text);
    return {
      pageNumber: p.pageNumber,
      sheetNumber: id.sheetNumber,
      discipline: id.discipline,
      title: id.title,
      confidence: id.confidence,
    };
  });

  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  for (const e of entries) {
    if (!e.sheetNumber) continue;
    const n = (seen.get(e.sheetNumber) ?? 0) + 1;
    seen.set(e.sheetNumber, n);
    // Two sheets with the same number is a real condition — a revised sheet
    // bound into the set alongside the original — and someone has to decide
    // which governs. It is surfaced, never silently deduplicated.
    if (n === 2) duplicates.push(e.sheetNumber);
  }

  const byDiscipline: Record<string, number> = {};
  for (const e of entries) byDiscipline[e.discipline] = (byDiscipline[e.discipline] ?? 0) + 1;

  return { entries, duplicates, byDiscipline };
}
