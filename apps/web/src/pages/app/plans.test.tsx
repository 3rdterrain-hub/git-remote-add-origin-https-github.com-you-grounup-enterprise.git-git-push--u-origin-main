/**
 * Plans & Specs, on the company's own documents.
 *
 * Everything behind this screen was built and none of it had a door here.
 * `documents` and `document_sheets` since migration 0005, `ai_findings` with
 * its citation constraint since 0008, `ingestion_jobs` since 0019,
 * `my_documents` / `my_ai_findings` / `accept_finding_as_line` since 0119, an
 * Edge Function to drive it, and a data layer that reads all of it.
 *
 * The page rendered `AI_FINDINGS` and `DOCUMENTS` out of `src/data`. So the one
 * screen named for the subsystem was the one place it could not be reached, and
 * every signed-in customer saw the same five sample findings about somebody
 * else's parking lot.
 *
 * The two rules the screen exists to enforce are what these tests hold: nothing
 * reaches an estimate without a named human accepting it, and a factual claim
 * shows the sheet it came from.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  companyId: 'co-1' as string | null,
  permissions: ['documents.write', 'ai.accept_findings'] as string[],
  documents: [] as unknown[],
  findings: [] as unknown[],
  jobs: [] as unknown[],
  estimates: [] as unknown[],
  findingsFail: null as string | null,
  accepted: [] as Array<{ finding: string; version: string; note: string | null }>,
  rejected: [] as Array<{ finding: string; note: string }>,
  uploaded: [] as Array<Record<string, unknown>>,
  analysis: { status: 'read', message: 'Read 42 sheets.', findings: 3, rejected: 0 } as Record<string, unknown>,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/session')>('@/lib/data/session');
  return {
    ...actual,
    usePermissions: () => ({ can: (p: string) => hoisted.permissions.includes(p), loading: false }),
    useCompanyId: () => ({ companyId: hoisted.companyId, loading: false }),
  };
});

vi.mock('@/lib/data/estimates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/estimates')>('@/lib/data/estimates');
  return { ...actual, loadEstimates: async () => hoisted.estimates };
});

vi.mock('@/lib/data/plans', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/plans')>('@/lib/data/plans');
  return {
    ...actual,
    loadPlanDocuments: async () => hoisted.documents,
    loadAllFindings: async () => {
      if (hoisted.findingsFail) throw new Error(hoisted.findingsFail);
      return hoisted.findings;
    },
    loadIngestionJobs: async () => hoisted.jobs,
    countPdfPages: async () => 42,
    uploadPlanSet: async (_c: unknown, input: Record<string, unknown>) => {
      hoisted.uploaded.push(input);
      return 'dv-new';
    },
    analyzeDocument: async () => hoisted.analysis,
    acceptFinding: async (_c: unknown, finding: string, version: string, note?: string | null) => {
      hoisted.accepted.push({ finding, version, note: note ?? null });
      return 'line-1';
    },
    rejectFinding: async (_c: unknown, finding: string, note: string) => {
      hoisted.rejected.push({ finding, note });
    },
  };
});

const { PlansPage } = await import('./plans');

const doc = (over: Record<string, unknown> = {}) => ({
  id: 'd-1', name: 'Maumee Commerce Park — Bid Set', documentType: 'plan_set',
  fileName: 'maumee-bid-set.pdf', byteSize: 24_117_248, pageCount: 42,
  currentVersionId: 'dv-1', processingState: 'indexed',
  createdAt: '2026-09-01T12:00:00Z', findingCount: 3, awaitingReview: 2, ...over,
});

const finding = (over: Record<string, unknown> = {}) => ({
  id: 'f-1', findingType: 'quantity_candidate',
  title: 'Storm sewer 12 inch RCP, 1,240 LF',
  description: 'Measured along the profile between STA 10+00 and STA 22+40.',
  confidence: 88, state: 'proposed', severity: 'moderate',
  quantity: 1240, unit: 'LF', method: 'dimensioned',
  sheetReferences: ['C-301', 'C-302'], specificationReferences: ['33 41 00'],
  citations: [{ sheet: 'C-301', quote: '12" RCP storm, see profile' }],
  model: 'claude-opus-5', documentName: 'Maumee Commerce Park — Bid Set',
  reviewNote: null, appliedEntityId: null, createdAt: '2026-09-02T09:00:00Z', ...over,
});

const estimate = { id: 'e-1', number: 'E-2026-0007', name: 'Maumee Phase 2', currentVersionId: 'v-7' };

describe('the documents and findings are the company\'s own', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.companyId = 'co-1';
    hoisted.permissions = ['documents.write', 'ai.accept_findings'];
    hoisted.documents = [doc()]; hoisted.findings = [finding()];
    hoisted.jobs = []; hoisted.estimates = [estimate];
    hoisted.findingsFail = null;
    hoisted.accepted = []; hoisted.rejected = []; hoisted.uploaded = [];
    hoisted.analysis = { status: 'read', message: 'Read 42 sheets.', findings: 3, rejected: 0 };
  });

  it('shows a finding the caller\'s own workspace produced', async () => {
    renderPage(<PlansPage />);
    await waitFor(() =>
      expect(screen.getByText('Storm sewer 12 inch RCP, 1,240 LF')).toBeInTheDocument());
    expect(screen.getByText(/STA 10\+00/)).toBeInTheDocument();
  });

  it('counts the documents and sheets it actually read', async () => {
    hoisted.documents = [doc(), doc({ id: 'd-2', currentVersionId: 'dv-2', pageCount: 8 })];
    renderPage(<PlansPage />);
    await waitFor(() => expect(screen.getByText('50')).toBeInTheDocument());
  });

  it('shows a read failure as a failure, never as a sample set', async () => {
    hoisted.findingsFail = 'JWT expired';
    renderPage(<PlansPage />);
    await waitFor(() => expect(screen.getByText('JWT expired')).toBeInTheDocument());
  });

  it('tells a company with nothing uploaded what to do', async () => {
    hoisted.documents = []; hoisted.findings = [];
    renderPage(<PlansPage />);
    await waitFor(() => expect(screen.getByText('Nothing has been read yet')).toBeInTheDocument());
    expect(screen.getByText(/none of it reaches an estimate until you accept it/))
      .toBeInTheDocument();
  });
});

describe('a factual claim shows where it came from', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.companyId = 'co-1';
    hoisted.permissions = ['documents.write', 'ai.accept_findings'];
    hoisted.documents = [doc()]; hoisted.findings = [finding()];
    hoisted.estimates = [estimate]; hoisted.findingsFail = null;
  });

  it('puts the sheet, the specification and the quote on the card', async () => {
    /*
     * The database refuses to store a quantity, conflict or scope claim without
     * a citation. This is that constraint made visible: a quantity whose source
     * nobody can check is a quantity nobody should price.
     */
    renderPage(<PlansPage />);
    await waitFor(() => expect(screen.getByText('Cited from')).toBeInTheDocument());
    expect(screen.getByText('C-301, C-302')).toBeInTheDocument();
    expect(screen.getByText('33 41 00')).toBeInTheDocument();
    expect(screen.getByText(/12" RCP storm, see profile/)).toBeInTheDocument();
  });

  it('says so plainly when a finding cites nothing and is not required to', async () => {
    hoisted.findings = [finding({
      id: 'f-2', findingType: 'observation', title: 'Two access points shown',
      quantity: null, unit: null, method: null,
      sheetReferences: [], specificationReferences: [], citations: [],
    })];
    renderPage(<PlansPage />);
    await waitFor(() => expect(screen.getByText(/Nothing cited/)).toBeInTheDocument());
  });

  it('names the model\'s confidence as the model\'s', async () => {
    // A line's confidence is the engine's to compute from what the line is made
    // of. Carrying this across would let a model's optimism reach a bid.
    renderPage(<PlansPage />);
    await waitFor(() =>
      expect(screen.getByText(/Model confidence 88%/)).toBeInTheDocument());
  });
});

