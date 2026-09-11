/**
 * Closing a period, which nothing could do.
 *
 * `financial_periods`, the posting guard and `app.close_financial_period` have
 * existed since migration 0034. The table was read by nothing and the function
 * had no `public.` wrapper until 0147, so a company running a month-end close
 * had the whole mechanism and no way to see or operate it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hoisted = vi.hoisted(() => ({
  periods: [] as unknown[],
  closed: [] as Array<{ id: string; note?: string }>,
  fails: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/finance', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/finance')>('@/lib/data/finance');
  return {
    ...actual,
    loadFinancialPeriods: async () => hoisted.periods,
    closeFinancialPeriod: async (_c: unknown, id: string, note?: string) => {
      if (hoisted.fails) throw new Error(hoisted.fails);
      hoisted.closed.push({ id, note });
    },
  };
});

const { ClosingTheBooks } = await import('./closing-the-books');

const period = (over: Record<string, unknown> = {}) => ({
  id: 'p-1', name: '2026-08', periodStart: '2026-08-01', periodEnd: '2026-08-31',
  status: 'open', closedAt: null, closedBy: null, openPayApplications: 0, ...over,
});

describe('closing the books', () => {
  beforeEach(() => { hoisted.periods = []; hoisted.closed = []; hoisted.fails = null; });

  it('says a company with no periods is not running a close', async () => {
    render(<ClosingTheBooks canClose />);
    expect(await screen.findByText('No periods defined')).toBeInTheDocument();
    expect(screen.getByText(/the platform does not invent one/)).toBeInTheDocument();
  });

  it('lists a period with what is in the way of closing it', async () => {
    hoisted.periods = [period({ openPayApplications: 2 })];
    render(<ClosingTheBooks canClose />);
    expect(await screen.findByText('2026-08')).toBeInTheDocument();
    expect(screen.getByText('2 pay applications still open')).toBeInTheDocument();
  });

  it('says nothing is in the way when nothing is', async () => {
    hoisted.periods = [period()];
    render(<ClosingTheBooks canClose />);
    expect(await screen.findByText('nothing')).toBeInTheDocument();
  });

  it('warns before the press rather than only on the refusal', async () => {
    /*
     * A button that fails when pressed, having looked pressable, is worse than
     * one that says what is in the way first. The database is still the
     * authority — a count on a screen is a moment old and its own is not.
     */
    hoisted.periods = [period({ openPayApplications: 1 })];
    render(<ClosingTheBooks canClose />);
    await userEvent.click(await screen.findByRole('button', { name: /Close/ }));
    expect(await screen.findByText('This will be refused')).toBeInTheDocument();
    expect(screen.getByText(/1 pay application inside this period/)).toBeInTheDocument();
  });

  it('closes a clean period, carrying the note', async () => {
    hoisted.periods = [period()];
    render(<ClosingTheBooks canClose />);
    await userEvent.click(await screen.findByRole('button', { name: /Close/ }));
    await userEvent.type(await screen.findByLabelText('Note'), 'Month end');
    await userEvent.click(screen.getByRole('button', { name: 'Close the period' }));
    await waitFor(() => expect(hoisted.closed).toEqual([{ id: 'p-1', note: 'Month end' }]));
  });

  it('shows the database refusal in the database’s words', async () => {
    /*
     * A clean-looking period the database still refuses — the count on the
     * screen was a moment old, which is exactly why the refusal is the
     * authority and not the warning above it.
     */
    hoisted.periods = [period()];
    hoisted.fails = 'Period 2026-08 has 1 pay application(s) still open.';
    render(<ClosingTheBooks canClose />);
    await userEvent.click(await screen.findByRole('button', { name: /Close/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Close the period' }));
    expect(await screen.findByText('Period 2026-08 has 1 pay application(s) still open.'))
      .toBeInTheDocument();
  });

  it('offers nothing to press on a period already closed', async () => {
    hoisted.periods = [period({ status: 'closed', closedAt: '2026-09-02T00:00:00Z' })];
    render(<ClosingTheBooks canClose />);
    expect(await screen.findByText('Closed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Close/ })).not.toBeInTheDocument();
  });

  it('gives somebody without finance.write nothing to press', async () => {
    hoisted.periods = [period()];
    render(<ClosingTheBooks canClose={false} />);
    expect(await screen.findByRole('button', { name: /Close/ })).toBeDisabled();
  });
});
