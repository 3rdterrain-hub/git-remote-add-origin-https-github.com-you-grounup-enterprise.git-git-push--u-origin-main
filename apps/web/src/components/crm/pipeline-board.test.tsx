/**
 * Working the pipeline.
 *
 * Every stage but the first was unreachable: the only writer of an opportunity
 * was `convert_lead`, which inserts at `identified`. So the win-rate figure
 * could only ever be zero and the loss-reason line never rendered, for anybody.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PipelineRow } from '@/lib/data/crm-pipeline';
import { PipelineBoard } from './pipeline-board';

const hoisted = vi.hoisted(() => ({
  rows: [] as PipelineRow[],
  moved: [] as Array<{ id: string; stage: string; reason?: string | null;
    competitor?: string | null }>,
  failWith: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/crm-pipeline', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/crm-pipeline')>(
    '@/lib/data/crm-pipeline');
  return {
    ...actual,
    loadPipeline: async () => hoisted.rows,
    moveStage: async (_c: unknown, id: string, stage: string,
      reason?: string | null, competitor?: string | null) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.moved.push({ id, stage, reason, competitor });
    },
  };
});

const row = (over: Partial<PipelineRow> = {}): PipelineRow => ({
  id: 'o-1', companyId: 'co-1', customerId: 'cu-1',
  customerName: 'Kingsway Development',
  number: 'OPP-2026-0001', name: 'Kingsway site package', description: null,
  stage: 'proposed', estimatedValue: 480000, probability: 0.5, weightedValue: 240000,
  bidDueAt: '2026-10-01T00:00:00Z', expectedAwardAt: null, expectedStartAt: null,
  siteCity: 'Toledo', siteState: 'OH', deliveryMethod: null, ownerUserId: null,
  wonAt: null, lostAt: null, lossReason: null, winningCompetitor: null,
  daysInStage: 42, isClosed: false, openActivities: 0, nextDueAt: null,
  updatedAt: '2026-08-01T00:00:00Z',
  ...over,
});

beforeEach(() => {
  hoisted.rows = [];
  hoisted.moved = [];
  hoisted.failWith = null;
});

describe('the pipeline board', () => {
  it('shows what is open and what it is worth weighted', async () => {
    hoisted.rows = [row()];
    render(<PipelineBoard editable />);
    expect(await screen.findByText('Kingsway site package')).toBeInTheDocument();
    expect(screen.getByText('OPP-2026-0001')).toBeInTheDocument();
    expect(screen.getByText(/50% · \$240,000\.00 weighted/)).toBeInTheDocument();
  });

  it('says how long it has sat in the stage it is in', async () => {
    /* Six weeks in "proposed" is what a pipeline review is hunting for. */
    hoisted.rows = [row({ daysInStage: 42 })];
    render(<PipelineBoard editable />);
    expect(await screen.findByText('42d in stage')).toBeInTheDocument();
  });

  it('marks one won in a click', async () => {
    hoisted.rows = [row()];
    const user = userEvent.setup();
    render(<PipelineBoard editable />);
    await user.click(await screen.findByRole('button', { name: /Won/ }));
    await waitFor(() => expect(hoisted.moved).toHaveLength(1));
    expect(hoisted.moved[0]).toMatchObject({ id: 'o-1', stage: 'won' });
  });

  it('will not record a loss until it is told why', async () => {
    hoisted.rows = [row()];
    const user = userEvent.setup();
    render(<PipelineBoard editable />);
    await user.click(await screen.findByRole('button', { name: /Lost/ }));

    const record = screen.getByRole('button', { name: 'Record the loss' });
    expect(record).toBeDisabled();
    expect(screen.getByText(/whether the number was wrong or the relationship was/))
      .toBeInTheDocument();
    expect(hoisted.moved).toEqual([]);

    await user.type(screen.getByLabelText('Why it was lost'), 'Price. We were 8% over.');
    await user.type(screen.getByLabelText('Who got it (optional)'), 'Aggregate Inc');
    await user.click(record);
    await waitFor(() => expect(hoisted.moved).toHaveLength(1));
    expect(hoisted.moved[0]).toMatchObject({
      stage: 'lost', reason: 'Price. We were 8% over.', competitor: 'Aggregate Inc',
    });
  });

  it('counts the win rate from decided bids only', async () => {
    hoisted.rows = [
      row({ id: 'a', stage: 'won', isClosed: true }),
      row({ id: 'b', stage: 'lost', isClosed: true, lossReason: 'Price' }),
      row({ id: 'c', stage: 'abandoned', isClosed: true }),
      row({ id: 'd' }),
    ];
    render(<PipelineBoard editable />);
    /* Abandoned is not a loss — nobody decided against us. */
    expect(await screen.findByText(/1 of 2 decided bids won · 50%/)).toBeInTheDocument();
  });

  it('shows why a lost one was lost, and to whom', async () => {
    hoisted.rows = [row({
      stage: 'lost', isClosed: true, lossReason: 'Price. We were 8% over.',
      winningCompetitor: 'Aggregate Inc',
    })];
    render(<PipelineBoard editable />);
    expect(await screen.findByText(/Price\. We were 8% over\. — to Aggregate Inc/))
      .toBeInTheDocument();
  });

  it('offers nothing to change to somebody who may only read', async () => {
    hoisted.rows = [row()];
    render(<PipelineBoard editable={false} />);
    expect(await screen.findByText('Kingsway site package')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Won/ })).not.toBeInTheDocument();
  });

  it('says what the database refused', async () => {
    hoisted.rows = [row()];
    hoisted.failWith = 'You do not have permission to change this opportunity';
    const user = userEvent.setup();
    render(<PipelineBoard editable />);
    await user.click(await screen.findByRole('button', { name: /Won/ }));
    expect(await screen.findByText('You do not have permission to change this opportunity'))
      .toBeInTheDocument();
  });
});