describe('AI proposes and a human accepts (RULE-008)', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.companyId = 'co-1';
    hoisted.permissions = ['documents.write', 'ai.accept_findings'];
    hoisted.documents = [doc()]; hoisted.findings = [finding()];
    hoisted.estimates = [estimate]; hoisted.findingsFail = null;
    hoisted.accepted = []; hoisted.rejected = [];
  });

  it('puts an accepted finding on the estimate the reviewer chose', async () => {
    const user = userEvent.setup();
    renderPage(<PlansPage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Accept onto the estimate/ })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Accept onto the estimate/ }));

    await waitFor(() => expect(hoisted.accepted).toHaveLength(1));
    expect(hoisted.accepted[0]).toMatchObject({ finding: 'f-1', version: 'v-7' });
    expect(screen.getByText(/is on the estimate as a line, recorded against you/))
      .toBeInTheDocument();
  });

  it('offers nothing to accept when there is no estimate to accept onto', async () => {
    hoisted.estimates = [];
    renderPage(<PlansPage />);
    await waitFor(() =>
      expect(screen.getByText('No estimate to add it to')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Accept onto the estimate/ })).toBeDisabled();
  });

  it('will not set one aside without a reason the next reader can use', async () => {
    const user = userEvent.setup();
    renderPage(<PlansPage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Set aside' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Set aside' }));

    expect(screen.getByRole('button', { name: /Set aside/ })).toBeDisabled();
    await user.type(screen.getByLabelText('Why is this being set aside?'),
      'Superseded by Addendum 2.');
    await user.click(screen.getByRole('button', { name: /Set aside/ }));

    await waitFor(() => expect(hoisted.rejected).toHaveLength(1));
    expect(hoisted.rejected[0]!.note).toBe('Superseded by Addendum 2.');
  });

  it('offers no decision at all to somebody without the permission', async () => {
    hoisted.permissions = ['documents.write'];
    renderPage(<PlansPage />);
    await waitFor(() =>
      expect(screen.getByText(/Accepting a finding needs/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Accept onto the estimate/ }))
      .not.toBeInTheDocument();
  });

  it('shows a decided finding with the reason, and no way to decide it again', async () => {
    hoisted.findings = [finding({
      state: 'rejected', reviewNote: 'The sheet it cites is superseded by Addendum 2.',
    })];
    renderPage(<PlansPage />);
    await waitFor(() =>
      expect(screen.getByText(/superseded by Addendum 2/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Accept onto the estimate/ }))
      .not.toBeInTheDocument();
  });
});

