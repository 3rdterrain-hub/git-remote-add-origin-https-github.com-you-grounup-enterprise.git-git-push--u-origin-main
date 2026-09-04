/**
 * Document ingestion pipeline records.
 *
 * The stages mirror `ingestion_jobs.stage` exactly, so what the screen shows is
 * what the pipeline actually tracks rather than a parallel narrative.
 */

export const PIPELINE_STAGES = [
  { key: 'virus_scan', label: 'Virus scan', detail: 'Every upload is scanned before anything reads it.' },
  { key: 'splitting', label: 'Sheet split', detail: 'A plan set is split into individual sheets so a finding can cite one.' },
  { key: 'ocr', label: 'OCR', detail: 'Scanned sheets are made searchable; born-digital PDFs skip this.' },
  { key: 'classifying', label: 'Classification', detail: 'Each sheet is identified — plan, profile, detail, schedule, specification.' },
  { key: 'extracting', label: 'Extraction', detail: 'Claude reads the sheets and proposes cited findings.' },
  { key: 'indexing', label: 'Indexing', detail: 'Text is indexed for permission-filtered search.' },
] as const;

export interface IngestionJob {
  id: string; documentName: string; version: number;
  stage: 'queued' | 'virus_scan' | 'splitting' | 'ocr' | 'classifying' | 'extracting' | 'indexing' | 'complete' | 'failed';
  progress: number; pagesTotal: number; pagesProcessed: number;
  model: string | null; promptVersion: string | null;
  inputTokens: number | null; outputTokens: number | null; costEstimate: number | null;
  findingsCreated: number; findingsRejected: number;
  startedAt: string; completedAt: string | null; durationMs: number | null;
  errorMessage: string | null; attempts: number;
  rejectionReasons?: string[];
}

export const INGESTION_JOBS: IngestionJob[] = [
  {
    id: 'ij-1', documentName: 'Maumee Commerce Park — Civil plan set', version: 3,
    stage: 'complete', progress: 1, pagesTotal: 47, pagesProcessed: 47,
    model: 'claude-opus-5', promptVersion: 'v1',
    inputTokens: 412_800, outputTokens: 18_240, costEstimate: 2.5203,
    findingsCreated: 14, findingsRejected: 3,
    startedAt: '2026-08-12T14:02:00Z', completedAt: '2026-08-12T14:09:41Z', durationMs: 461_000,
    errorMessage: null, attempts: 1,
    rejectionReasons: [
      'A quantity_candidate makes a factual claim and must cite the sheet or specification it came from.',
      'Quantity candidate must state how it was measured.',
      'A scope_item makes a factual claim and must cite the sheet or specification it came from.',
    ],
  },
  {
    id: 'ij-2', documentName: 'Addendum No. 2 — grading limits and undercut', version: 1,
    stage: 'complete', progress: 1, pagesTotal: 6, pagesProcessed: 6,
    model: 'claude-opus-5', promptVersion: 'v1',
    inputTokens: 48_100, outputTokens: 4_620, costEstimate: 0.3560,
    findingsCreated: 5, findingsRejected: 0,
    startedAt: '2026-08-22T09:14:00Z', completedAt: '2026-08-22T09:16:12Z', durationMs: 132_000,
    errorMessage: null, attempts: 1,
  },
  {
    id: 'ij-3', documentName: 'Geotechnical exploration report', version: 1,
    stage: 'complete', progress: 1, pagesTotal: 88, pagesProcessed: 88,
    model: 'claude-opus-5', promptVersion: 'v1',
    inputTokens: 690_400, outputTokens: 12_180, costEstimate: 3.7565,
    findingsCreated: 9, findingsRejected: 1,
    startedAt: '2026-07-30T11:30:00Z', completedAt: '2026-07-30T11:41:08Z', durationMs: 668_000,
    errorMessage: null, attempts: 1,
    rejectionReasons: ['Response was not valid JSON.'],
  },
  {
    id: 'ij-4', documentName: 'Wetland delineation report', version: 1,
    stage: 'extracting', progress: 0.55, pagesTotal: 22, pagesProcessed: 12,
    model: 'claude-opus-5', promptVersion: 'v1',
    inputTokens: null, outputTokens: null, costEstimate: null,
    findingsCreated: 0, findingsRejected: 0,
    startedAt: '2026-09-02T16:48:00Z', completedAt: null, durationMs: null,
    errorMessage: null, attempts: 1,
  },
  {
    id: 'ij-5', documentName: 'Project manual — Divisions 31–33', version: 1,
    stage: 'failed', progress: 0.34, pagesTotal: 214, pagesProcessed: 72,
    model: 'claude-opus-5', promptVersion: 'v1',
    inputTokens: 184_200, outputTokens: 3_100, costEstimate: 0.9985,
    findingsCreated: 7, findingsRejected: 0,
    startedAt: '2026-08-12T15:20:00Z', completedAt: null, durationMs: 218_000,
    errorMessage: 'Upstream rate limit reached after page 72. Retry will resume from the last completed batch.',
    attempts: 2,
  },
];

/** Aggregate AI spend, for the usage panel. */
export function aiUsageSummary() {
  const done = INGESTION_JOBS.filter((j) => j.costEstimate !== null);
  return {
    runs: INGESTION_JOBS.length,
    pages: INGESTION_JOBS.reduce((a, j) => a + j.pagesProcessed, 0),
    inputTokens: done.reduce((a, j) => a + (j.inputTokens ?? 0), 0),
    outputTokens: done.reduce((a, j) => a + (j.outputTokens ?? 0), 0),
    cost: done.reduce((a, j) => a + (j.costEstimate ?? 0), 0),
    findings: INGESTION_JOBS.reduce((a, j) => a + j.findingsCreated, 0),
    rejected: INGESTION_JOBS.reduce((a, j) => a + j.findingsRejected, 0),
  };
}
