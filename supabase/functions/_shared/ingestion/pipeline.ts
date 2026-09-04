/**
 * The ingestion pipeline.
 *
 * Split, extract, classify, index — with OCR reached only for the pages that
 * genuinely need it. The routing decision is the point of this module: a
 * 240-sheet drawing set with a text layer costs nothing to read and is more
 * accurate than any OCR of the same pages, while a scan of the same set has to
 * go through OCR page by page. Sending everything to OCR is the expensive,
 * less accurate way to be consistent.
 *
 * OCR itself is an injected interface. No OCR vendor is bundled, because every
 * one of them needs an account, and an adapter written against a guess at an
 * API is worse than none — it looks finished.
 */

import { inspectPdf, identifySheetSize, type PageInfo, type PdfInfo } from './pdf-inspect.ts';
import { buildDrawingIndex, identifySheet, type IndexEntry } from './sheets.ts';

export type Stage =
  | 'queued' | 'virus_scan' | 'splitting' | 'ocr'
  | 'classifying' | 'extracting' | 'indexing' | 'complete' | 'failed';

/** Text recovered from a page image. Supplied by whichever OCR the tenant uses. */
export interface OcrResult {
  pageNumber: number;
  text: string;
  /** 0-1 from the OCR engine, carried through to the sheet's confidence. */
  confidence: number;
}

export interface OcrProvider {
  readonly name: string;
  /** Recognize the given pages. Pages not returned are treated as empty. */
  recognize(input: {
    document: Uint8Array;
    pageNumbers: readonly number[];
    signal?: AbortSignal;
  }): Promise<OcrResult[]>;
}

export interface SheetRecord {
  pageNumber: number;
  sheetNumber: string | null;
  discipline: string;
  title: string | null;
  sheetSize: string | null;
  widthIn: number;
  heightIn: number;
  orientation: 'portrait' | 'landscape';
  text: string;
  /** Where the text came from. This governs how much anything downstream trusts it. */
  textSource: 'text_layer' | 'ocr' | 'none';
  ocrConfidence: number | null;
  identityConfidence: 'high' | 'medium' | 'low';
}

export interface PipelineProgress {
  stage: Stage;
  progress: number;
  pagesProcessed: number;
  pagesTotal: number;
}

export interface PipelineResult {
  stage: 'complete' | 'failed';
  info: PdfInfo;
  sheets: SheetRecord[];
  index: { entries: IndexEntry[]; duplicates: string[]; byDiscipline: Record<string, number> };
  pagesFromTextLayer: number;
  pagesFromOcr: number;
  pagesWithNoText: number;
  /** Pages sent to OCR, which is the only part of ingestion that costs money. */
  ocrPagesBilled: number;
  warnings: string[];
  errorMessage: string | null;
  progressLog: PipelineProgress[];
}

export interface RunOptions {
  ocr?: OcrProvider;
  /** Refuse a document larger than this, in pages. */
  maxPages?: number;
  onProgress?: (p: PipelineProgress) => void;
  signal?: AbortSignal;
}

/** Above this, a set is almost certainly a mis-upload rather than a drawing set. */
export const DEFAULT_MAX_PAGES = 2000;

