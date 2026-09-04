/**
 * Adobe Core-14 font metrics for Helvetica and Helvetica-Bold.
 *
 * These are needed to lay text out at all: right-aligning a money column,
 * wrapping a scope paragraph and centering a heading each require knowing how
 * wide a string will actually be. Guessing produces columns that overlap in
 * exactly the documents — proposals, pay applications — that go to an owner.
 *
 * Widths are in 1/1000 em, the PDF text-space unit, so a string's width at
 * size N points is (sum of widths) x N / 1000.
 */

export type StandardFont = 'Helvetica' | 'Helvetica-Bold';

/* eslint-disable @typescript-eslint/naming-convention */
const HELVETICA: Record<number, number> = {
  32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 191,
  40: 333, 41: 333, 42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278,
  48: 556, 49: 556, 50: 556, 51: 556, 52: 556, 53: 556, 54: 556, 55: 556,
  56: 556, 57: 556, 58: 278, 59: 278, 60: 584, 61: 584, 62: 584, 63: 556,
  64: 1015, 65: 667, 66: 667, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778,
  72: 722, 73: 278, 74: 500, 75: 667, 76: 556, 77: 833, 78: 722, 79: 778,
  80: 667, 81: 778, 82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944,
  88: 667, 89: 667, 90: 611, 91: 278, 92: 278, 93: 278, 94: 469, 95: 556,
  96: 333, 97: 556, 98: 556, 99: 500, 100: 556, 101: 556, 102: 278, 103: 556,
  104: 556, 105: 222, 106: 222, 107: 500, 108: 222, 109: 833, 110: 556,
  111: 556, 112: 556, 113: 556, 114: 333, 115: 500, 116: 278, 117: 556,
  118: 500, 119: 722, 120: 500, 121: 500, 122: 500, 123: 334, 124: 260,
  125: 334, 126: 584,
};

const HELVETICA_BOLD: Record<number, number> = {
  32: 278, 33: 333, 34: 474, 35: 556, 36: 556, 37: 889, 38: 722, 39: 238,
  40: 333, 41: 333, 42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278,
  48: 556, 49: 556, 50: 556, 51: 556, 52: 556, 53: 556, 54: 556, 55: 556,
  56: 556, 57: 556, 58: 333, 59: 333, 60: 584, 61: 584, 62: 584, 63: 611,
  64: 975, 65: 722, 66: 722, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778,
  72: 722, 73: 278, 74: 556, 75: 722, 76: 611, 77: 833, 78: 722, 79: 778,
  80: 667, 81: 778, 82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944,
  88: 667, 89: 667, 90: 611, 91: 333, 92: 278, 93: 333, 94: 584, 95: 556,
  96: 333, 97: 556, 98: 611, 99: 556, 100: 611, 101: 556, 102: 333, 103: 611,
  104: 611, 105: 278, 106: 278, 107: 556, 108: 278, 109: 889, 110: 611,
  111: 611, 112: 611, 113: 611, 114: 389, 115: 556, 116: 333, 117: 611,
  118: 556, 119: 778, 120: 556, 121: 556, 122: 500, 123: 389, 124: 280,
  125: 389, 126: 584,
};
/* eslint-enable @typescript-eslint/naming-convention */

const TABLES: Record<StandardFont, Record<number, number>> = {
  'Helvetica': HELVETICA,
  'Helvetica-Bold': HELVETICA_BOLD,
};

/**
 * Characters the application genuinely emits that are outside ASCII, mapped to
 * ASCII equivalents.
 *
 * The alternative — encoding WinAnsi and carrying approximate widths for the
 * Latin-1 supplement — would lay text out using widths that are close but
 * wrong, and "close but wrong" in a column of money is a document that has to
 * be reissued. Explicit substitution is visible, testable, and cannot silently
 * misalign a table.
 */
