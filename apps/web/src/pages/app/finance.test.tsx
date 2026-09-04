/**
 * Finance, and the two months that were typed in.
 *
 * The cash forecast carried three months. September read the real pay
 * application. October and November were `286_400 / 118_600` and
 * `198_200 / 94_300` — literals in the component, drawn to the same scale, in
 * the same colors, with nothing distinguishing them from the real one.
 *
 * These tests hold the replacement in place: every bar comes from
 * `reporting_cash_forecast`, and an amount whose timing the platform does not
 * know is reported as undated rather than assigned a month.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  wip: [] as unknown[],
  cash: [] as unknown[],
  payables: [] as unknown[],
  wipError: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));
vi.mock('@/lib/data/finance', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/finance')>('@/lib/data/finance');
  return {
    ...actual,
    loadPayApplications: async () => [],
    loadWip: async () => {
      if (hoisted.wipError) throw new Error(hoisted.wipError);
      return hoisted.wip;
    },
    loadPayables: async () => hoisted.payables,
    loadCashForecast: async () => hoisted.cash,
  };
});

const { FinancePage } = await import('./finance');

const wipRow = {
  projectId: 'p-1', projectNumber: 'PRJ-2026-011', projectName: 'Kingsway',
  contractValue: 1_000_000, approvedBudget: 800_000, actualCost: 200_000,
  billedToDate: 180_000, costRatio: 0.25, percentComplete: 0.25,
  earnedRevenue: 250_000, overUnderBilled: -70_000, earnedMargin: 0.2,
};

/**
 * Wait for every query to settle.
 *
 * The project number is not an anchor: it lives on the work-in-progress tab,
 * and the page opens on the pay application. Waiting for the loading state to
 * clear is the honest signal that all four reads are in.
 */
const loaded = async () =>
  waitFor(() =>
    expect(screen.queryByText('Reading billing, cost and payables')).not.toBeInTheDocument());

const goToCash = async () => {
  await userEvent.click(screen.getByRole('tab', { name: /Cash forecast/ }));
};

describe('the finance page', () => {
  beforeEach(() => {
    hoisted.configured = true;
    hoisted.wipError = null;
    hoisted.wip = [wipRow];
    hoisted.payables = [];
    hoisted.cash = [];
  });

  it('draws only months the database dated', async () => {
    hoisted.cash = [{
      month: '2026-10-01', inflow: 200_000, outflow: 50_000, outflowBlocked: 0,
      net: 150_000, receivableCount: 1, payableCount: 2,
    }];
    renderPage(<FinancePage />);
    await loaded();
    await goToCash();
    await waitFor(() => expect(screen.getByText('October 2026')).toBeInTheDocument());
    // The two months that were never real.
    expect(screen.queryByText('November 2026')).not.toBeInTheDocument();
    expect(screen.queryByText('$286,400.00')).not.toBeInTheDocument();
  });

  it('reports money with no date instead of assigning it a month', async () => {
    /*
     * The whole reason `reporting_cash_forecast` keeps a null-month bucket. An
     * undated receivable folded into a month is a forecast somebody borrows
     * against.
     */
    hoisted.cash = [{
      month: null, inflow: 85_500, outflow: 7_850, outflowBlocked: 0,
      net: 77_650, receivableCount: 1, payableCount: 1,
    }];
    renderPage(<FinancePage />);
    await loaded();
    await goToCash();
    await waitFor(() => expect(screen.getByText('Money with no date on it')).toBeInTheDocument());
    expect(screen.getByText('Nothing scheduled')).toBeInTheDocument();
  });

  it('keeps blocked money out of the amount it says will leave', async () => {
    // A disputed invoice is owed and is not going out on its due date.
    hoisted.cash = [{
      month: '2026-10-01', inflow: 0, outflow: 40_000, outflowBlocked: 15_000,
      net: -40_000, receivableCount: 0, payableCount: 2,
    }];
    renderPage(<FinancePage />);
    await loaded();
    await goToCash();
    await waitFor(() => expect(screen.getByText('October 2026')).toBeInTheDocument());
    // Twice on purpose: the "payables due" figure and the bar's own label. Both
    // are the unblocked amount, and neither includes the 15,000 that is stuck.
    expect(screen.getAllByText('$40,000.00')).toHaveLength(2);
    expect(screen.getByText(/\+\$15K/)).toBeInTheDocument();
  });

  it('says a project has no percentage rather than calling it zero', async () => {
    /*
     * A job with no approved budget has no cost-to-cost denominator. Showing 0%
     * would read as "no work done", and pairing that with a contract value
     * would report the whole contract as under-billed cash owed.
     */
    hoisted.wip = [{
      ...wipRow, projectId: 'p-2', projectNumber: 'PRJ-2026-099', projectName: 'Unbudgeted',
      approvedBudget: 0, costRatio: null, percentComplete: null,
      earnedRevenue: null, overUnderBilled: null, earnedMargin: null,
    }];
    renderPage(<FinancePage />);
    await userEvent.click(screen.getByRole('tab', { name: /Work in progress/ }));
    await waitFor(() => expect(screen.getByText('No approved budget')).toBeInTheDocument());
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('leaves an unbudgeted project out of the portfolio total and says so', async () => {
    hoisted.wip = [wipRow, {
      ...wipRow, projectId: 'p-2', projectNumber: 'PRJ-2026-099', projectName: 'Unbudgeted',
      contractValue: 400_000, approvedBudget: 0, costRatio: null, percentComplete: null,
      earnedRevenue: null, overUnderBilled: null, earnedMargin: null,
    }];
    renderPage(<FinancePage />);
    await loaded();
    await userEvent.click(screen.getByRole('tab', { name: /Work in progress/ }));
    await waitFor(() =>
      expect(screen.getByText(/excludes 1 project with no approved budget/)).toBeInTheDocument());
    // 1,000,000 counted; the unbudgeted 400,000 is not folded in.
    expect(screen.getByText('$1.0M')).toBeInTheDocument();
  });

  it('shows a cost overrun on the progress bar', async () => {
    hoisted.wip = [{ ...wipRow, actualCost: 900_000, costRatio: 1.125, percentComplete: 1 }];
    renderPage(<FinancePage />);
    await userEvent.click(screen.getByRole('tab', { name: /Work in progress/ }));
    await waitFor(() =>
      expect(screen.getByText(/113% of budget spent/)).toBeInTheDocument());
  });

  it('marks a payable that arrived without terms', async () => {
    hoisted.payables = [{
      id: 'i-1', vendor: 'Fort Miami Precast', invoiceNumber: 'FMP-0031',
      invoiceDate: '2026-09-01', dueDate: null, po: null, project: null,
      amount: 7_850, tax: 0, retainageWithheld: 0, amountPaid: 0,
      matchStatus: 'matched', status: 'received', blocked: false,
    }];
    renderPage(<FinancePage />);
    await userEvent.click(screen.getByRole('tab', { name: /Payables/ }));
    await waitFor(() => expect(screen.getByText('no terms')).toBeInTheDocument());
  });

  it('shows a failed read as a failure rather than as an empty portfolio', async () => {
    hoisted.wipError = 'permission denied for view reporting_wip';
    renderPage(<FinancePage />);
    await waitFor(() =>
      expect(screen.getByText('permission denied for view reporting_wip')).toBeInTheDocument());
  });

  it('labels the page when there is no workspace behind it', async () => {
    hoisted.configured = false;
    renderPage(<FinancePage />);
    await waitFor(() => expect(screen.getByText('Demonstration data')).toBeInTheDocument());
  });
});
