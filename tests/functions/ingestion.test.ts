/**
 * Document ingestion.
 *
 * The fixtures are real PDFs, built with the platform's own writer, so the
 * inspector is parsing genuine PDF structure rather than a string that happens
 * to look like one.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  inspectPdf, extractStreamText, identifySheetSize, TEXT_LAYER_THRESHOLD,
} from '../../supabase/functions/_shared/ingestion/pdf-inspect.ts';
import {
  identifySheet, buildDrawingIndex, disciplineFromPrefix,
} from '../../supabase/functions/_shared/ingestion/sheets.ts';
import {
  runIngestion, type OcrProvider,
} from '../../supabase/functions/_shared/ingestion/pipeline.ts';
import { PdfDocument, PAGE_SIZES } from '../../packages/pdf/src/writer.js';

/** A drawing set with a real text layer, at ARCH D. */
function drawingSet(sheets: readonly { number: string; title: string; extra?: string }[]): Uint8Array {
  const doc = new PdfDocument({ title: 'Drawing set', createdAt: new Date(0) });
  for (const s of sheets) {
    doc.addPage({ width: 36 * 72, height: 24 * 72 });
    doc.text('NORTHGATE LOGISTICS PARK', 60, 1650, { font: 'Helvetica-Bold', size: 24 });
    doc.text('ISSUED FOR CONSTRUCTION - 28 AUGUST 2026', 60, 1610, { size: 12 });
    if (s.extra) doc.text(s.extra, 60, 1560, { size: 12 });
    doc.text('SHEET TITLE', 1900, 140, { size: 8 });
    doc.text(s.title, 1900, 120, { font: 'Helvetica-Bold', size: 14 });
    doc.text('SHEET NUMBER', 1900, 90, { size: 8 });
    doc.text(s.number, 1900, 60, { font: 'Helvetica-Bold', size: 22 });
  }
  return doc.toBytes();
}

/** A page with almost no text — what a scanned sheet looks like structurally. */
function scannedSet(pages: number): Uint8Array {
  const doc = new PdfDocument({ title: 'Scan', createdAt: new Date(0) });
  for (let i = 0; i < pages; i++) {
    doc.addPage({ width: 36 * 72, height: 24 * 72 });
    // A digital stamp applied after scanning: real, and not a text layer.
    doc.text('SCANNED', 60, 60, { size: 8 });
  }
  return doc.toBytes();
}

describe('reading a PDF structure', () => {
  it('counts the pages and reads each MediaBox', () => {
    const info = inspectPdf(drawingSet([
      { number: 'C-101', title: 'SITE PLAN' },
      { number: 'C-301', title: 'GRADING PLAN' },
    ]));
    expect(info.pageCount).toBe(2);
    expect(info.pages[0]!.widthIn).toBe(36);
    expect(info.pages[0]!.heightIn).toBe(24);
    expect(info.pages[0]!.orientation).toBe('landscape');
  });

  it('finds the text layer in a vector drawing set', () => {
    const info = inspectPdf(drawingSet([{ number: 'C-301', title: 'GRADING AND DRAINAGE PLAN' }]));
    expect(info.hasTextLayer).toBe(true);
    expect(info.textCoverage).toBe(1);
    expect(info.pages[0]!.text).toContain('C-301');
  });

  it('reports a scan as having no text layer', () => {
    const info = inspectPdf(scannedSet(4));
    // A stamp applied after scanning is not a text layer, and treating it as
    // one would skip OCR on a page that needs it.
    expect(info.hasTextLayer).toBe(false);
    expect(info.textCoverage).toBe(0);
    expect(info.pages[0]!.textLength).toBeLessThan(TEXT_LAYER_THRESHOLD);
  });

  it('refuses a file that is not a PDF', () => {
    const info = inspectPdf(new TextEncoder().encode('this is a spreadsheet'));
    expect(info.pageCount).toBe(0);
    expect(info.warnings[0]).toContain('PDF header');
  });

  it('names an encrypted document rather than reporting it as a scan', () => {
    const bytes = drawingSet([{ number: 'C-101', title: 'SITE PLAN' }]);
    const tampered = new TextDecoder('latin1').decode(bytes)
      .replace('/Root 1 0 R', '/Encrypt 9 0 R /Root 1 0 R');
    const info = inspectPdf(new TextEncoder().encode(tampered));
    expect(info.encrypted).toBe(true);
    expect(info.warnings.join(' ')).toContain('encrypted');
  });

  it('extracts text from both the Tj and TJ array forms', () => {
    // Missing the array form is the classic reason a fully digital set is
    // reported as a scan.
    expect(extractStreamText('BT (Sheet C-301) Tj ET')).toBe('Sheet C-301');
    expect(extractStreamText('BT [(Sheet ) -250 (C-301)] TJ ET')).toBe('Sheet C-301');
    expect(extractStreamText('BT (a\\(b\\)) Tj ET')).toBe('a(b)');
  });
});

