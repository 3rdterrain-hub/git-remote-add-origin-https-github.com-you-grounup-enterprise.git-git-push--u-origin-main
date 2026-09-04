/**
 * Workforce, and the first write in this application.
 *
 * Approving a timecard is not a display change. Since migration 0044 an
 * approved entry posts wages, burden and per diem onto the job it was worked
 * on, and withdrawing the approval takes them back off — so this button moves
 * money, and a failure has to be shown rather than swallowed.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  canApprove: true,
  approveError: null as string | null,
  approved: [] as string[],
  entries: [] as unknown[],
  reconciliation: [] as unknown[],
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));
// Permissions come from the caller's own membership now, not from the sample
// user — which is the defect this conversion found: fixture data was deciding
// whether a live button appeared.
vi.mock('@/lib/data/session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/session')>('@/lib/data/session');
  return { ...actual, usePermissions: () => ({ can: () => hoisted.canApprove, loading: false }) };
});
vi.mock('@/lib/data/workforce', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/workforce')>('@/lib/data/workforce');
  return {
    ...actual,
    loadEmployees: async () => [],
    loadTimeEntries: async () => hoisted.entries,
    loadProductivity: async () => [],
    loadReconciliation: async () => hoisted.reconciliation,
    approveTimeEntry: async (id: string) => {
      if (hoisted.approveError) throw new Error(hoisted.approveError);
      hoisted.approved.push(id);
    },
  };
});

const { WorkforcePage } = await import('./workforce');

const entry = {
  id: 't-1', employeeName: 'Ray Delgado', workDate: '2026-09-01', project: 'PRJ-2026-011',
  costCode: 'CC-0340', straight: 8, overtime: 1.5, doubletime: 0,
  approvalState: 'pending', exported: false,
};

describe('the workforce page', () => {
  beforeEach(() => {
    hoisted.configured = true;
    hoisted.canApprove = true;
    hoisted.approveError = null;
    hoisted.approved = [];
    hoisted.entries = [entry];
    hoisted.reconciliation = [];
  });

  it('approves a timecard through the database', async () => {
    renderPage(<WorkforcePage />);
    await waitFor(() => expect(screen.getAllByText('Ray Delgado').length).toBeGreaterThan(0));
    await userEvent.click(screen.getAllByText('Approve')[0]!);
    await waitFor(() => expect(hoisted.approved).toEqual(['t-1']));
  });

  it('shows a refused approval rather than pretending it worked', async () => {
    /*
     * A button that silently fails to approve a timecard is worse than one that
     * does nothing: the hours look approved, the job cost never moves, and
     * nobody finds out until payroll.
     */
    hoisted.approveError = 'new row violates row-level security policy';
    renderPage(<WorkforcePage />);
    await waitFor(() => expect(screen.getAllByText('Ray Delgado').length).toBeGreaterThan(0));
    await userEvent.click(screen.getAllByText('Approve')[0]!);
    await waitFor(() =>
      expect(screen.getByText('new row violates row-level security policy')).toBeInTheDocument());
  });

  it('lists where the daily report and the timecards disagree', async () => {
    // The oldest labor control on a job, and it is a subtraction.
    hoisted.reconciliation = [{
      project: 'PRJ-2026-011', workDate: '2026-09-01',
      dailyReportHours: 24, timecardHours: 16, varianceHours: 8,
      finding: 'hours reported not on a timecard',
    }];
    renderPage(<WorkforcePage />);
    await waitFor(() =>
      expect(screen.getByText('hours reported not on a timecard')).toBeInTheDocument());
    expect(screen.getByText('+8.0')).toBeInTheDocument();
  });

  it('says nothing when the two agree', async () => {
    // A list of days that agree is a list nobody reads.
    renderPage(<WorkforcePage />);
    await waitFor(() => expect(screen.getAllByText('Ray Delgado').length).toBeGreaterThan(0));
    expect(screen.queryByText('Daily report against timecards')).not.toBeInTheDocument();
  });

  it('shows no approve button to somebody whose role does not permit it', async () => {
    /*
     * Gated on the caller's own membership rather than on the sample user's
     * permission list, which is what it read before: a person whose real role
     * permits approving time would have been shown no button because a fixture
     * said so, and the reverse would have been worse.
     */
    hoisted.canApprove = false;
    renderPage(<WorkforcePage />);
    await waitFor(() => expect(screen.getAllByText('Ray Delgado').length).toBeGreaterThan(0));
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
  });

  it('labels the page when there is no workspace behind it', async () => {
    hoisted.configured = false;
    renderPage(<WorkforcePage />);
    await waitFor(() => expect(screen.getByText('Demonstration data')).toBeInTheDocument());
  });
});
