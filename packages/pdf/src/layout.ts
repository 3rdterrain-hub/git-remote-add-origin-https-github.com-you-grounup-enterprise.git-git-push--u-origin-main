/**
 * Page layout on top of the raw writer.
 *
 * The writer speaks PDF coordinates — origin bottom-left, y increasing upward.
 * Nobody lays out a document that way, so everything here is top-down: `y` is
 * distance from the top of the page, and the flow moves down. Every conversion
 * happens in one place, which is the only way this stays reliable.
 *
 * The layout engine also owns pagination. A table that runs past the bottom of
 * a page continues on the next one with its header repeated — a pay
 * application whose second page has unlabelled columns is a document the
 * architect sends back.
 */

import { PdfDocument, PAGE_SIZES, BLACK, color, type Align, type Rgb, type Size } from './writer.js';
import { measure, truncate, wrap, type StandardFont } from './metrics.js';

export interface Margins { top: number; right: number; bottom: number; left: number }

export const DEFAULT_MARGINS: Readonly<Margins> = Object.freeze({
  top: 54, right: 54, bottom: 54, left: 54,
});

export interface Theme {
  primary: string;
  accent: string;
  text: string;
  muted: string;
  rule: string;
  zebra: string;
}

export const DEFAULT_THEME: Readonly<Theme> = Object.freeze({
  primary: '#111827',
  accent: '#f6c101',
  text: '#111827',
  muted: '#6b7280',
  rule: '#d1d5db',
  zebra: '#f9fafb',
});

export interface Column {
  header: string;
  /** Fraction of the content width, or an absolute width in points. */
  width: number;
  align?: Align;
  bold?: boolean;
  /** Wrap rather than truncate. Wrapping grows the row height. */
  wrap?: boolean;
}

export interface TableOptions {
  columns: Column[];
  rows: string[][];
  fontSize?: number;
  headerFill?: string;
  zebra?: boolean;
  /** Rendered in bold with a rule above, after the last row. */
  totals?: string[];
}

export interface PageFurniture {
  /** Drawn at the top of every page. Return the height it consumed. */
  header?: (doc: LayoutDocument, pageNumber: number) => number;
  /** Drawn at the bottom of every page. */
  footer?: (doc: LayoutDocument, pageNumber: number) => void;
}

export class LayoutDocument {
  readonly pdf: PdfDocument;
  readonly size: Size;
  readonly margins: Margins;
  readonly theme: Theme;
  /** Distance from the top of the page to the next thing drawn. */
  private cursor = 0;
  private furniture: PageFurniture = {};

  constructor(opts: {
    title: string; author?: string; subject?: string; createdAt?: Date;
    size?: Size; margins?: Partial<Margins>; theme?: Partial<Theme>;
  }) {
    this.pdf = new PdfDocument({
      title: opts.title, author: opts.author, subject: opts.subject, createdAt: opts.createdAt,
    });
    this.size = opts.size ?? PAGE_SIZES.letter;
    this.margins = { ...DEFAULT_MARGINS, ...opts.margins };
    this.theme = { ...DEFAULT_THEME, ...opts.theme };
  }

  get contentWidth(): number {
    return this.size.width - this.margins.left - this.margins.right;
  }

  get contentBottom(): number {
    return this.size.height - this.margins.bottom;
  }

  get y(): number { return this.cursor; }
  set y(v: number) { this.cursor = v; }

  get pageNumber(): number { return this.pdf.pageCount; }

  /** Convert a top-down y to the PDF's bottom-up coordinate. */
  private flip(y: number): number { return this.size.height - y; }

  setFurniture(f: PageFurniture): this {
    this.furniture = f;
    return this;
  }

  newPage(): this {
    this.pdf.addPage(this.size);
    this.cursor = this.margins.top;
    if (this.furniture.header) {
      this.cursor += this.furniture.header(this, this.pdf.pageCount);
    }
    if (this.furniture.footer) this.furniture.footer(this, this.pdf.pageCount);
    return this;
  }