describe('sheet sizes', () => {
  it('identifies the standard sizes', () => {
    expect(identifySheetSize(36, 24)).toBe('ARCH D');
    expect(identifySheetSize(24, 36)).toBe('ARCH D');
    expect(identifySheetSize(11, 17)).toBe('ANSI B / Tabloid');
    expect(identifySheetSize(8.5, 11)).toBe('ANSI A / Letter');
  });

  it('returns null for a size it does not know', () => {
    expect(identifySheetSize(19, 23)).toBeNull();
  });
});

describe('sheet identification', () => {
  it('reads the sheet number and derives the discipline from it', () => {
    const id = identifySheet('NORTHGATE LOGISTICS PARK SHEET TITLE GRADING PLAN SHEET NUMBER C-301');
    expect(id.sheetNumber).toBe('C-301');
    expect(id.discipline).toBe('civil');
    expect(id.confidence).toBe('high');
    expect(id.basis).toContain('National CAD Standard');
  });

  it('maps every National CAD Standard prefix', () => {
    expect(disciplineFromPrefix('S')).toBe('structural');
    expect(disciplineFromPrefix('E')).toBe('electrical');
    expect(disciplineFromPrefix('FP')).toBe('fire_protection');
    // FP must not be read as F.
    expect(disciplineFromPrefix('F')).toBe('fire_protection');
    expect(disciplineFromPrefix('Z')).toBe('unknown');
  });

  it('prefers the last plausible number, which is the title block', () => {
    // A callout referencing another sheet appears in the drawing body; the
    // sheet's own number is in the bottom-right title block.
    const id = identifySheet('SEE DETAIL 3 ON C-501 FOR TRENCH SECTION ... SHEET NUMBER C-301');
    expect(id.sheetNumber).toBe('C-301');
  });

  it('identifies a sheet from its content when it has no number', () => {
    const id = identifySheet('EROSION AND SEDIMENT CONTROL NOTES AND DETAILS');
    expect(id.discipline).toBe('civil');
    expect(id.sheetNumber).toBeNull();
    expect(id.confidence).toBe('medium');
  });

  it('says plainly when it cannot identify a sheet', () => {
    const id = identifySheet('');
    expect(id.discipline).toBe('unknown');
    expect(id.confidence).toBe('low');
    expect(id.basis).toContain('no text layer');
  });

  it('reads a title out of the title block', () => {
    const id = identifySheet('SHEET TITLE  GRADING PLAN  SHEET NUMBER C-301');
    expect(id.title).toBeTruthy();
  });
});

describe('the drawing index', () => {
  const pages = [
    { pageNumber: 1, text: 'SHEET NUMBER G-001 COVER SHEET' },
    { pageNumber: 2, text: 'SHEET NUMBER C-101 SITE PLAN' },
    { pageNumber: 3, text: 'SHEET NUMBER C-301 GRADING PLAN' },
    { pageNumber: 4, text: 'SHEET NUMBER S-201 FOUNDATION PLAN' },
  ];

  it('lists every page in order with its discipline', () => {
    const { entries, byDiscipline } = buildDrawingIndex(pages);
    expect(entries.map((e) => e.sheetNumber)).toEqual(['G-001', 'C-101', 'C-301', 'S-201']);
    expect(byDiscipline.civil).toBe(2);
    expect(byDiscipline.structural).toBe(1);
  });

  it('surfaces a duplicate sheet number instead of deduplicating it', () => {
    const { duplicates } = buildDrawingIndex([...pages, { pageNumber: 5, text: 'SHEET NUMBER C-301 GRADING PLAN REVISED' }]);
    // A revised sheet bound alongside the original is a real condition, and
    // someone has to decide which governs.
    expect(duplicates).toEqual(['C-301']);
  });
});

