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
  workOrders: [] as unknown[],
  fuel: [] as unknown[],
  services: [] as unknown[],
  meter: null as unknown,
  assetsError: null as string | null,
  can: true,
  /* What the page actually asked the database to do, in order. */
  wrote: [] as Array<[string, unknown]>,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));
vi.mock('@/lib/data/session', () => ({
  usePermissions: () => ({ can: () => hoisted.can, loading: false }),
  useCompanyId: () => ({ companyId: 'co-1', loading: false }),
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
    loadWorkOrders: async () => hoisted.workOrders,
    loadFuel: async () => hoisted.fuel,
    loadAssetServices: () => async () => hoisted.services,
    loadAssetMeter: () => async () => hoisted.meter,
    recordMeterReading: async (input: unknown) => {
      hoisted.wrote.push(['meter', input]); return 'r-1';
    },
    setMaintenanceSchedule: async (input: unknown) => {
      hoisted.wrote.push(['service', input]); return 's-1';
    },
    retireMaintenanceSchedule: async (id: unknown) => { hoisted.wrote.push(['retire', id]); },
    updateAsset: async (input: unknown) => { hoisted.wrote.push(['asset', input]); },
    setAssetStatus: async (id: unknown, status: unknown) => {
      hoisted.wrote.push(['status', { id, status }]);
    },
    disposeAsset: async (id: unknown, on: unknown) => {
      hoisted.wrote.push(['dispose', { id, on }]);
    },
    updateWorkOrder: async (input: unknown) => { hoisted.wrote.push(['wo', input]); },
    completeWorkOrder: async (input: unknown) => { hoisted.wrote.push(['complete', input]); },
    cancelWorkOrder: async (id: unknown, reason: unknown) => {
      hoisted.wrote.push(['cancel', { id, reason }]);
    },
    recordFuel: async (_company: unknown, input: unknown) => {
      hoisted.wrote.push(['fuel', input]); return 'f-1';
    },
    resolveFuelException: async (input: unknown) => { hoisted.wrote.push(['resolve', input]); },
  };
});

const { FleetPage } = await import('./fleet');

const asset = {
  id: 'a-1', assetNumber: 'EX-4412', name: 'Excavator 20-25 ton', assetClass: 'excavator',
  make: 'Caterpillar', model: '325', modelYear: 2022, ownership: 'owned',
  currentHours: 4182, fuelType: 'diesel', status: 'assigned',
  location: null, lastTelemetryAt: null, acquisitionCost: 285000, serialNumber: 'CAT0325X',
  equipmentCode: 'EQ-EX-20', hoursLast30: 234, project: 'PRJ-2026-011',
  assignedOperator: 'Marco Silva',
};

