/**
 * Hand it the plans, get quantities back.
 *
 * RULE-008 is the whole point of this screen, and it is not enforced by a
 * comment: a finding becomes an estimate line only when a person presses the
 * button. These tests hold the two things a screen could quietly get wrong.
 *
 * The model's confidence has to read as the model's. An interface that showed
 * "88%" beside a quantity, in the same styling a line's confidence uses, would
 * make every AI line look verified by the platform when nothing has verified
 * anything. And what the model cited has to be visible beside what it claims —
 * a quantity you cannot trace to a sheet is one you should not bid.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Finding, PlanDocument } from '@/lib/data/plans';

const hoisted = vi.hoisted(() => ({
  configured: true,
  documents: [] as PlanDocument[],
  findings: [] as Finding[],
  analyzed: [] as string[],
  accepted: [] as string[],
  rejected: [] as Array<{ id: string; note: string }>,
  outcome: { status: 'read', message: '', findings: 2, rejected: 0 } as
    { status: 'read' | 'refused' | 'failed'; message: string; findings: number; rejected: number },
  fail: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
  callFunction: async () => ({}),
}));

vi.mock('@/lib/data/plans', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/plans')>('@/lib/data/plans');
  return {
    ...actual,
    loadPlanDocuments: async () => hoisted.documents,
    loadFindings: () => async () => hoisted.findings,
    analyzeDocument: async (_c: string, id: string) => {
      hoisted.analyzed.push(id);
      return hoisted.outcome;
    },
    acceptFinding: async (_c: unknown, id: string) => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      hoisted.accepted.push(id);
      return 'l-new';
    },
    rejectFinding: async (_c: unknown, id: string, note: string) => {
      hoisted.rejected.push({ id, note });
    },
  };
});

const { PlanTakeoffPanel } = await import('./plan-takeoff');

const doc = (over: Partial<PlanDocument> = {}): PlanDocument => ({
  id: 'd-1', name: 'Bid set', documentType: 'plan_set', fileName: 'plans.pdf',
  byteSize: 4_200_000, pageCount: 42, currentVersionId: 'dv-1',
  processingState: 'pending', createdAt: '2026-09-01T00:00:00Z',
  findingCount: 0, awaitingReview: 0, ...over,
});

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: 'f-1', findingType: 'quantity_candidate',
  title: 'Storm sewer, 12in RCP', description: 'From the dimensioned run on C-101.',
  confidence: 88, state: 'proposed', severity: null,
  quantity: 120, unit: 'LF', method: 'dimensioned',
  sheetReferences: ['C-101'], specificationReferences: [],
  citations: [{ sheet: 'C-101', quote: '120 LF of 12in RCP' }],
  model: 'claude-opus-5', documentName: 'Bid set', reviewNote: null,
  appliedEntityId: null, createdAt: '2026-09-01T00:00:00Z', ...over,
});

const show = async (editable = true) => {
  render(<PlanTakeoffPanel versionId="v-1" estimateId="e-1" companyId="c-1"
    editable={editable} onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole('button', { name: /quantities from the plans/i }));
};

beforeEach(() => {
  hoisted.configured = true;
  hoisted.documents = [doc()];
  hoisted.findings = [];
  hoisted.analyzed = []; hoisted.accepted = []; hoisted.rejected = [];
  hoisted.outcome = { status: 'read', message: '', findings: 2, rejected: 0 };
  hoisted.fail = null;
});

describe('handing over the plans', () => {
  it('offers an upload before there is anything to read', async () => {
    hoisted.documents = [];
    await show();
    expect(await screen.findByText('No plans uploaded yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload a plan set/i })).toBeInTheDocument();
  });

  it('says a document has not been read yet rather than leaving it blank', async () => {
    await show();
    expect(await screen.findByText(/not read yet/)).toBeInTheDocument();
  });

  it('asks the model to read the one that was chosen', async () => {
    await show();
    await userEvent.click(await screen.findByRole('button', { name: /read it/i }));
    await waitFor(() => expect(hoisted.analyzed).toEqual(['dv-1']));
  });

  it('says nothing is on the estimate until a person puts it there', async () => {
    await show();
    await userEvent.click(await screen.findByRole('button', { name: /read it/i }));
    expect(await screen.findByText(/Nothing is on the estimate until you put it there/))
      .toBeInTheDocument();
  });

  it('reports a plan that does not include plan review as a plan, not a fault', async () => {
    hoisted.outcome = {
      status: 'refused', findings: 0, rejected: 0,
      message: 'Your plan does not include AI plan review.',
    };
    await show();
    await userEvent.click(await screen.findByRole('button', { name: /read it/i }));
    expect(await screen.findByText('Not available')).toBeInTheDocument();
    expect(screen.getByText(/does not include AI plan review/)).toBeInTheDocument();
  });

  it('says how many it threw out for citing nothing', async () => {
    hoisted.outcome = { status: 'read', findings: 5, rejected: 2, message: '' };
    await show();
    await userEvent.click(await screen.findByRole('button', { name: /read it/i }));
    expect(await screen.findByText(/2 the platform threw out for citing nothing/))
      .toBeInTheDocument();
  });
});

describe('deciding what to keep', () => {
  beforeEach(() => {
    hoisted.documents = [doc({ findingCount: 1, awaitingReview: 1 })];
    hoisted.findings = [finding()];
  });

  it('shows what the model cited beside what it claims', async () => {
    await show();
    await userEvent.click(await screen.findByText('Bid set'));
    expect(await screen.findByText(/Sheets C-101/)).toBeInTheDocument();
    expect(screen.getByText(/120 LF of 12in RCP/)).toBeInTheDocument();
  });

  it('says how the quantity was obtained, because that is a different claim', async () => {
    await show();
    await userEvent.click(await screen.findByText('Bid set'));
    expect(await screen.findByText('Dimensioned on the sheet')).toBeInTheDocument();
  });

  it('marks an allowance as an allowance rather than a measurement', async () => {
    hoisted.findings = [finding({ method: 'estimator_allowance' })];
    await show();
    await userEvent.click(await screen.findByText('Bid set'));
    expect(await screen.findByText('An allowance, not a measurement')).toBeInTheDocument();
  });

  it("says the confidence is the model's own and not the line's", async () => {
    await show();
    await userEvent.click(await screen.findByText('Bid set'));
    expect(await screen.findByText(/scored itself 88%/)).toBeInTheDocument();
    expect(screen.getByText(/never becomes the line's confidence/)).toBeInTheDocument();
  });

  it('puts a finding on the estimate only when a person says so', async () => {
    await show();
    await userEvent.click(await screen.findByText('Bid set'));
    expect(hoisted.accepted).toEqual([]);
    await userEvent.click(await screen.findByRole('button', { name: /add as a line/i }));
    await waitFor(() => expect(hoisted.accepted).toEqual(['f-1']));
  });

  it('offers no line for something that is not a quantity', async () => {
    hoisted.findings = [finding({ findingType: 'scope_item', quantity: null, unit: null })];
    await show();
    await userEvent.click(await screen.findByText('Bid set'));
    expect(screen.queryByRole('button', { name: /add as a line/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set aside/i })).toBeInTheDocument();
  });

  it('will not set one aside without saying why', async () => {
    await show();
    await userEvent.click(await screen.findByText('Bid set'));
    await userEvent.click(await screen.findByRole('button', { name: /set aside/i }));
    const [, confirm] = screen.getAllByRole('button', { name: /set aside/i });
    expect(confirm).toBeDisabled();
  });

  it('records the reason it was not used', async () => {
    await show();
    await userEvent.click(await screen.findByText('Bid set'));
    await userEvent.click(await screen.findByRole('button', { name: /set aside/i }));
    await userEvent.type(screen.getByLabelText(/why Storm sewer, 12in RCP was not used/i),
      'Already in the sitework allowance');
    const [, confirm] = screen.getAllByRole('button', { name: /set aside/i });
    await userEvent.click(confirm!);
    await waitFor(() => expect(hoisted.rejected).toEqual([
      { id: 'f-1', note: 'Already in the sitework allowance' },
    ]));
  });

  it('shows a decided finding as decided, with no way to decide it again', async () => {
    hoisted.findings = [finding({ state: 'accepted', reviewNote: 'Checked against C-501' })];
    await show();
    await userEvent.click(await screen.findByText('Bid set'));
    expect(await screen.findByText('accepted')).toBeInTheDocument();
    expect(screen.getByText(/Note: Checked against C-501/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add as a line/i })).not.toBeInTheDocument();
  });

  it('offers nothing to change on a frozen version', async () => {
    await show(false);
    expect(screen.queryByRole('button', { name: /upload a plan set/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /read it/i })).not.toBeInTheDocument();
  });
});