describe('the pipeline routes pages away from OCR when it can', () => {
  const digital = drawingSet([
    { number: 'G-001', title: 'COVER SHEET' },
    { number: 'C-101', title: 'SITE PLAN' },
    { number: 'C-301', title: 'GRADING PLAN' },
    { number: 'S-201', title: 'FOUNDATION PLAN' },
  ]);

  it('reads a digital set without calling OCR at all', async () => {
    const ocr: OcrProvider = { name: 'stub', recognize: vi.fn(async () => []) };
    const r = await runIngestion(digital, { ocr });
    expect(r.stage).toBe('complete');
    expect(r.pagesFromTextLayer).toBe(4);
    expect(r.pagesFromOcr).toBe(0);
    // OCR of rendered text is strictly worse than the text already there, and
    // it costs money. Not calling it is the point of the module.
    expect(ocr.recognize).not.toHaveBeenCalled();
    expect(r.ocrPagesBilled).toBe(0);
  });

  it('classifies every sheet in a digital set', async () => {
    const r = await runIngestion(digital);
    expect(r.sheets.map((s) => s.sheetNumber)).toEqual(['G-001', 'C-101', 'C-301', 'S-201']);
    expect(r.sheets.map((s) => s.discipline)).toEqual(['general', 'civil', 'civil', 'structural']);
    expect(r.sheets.every((s) => s.sheetSize === 'ARCH D')).toBe(true);
  });

  it('sends only the pages that need it to OCR', async () => {
    const scanned = scannedSet(3);
    const ocr: OcrProvider = {
      name: 'stub',
      recognize: vi.fn(async ({ pageNumbers }) => pageNumbers.map((n) => ({
        pageNumber: n, text: `SHEET NUMBER C-${300 + n} GRADING PLAN`, confidence: 0.91,
      }))),
    };
    const r = await runIngestion(scanned, { ocr });
    expect(ocr.recognize).toHaveBeenCalledTimes(1);
    expect(r.pagesFromOcr).toBe(3);
    expect(r.ocrPagesBilled).toBe(3);
    expect(r.sheets[0]!.sheetNumber).toBe('C-301');
  });

  it('never treats OCR text as high confidence', async () => {
    const ocr: OcrProvider = {
      name: 'stub',
      recognize: async ({ pageNumbers }) => pageNumbers.map((n) => ({
        pageNumber: n, text: 'SHEET NUMBER C-301 GRADING PLAN', confidence: 0.99,
      })),
    };
    const r = await runIngestion(scannedSet(1), { ocr });
    // The characters are a machine's reading of an image, however certain the
    // identification looks.
    expect(r.sheets[0]!.textSource).toBe('ocr');
    expect(r.sheets[0]!.identityConfidence).not.toBe('high');
    expect(r.sheets[0]!.ocrConfidence).toBe(0.99);
  });

  it('says what it cannot do when no OCR is configured', async () => {
    const r = await runIngestion(scannedSet(2));
    expect(r.stage).toBe('complete');
    expect(r.pagesWithNoText).toBe(2);
    expect(r.warnings.join(' ')).toContain('no OCR provider is configured');
  });

  it('keeps the digital pages when OCR fails', async () => {
    const mixed = new Uint8Array([...drawingSet([
      { number: 'C-101', title: 'SITE PLAN' },
      { number: 'C-301', title: 'GRADING PLAN' },
    ])]);
    const ocr: OcrProvider = {
      name: 'stub', recognize: async () => { throw new Error('quota exceeded'); },
    };
    const r = await runIngestion(mixed, { ocr });
    // A failed OCR must not lose the pages that read cleanly.
    expect(r.stage).toBe('complete');
    expect(r.pagesFromTextLayer).toBe(2);
  });

  it('refuses an encrypted document rather than billing OCR for every page', async () => {
    const bytes = drawingSet([{ number: 'C-101', title: 'SITE PLAN' }]);
    const tampered = new TextDecoder('latin1').decode(bytes)
      .replace('/Root 1 0 R', '/Encrypt 9 0 R /Root 1 0 R');
    const ocr: OcrProvider = { name: 'stub', recognize: vi.fn(async () => []) };
    const r = await runIngestion(new TextEncoder().encode(tampered), { ocr });
    expect(r.stage).toBe('failed');
    expect(r.errorMessage).toContain('password');
    expect(ocr.recognize).not.toHaveBeenCalled();
  });

  it('refuses a document above the page limit', async () => {
    const r = await runIngestion(drawingSet(
      Array.from({ length: 5 }, (_, i) => ({ number: `C-10${i}`, title: 'PLAN' }))),
      { maxPages: 3 });
    expect(r.stage).toBe('failed');
    expect(r.errorMessage).toContain('above the 3-page limit');
  });

  it('reports progress through every stage in order', async () => {
    const seen: string[] = [];
    await runIngestion(digital, { onProgress: (p) => seen.push(p.stage) });
    expect(seen[0]).toBe('queued');
    expect(seen.at(-1)).toBe('complete');
    // Progress must never go backwards, or the bar jumps about.
    const r = await runIngestion(digital);
    const values = r.progressLog.map((p) => p.progress);
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
    expect(values.at(-1)).toBe(1);
  });

  it('warns about sheets it could not number', async () => {
    const r = await runIngestion(drawingSet([{ number: 'ZZ-999', title: 'MYSTERY' }]));
    expect(r.warnings.join(' ')).toContain('no recognizable sheet number');
  });
});
