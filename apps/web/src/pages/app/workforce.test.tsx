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

/**
 * Open the timecard tab.
 *
 * The screen opens on the time clock now — punching is what somebody is here to
 * do at 6:41 in the morning, and approving a week is not. Radix renders only
 * the active tab, so a test about timecards has to click its way there, the way
 * a person would.
 */
async function openTimecards() {
  await userEvent.click(await screen.findByRole('tab', { name: /Time & attendance/ }));
}

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
    await openTimecards();
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
    await openTimecards();
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
    await openTimecards();
    await waitFor(() =>
      expect(screen.getByText('hours reported not on a timecard')).toBeInTheDocument());
    expect(screen.getByText('+8.0')).toBeInTheDocument();
  });

  it('says nothing when the two agree', async () => {
    // A list of days that agree is a list nobody reads.
    renderPage(<WorkforcePage />);
    await openTimecards();
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
    await openTimecards();
    await waitFor(() => expect(screen.getAllByText('Ray Delgado').length).toBeGreaterThan(0));
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
  });

  it('opens on the time clock, because that is what the crew is here for', async () => {
    /*
     * The tab order is a claim about who this screen is for. Approving a week
     * is an office task done once; punching in is done by everybody, daily, on
     * a phone, standing up.
     */
    renderPage(<WorkforcePage />);
    expect(await screen.findByRole('tab', { name: 'Time clock' }))
      .toHaveAttribute('data-state', 'active');
  });

  it('labels the page when there is no workspace behind it', async () => {
    hoisted.configured = false;
    renderPage(<WorkforcePage />);
    await waitFor(() => expect(screen.getByText('Demonstration data')).toBeInTheDocument());
  });
});

describe('the boxes across the top', () => {
  it('opens the credential register from the tile that counts credentials', async () => {
    const user = userEvent.setup();
    renderPage(<WorkforcePage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open the credential register' }))
        .toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Open the credential register' }));
    expect(screen.getByRole('tab', { name: /Credentials/ }))
      .toHaveAttribute('data-state', 'active');
  });

  it('sends the approval count to the timecards it is counting', async () => {
    const user = userEvent.setup();
    renderPage(<WorkforcePage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Show the timecards waiting for approval' }))
        .toBeInTheDocument());
    await user.click(
      screen.getByRole('button', { name: 'Show the timecards waiting for approval' }));
    expect(screen.getByRole('tab', { name: /Time & attendance/ }))
      .toHaveAttribute('data-state', 'active');
  });
});
