/**
 * Reading the structure of an uploaded PDF.
 *
 * The first question the pipeline must answer about a drawing set is whether it
 * has a text layer. A vector PDF exported from Civil 3D carries every sheet
 * number, every callout and every note as selectable text; a scan of the same
 * set carries nothing but pixels. Sending the first to OCR wastes money and
 * loses accuracy — OCR of rendered text is strictly worse than the text that
 * was already there. Sending the second anywhere else produces empty sheets.
 *
 * So this module answers three questions before a single token is spent:
 * how many pages, what size is each one, and does it have real text.
 *
 * It parses the PDF directly rather than rendering it. The object graph is
 * enough to count pages and find content streams, and it needs no binary
 * dependency, which is what lets it run inside an Edge Function.
 */

export interface PageInfo {
  /** 1-based, as everyone in construction refers to sheets. */
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  /** Sheet size in inches, rounded — 36 x 24 is a D sheet, 11 x 17 a tabloid. */
  widthIn: number;
  heightIn: number;
  orientation: 'portrait' | 'landscape';
  /** Characters of extractable text found in the page's content stream. */
  textLength: number;
  /** Whether this page carries a usable text layer. */
  hasTextLayer: boolean;
  /** The text found, when there is a layer worth keeping. */
  text: string;
}

export interface PdfInfo {
  pageCount: number;
  pages: PageInfo[];
  /** True when enough pages carry text that OCR would be a waste. */
  hasTextLayer: boolean;
  /** Fraction of pages with a usable text layer. */
  textCoverage: number;
  encrypted: boolean;
  warnings: string[];
}

/**
 * Below this many characters a page is treated as having no text layer.
 *
 * A drawing sheet with a text layer carries hundreds of characters — the title
 * block alone has a dozen fields. A scanned sheet sometimes carries a handful
 * from a digital stamp applied after scanning, and treating that as a text
 * layer would skip OCR on a page that needs it.
 */
export const TEXT_LAYER_THRESHOLD = 40;

/** Fraction of pages that must have text before the set is treated as digital. */
export const TEXT_COVERAGE_THRESHOLD = 0.6;

const POINTS_PER_INCH = 72;