describe('reading a document', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.companyId = 'co-1';
    hoisted.permissions = ['documents.write', 'ai.accept_findings'];
    hoisted.documents = [doc()]; hoisted.findings = []; hoisted.estimates = [estimate];
    hoisted.findingsFail = null; hoisted.uploaded = [];
  });

  it('says how many claims the citation guard refused', async () => {
    // The rejection count is the guard doing its job, not a failure, and saying
    // nothing about it would make a silent guard look like a quiet model.
    hoisted.analysis = { status: 'read', message: 'Read 42 sheets.', findings: 5, rejected: 2 };
    const user = userEvent.setup();
    renderPage(<PlansPage />);
    await user.click(screen.getByRole('tab', { name: /Document register/ }));
    await user.click(await screen.findByRole('button', { name: /Read again/ }));

    await waitFor(() =>
      expect(screen.getByText(/2 claims arrived without a citation/)).toBeInTheDocument());
  });

  it('tells somebody their plan does not include it, rather than calling it a fault', async () => {
    hoisted.analysis = {
      status: 'refused', findings: 0, rejected: 0,
      message: 'This plan does not include AI plan review.',
    };
    const user = userEvent.setup();
    renderPage(<PlansPage />);
    await user.click(screen.getByRole('tab', { name: /Document register/ }));
    await user.click(await screen.findByRole('button', { name: /Read again/ }));

    await waitFor(() =>
      expect(screen.getByText('This plan does not include AI plan review.')).toBeInTheDocument());
  });

  it('files an uploaded plan set against the caller\'s own company', async () => {
    const user = userEvent.setup();
    renderPage(<PlansPage />);
    const file = new File(['%PDF-1.7'], 'addendum-2.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText('Upload a plan set'), file);

    await waitFor(() => expect(hoisted.uploaded).toHaveLength(1));
    expect(hoisted.uploaded[0]).toMatchObject({ companyId: 'co-1', documentType: 'plan_set' });
    expect(screen.getByText(/addendum-2\.pdf is filed/)).toBeInTheDocument();
  });

  it('does not offer an upload to somebody who may not write documents', async () => {
    hoisted.permissions = ['ai.accept_findings'];
    renderPage(<PlansPage />);
    await waitFor(() =>
      expect(screen.getByText('You can read the document set but not add to it'))
        .toBeInTheDocument());
    expect(screen.getByLabelText('Upload a plan set')).toBeDisabled();
  });
});

