/**
 * Fleet, and the number this page used to invent.
 *
 * The sample dataset carried a `utilization30d` ratio for every machine, shown
 * as a percentage, colored green or red against a threshold — and nothing in
 * the platform computed it. A utilization percentage needs a denominator: hours
 * available. Available means what — every hour of the month, every shift hour,
 * every hour the machine was assigned to a job? The three answers differ by a
 * factor of four, and the platform holds no position on which one is meant.
 *
 * So the ratio is gone and the measured quantity is shown instead: hours the
 * meter actually moved in the last thirty days, computed from `meter_readings`.
 * That is a number the database can defend. These tests hold it there.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  assets: [] as unknown[],
  maintenance: [] as unknown[],
  assetsError: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));
vi.mock('@/lib/data/fleet', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/fleet')>('@/lib/data/fleet');
  return {
    ...actual,
    loadAssets: async () => {
      if (hoisted.assetsError) throw new Error(hoisted.assetsError);
      return hoisted.assets;
    },
    loadMaintenanceDue: async () => hoisted.maintenance,
    loadWorkOrders: async () => [],
    loadFuel: async () => [],
  };
});

const { FleetPage } = await import('./fleet');

const asset = {
  id: 'a-1', assetNumber: 'EX-4412', name: 'Excavator 20-25 ton', assetClass: 'excavator',
  make: 'Caterpillar', model: '325', modelYear: 2022, ownership: 'owned',
  currentHours: 4182, fuelType: 'diesel', status: 'assigned',
  location: null, lastTelemetryAt: null, acquisitionCost: 285000,
  equipmentCode: 'EQ-EX-20', hoursLast30: 234, project: 'PRJ-2026-011',
  assignedOperator: 'Marco Silva',
};

describe('the fleet page', () => {
  beforeEach(() => {
    hoisted.configured = true;
    hoisted.assetsError = null;
    hoisted.assets = [asset];
    hoisted.maintenance = [];
  });

  it('reports measured meter hours, never an invented utilization ratio', async () => {
    renderPage(<FleetPage />);
    await waitFor(() => expect(screen.getAllByText('EX-4412').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/234 hr in 30 days/).length).toBeGreaterThan(0);
    // The old page rendered "78%" here. A percentage of nothing.
    expect(screen.queryByText(/utilization ÷/)).not.toBeInTheDocument();
    expect(screen.queryByText('78%')).not.toBeInTheDocument();
  });

  it('counts only machines whose meter actually reported', async () => {
    /*
     * A machine with no reading in the window is not a machine that ran zero
     * hours — it is a machine the platform has nothing to say about. Averaging
     * it in as a zero would understate the fleet; the header says how many
     * machines the total is drawn from instead.
     */
    hoisted.assets = [asset, { ...asset, id: 'a-2', assetNumber: 'PV-5501', hoursLast30: null }];
    renderPage(<FleetPage />);
    await waitFor(() => expect(screen.getAllByText('EX-4412').length).toBeGreaterThan(0));
    expect(screen.getByText(/across 1 machine with meter readings/)).toBeInTheDocument();
  });

  it('ties a machine to the catalog rate it is estimated at', async () => {
    // The link that makes field cost and estimated cost comparable at all.
    renderPage(<FleetPage />);
    await waitFor(() => expect(screen.getByText('rate EQ-EX-20')).toBeInTheDocument());
  });

  it('does not call a schedule that runs on miles or a calendar overdue', async () => {
    /*
     * `hours_remaining` is null for a schedule with no hour interval. Treating
     * null as zero would have shown every mileage-based service as due right
     * now, in red, forever.
     */
    hoisted.maintenance = [{
      id: 'm-1', assetNumber: 'WT-0651', assetName: 'Water Truck',
      scheduleName: 'Annual DOT inspection', intervalHours: null,
      lastPerformedHours: null, currentHours: 5602, hoursRemaining: null,
    }];
    renderPage(<FleetPage />);
    await waitFor(() => expect(screen.getAllByText('EX-4412').length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole('tab', { name: /Maintenance/ }));
    await waitFor(() => expect(screen.getByText('Annual DOT inspection')).toBeInTheDocument());
    expect(screen.getByText('not hour-based')).toBeInTheDocument();
    expect(screen.queryByText(/over$/)).not.toBeInTheDocument();
  });

  it('shows a failed read as a failure rather than as an empty fleet', async () => {
    // An empty table and a broken query look identical, and mean opposite things.
    hoisted.assetsError = 'permission denied for table assets';
    renderPage(<FleetPage />);
    await waitFor(() =>
      expect(screen.getByText('permission denied for table assets')).toBeInTheDocument());
  });

  it('labels the page when there is no workspace behind it', async () => {
    hoisted.configured = false;
    renderPage(<FleetPage />);
    await waitFor(() => expect(screen.getByText('Demonstration data')).toBeInTheDocument());
  });
});
