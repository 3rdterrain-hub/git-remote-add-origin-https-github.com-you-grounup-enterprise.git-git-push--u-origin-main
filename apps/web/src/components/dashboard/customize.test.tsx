/**
 * Arranging your own dashboard.
 *
 * The property that matters is the one a customizer gets wrong most easily: it
 * must not offer a panel the person may not see. Hiding a checkbox is not the
 * control — the catalog is — but a customizer that listed safety panels to
 * somebody without safety permission would be telling them what exists in a
 * part of the platform they have no access to.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_DASHBOARD, type DashboardPreference } from '@/lib/dashboard-panels';

const hoisted = vi.hoisted(() => ({
  saved: [] as DashboardPreference[],
  fail: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/preferences', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/preferences')>(
    '@/lib/data/preferences');
  return {
    ...actual,
    saveDashboardPreference: async (_c: unknown, value: DashboardPreference) => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      hoisted.saved.push(value);
    },
  };
});

const { CustomizeDashboard } = await import('./customize');

const show = (
  preference: DashboardPreference = DEFAULT_DASHBOARD,
  can: (p: string) => boolean = () => true,
) => {
  const onSaved = vi.fn();
  render(<CustomizeDashboard open onOpenChange={() => {}} preference={preference}
    can={can} onSaved={onSaved} />);
  return { onSaved };
};

beforeEach(() => { hoisted.saved = []; hoisted.fail = null; });

describe('what it offers', () => {
  it('lists the panels with what each is for', async () => {
    show();
    expect(await screen.findByText('What is due')).toBeInTheDocument();
    expect(screen.getByText(/dates after which doing nothing costs you the job/))
      .toBeInTheDocument();
  });

  it('offers no panel the person may not see', () => {
    show(DEFAULT_DASHBOARD, (p) => p === 'estimates.read');
    expect(screen.getByText('What is due')).toBeInTheDocument();
    expect(screen.queryByText('Safety standing')).not.toBeInTheDocument();
    expect(screen.queryByText('Certifications lapsing')).not.toBeInTheDocument();
  });

  it('says so when a role is why the list is short', () => {
    show(DEFAULT_DASHBOARD, (p) => p === 'estimates.read');
    expect(screen.getByText(/Panels your role cannot see are not offered/))
      .toBeInTheDocument();
  });

  it('counts what is on out of what is available', () => {
    show();
    expect(screen.getByText(/of 9 panels on/)).toBeInTheDocument();
  });
});

describe('arranging it', () => {
  it('saves a panel that was switched on', async () => {
    const { onSaved } = show();
    await userEvent.click(screen.getByRole('switch', { name: 'Show Safety standing' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(hoisted.saved).toHaveLength(1));
    expect(hoisted.saved[0]!.order).toContain('safety');
    expect(onSaved).toHaveBeenCalled();
  });

  it('saves a panel that was switched off', async () => {
    show();
    await userEvent.click(screen.getByRole('switch', { name: 'Show What is due' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(hoisted.saved).toHaveLength(1));
    expect(hoisted.saved[0]!.hidden).toContain('due');
  });

  it('moves one up the order', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Move The week ahead up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(hoisted.saved).toHaveLength(1));
    expect(hoisted.saved[0]!.order[0]).toBe('weather');
  });

  it('will not move the first one up or the last one down', () => {
    show();
    expect(screen.getByRole('button', { name: 'Move What is due up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Safety standing down' })).toBeDisabled();
  });

  it('turns the tabs off for one long page', async () => {
    show();
    await userEvent.click(screen.getByRole('switch', { name: 'Group into tabs' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(hoisted.saved).toHaveLength(1));
    expect(hoisted.saved[0]!.layout).toBe('single');
  });

  it('puts everything back to the shipped arrangement', async () => {
    show({ order: ['safety'], hidden: ['due'], layout: 'single' });
    await userEvent.click(
      screen.getByRole('button', { name: /back to the shipped arrangement/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(hoisted.saved).toHaveLength(1));
    expect(hoisted.saved[0]).toEqual(DEFAULT_DASHBOARD);
  });

  it('says what went wrong rather than closing', async () => {
    hoisted.fail = 'You are signed out.';
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/You are signed out/)).toBeInTheDocument();
  });

  it('says the arrangement is this person’s alone', () => {
    show();
    expect(screen.getByText(/nobody else's dashboard changes/i)).toBeInTheDocument();
  });
});
