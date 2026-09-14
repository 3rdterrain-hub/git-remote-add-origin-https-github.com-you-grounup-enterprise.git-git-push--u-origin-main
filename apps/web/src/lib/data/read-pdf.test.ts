/**
 * Reading what a plan set says.
 *
 * `document_sheets.extracted_text` carried a GIN trigram index from migration
 * 0005 and a search function from 0036, and nothing wrote it until 0172. So
 * "Search the drawings" returned nothing for every company and every term, for
 * the life of the platform — and a search that finds nothing looks exactly like
 * a job with no silt fence on it, which is why nobody noticed.
 *
 * Written as a round trip rather than against a fixture: the PDF is produced by
 * this repository's own writer, so the test proves the reader and the writer
 * agree about where the words went rather than proving a checked-in file still
 * parses.
 */
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, beforeAll } from 'vitest';
import { PdfDocument } from '@grounup/pdf';
import { readPdf } from './plans';

/*
 * jsdom has no `DOMMatrix`; every browser does, and PDF.js constructs one while
 * setting up a page. Polyfilled here rather than worked around in `readPdf`,
 * because the production path runs in a browser and should not carry a shim for
 * the test environment.
 */
beforeAll(async () => {
  /*
   * jsdom has no `DOMMatrix`; every browser does, and PDF.js constructs one as
   * its module is evaluated — so this has to be in place before the import,
   * not before the call. Polyfilled here rather than shimmed in `readPdf`,
   * because the production path runs in a browser.
   */
  if (typeof globalThis.DOMMatrix === 'undefined') {
    class Matrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      constructor(init?: number[]) {
        if (Array.isArray(init)) {
          [this.a, this.b, this.c, this.d, this.e, this.f] =
            init as [number, number, number, number, number, number];
        }
      }
      multiplySelf() { return this; }
      translateSelf() { return this; }
      scaleSelf() { return this; }
    }
    (globalThis as { DOMMatrix?: unknown }).DOMMatrix = Matrix;
  }

  /*
   * PDF.js 5 uses `Uint8Array.prototype.toHex`, which browsers have and this
   * Node does not yet. Without it the parse fails with
   * "hashOriginal.toHex is not a function" and looks like a broken PDF.
   */
  const bytes = Uint8Array.prototype as unknown as { toHex?: () => string };
  if (typeof bytes.toHex !== 'function') {
    bytes.toHex = function toHex(this: Uint8Array) {
      return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join('');
    };
  }

  /*
   * PDF.js resolves its bundled worker against the module URL, which Vite
   * serves over http — and Node's ESM loader will not import an http URL. The
   * browser has no such problem. Pointed at the file on disk here; `readPdf`
   * leaves a worker alone once one is chosen.
   */
  const pdfjs = await import('pdfjs-dist');
  const require = createRequire(import.meta.url);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(
    dirname(require.resolve('pdfjs-dist')), 'pdf.worker.mjs',
  )).href;
});

/**
 * A `File` that can hand back its own bytes.
 *
 * jsdom's `File` has no `arrayBuffer()`; every browser's does. Attached here
 * for the same reason `DOMMatrix` is: the gap is in the test environment, and
 * `readPdf` should not carry a branch for it.
 */
function fileOf(bytes: Uint8Array | string, name: string, type: string): File {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const file = new File([data as unknown as BlobPart], name, { type });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => data.slice().buffer,
  });
  return file;
}

/** A two-sheet set, with known words on known pages. */
function planSet(): File {
  const doc = new PdfDocument({ title: 'Kingsway civil set', createdAt: new Date(0) });
  doc.addPage();
  doc.text('SITE PLAN', 72, 700, { size: 18 });
  doc.text('Install silt fence along the north property line', 72, 660);
  doc.addPage();
  doc.text('GRADING PLAN', 72, 700, { size: 18 });
  doc.text('Finish grade 1184.50', 72, 660);
  return fileOf(doc.toBytes(), 'kingsway-civil.pdf', 'application/pdf');
}

describe('reading a plan set', () => {
  it('counts the pages and reads each one', async () => {
    const reading = await readPdf(planSet());
    expect(reading.pages).toBe(2);
    expect(reading.text).toHaveLength(2);
    expect(reading.text[0]!.page).toBe(1);
    expect(reading.text[1]!.page).toBe(2);
  });

  it('keeps each sheet\'s words on its own sheet', async () => {
    const reading = await readPdf(planSet());
    expect(reading.text[0]!.text).toMatch(/silt fence/i);
    expect(reading.text[0]!.text).not.toMatch(/1184\.50/);
    expect(reading.text[1]!.text).toMatch(/1184\.50/);
    expect(reading.text[1]!.text).not.toMatch(/silt fence/i);
  });

  it('says nothing about a file that is not a PDF', async () => {
    const notAPlan = fileOf('name,rate\nOperator,42', 'rates.csv', 'text/csv');
    const reading = await readPdf(notAPlan);
    expect(reading.pages).toBeNull();
    expect(reading.text).toEqual([]);
  });

  it('does not fail an upload over a file it cannot parse', async () => {
    /*
     * Null rather than a throw. A plan set that uploads and needs its pages
     * counted later is recoverable — `my_plan_sets_without_sheets` names it —
     * and losing the upload over a parse would be the worse trade.
     */
    const broken = fileOf('%PDF-1.7 and then nonsense', 'broken.pdf', 'application/pdf');
    const reading = await readPdf(broken);
    expect(reading.pages).toBeNull();
  });
});