describe('the pipeline', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.companyId = 'co-1';
    hoisted.permissions = ['documents.write', 'ai.accept_findings'];
    hoisted.documents = [doc()]; hoisted.findings = []; hoisted.estimates = [estimate];
    hoisted.findingsFail = null;
    hoisted.jobs = [{
      id: 'j-1', documentId: 'd-1', documentVersionId: 'dv-1', stage: 'failed',
      progress: 0.4, pagesTotal: 42, pagesProcessed: 17, findingsCreated: 0,
      model: 'claude-opus-5', promptVersion: 'v3', inputTokens: 812_000, outputTokens: 9_400,
      costEstimate: 4.12, attempts: 2,
      errorMessage: 'Sheet C-114 is a scanned raster with no text layer and OCR timed out.',
      startedAt: '2026-09-02T08:00:00Z', completedAt: null, durationMs: 91_000,
      createdAt: '2026-09-02T08:00:00Z',
    }];
  });

  it('keeps a failed run on the list with the message that failed it', async () => {
    // The table refuses to record a failure without a message, precisely so
    // nobody has to re-run it blind to find out what happened.
    const user = userEvent.setup();
    renderPage(<PlansPage />);
    await user.click(screen.getByRole('tab', { name: /Ingestion pipeline/ }));

    expect(await screen.findByText(/OCR timed out/)).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/17 of 42 pages/)).toBeInTheDocument();
    expect(screen.getByText('2 attempts')).toBeInTheDocument();
  });

  it('sums the spend from the runs rather than from a fixture', async () => {
    const user = userEvent.setup();
    renderPage(<PlansPage />);
    await user.click(screen.getByRole('tab', { name: /Ingestion pipeline/ }));
    const spend = await screen.findByRole('button', { name: 'What is behind AI spend' });
    expect(within(spend).getByText('$4.12')).toBeInTheDocument();
  });
});

describe('the boxes across the top', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.companyId = 'co-1';
    hoisted.permissions = ['documents.write', 'ai.accept_findings'];
    hoisted.documents = [doc()]; hoisted.estimates = [estimate]; hoisted.findingsFail = null;
    hoisted.findings = [
      finding(),
      finding({ id: 'f-9', title: 'Silt fence, 2,100 LF', state: 'accepted', reviewNote: 'Checked against C-501.' }),
    ];
  });

  it('narrows the findings to the ones waiting for a reviewer', async () => {
    const user = userEvent.setup();
    renderPage(<PlansPage />);
    await waitFor(() => expect(screen.getByText('Silt fence, 2,100 LF')).toBeInTheDocument());

    await user.click(screen.getByRole('button',
      { name: 'List the findings waiting for a reviewer' }));
    expect(screen.getByText('Storm sewer 12 inch RCP, 1,240 LF')).toBeInTheDocument();
    expect(screen.queryByText('Silt fence, 2,100 LF')).not.toBeInTheDocument();
  });

  it('opens the document register from the tile that counts documents', async () => {
    const user = userEvent.setup();
    renderPage(<PlansPage />);
    await user.click(screen.getByRole('button', { name: 'Open the document register' }));
    expect(screen.getByRole('tab', { name: /Document register/ }))
      .toHaveAttribute('data-state', 'active');
  });
});
