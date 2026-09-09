/**
 * The tiles on the screens a visitor sees before they have a workspace.
 *
 * Four of this application's screens are a switch: with a Supabase project
 * behind them they render the live page, and with none they render the sample
 * workspace. The sample half is the first thing anybody sees, and every tile on
 * it was a `div` — a dashboard whose whole job is to send somebody somewhere,
 * where nothing could be pressed.
 *
 * Kept in one file because the setup is the same for all four: the only thing
 * that decides which half renders is `isSupabaseConfigured`.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabase: null,
  callFunction: async () => { throw new Error('not configured'); },
}));

const { DashboardPage } = await import('./dashboard');
const { CrmPage } = await import('./crm');
const { NotificationsPage } = await import('./notifications');
const { ProposalsPage } = await import('./proposals');
const { BillingPage } = await import('./billing');

describe('the sample dashboard', () => {
  it('says what backlog is, and offers the screen that holds it', async () => {
    const user = userEvent.setup();
    renderPage(<DashboardPage />);
    await user.click(screen.getByRole('button', { name: 'What is behind Backlog remaining' }));

    expect(screen.getByText(/revenue still to\s+earn, not cash still to collect/))
      .toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See the projects behind it' }))
      .toHaveAttribute('href', '/app/projects');
  });

  it('says a fuel forecast is burn rates and not a percentage of the machine cost', async () => {
    const user = userEvent.setup();
    renderPage(<DashboardPage />);
    await user.click(screen.getByRole('button', { name: 'What is behind Fuel forecast' }));
    expect(screen.getByText(/not a percentage added to the equipment cost/)).toBeInTheDocument();
  });

  it('says duration is how much work there is, not when the job finishes', async () => {
    const user = userEvent.setup();
    renderPage(<DashboardPage />);
    await user.click(screen.getByRole('button', { name: 'What is behind Estimated duration' }));
    expect(screen.getByText(/not of when the job\s+finishes/)).toBeInTheDocument();
  });
});

describe('the sample CRM', () => {
  it('computes the win rate rather than printing one', async () => {
    // It read a hard-coded "62%" beside a live count of wins and losses, so the
    // rate and the numbers it claimed to be a rate of disagreed.
    renderPage(<CrmPage />);
    const tile = screen.getByRole('button', { name: 'Show the win and loss analysis' });
    expect(tile).not.toHaveTextContent('62%');
  });

  it('goes to the stage breakdown from the pipeline total', async () => {
    const user = userEvent.setup();
    renderPage(<CrmPage />);
    const tile = screen.getByRole('button',
      { name: 'Show the pipeline broken down by stage' });
    await user.click(tile);
    expect(tile).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Pipeline by stage')).toBeInTheDocument();
  });

  it('says what the weighted pipeline is for', async () => {
    const user = userEvent.setup();
    renderPage(<CrmPage />);
    await user.click(screen.getByRole('button', { name: 'What is behind Weighted pipeline' }));
    expect(screen.getByText(/no job lands at 40%/)).toBeInTheDocument();
  });
});

describe('the sample notifications', () => {
  it('gives the critical count a view of its own', async () => {
    const user = userEvent.setup();
    renderPage(<NotificationsPage />);
    await user.click(screen.getByRole('button', { name: 'Show only the unread critical notices' }));
    expect(screen.getByRole('tab', { name: /^Critical/ })).toHaveAttribute('data-state', 'active');
  });

  it('shows everything from the total', async () => {
    const user = userEvent.setup();
    renderPage(<NotificationsPage />);
    await user.click(screen.getByRole('button', { name: 'Show everything, read and unread' }));
    expect(screen.getByRole('tab', { name: /^All/ })).toHaveAttribute('data-state', 'active');
  });
});

describe('the sample proposals', () => {
  it('narrows the list to what has been accepted', async () => {
    const user = userEvent.setup();
    renderPage(<ProposalsPage />);
    await user.click(screen.getByRole('button', { name: 'List the accepted proposals' }));
    expect(screen.getByText('Accepted proposals')).toBeInTheDocument();
  });

  it('says the acceptance rate excludes drafts', async () => {
    const user = userEvent.setup();
    renderPage(<ProposalsPage />);
    await user.click(screen.getByRole('button', { name: 'What is behind Acceptance rate' }));
    expect(screen.getByText(/A proposal nobody sent has not been declined/)).toBeInTheDocument();
  });
});

describe('the billing screen', () => {
  it('says why a redirect back from checkout does not activate anything', async () => {
    // The rule this page exists under: paid access comes from verified webhook
    // state, never from a browser that has been redirected.
    const user = userEvent.setup();
    renderPage(<BillingPage />);
    await user.click(screen.getByRole('button', { name: 'What is behind Subscription status' }));

    expect(screen.getByText(/Coming back from a checkout page does not activate anything/))
      .toBeInTheDocument();
    expect(screen.getByText(/treating a redirect as payment is how paid access gets handed out/))
      .toBeInTheDocument();
  });

  it('sends the seat count to the limits it is one of', async () => {
    const user = userEvent.setup();
    renderPage(<BillingPage />);
    const tile = screen.getByRole('button',
      { name: 'Show every limit and what is used against it' });
    await user.click(tile);
    expect(tile).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Usage this period')).toBeInTheDocument();
  });
});