function latin1(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

/**
 * Pull the readable strings out of a content stream.
 *
 * Handles both `(literal) Tj` and the `[(a) -20 (b)] TJ` array form, which is
 * what most producers emit because it lets them adjust kerning. Missing the
 * array form is the classic reason a text-layer detector reports a fully
 * digital drawing set as a scan.
 */
export function extractStreamText(stream: string): string {
  const parts: string[] = [];

  const unescape = (s: string): string => s
    .replace(/\\([nrtbf])/g, (_, c: string) =>
      ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] ?? c))
    .replace(/\\(\d{1,3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)))
    .replace(/\\([()\\])/g, '$1');

  // Literal strings drawn with Tj, ' or "
  for (const m of stream.matchAll(/\(((?:[^()\\]|\\[\s\S]|\([^()]*\))*)\)\s*(?:Tj|'|")/g)) {
    parts.push(unescape(m[1]!));
  }
  // Arrays drawn with TJ: [(Sheet ) -250 (C-301)] TJ
  for (const m of stream.matchAll(/\[((?:[^\][]|\[[^\]]*\])*)\]\s*TJ/g)) {
    let line = '';
    for (const s of m[1]!.matchAll(/\(((?:[^()\\]|\\[\s\S])*)\)/g)) line += unescape(s[1]!);
    if (line !== '') parts.push(line);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Parse a `/MediaBox [a b c d]` into a size in points. */
function parseMediaBox(dict: string): { width: number; height: number } | null {
  const m = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/.exec(dict);
  if (!m) return null;
  const [x0, y0, x1, y1] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return { width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

/**
 * Inspect a PDF without rendering it.
 *
 * Deliberately tolerant: a set that cannot be fully parsed still reports what
 * it could read, with a warning, rather than failing the whole upload. A
 * drawing set arriving from an architect is often produced by software nobody
 * involved controls.
 */
export function inspectPdf(bytes: Uint8Array): PdfInfo {
  const source = latin1(bytes);
  const warnings: string[] = [];

  if (!source.startsWith('%PDF-')) {
    return {
      pageCount: 0, pages: [], hasTextLayer: false, textCoverage: 0, encrypted: false,
      warnings: ['The file does not begin with a PDF header.'],
    };
  }

  // An encrypted document cannot have its content streams read. Saying so is
  // far better than reporting every page as a scan and sending the whole set
  // to OCR.
  const encrypted = /\/Encrypt\s+\d+\s+\d+\s+R/.test(source);
  if (encrypted) {
    warnings.push('The PDF is encrypted. Page text cannot be read until it is supplied without a password.');
  }

  /*
   * Split the file into objects once, then look inside each.
   *
   * Matching `N 0 obj ... << dict >> ... stream` in a single pass looks
   * simpler and is wrong: the dictionary pattern backtracks across object
   * boundaries until it finds one followed by `stream`, so a content stream
   * gets filed under the object number of the catalog. Splitting first makes
   * that impossible.
   */
  const objects: { num: number; body: string }[] = [];
  for (const m of source.matchAll(/(\d+)\s+0\s+obj\b([\s\S]*?)\bendobj/g)) {
    objects.push({ num: Number(m[1]), body: m[2]! });
  }

  const pageObjects = objects
    .filter((o) => /\/Type\s*\/Page(?![a-zA-Z])/.test(o.body))
    .map((o) => ({ num: o.num, dict: o.body }));

  const declared = /\/Type\s*\/Pages[\s\S]{0,400}?\/Count\s+(\d+)/.exec(source);
  if (declared && Number(declared[1]) !== pageObjects.length) {
    warnings.push(
      `The catalog declares ${declared[1]} pages but ${pageObjects.length} page objects were found. `
      + 'The file may use object streams or be incrementally updated.',
    );
  }

  // Content streams, keyed by object number, so a page can find its own.
  const streams = new Map<number, string>();
  for (const o of objects) {
    const m = /^([\s\S]*?)stream\r?\n([\s\S]*)\r?\nendstream\s*$/.exec(o.body);
    if (!m) continue;
    // A compressed stream cannot be read as text here. Rather than emitting
    // mojibake and calling it a text layer, it is skipped and reported.
    if (/\/Filter\s*\/(FlateDecode|LZWDecode|DCTDecode|JPXDecode|CCITTFaxDecode)/.test(m[1]!)) continue;
    streams.set(o.num, m[2]!);
  }

  const compressedPages = pageObjects.filter((p) => {
    const ref = /\/Contents\s+(\d+)\s+0\s+R/.exec(p.dict);
    return ref !== null && !streams.has(Number(ref[1]));
  }).length;
  if (compressedPages > 0) {
    warnings.push(
      `${compressedPages} page(s) use a compressed content stream, which this inspector does not decode. `
      + 'Those pages are reported as having no readable text layer; the extraction stage decompresses them.',
    );
  }

  const inherited = parseMediaBox(source.slice(0, 4000)) ?? { width: 612, height: 792 };

  const pages: PageInfo[] = pageObjects.map((p, i) => {
    const box = parseMediaBox(p.dict) ?? inherited;
    const contentRef = /\/Contents\s+(\d+)\s+0\s+R/.exec(p.dict);
    const stream = contentRef ? streams.get(Number(contentRef[1])) ?? '' : '';
    const text = encrypted ? '' : extractStreamText(stream);
    const round1 = (v: number): number => Math.round(v * 10) / 10;
    return {
      pageNumber: i + 1,
      widthPt: box.width,
      heightPt: box.height,
      widthIn: round1(box.width / POINTS_PER_INCH),
      heightIn: round1(box.height / POINTS_PER_INCH),
      orientation: box.width >= box.height ? 'landscape' : 'portrait',
      textLength: text.length,
      hasTextLayer: text.length >= TEXT_LAYER_THRESHOLD,
      text,
    };
  });

  const withText = pages.filter((p) => p.hasTextLayer).length;
  const coverage = pages.length > 0 ? withText / pages.length : 0;

  return {
    pageCount: pages.length,
    pages,
    hasTextLayer: coverage >= TEXT_COVERAGE_THRESHOLD,
    textCoverage: Number(coverage.toFixed(4)),
    encrypted,
    warnings,
  };
}

/** Common architectural and engineering sheet sizes, in inches. */
export const SHEET_SIZES: readonly { name: string; w: number; h: number }[] = [
  { name: 'ANSI A / Letter', w: 8.5, h: 11 },
  { name: 'ANSI B / Tabloid', w: 11, h: 17 },
  { name: 'ANSI C', w: 17, h: 22 },
  { name: 'ANSI D', w: 22, h: 34 },
  { name: 'ANSI E', w: 34, h: 44 },
  { name: 'ARCH B', w: 12, h: 18 },
  { name: 'ARCH C', w: 18, h: 24 },
  { name: 'ARCH D', w: 24, h: 36 },
  { name: 'ARCH E', w: 30, h: 42 },
  { name: 'ARCH E1', w: 30, h: 42 },
];

/**
 * Name the sheet size, within a tolerance.
 *
 * The size matters because it sets the scale a takeoff is measured at. A
 * D-size sheet printed to letter is half scale, and a takeoff that does not
 * know which it is measuring will be out by a factor of two.
 */
export function identifySheetSize(widthIn: number, heightIn: number, toleranceIn = 0.35): string | null {
  const [short, long] = widthIn <= heightIn ? [widthIn, heightIn] : [heightIn, widthIn];
  for (const s of SHEET_SIZES) {
    const [sShort, sLong] = s.w <= s.h ? [s.w, s.h] : [s.h, s.w];
    if (Math.abs(short - sShort) <= toleranceIn && Math.abs(long - sLong) <= toleranceIn) return s.name;
  }
  return null;
}