  /** Start a new page if `needed` points will not fit below the cursor. */
  ensure(needed: number): this {
    if (this.pdf.pageCount === 0) return this.newPage();
    if (this.cursor + needed > this.contentBottom) this.newPage();
    return this;
  }

  text(value: string, opts: {
    x?: number; width?: number; font?: StandardFont; size?: number;
    color?: string; align?: Align; leading?: number; wrap?: boolean;
  } = {}): this {
    const font = opts.font ?? 'Helvetica';
    const size = opts.size ?? 10;
    const leading = opts.leading ?? size * 1.35;
    const x = opts.x ?? this.margins.left;
    const width = opts.width ?? this.contentWidth;
    const fill = color(opts.color ?? this.theme.text);

    const lines = opts.wrap === false ? [value] : wrap(value, font, size, width);
    for (const line of lines) {
      this.ensure(leading);
      // The baseline sits `size` below the cursor, so a line occupies the
      // space the reader expects it to.
      this.pdf.text(line, x, this.flip(this.cursor + size), {
        font, size, color: fill, align: opts.align, width,
      });
      this.cursor += leading;
    }
    return this;
  }

  heading(value: string, level: 1 | 2 | 3 = 1): this {
    const sizes = { 1: 18, 2: 13, 3: 11 } as const;
    const space = { 1: 10, 2: 8, 3: 6 } as const;
    this.ensure(sizes[level] * 1.6 + space[level]);
    this.text(value, { font: 'Helvetica-Bold', size: sizes[level], color: this.theme.primary });
    this.cursor += space[level];
    return this;
  }

  gap(points: number): this { this.cursor += points; return this; }

  rule(opts: { color?: string; thickness?: number; width?: number } = {}): this {
    this.ensure(opts.thickness ?? 0.5);
    this.pdf.rule(
      this.margins.left, this.flip(this.cursor),
      opts.width ?? this.contentWidth,
      color(opts.color ?? this.theme.rule), opts.thickness ?? 0.5,
    );
    this.cursor += (opts.thickness ?? 0.5) + 1;
    return this;
  }

  fill(height: number, hex: string, opts: { x?: number; width?: number } = {}): this {
    const x = opts.x ?? this.margins.left;
    const w = opts.width ?? this.contentWidth;
    this.pdf.rect(x, this.flip(this.cursor + height), w, height, color(hex));
    return this;
  }

  /** A label/value pair block, used for document metadata. */
  fields(pairs: readonly (readonly [string, string])[], columns = 2): this {
    const colWidth = this.contentWidth / columns;
    const rows = Math.ceil(pairs.length / columns);
    const rowHeight = 26;
    this.ensure(rows * rowHeight);
    const top = this.cursor;
    pairs.forEach(([label, value], i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const x = this.margins.left + col * colWidth;
      const y = top + row * rowHeight;
      this.pdf.text(label.toUpperCase(), x, this.flip(y + 7), {
        font: 'Helvetica-Bold', size: 6.5, color: color(this.theme.muted), charSpacing: 0.4,
      });
      this.pdf.text(truncate(value, 'Helvetica', 10, colWidth - 8), x, this.flip(y + 20), {
        font: 'Helvetica', size: 10, color: color(this.theme.text),
      });
    });
    this.cursor = top + rows * rowHeight;
    return this;
  }

