/**
 * A minimal, correct PDF 1.7 writer.
 *
 * Written rather than taken from a library for three reasons. It runs
 * unchanged in the browser, in Node and in a Deno Edge Function, so a proposal
 * rendered on screen and one rendered by a scheduled job are byte-identical.
 * It adds no dependency to a document path that handles contract values. And
 * it is deterministic: the same document produces the same bytes, which is
 * what lets a pay application be hashed and compared.
 *
 * Scope is deliberately narrow — the Core-14 fonts, text, lines and filled
 * rectangles. That is the whole vocabulary a proposal, a report and an AIA-style
 * pay application need.
 */

import { measure, sanitize, type StandardFont } from './metrics.js';

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }

/** US Letter and A4 at 72 points per inch. */
export const PAGE_SIZES = {
  letter: { width: 612, height: 792 },
  letterLandscape: { width: 792, height: 612 },
  a4: { width: 595.28, height: 841.89 },
  a4Landscape: { width: 841.89, height: 595.28 },
} as const satisfies Record<string, Size>;

export type Rgb = readonly [number, number, number];

export const BLACK: Rgb = [0, 0, 0];
export const WHITE: Rgb = [1, 1, 1];

/** Convert `#rrggbb` to the 0-1 components PDF wants. */
export function color(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new RangeError(`Not a hex color: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Round to 3 decimals so output is stable and compact. */
function num(v: number): string {
  if (!Number.isFinite(v)) throw new RangeError(`Non-finite coordinate: ${v}`);
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

/**
 * Escape a string for a PDF literal.
 *
 * Backslash and both parentheses must be escaped or the content stream becomes
 * unparseable — an unescaped `)` in a company name ends the string early and
 * corrupts every object after it.
 */
function pdfString(s: string): string {
  return `(${s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
}

export type Align = 'left' | 'center' | 'right';

export interface TextOptions {
  font?: StandardFont;
  size?: number;
  color?: Rgb;
  align?: Align;
  /** Width the alignment is measured within. Required for center and right. */
  width?: number;
  /** Extra space between characters, in points. */
  charSpacing?: number;
}

interface PageState {
  size: Size;
  ops: string[];
}

export interface DocumentInfo {
  title: string;
  author?: string;
  subject?: string;
  /** Fixed so the same document renders to the same bytes. */
  createdAt?: Date;
}

export class PdfDocument {
  private pages: PageState[] = [];
  private current: PageState | null = null;
  /** Characters that had no glyph, surfaced rather than silently replaced. */
  readonly droppedCharacters = new Set<string>();

  constructor(private readonly info: DocumentInfo) {}

  get pageCount(): number { return this.pages.length; }

  get page(): PageState {
    if (!this.current) throw new Error('No page has been started. Call addPage() first.');
    return this.current;
  }

  addPage(size: Size = PAGE_SIZES.letter): this {
    this.current = { size, ops: [] };
    this.pages.push(this.current);
    return this;
  }

  /** Width of `text` as it will actually be drawn. */
  measure(text: string, font: StandardFont = 'Helvetica', size = 10): number {
    return measure(sanitize(text).text, font, size);
  }

  /**
   * Draw text with its baseline at `y`.
   *
   * Coordinates are PDF-native: the origin is the bottom-left of the page and
   * y increases upward. The layout module above this converts from the
   * top-down coordinates people actually think in.
   */
  text(value: string, x: number, y: number, options: TextOptions = {}): this {
    const font = options.font ?? 'Helvetica';
    const size = options.size ?? 10;
    const fill = options.color ?? BLACK;
    const clean = sanitize(value);
    for (const ch of clean.dropped) this.droppedCharacters.add(ch);
    if (clean.text === '') return this;

    let drawX = x;
    if (options.align && options.align !== 'left') {
      if (options.width === undefined) {
        throw new Error(`A ${options.align}-aligned string needs a width to align within.`);
      }
      const w = measure(clean.text, font, size);
      drawX = options.align === 'right' ? x + options.width - w : x + (options.width - w) / 2;
    }

    const ops = this.page.ops;
    ops.push('BT');
    ops.push(`/${font === 'Helvetica-Bold' ? 'F2' : 'F1'} ${num(size)} Tf`);
    if (options.charSpacing) ops.push(`${num(options.charSpacing)} Tc`);
    ops.push(`${num(fill[0])} ${num(fill[1])} ${num(fill[2])} rg`);
    ops.push(`1 0 0 1 ${num(drawX)} ${num(y)} Tm`);
    ops.push(`${pdfString(clean.text)} Tj`);
    if (options.charSpacing) ops.push('0 Tc');
    ops.push('ET');
    return this;
  }

  rect(x: number, y: number, width: number, height: number, fill: Rgb): this {
    this.page.ops.push(
      `${num(fill[0])} ${num(fill[1])} ${num(fill[2])} rg`,
      `${num(x)} ${num(y)} ${num(width)} ${num(height)} re f`,
    );
    return this;
  }

  line(from: Point, to: Point, stroke: Rgb = BLACK, width = 0.5): this {
    this.page.ops.push(
      `${num(stroke[0])} ${num(stroke[1])} ${num(stroke[2])} RG`,
      `${num(width)} w`,
      `${num(from.x)} ${num(from.y)} m ${num(to.x)} ${num(to.y)} l S`,
    );
    return this;
  }

  /** A horizontal rule, the case this is used for almost every time. */
  rule(x: number, y: number, width: number, stroke: Rgb = BLACK, thickness = 0.5): this {
    return this.line({ x, y }, { x: x + width, y }, stroke, thickness);
  }

  /**
   * Serialize the document.
   *
   * The cross-reference table must record the exact byte offset of every
   * object, so the body is built first and measured as it goes. Getting an
   * offset wrong produces a file that some readers open and others reject,
   * which is the worst possible failure mode for a document sent to an owner.
   */
  toBytes(): Uint8Array {
    if (this.pages.length === 0) throw new Error('A PDF must have at least one page.');

    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    let offset = 0;
    const push = (s: string): void => {
      const bytes = encoder.encode(s);
      chunks.push(bytes);
      offset += bytes.length;
    };

    // 1 catalog, 2 pages, 3 font, 4 bold font, 5 info, then per page: page + contents.
    const FIRST_PAGE_OBJ = 6;
    const pageObjNums = this.pages.map((_, i) => FIRST_PAGE_OBJ + i * 2);
    const totalObjects = FIRST_PAGE_OBJ - 1 + this.pages.length * 2;
    const offsets = new Map<number, number>();

    push('%PDF-1.7\n');
    // A binary comment marks the file as binary for tools that sniff content.
    push('%\xE2\xE3\xCF\xD3\n');

    const obj = (n: number, body: string): void => {
      offsets.set(n, offset);
      push(`${n} 0 obj\n${body}\nendobj\n`);
    };

    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Count ${this.pages.length} /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] >>`);
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

    const created = this.info.createdAt ?? new Date(0);
    const stamp = (d: Date): string => {
      const p = (n: number, w = 2) => String(n).padStart(w, '0');
      return `D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
        + `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
    };
    obj(5, [
      '<<',
      `/Title ${pdfString(sanitize(this.info.title).text)}`,
      this.info.author ? `/Author ${pdfString(sanitize(this.info.author).text)}` : '',
      this.info.subject ? `/Subject ${pdfString(sanitize(this.info.subject).text)}` : '',
      '/Producer (GrounUp Enterprise)',
      `/CreationDate (${stamp(created)})`,
      '>>',
    ].filter((l) => l !== '').join('\n'));

    this.pages.forEach((p, i) => {
      const pageNum = pageObjNums[i]!;
      const contentNum = pageNum + 1;
      obj(pageNum, [
        '<< /Type /Page /Parent 2 0 R',
        `/MediaBox [0 0 ${num(p.size.width)} ${num(p.size.height)}]`,
        '/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >>',
        `/Contents ${contentNum} 0 R >>`,
      ].join(' '));

      const stream = p.ops.join('\n');
      offsets.set(contentNum, offset);
      push(`${contentNum} 0 obj\n<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream\nendobj\n`);
    });

    const xrefOffset = offset;
    push(`xref\n0 ${totalObjects + 1}\n`);
    push('0000000000 65535 f \n');
    for (let n = 1; n <= totalObjects; n++) {
      const at = offsets.get(n);
      if (at === undefined) throw new Error(`Object ${n} was never written; the xref table would be wrong.`);
      push(`${String(at).padStart(10, '0')} 00000 n \n`);
    }
    push(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R /Info 5 0 R >>\n`);
    push(`startxref\n${xrefOffset}\n%%EOF\n`);

    const out = new Uint8Array(offset);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }
}