describe('the fleet page', () => {
  beforeEach(() => {
    hoisted.configured = true;
    hoisted.assetsError = null;
    hoisted.assets = [asset];
    hoisted.maintenance = [];
    hoisted.workOrders = []; hoisted.fuel = [];
    hoisted.services = []; hoisted.meter = null; hoisted.wrote = [];
    hoisted.can = true;
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

describe('the boxes across the top', () => {
  beforeEach(() => {
    hoisted.configured = true;
    hoisted.assetsError = null;
    hoisted.assets = [asset];
    hoisted.maintenance = [];
    hoisted.workOrders = []; hoisted.fuel = [];
    hoisted.services = []; hoisted.meter = null; hoisted.wrote = [];
    hoisted.can = true;
  });

  it('narrows the asset list to what is down or in the shop', async () => {
    hoisted.assets = [
      asset,
      { ...asset, id: 'a-2', assetNumber: 'DZ-2205', name: 'Dozer', status: 'down' },
    ];
    const user = userEvent.setup();
    renderPage(<FleetPage />);
    await waitFor(() => expect(screen.getByText('DZ-2205')).toBeInTheDocument());

    await user.click(screen.getByRole('button',
      { name: 'List the machines that are down or in the shop' }));
    await waitFor(() =>
      expect(screen.getByText(/The 1 machine that is down or in the shop/)).toBeInTheDocument());
    expect(screen.getByText('DZ-2205')).toBeInTheDocument();
    expect(screen.queryByText('EX-4412')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show all 2' }));
    await waitFor(() => expect(screen.getByText('EX-4412')).toBeInTheDocument());
  });

  it('opens the utilization tab from the tile that counts hours', async () => {
    const user = userEvent.setup();
    renderPage(<FleetPage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Show the hours each machine ran' }))
        .toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Show the hours each machine ran' }));
    expect(screen.getByRole('tab', { name: 'Utilization' })).toHaveAttribute('data-state', 'active');
  });

  it('says what the owned fleet value excludes', async () => {
    const user = userEvent.setup();
    renderPage(<FleetPage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'What is behind Owned fleet value' }))
        .toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'What is behind Owned fleet value' }));
    expect(screen.getByText(/nothing here depreciates a machine/)).toBeInTheDocument();
  });
});

/**
 * The doors, added by migration 0186.
 *
 * `create_asset` and `create_work_order` were Fleet's entire write side. A
 * machine could be entered and never corrected, a work order opened and never
 * closed, and nothing anywhere could record a meter reading — the number every
 * maintenance interval, every utilization figure and `notify_maintenance_due`
 * are all computed from.
 */
describe('fleet doors', () => {
  /* Its own reset: the beforeEach above belongs to a sibling describe. */
  beforeEach(() => {
    hoisted.configured = true; hoisted.assetsError = null; hoisted.can = true;
    hoisted.assets = [asset]; hoisted.maintenance = [];
    hoisted.workOrders = []; hoisted.fuel = [];
    hoisted.services = []; hoisted.meter = null; hoisted.wrote = [];
  });

  const openAsset = async (user: ReturnType<typeof userEvent.setup>) => {
    renderPage(<FleetPage />);
    await user.click(await screen.findByRole('button', { name: 'EX-4412' }));
  };

  it('records a meter reading, which nothing could do before', async () => {
    hoisted.meter = {
      currentHours: 4182, currentMiles: 0, hours30DaysAgo: 3948,
      readingCount: 12, lastReadingAt: '2026-09-01T10:00:00Z',
      openWorkOrders: 0, downtime30Days: 0,
    };
    const user = userEvent.setup();
    await openAsset(user);
    await user.type(await screen.findByLabelText(/Meter now/i), '4300');
    await user.click(screen.getByRole('button', { name: /Record it/i }));
    await waitFor(() => expect(hoisted.wrote[0]?.[0]).toBe('meter'));
    expect(hoisted.wrote[0]![1]).toMatchObject({ assetId: 'a-1', hours: 4300, isReplacement: false });
  });

  it('says a meter replacement out loud rather than inferring it', async () => {
    const user = userEvent.setup();
    await openAsset(user);
    await user.type(await screen.findByLabelText(/Meter now/i), '12');
    await user.click(screen.getByLabelText(/The meter was replaced/i));
    await user.click(screen.getByRole('button', { name: /Record it/i }));
    await waitFor(() => expect(hoisted.wrote[0]?.[0]).toBe('meter'));
    expect(hoisted.wrote[0]![1]).toMatchObject({ isReplacement: true });
  });

  it('adds a service interval, because one with none never comes due', async () => {
    const user = userEvent.setup();
    await openAsset(user);
    await user.click(await screen.findByRole('button', { name: /Add a service/i }));
    await user.type(screen.getByLabelText(/What it is/i), '250-hour service');
    await user.type(screen.getByLabelText(/Every \(hours\)/i), '250');
    await user.click(screen.getByRole('button', { name: /^Add it$/i }));
    await waitFor(() => expect(hoisted.wrote[0]?.[0]).toBe('service'));
    expect(hoisted.wrote[0]![1]).toMatchObject({
      assetId: 'a-1', name: '250-hour service', intervalHours: 250,
    });
  });

  it('shows an overdue service as overdue, not as zero to go', async () => {
    hoisted.services = [{
      scheduleId: 's-1', name: '250-hour service', intervalHours: 250,
      intervalMiles: null, intervalDays: null, lastPerformedAt: '2026-06-01T00:00:00Z',
      lastPerformedHours: 3900, hoursRemaining: -32, daysRemaining: null,
      openWorkOrders: 0,
    }];
    const user = userEvent.setup();
    await openAsset(user);
    expect(await screen.findByText(/32 h overdue/i)).toBeTruthy();
  });

  it('puts a machine down', async () => {
    const user = userEvent.setup();
    await openAsset(user);
    await user.selectOptions(await screen.findByLabelText(/^Status$/i), 'down');
    await waitFor(() => expect(hoisted.wrote[0]?.[0]).toBe('status'));
    expect(hoisted.wrote[0]![1]).toMatchObject({ id: 'a-1', status: 'down' });
  });

  it('corrects a machine that was entered wrong', async () => {
    const user = userEvent.setup();
    await openAsset(user);
    const serial = await screen.findByLabelText(/Serial number/i);
    await user.clear(serial);
    await user.type(serial, 'CAT0325Z');
    await user.click(screen.getByRole('button', { name: /Save the machine/i }));
    await waitFor(() => expect(hoisted.wrote[0]?.[0]).toBe('asset'));
    expect(hoisted.wrote[0]![1]).toMatchObject({ assetId: 'a-1', serialNumber: 'CAT0325Z' });
  });

  it('will not complete a work order without saying what was done', async () => {
    hoisted.workOrders = [{
      id: 'w-1', number: 'WO-2026-0001', assetNumber: 'EX-4412', assetName: 'Excavator',
      title: 'Track tension', type: 'corrective', priority: 'high', status: 'open',
      openedAt: '2026-09-01T08:00:00Z', completedAt: null, downtimeHours: 0,
      laborCost: 0, partsCost: 0, outsideCost: 0, resolution: null,
    }];
    const user = userEvent.setup();
    renderPage(<FleetPage />);
    await user.click(await screen.findByRole('tab', { name: /Work orders/i }));
    await user.click(await screen.findByRole('button', { name: 'WO-2026-0001' }));
    const complete = await screen.findByRole('button', { name: /Complete it/i });
    expect(complete.hasAttribute('disabled')).toBe(true);

    await user.type(screen.getByLabelText(/What was done/i), 'Adjusted and greased');
    await user.click(screen.getByRole('button', { name: /Complete it/i }));
    await waitFor(() => expect(hoisted.wrote[0]?.[0]).toBe('complete'));
    expect(hoisted.wrote[0]![1]).toMatchObject({
      workOrderId: 'w-1', resolution: 'Adjusted and greased',
    });
  });

  it('will not reopen a closed work order', async () => {
    hoisted.workOrders = [{
      id: 'w-2', number: 'WO-2026-0002', assetNumber: 'EX-4412', assetName: 'Excavator',
      title: 'Annual', type: 'inspection', priority: 'normal', status: 'complete',
      openedAt: '2026-08-01T08:00:00Z', completedAt: '2026-08-02T08:00:00Z',
      downtimeHours: 4, laborCost: 100, partsCost: 0, outsideCost: 0,
      resolution: 'Passed, sticker applied',
    }];
    const user = userEvent.setup();
    renderPage(<FleetPage />);
    await user.click(await screen.findByRole('tab', { name: /Work orders/i }));
    await user.click(await screen.findByRole('button', { name: 'WO-2026-0002' }));
    expect(await screen.findByText(/is not reopened/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Complete it/i })).toBeNull();
  });

  it('records a fuel ticket, and says when it cannot be attributed', async () => {
    const user = userEvent.setup();
    renderPage(<FleetPage />);
    await user.click(await screen.findByRole('tab', { name: /Fuel/i }));
    await user.click(await screen.findByRole('button', { name: /Record a fuel ticket/i }));
    await user.type(screen.getByLabelText(/Gallons/i), '85');
    await user.type(screen.getByLabelText(/Price per gallon/i), '4.10');
    await user.click(screen.getByRole('button', { name: /^Record it$/i }));
    await waitFor(() => expect(hoisted.wrote[0]?.[0]).toBe('fuel'));
    expect(hoisted.wrote[0]![1]).toMatchObject({ gallons: 85, pricePerGallon: 4.1, assetId: null });
  });

  it('offers to attribute a fuel ticket that matched no machine', async () => {
    hoisted.fuel = [{
      id: 'f-1', transactedAt: '2026-09-10T12:00:00Z', assetNumber: null,
      assetName: 'no machine on the ticket', gallons: 60, pricePerGallon: 4.05,
      totalCost: 243, location: 'Pilot on 23', source: 'fuel_card', project: null,
      exception: 'no_asset', operator: null,
    }];
    const user = userEvent.setup();
    renderPage(<FleetPage />);
    await user.click(await screen.findByRole('tab', { name: /Fuel/i }));
    expect(await screen.findByText(/cannot be attributed to anything/i)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText(/Match it to a machine/i), 'a-1');
    await user.click(screen.getByRole('button', { name: /Attribute it/i }));
    await waitFor(() => expect(hoisted.wrote[0]?.[0]).toBe('resolve'));
    expect(hoisted.wrote[0]![1]).toMatchObject({ transactionId: 'f-1', assetId: 'a-1' });
  });

  it('says plainly when no machine has a service interval at all', async () => {
    const user = userEvent.setup();
    renderPage(<FleetPage />);
    await user.click(await screen.findByRole('tab', { name: /Maintenance/i }));
    expect(await screen.findByText(/never comes due, which is not the same/i)).toBeTruthy();
  });
});