export const TRANSLITERATIONS: ReadonlyMap<string, string> = new Map([
  ['—', '--'],   // em dash
  ['–', '-'],    // en dash
  ['‘', "'"], ['’', "'"],
  ['“', '"'], ['”', '"'],
  ['…', '...'],
  ['°', ' deg'],
  ['×', 'x'],
  ['±', '+/-'],
  [' ', ' '],    // non-breaking space
  ['−', '-'],    // minus sign
  ['½', '1/2'], ['¼', '1/4'], ['¾', '3/4'],
  ['′', "'"],    // prime (feet)
  ['″', '"'],    // double prime (inches)
  ['é', 'e'], ['è', 'e'], ['ê', 'e'],
  ['á', 'a'], ['à', 'a'], ['â', 'a'],
  ['ñ', 'n'], ['ü', 'u'], ['ö', 'o'], ['ç', 'c'],
  ['•', '-'],    // bullet
  ['·', '-'],    // middle dot, used as a separator throughout the app
  ['‐', '-'], ['‑', '-'], ['‒', '-'],  // hyphen variants
  ['§', 'Sec.'],
  ['¶', 'para.'],
  ['€', 'EUR'], ['£', 'GBP'], ['¢', 'c'],
  ['≤', '<='], ['≥', '>='], ['≈', '~'], ['≠', '!='],
  ['¹', '1'], ['²', '2'], ['³', '3'],
  ['Ø', 'dia.'], ['ø', 'dia.'],
  ['\u00ad', ''],  // soft hyphen: invisible, and must not become a '?'
  ['←', '<-'], ['→', '->'],
  ['©', '(c)'], ['®', '(R)'], ['™', '(TM)'],
]);

/** Replacement for a character with no mapping and no glyph. */
export const UNMAPPED = '?';

export interface SanitizeResult {
  text: string;
  /** Characters that had no mapping and were replaced. */
  dropped: string[];
}

/** Reduce a string to the ASCII range the standard fonts render exactly. */
export function sanitize(input: string): SanitizeResult {
  const dropped: string[] = [];
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code >= 32 && code <= 126) { out += ch; continue; }
    if (ch === '\n' || ch === '\t') { out += ch; continue; }
    const mapped = TRANSLITERATIONS.get(ch);
    if (mapped !== undefined) { out += mapped; continue; }
    dropped.push(ch);
    out += UNMAPPED;
  }
  return { text: out, dropped };
}

/** Width of a single already-sanitized character, in 1/1000 em. */
export function charWidth(char: string, font: StandardFont): number {
  const table = TABLES[font];
  const code = char.charCodeAt(0);
  // Every printable ASCII code is present; anything else has been sanitized
  // away before it reaches here, so the space width is a safe last resort.
  return table[code] ?? table[32]!;
}

/** Width of a string at a given point size. */
export function measure(text: string, font: StandardFont, size: number): number {
  let units = 0;
  for (const ch of text) units += charWidth(ch, font);
  return (units * size) / 1000;
}

/**
 * Break text into lines that fit `maxWidth`.
 *
 * Breaks on spaces; a single word longer than the line is broken by character
 * rather than allowed to run past the margin, because a scope description
 * containing a long specification reference should still stay inside the page.
 */
export function wrap(text: string, font: StandardFont, size: number, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph === '') { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (measure(candidate, font, size) <= maxWidth) { line = candidate; continue; }
      if (line !== '') { lines.push(line); line = ''; }

      if (measure(word, font, size) <= maxWidth) { line = word; continue; }
      // A word wider than the whole line: break it rather than overrun.
      let chunk = '';
      for (const ch of word) {
        if (measure(chunk + ch, font, size) > maxWidth && chunk !== '') {
          lines.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines;
}

/** Shorten text to fit, ending in an ellipsis, for a cell that must not wrap. */
export function truncate(text: string, font: StandardFont, size: number, maxWidth: number): string {
  if (measure(text, font, size) <= maxWidth) return text;
  const ellipsis = '...';
  const room = maxWidth - measure(ellipsis, font, size);
  if (room <= 0) return '';
  let out = '';
  for (const ch of text) {
    if (measure(out + ch, font, size) > room) break;
    out += ch;
  }
  return out + ellipsis;
}
