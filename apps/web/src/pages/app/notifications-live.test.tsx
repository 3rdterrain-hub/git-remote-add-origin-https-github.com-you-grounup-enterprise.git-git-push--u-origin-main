/**
 * Notifications, on real data.
 *
 * The fixture behind this page also fed the header bell, so five sample notices
 * and a permanent "3 unread" followed every signed-in person around the whole
 * application regardless of whose workspace it was.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  rows: [] as unknown[],
  fail: null as string | null,
  marked: [] as string[],
  dismissed: [] as string[],
  markFails: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/session', async () => {
  const actual = await vi.importActual<typeof import('./../../lib/data/session')>(
    '@/lib/data/session');
  return {
    ...actual,
    loadMyNotifications: async () => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      return hoisted.rows;
    },
    markNotificationRead: async (_c: unknown, id: string) => {
      if (hoisted.markFails) throw new Error(hoisted.markFails);
      hoisted.marked.push(id);
    },
    dismissNotification: async (_c: unknown, id: string) => {
      hoisted.dismissed.push(id);
    },
  };
});

const { NotificationsLivePage } = await import('./notifications-live');

const note = (over: Record<string, unknown> = {}) => ({
  id: 'n-1', category: 'estimate', severity: 'warning',
  title: 'E-2026-0001 is waiting for approval',
  body: 'Priced at $250,000 and blocked from issue until a senior signs it off.',
  actionPath: '/app/estimates/v-1', actionLabel: 'Open the estimate',
  readAt: null, createdAt: '2026-09-05T14:00:00Z', ...over,
});

describe('the notifications screen', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.fail = null; hoisted.markFails = null;
    hoisted.marked = []; hoisted.dismissed = [];
    hoisted.rows = [note()];
  });

  it('shows the caller\'s own notices, not a sample set', async () => {
    renderPage(<NotificationsLivePage />);
    await waitFor(() =>
      expect(screen.getByText('E-2026-0001 is waiting for approval')).toBeInTheDocument());
    expect(screen.getByText(/blocked from issue until a senior signs it off/))
      .toBeInTheDocument();
  });

  it('counts unread from what is actually unread', async () => {
    hoisted.rows = [note(), note({ id: 'n-2', readAt: '2026-09-05T15:00:00Z' })];
    renderPage(<NotificationsLivePage />);
    await waitFor(() => expect(screen.getByText('Unread (1)')).toBeInTheDocument());
    expect(screen.getByText('Everything (2)')).toBeInTheDocument();
  });

  it('marks one read', async () => {
    const user = userEvent.setup();
    renderPage(<NotificationsLivePage />);
    await waitFor(() => expect(screen.getByText('Mark read')).toBeInTheDocument());
    await user.click(screen.getByText('Mark read'));
    await waitFor(() => expect(hoisted.marked).toEqual(['n-1']));
  });

  it('marks everything read in one go', async () => {
    hoisted.rows = [note(), note({ id: 'n-2' }), note({ id: 'n-3' })];
    const user = userEvent.setup();
    renderPage(<NotificationsLivePage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Mark all read/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Mark all read/ }));
    await waitFor(() => expect(hoisted.marked.sort()).toEqual(['n-1', 'n-2', 'n-3']));
  });

  it('offers nothing to mark when nothing is unread', async () => {
    hoisted.rows = [note({ readAt: '2026-09-05T15:00:00Z' })];
    renderPage(<NotificationsLivePage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Mark all read/ })).toBeDisabled());
    expect(screen.getByText('Nothing unread')).toBeInTheDocument();
  });

  it('says a mark failed instead of showing it as read', async () => {
    // Silently showing it read would lose the notice: the person believes they
    // have dealt with it and the database still says they have not.
    hoisted.markFails = 'new row violates row-level security policy';
    const user = userEvent.setup();
    renderPage(<NotificationsLivePage />);
    await waitFor(() => expect(screen.getByText('Mark read')).toBeInTheDocument());
    await user.click(screen.getByText('Mark read'));
    await waitFor(() =>
      expect(screen.getByText('new row violates row-level security policy'))
        .toBeInTheDocument());
  });

  it('puts one away without deleting it', async () => {
    const user = userEvent.setup();
    renderPage(<NotificationsLivePage />);
    await waitFor(() => expect(screen.getByText('Dismiss')).toBeInTheDocument());
    await user.click(screen.getByText('Dismiss'));
    await waitFor(() => expect(hoisted.dismissed).toEqual(['n-1']));
    expect(screen.getByText(/nothing here is deleted/)).toBeInTheDocument();
  });

  it('lists only the kinds of notice that actually exist', async () => {
    // The schema allows twelve categories. A filter offering eleven empty ones
    // is a filter nobody uses.
    hoisted.rows = [note(), note({ id: 'n-2', category: 'billing' })];
    renderPage(<NotificationsLivePage />);
    await waitFor(() => expect(screen.getByText('Billing, Estimate')).toBeInTheDocument());
  });

  it('says plainly when there is nothing at all', async () => {
    hoisted.rows = [];
    renderPage(<NotificationsLivePage />);
    await waitFor(() => expect(screen.getByText('Nothing unread')).toBeInTheDocument());
    expect(screen.getByText(/when an estimate needs approval, a payment fails/))
      .toBeInTheDocument();
  });

  it('shows a read failure as a failure', async () => {
    hoisted.fail = 'JWT expired';
    renderPage(<NotificationsLivePage />);
    await waitFor(() => expect(screen.getByText('JWT expired')).toBeInTheDocument());
  });

  /*
   * The four tiles counted and then left the reader to find the notices behind
   * the count. Three of them now put that view on the screen; the fourth says
   * what it is made of.
   */
  it('narrows the list to warnings and critical notices from the tile', async () => {
    hoisted.rows = [
      note({ id: 'n-1', severity: 'critical', title: 'Payment failed' }),
      note({ id: 'n-2', severity: 'info', title: 'Estimate issued' }),
    ];
    const user = userEvent.setup();
    renderPage(<NotificationsLivePage />);
    await waitFor(() => expect(screen.getByText('Estimate issued')).toBeInTheDocument());

    const tile = screen.getByRole('button', { name: 'Show only warnings and critical notices' });
    expect(tile).toHaveAttribute('aria-pressed', 'false');
    await user.click(tile);

    await waitFor(() =>
      expect(screen.getByText('Warnings and critical notices')).toBeInTheDocument());
    expect(screen.getByText('Payment failed')).toBeInTheDocument();
    expect(screen.queryByText('Estimate issued')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show only warnings and critical notices' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('says so rather than showing an empty list when nothing needs attention', async () => {
    hoisted.rows = [note({ severity: 'info' })];
    const user = userEvent.setup();
    renderPage(<NotificationsLivePage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Show only warnings and critical notices' }))
        .toBeInTheDocument());
    await user.click(
      screen.getByRole('button', { name: 'Show only warnings and critical notices' }));
    await waitFor(() =>
      expect(screen.getByText('Nothing needing attention')).toBeInTheDocument());
    expect(screen.getByText('Nothing here is a warning or a critical notice.'))
      .toBeInTheDocument();
  });

  it('shows everything from the total tile and returns from the unread one', async () => {
    hoisted.rows = [
      note({ id: 'n-1' }),
      note({ id: 'n-2', readAt: '2026-09-05T15:00:00Z', title: 'Already seen' }),
    ];
    const user = userEvent.setup();
    renderPage(<NotificationsLivePage />);
    await waitFor(() => expect(screen.getByText('Waiting on you')).toBeInTheDocument());
    expect(screen.queryByText('Already seen')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show everything, read and unread' }));
    await waitFor(() => expect(screen.getByText('Already seen')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Show only what is unread' }));
    await waitFor(() => expect(screen.queryByText('Already seen')).not.toBeInTheDocument());
  });

  it('breaks the kinds count down instead of leaving it a number', async () => {
    hoisted.rows = [
      note({ id: 'n-1', category: 'estimate' }),
      note({ id: 'n-2', category: 'estimate', readAt: '2026-09-05T15:00:00Z' }),
      note({ id: 'n-3', category: 'billing', readAt: '2026-09-05T15:00:00Z' }),
    ];
    const user = userEvent.setup();
    renderPage(<NotificationsLivePage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'What is behind Kinds' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'What is behind Kinds' }));

    await waitFor(() => expect(screen.getByText('2 notices, 1 unread')).toBeInTheDocument());
    expect(screen.getByText('1 notice')).toBeInTheDocument();
  });
});