export async function runIngestion(
  document: Uint8Array,
  options: RunOptions = {},
): Promise<PipelineResult> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const progressLog: PipelineProgress[] = [];
  const warnings: string[] = [];

  const report = (stage: Stage, progress: number, done: number, total: number): void => {
    const p: PipelineProgress = { stage, progress: Number(progress.toFixed(4)), pagesProcessed: done, pagesTotal: total };
    progressLog.push(p);
    options.onProgress?.(p);
  };

  const fail = (message: string, info: PdfInfo): PipelineResult => ({
    stage: 'failed', info, sheets: [],
    index: { entries: [], duplicates: [], byDiscipline: {} },
    pagesFromTextLayer: 0, pagesFromOcr: 0, pagesWithNoText: 0, ocrPagesBilled: 0,
    warnings, errorMessage: message, progressLog,
  });

  report('queued', 0, 0, 0);

  report('splitting', 0.1, 0, 0);
  const info = inspectPdf(document);
  warnings.push(...info.warnings);

  if (info.pageCount === 0) {
    return fail('The file could not be read as a PDF, or contains no pages.', info);
  }
  if (info.encrypted) {
    // Guessing at a password, or reporting every page as a scan and billing
    // OCR for the whole set, are both worse than saying what is wrong.
    return fail('The PDF is password protected. Upload a copy without a password.', info);
  }
  if (info.pageCount > maxPages) {
    return fail(
      `The document has ${info.pageCount} pages, above the ${maxPages}-page limit. Split it into volumes.`,
      info,
    );
  }

  const total = info.pageCount;
  report('splitting', 0.2, total, total);

  // Pages with a usable text layer are read directly. This is the decision the
  // whole module exists for.
  const needOcr = info.pages.filter((p) => !p.hasTextLayer);
  const ocrText = new Map<number, OcrResult>();

  if (needOcr.length > 0) {
    if (options.ocr) {
      report('ocr', 0.3, total - needOcr.length, total);
      try {
        const results = await options.ocr.recognize({
          document,
          pageNumbers: needOcr.map((p) => p.pageNumber),
          signal: options.signal,
        });
        for (const r of results) ocrText.set(r.pageNumber, r);
        const missing = needOcr.length - results.length;
        if (missing > 0) {
          warnings.push(`${options.ocr.name} returned no text for ${missing} page(s); they are recorded as having none.`);
        }
      } catch (err) {
        // A failed OCR must not lose the pages that did read cleanly. The
        // digital pages are still worth indexing.
        warnings.push(
          `OCR failed (${err instanceof Error ? err.message : String(err)}). `
          + `${needOcr.length} page(s) are recorded without text and can be re-run.`,
        );
      }
    } else {
      warnings.push(
        `${needOcr.length} of ${total} page(s) have no text layer and no OCR provider is configured. `
        + 'They are indexed by sheet size only, with no searchable text.',
      );
    }
  }

  report('extracting', 0.6, total, total);

  const sheets: SheetRecord[] = info.pages.map((page: PageInfo) => {
    const ocr = ocrText.get(page.pageNumber);
    const text = page.hasTextLayer ? page.text : ocr?.text ?? '';
    const textSource: SheetRecord['textSource'] =
      page.hasTextLayer ? 'text_layer' : ocr ? 'ocr' : 'none';
    const identity = identifySheet(text);
    return {
      pageNumber: page.pageNumber,
      sheetNumber: identity.sheetNumber,
      discipline: identity.discipline,
      title: identity.title,
      sheetSize: identifySheetSize(page.widthIn, page.heightIn),
      widthIn: page.widthIn,
      heightIn: page.heightIn,
      orientation: page.orientation,
      text,
      textSource,
      ocrConfidence: ocr ? Number(ocr.confidence.toFixed(4)) : null,
      // Text recovered by OCR is never treated as high confidence, however
      // certain the identification looks. The characters themselves are a
      // machine's reading of an image.
      identityConfidence: textSource === 'ocr' && identity.confidence === 'high'
        ? 'medium' : identity.confidence,
    };
  });

  report('classifying', 0.8, total, total);
  const index = buildDrawingIndex(sheets.map((s) => ({ pageNumber: s.pageNumber, text: s.text })));

  if (index.duplicates.length > 0) {
    warnings.push(
      `Sheet number(s) ${index.duplicates.join(', ')} appear more than once. `
      + 'A revised sheet bound alongside the original is a real condition, and someone has to decide which governs.',
    );
  }
  const unidentified = sheets.filter((s) => s.sheetNumber === null).length;
  if (unidentified > 0) {
    warnings.push(`${unidentified} of ${total} sheet(s) carry no recognizable sheet number.`);
  }

  report('indexing', 0.95, total, total);
  report('complete', 1, total, total);

  const fromOcr = sheets.filter((s) => s.textSource === 'ocr').length;
  return {
    stage: 'complete',
    info, sheets, index,
    pagesFromTextLayer: sheets.filter((s) => s.textSource === 'text_layer').length,
    pagesFromOcr: fromOcr,
    pagesWithNoText: sheets.filter((s) => s.textSource === 'none').length,
    // Only pages actually sent for recognition are billable. A set with a text
    // layer costs nothing here, which is the saving worth measuring.
    ocrPagesBilled: options.ocr ? needOcr.length : 0,
    warnings,
    errorMessage: null,
    progressLog,
  };
}
