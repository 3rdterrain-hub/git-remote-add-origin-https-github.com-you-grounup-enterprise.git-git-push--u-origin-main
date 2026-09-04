/**
 * A small PDF reader, used only by the tests.
 *
 * Asserting that `toBytes()` returned "some bytes" would prove nothing. These
 * helpers parse the file back — objects, the cross-reference table, the text
 * inside content streams — so a test can check that a document actually
 * contains the number it is supposed to contain, and that the structure a PDF
 * reader relies on is correct.
 */

export function decode(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

/** Every string literal drawn with Tj, in page order. */
export function extractText(bytes: Uint8Array): string[] {
  const source = decode(bytes);
  const out: string[] = [];
  for (const m of source.matchAll(/\((?:[^()\\]|\\.)*\)\s*Tj/g)) {
    const literal = m[0].slice(1, m[0].lastIndexOf(')'));
    out.push(literal.replace(/\\([()\\])/g, '$1'));
  }
  return out;
}

export function pageCount(bytes: Uint8Array): number {
  const m = /\/Type\s*\/Pages\s*\/Count\s+(\d+)/.exec(decode(bytes));
  return m ? Number(m[1]) : 0;
}

export interface XrefCheck { valid: boolean; problems: string[] }

/**
 * Verify the cross-reference table points at the objects it claims to.
 *
 * A wrong offset produces a file some readers open and others reject — the
 * worst failure mode for a document sent to an owner, because it is invisible
 * until it reaches them.
 */
export function checkXref(bytes: Uint8Array): XrefCheck {
  const source = decode(bytes);
  const problems: string[] = [];

  const startxref = /startxref\s+(\d+)\s+%%EOF/.exec(source);
  if (!startxref) return { valid: false, problems: ['No startxref/%%EOF trailer'] };

  const xrefAt = Number(startxref[1]);
  if (!source.startsWith('xref', xrefAt)) problems.push(`startxref points at ${xrefAt}, which is not "xref"`);

  const header = /xref\s+0\s+(\d+)\s/.exec(source.slice(xrefAt));
  if (!header) return { valid: false, problems: ['Malformed xref subsection header'] };
  const count = Number(header[1]);

  const entries = [...source.slice(xrefAt).matchAll(/(\d{10}) (\d{5}) ([nf])\s/g)].slice(0, count);
  if (entries.length !== count) problems.push(`xref declares ${count} entries but ${entries.length} are present`);

  entries.forEach((e, i) => {
    if (i === 0) {
      if (e[3] !== 'f') problems.push('Object 0 must be the free-list head');
      return;
    }
    const at = Number(e[1]);
    if (!new RegExp(`^${i} 0 obj`).test(source.slice(at))) {
      problems.push(`xref entry ${i} points at offset ${at}, which is not "${i} 0 obj"`);
    }
  });

  const trailer = /\/Size\s+(\d+)/.exec(source.slice(xrefAt));
  if (trailer && Number(trailer[1]) !== count) {
    problems.push(`Trailer /Size ${trailer[1]} disagrees with the xref count ${count}`);
  }

  return { valid: problems.length === 0, problems };
}

/** Every content stream declares a /Length; check each one is honest. */
export function checkStreamLengths(bytes: Uint8Array): string[] {
  const source = decode(bytes);
  const problems: string[] = [];
  for (const m of source.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) {
    const declared = Number(m[1]);
    const actual = new TextEncoder().encode(m[2]!).length;
    if (declared !== actual) problems.push(`Stream declares /Length ${declared} but holds ${actual} bytes`);
  }
  return problems;
}

export interface PlacedText { page: number; x: number; y: number; text: string }

/**
 * Every string drawn, with the page and the baseline it was drawn at.
 *
 * Needed to assert that content stays inside the margins. A block that
 * overlaps the footer still produces a structurally valid PDF, so nothing but
 * position tells you it is wrong.
 */
export function placedText(bytes: Uint8Array): PlacedText[] {
  const source = decode(bytes);
  const out: PlacedText[] = [];
  let page = 0;
  for (const stream of source.matchAll(/stream\n([\s\S]*?)\nendstream/g)) {
    page += 1;
    const body = stream[1]!;
    let x = 0;
    let y = 0;
    for (const op of body.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm|\((?:[^()\\]|\\.)*\)\s*Tj/g)) {
      if (op[1] !== undefined) { x = Number(op[1]); y = Number(op[2]); continue; }
      const literal = op[0].slice(1, op[0].lastIndexOf(')'));
      out.push({ page, x, y, text: literal.replace(/\\([()\\])/g, '$1') });
    }
  }
  return out;
}
