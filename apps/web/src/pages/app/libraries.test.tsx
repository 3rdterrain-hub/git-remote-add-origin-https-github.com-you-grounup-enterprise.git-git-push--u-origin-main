/**
 * The library counts are counted.
 *
 * The four figures across the top of this screen were constants copied out of
 * the generated seed — `services: 188, tasks: 2783` — and they stayed at those
 * numbers whatever a company added, copied or retired. The tabs underneath
 * listed the real rows, so the page disagreed with itself for anybody who had
 * used it, and it disagreed most for the customers who had used it most.
 *
 * They are also the door to the tab that holds what they count, which is the
 * other half of what a tile that only displayed a number was not doing.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  counts: {
    services: 191, tasks: 2_790, assemblies: 188,
    productionRates: 1_452, labor: 14, equipment: 17, crews: 8,
  },
  countsFail: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/session')>('@/lib/data/session');
  return {
    ...actual,
    usePermissions: () => ({ can: () => true, loading: false }),
    loadMemberships: async () => [{ companyId: 'co-1', companyName: 'Terrain', role: 'owner' }],
  };
});

vi.mock('@/lib/data/production', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/production')>(
    '@/lib/data/production');
  return { ...actual, loadProductionRates: () => async () => [] };
});

vi.mock('@/lib/data/library', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/library')>('@/lib/data/library');
  const none = async () => [];
  return {
    ...actual,
    loadServices: none, loadTasks: none, loadTruckingRates: none, loadDisposalSites: none,
    loadVendors: none, loadMaterials: none, loadLaborRates: none, loadEquipmentOptions: none,
    loadCrews: none, loadConditionModifiers: none, loadPricingProfiles: none,
    loadLibraryCounts: async () => {
      if (hoisted.countsFail) throw new Error(hoisted.countsFail);
      return hoisted.counts;
    },
  };
});

const { LibrariesPage } = await import('./libraries');

describe('the four figures across the top', () => {
  beforeEach(() => {
    hoisted.configured = true;
    hoisted.countsFail = null;
    hoisted.counts = {
      services: 191, tasks: 2_790, assemblies: 188,
      productionRates: 1_452, labor: 14, equipment: 17, crews: 8,
    };
  });

  it('counts what the library actually holds, not what the seed shipped', async () => {
    renderPage(<LibrariesPage />);
    // 191, not the 188 the seed ships: three services this company added.
    await waitFor(() => expect(screen.getByText('191')).toBeInTheDocument());
    expect(screen.getByText('2,790')).toBeInTheDocument();
    expect(screen.getByText('1,452')).toBeInTheDocument();
    // Labor, equipment and crews added together.
    expect(screen.getByText('39')).toBeInTheDocument();
  });

  it('shows a dash rather than a remembered number while the count is in flight', async () => {
    renderPage(<LibrariesPage />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    // Let the query land before the test ends, so the settle is not reported
    // as an unwrapped update belonging to whichever test runs next.
    await waitFor(() => expect(screen.getByText('191')).toBeInTheDocument());
  });

  it('says nothing rather than something wrong when the count fails', async () => {
    hoisted.countsFail = 'JWT expired';
    renderPage(<LibrariesPage />);
    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThan(0));
    expect(screen.queryByText('188')).not.toBeInTheDocument();
  });

  it('opens the tab that holds what it counted', async () => {
    const user = userEvent.setup();
    renderPage(<LibrariesPage />);
    await waitFor(() => expect(screen.getByText('191')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Open the services tab' }));
    expect(screen.getByRole('tab', { name: 'Services' })).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('button', { name: 'Open the services tab' }))
      .toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Open the production rates tab' }));
    expect(screen.getByRole('tab', { name: 'Production rates' }))
      .toHaveAttribute('data-state', 'active');
  });

  it('marks the resources tile on any of the three tabs it stands for', async () => {
    const user = userEvent.setup();
    renderPage(<LibrariesPage />);
    await waitFor(() => expect(screen.getByText('39')).toBeInTheDocument());

    const resources = () => screen.getByRole('button',
      { name: 'Open the labor, equipment and crew tabs' });
    // Labor is where the screen opens, so it is already the answer.
    expect(resources()).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('tab', { name: 'Crews' }));
    expect(resources()).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('tab', { name: 'Materials' }));
    expect(resources()).toHaveAttribute('aria-pressed', 'false');
  });
});