  /**
   * A table that paginates, repeating its header on each new page.
   *
   * Column widths given as fractions (values at or below 1) are resolved
   * against the content width, so a caller does not have to know the page size.
   */
  table(opts: TableOptions): this {
    const size = opts.fontSize ?? 9;
    const padX = 6;
    const padY = 5;
    const lineHeight = size * 1.3;

    const total = opts.columns.reduce((a, c) => a + c.width, 0);
    const widths = opts.columns.map((c) =>
      c.width <= 1 && total <= 1.0001 ? c.width * this.contentWidth : c.width);

    const drawHeader = (): void => {
      const h = lineHeight + padY * 2;
      this.ensure(h);
      this.fill(h, opts.headerFill ?? this.theme.primary);
      let x = this.margins.left;
      opts.columns.forEach((c, i) => {
        this.pdf.text(
          truncate(c.header, 'Helvetica-Bold', size, widths[i]! - padX * 2),
          x + padX, this.flip(this.cursor + padY + size),
          { font: 'Helvetica-Bold', size, color: [1, 1, 1], align: c.align, width: widths[i]! - padX * 2 },
        );
        x += widths[i]!;
      });
      this.cursor += h;
    };

    const rowHeight = (cells: string[]): number => {
      let lines = 1;
      cells.forEach((cell, i) => {
        if (!opts.columns[i]?.wrap) return;
        lines = Math.max(lines, wrap(cell, 'Helvetica', size, widths[i]! - padX * 2).length);
      });
      return lines * lineHeight + padY * 2;
    };

    if (this.pdf.pageCount === 0) this.newPage();
    drawHeader();

    opts.rows.forEach((cells, rowIndex) => {
      const h = rowHeight(cells);
      if (this.cursor + h > this.contentBottom) {
        this.newPage();
        // A continued table whose columns are unlabelled is a document the
        // architect sends back.
        drawHeader();
      }
      if (opts.zebra !== false && rowIndex % 2 === 1) this.fill(h, this.theme.zebra);

      let x = this.margins.left;
      cells.forEach((cell, i) => {
        const col = opts.columns[i];
        if (!col) return;
        const inner = widths[i]! - padX * 2;
        const lines = col.wrap ? wrap(cell, 'Helvetica', size, inner)
                               : [truncate(cell, 'Helvetica', size, inner)];
        lines.forEach((line, li) => {
          this.pdf.text(line, x + padX, this.flip(this.cursor + padY + size + li * lineHeight), {
            font: col.bold ? 'Helvetica-Bold' : 'Helvetica',
            size, color: color(this.theme.text), align: col.align, width: inner,
          });
        });
        x += widths[i]!;
      });
      this.cursor += h;
      this.pdf.rule(this.margins.left, this.flip(this.cursor), this.contentWidth, color(this.theme.rule), 0.25);
    });

    if (opts.totals) {
      const h = lineHeight + padY * 2;
      this.ensure(h);
      this.pdf.rule(this.margins.left, this.flip(this.cursor), this.contentWidth, color(this.theme.primary), 1);
      let x = this.margins.left;
      opts.totals.forEach((cell, i) => {
        const col = opts.columns[i];
        if (!col) return;
        const inner = widths[i]! - padX * 2;
        this.pdf.text(truncate(cell, 'Helvetica-Bold', size, inner), x + padX,
          this.flip(this.cursor + padY + size), {
            font: 'Helvetica-Bold', size, color: color(this.theme.primary), align: col.align, width: inner,
          });
        x += widths[i]!;
      });
      this.cursor += h;
    }
    return this;
  }

  /** Text placed at an absolute distance from the top, outside the flow. */
  absolute(value: string, x: number, yFromTop: number, opts: {
    font?: StandardFont; size?: number; color?: string; align?: Align; width?: number;
  } = {}): this {
    const size = opts.size ?? 9;
    this.pdf.text(value, x, this.flip(yFromTop + size), {
      font: opts.font ?? 'Helvetica', size,
      color: color(opts.color ?? this.theme.text),
      align: opts.align, width: opts.width,
    });
    return this;
  }

  measure(text: string, font: StandardFont = 'Helvetica', size = 10): number {
    return measure(text, font, size);
  }

  toBytes(): Uint8Array {
    if (this.pdf.pageCount === 0) this.newPage();
    return this.pdf.toBytes();
  }
}

export { PAGE_SIZES, BLACK, color, type Rgb, type Size, type Align };
