/**
 * The estimate workspace, on a real version.
 *
 * The properties worth holding a screen to here are the ones that decide
 * whether a wrong number can reach a customer:
 *
 *   * a version that has been approved cannot be edited from this screen,
 *     because it cannot be edited at all — RULE-009 freezes it;
 *   * approving says in advance why it is unavailable, rather than letting
 *     somebody discover the rule by being refused;
 *   * an estimate the engine has blocked cannot be approved or issued from
 *     here, which is the gate migration 0097 added and nothing had before.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  version: null as unknown,
  fail: null as string | null,
  permissions: ['estimates.read', 'estimates.write', 'estimates.approve', 'estimates.issue'] as string[],
  updated: [] as Array<Record<string, unknown>>,
  revised: [] as Array<{ id: string; reason: string }>,
  navigated: [] as string[],
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
  callFunction: async () => ({}),
}));

vi.mock('@/lib/data/session', () => ({
  usePermissions: () => ({ can: (p: string) => hoisted.permissions.includes(p), loading: false }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ estimateId: 'v-1' }),
    useNavigate: () => (to: string) => { hoisted.navigated.push(to); },
  };
});

vi.mock('@/lib/data/estimates', async () => {
  const actual = await vi.importActual<typeof import('./../../lib/data/estimates')>(
    '@/lib/data/estimates');
  return {
    ...actual,
    loadVersion: () => async () => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      return hoisted.version;
    },
    loadDrift: () => async () => [],
    searchServices: () => async () => [],
    updateVersion: async (_c: unknown, _v: string, fields: Record<string, unknown>) => {
      hoisted.updated.push(fields);
    },
    reviseVersion: async (_c: unknown, id: string, reason: string) => {
      hoisted.revised.push({ id, reason });
      return 'v-2';
    },
  };
});

const { EstimateVersionPage } = await import('./estimate-version');

const line = (over: Record<string, unknown> = {}) => ({
  id: 'l-1', sortOrder: 10, lineNumber: null, description: 'Mass excavation',
  serviceId: 's-1', serviceName: 'Mass excavation', costCode: 'CC-0006',
  unit: 'CY', measuredQuantity: 12_000, adjustedQuantity: 12_000,
  unitCost: 4.25, totalDirectCost: 51_000, laborHours: 180, equipmentHours: 210,
  confidenceBand: 'high', blocksIssue: false, hasProductionRate: true,
  clientVisible: true, markupOverride: null, wastePercent: 0, productionModifier: 1,
  ...over,
});

const version = (over: Record<string, unknown> = {}) => ({
  id: 'v-1', estimateId: 'e-1', estimateNumber: 'E-2026-0001', estimateName: 'Quarry haul road',
  customerName: 'Maumee Development', expiresAt: null, expired: false,
  createdAt: '2026-08-25T12:00:00Z', versionNumber: 1, status: 'draft',
  directCost: 51_000, indirectCost: 4_000, totalMarkup: 11_000, totalPrice: 66_000,
  bidPrice: 66_000, totalLaborHours: 180, totalEquipmentHours: 210,
  blockedFromIssue: false, confidence: 91.5, engineVersion: 'engine-2.0.0',
  calculatedAt: '2026-09-01T09:00:00Z', librarySnapshotId: null,
  approvedAt: null, issuedAt: null,
  costs: { labor: 30_000, burden: 9_000, equipment: 12_000, fuel: 0, material: 0,
           mobilization: 0, trucking: 0, disposal: 0, subcontract: 0, other: 0 },
  lines: [line()],
  show: { labor: false, equipment: false, materials: true, hauling: true,
          subcontract: true },
  assumptions: {
    shiftHours: 10, calendarEfficiency: 0.85, fuelPricePerGallon: 4.1,
    defPricePerGallon: 12.5, swellPercent: 0.25, shrinkPercent: 0.1,
    bidRoundingIncrement: 0,
  },
  ...over,
});

describe('the estimate workspace', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.fail = null;
    hoisted.permissions = ['estimates.read', 'estimates.write', 'estimates.approve', 'estimates.issue'];
    hoisted.version = version();
    hoisted.updated = []; hoisted.revised = []; hoisted.navigated = [];
  });

  it('shows the engine result and says which build produced it', async () => {
    renderPage(<EstimateVersionPage />);
    await waitFor(() => expect(screen.getByText(/E-2026-0001/)).toBeInTheDocument());
    expect(screen.getByText(/Priced by engine engine-2\.0\.0/)).toBeInTheDocument();
    expect(screen.getAllByText('$66,000.00').length).toBeGreaterThan(0);
  });

  it('lets the estimator edit the quantity and nothing else on the line', async () => {
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(screen.getByLabelText('Quantity for Mass excavation')).toBeInTheDocument());
    // The unit cost and total are the engine's; there is no field for either.
    expect(screen.queryByLabelText(/unit cost/i)).not.toBeInTheDocument();
    expect(screen.getByText('$4.25')).toBeInTheDocument();
  });

  it('will not approve a version with a line that has a quantity and no price', async () => {
    hoisted.version = version({
      lines: [line({ totalDirectCost: 0, unitCost: 0 })], directCost: 0, calculatedAt: null,
    });
    renderPage(<EstimateVersionPage />);
    await waitFor(() => expect(screen.getByText(/have a quantity and no price/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
  });

  it('will not approve what the engine has blocked, and says so', async () => {
    hoisted.version = version({ blockedFromIssue: true });
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(screen.getByText('The pricing engine has not cleared this estimate.'))
        .toBeInTheDocument());
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
  });

  it('names the line that is blocking the bid', async () => {
    hoisted.version = version({ lines: [line({ blocksIssue: true, confidenceBand: 'do_not_price' })] });
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(screen.getByText(/1 line is not confident enough to bid/)).toBeInTheDocument());
    expect(screen.getByLabelText('This line blocks issue')).toBeInTheDocument();
  });

  it('will not approve an estimate whose price has stopped being good', async () => {
    hoisted.version = version({ expiresAt: '2026-08-30T12:00:00Z', expired: true });
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(screen.getByText(/This estimate expired on Aug 30, 2026/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
  });

  it('says when it was made and how long it stands', async () => {
    hoisted.version = version({ expiresAt: '2026-12-01T12:00:00Z' });
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(screen.getByText(/created Aug 25, 2026, valid until Dec 1, 2026/))
        .toBeInTheDocument());
  });

  it('offers no approval to somebody who cannot approve', async () => {
    hoisted.permissions = ['estimates.read', 'estimates.write'];
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(screen.getByText('You do not have permission to approve an estimate.'))
        .toBeInTheDocument());
  });

  it('offers no editing at all once the version is approved', async () => {
    hoisted.version = version({
      status: 'approved', approvedAt: '2026-09-02T10:00:00Z', librarySnapshotId: 'snap-1',
    });
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(screen.getByText(/This version is Approved and frozen/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /add line/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /price with the engine/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Quantity for Mass excavation')).not.toBeInTheDocument();
    // And it offers the thing an approved estimate is actually for.
    expect(screen.getByRole('button', { name: /issue proposal/i })).toBeInTheDocument();
  });

  it('says what the library has done since the version was priced', async () => {
    hoisted.version = version({ status: 'approved', librarySnapshotId: 'snap-1' });
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(screen.getByText('Nothing it was priced with has changed.')).toBeInTheDocument());
  });

  it('keeps every cost bucket separately visible', async () => {
    renderPage(<EstimateVersionPage />);
    // RULE-001. A single "cost" figure is exactly what this forbids.
    await waitFor(() => expect(screen.getByText('Labor wage')).toBeInTheDocument());
    for (const bucket of ['Labor burden', 'Equipment ownership']) {
      expect(screen.getByText(bucket)).toBeInTheDocument();
    }
  });

  it('shows a read failure as a failure', async () => {
    hoisted.fail = 'JWT expired';
    renderPage(<EstimateVersionPage />);
    await waitFor(() => expect(screen.getByText('JWT expired')).toBeInTheDocument());
    expect(screen.queryByText('Strip and stockpile topsoil')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  describe("this bid's assumptions", () => {
    it('shows the numbers the engine actually reads off the version', async () => {
      renderPage(<EstimateVersionPage />);
      await waitFor(() => expect(screen.getByLabelText('Diesel, $/gal')).toBeInTheDocument());
      expect(screen.getByLabelText('Diesel, $/gal')).toHaveValue(4.1);
      expect(screen.getByLabelText('Swell')).toHaveValue(0.25);
    });

    it('saves one when it changes, and only when it changes', async () => {
      renderPage(<EstimateVersionPage />);
      const field = await screen.findByLabelText('Diesel, $/gal');
      await userEvent.clear(field);
      await userEvent.type(field, '4.55');
      await userEvent.tab();
      await waitFor(() => expect(hoisted.updated).toHaveLength(1));
      expect(hoisted.updated[0]).toEqual({ fuel_price_per_gallon: 4.55 });

      /* Blurring an untouched field is not an edit and must not write one. */
      const swell = screen.getByLabelText('Swell');
      swell.focus();
      await userEvent.tab();
      expect(hoisted.updated).toHaveLength(1);
    });

    it('is read-only once the version is frozen', async () => {
      hoisted.version = version({ status: 'approved', approvedAt: '2026-09-02T00:00:00Z' });
      renderPage(<EstimateVersionPage />);
      await waitFor(() => expect(screen.getByLabelText('Swell')).toBeDisabled());
    });

    it('says the price does not follow on its own', async () => {
      renderPage(<EstimateVersionPage />);
      expect(await screen.findByText(/nothing recalculates on its own/i)).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  describe('creating a revision', () => {
    it('is offered exactly when the version is frozen', async () => {
      renderPage(<EstimateVersionPage />);
      await waitFor(() => expect(screen.getByText(/E-2026-0001/)).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /create revision/i })).not.toBeInTheDocument();

      hoisted.version = version({ status: 'issued', issuedAt: '2026-09-02T00:00:00Z' });
      renderPage(<EstimateVersionPage />);
      expect(await screen.findByRole('button', { name: /create revision/i })).toBeInTheDocument();
    });

    it('will not send a reason too short to explain anything', async () => {
      hoisted.version = version({ status: 'issued', issuedAt: '2026-09-02T00:00:00Z' });
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button', { name: /create revision/i }));
      const dialog = await screen.findByRole('dialog');
      const submit = within(dialog).getByRole('button', { name: /create revision/i });
      expect(submit).toBeDisabled();
      await userEvent.type(within(dialog).getByLabelText(/why this revision exists/i), 'oops');
      expect(submit).toBeDisabled();
    });

    it('copies it forward with the reason, and opens the new version', async () => {
      hoisted.version = version({ status: 'issued', issuedAt: '2026-09-02T00:00:00Z' });
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button', { name: /create revision/i }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/why this revision exists/i),
        'Owner moved the pond outlet');
      await userEvent.click(within(dialog).getByRole('button', { name: /create revision/i }));
      await waitFor(() => expect(hoisted.revised).toHaveLength(1));
      expect(hoisted.revised[0]).toEqual({ id: 'v-1', reason: 'Owner moved the pond outlet' });
      await waitFor(() => expect(hoisted.navigated).toEqual(['/app/estimates/v-2']));
    });

    it('says what a revision carries, so nobody expects to lose the crew', async () => {
      hoisted.version = version({ status: 'issued', issuedAt: '2026-09-02T00:00:00Z' });
      renderPage(<EstimateVersionPage />);
      expect(await screen.findByText(/crew, equipment, material, haul, modifiers and markups/))
        .toBeInTheDocument();
    });
  });


  // -------------------------------------------------------------------------
  describe('the boxes across the top', () => {
    it('shows only the blocking lines when the blocked tile is clicked', async () => {
      hoisted.version = version({
        blockedFromIssue: true,
        lines: [
          line({ id: 'l-1', description: 'Strip and stockpile topsoil', blocksIssue: false }),
          line({ id: 'l-2', description: 'Rock removal', blocksIssue: true }),
        ],
      });
      renderPage(<EstimateVersionPage />);
      await waitFor(() => expect(screen.getByText('Strip and stockpile topsoil')).toBeInTheDocument());

      await userEvent.click(screen.getByRole('button',
        { name: /show only the lines that are blocking this bid/i }));
      await waitFor(() => expect(screen.queryByText('Strip and stockpile topsoil')).not.toBeInTheDocument());
      expect(screen.getByText('Rock removal')).toBeInTheDocument();
    });

    it('says the table is filtered, and that the total still covers everything', async () => {
      hoisted.version = version({
        blockedFromIssue: true,
        lines: [
          line({ id: 'l-1', description: 'Strip and stockpile topsoil', blocksIssue: false }),
          line({ id: 'l-2', description: 'Rock removal', blocksIssue: true }),
        ],
      });
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button',
        { name: /show only the lines that are blocking this bid/i }));
      expect(await screen.findByText(/1 other is hidden/i)).toBeInTheDocument();
      expect(screen.getByText(/the whole estimate, not the 1 shown/i)).toBeInTheDocument();
    });

    it('offers no filter on an estimate the engine has cleared', async () => {
      renderPage(<EstimateVersionPage />);
      await waitFor(() => expect(screen.getByText(/E-2026-0001/)).toBeInTheDocument());
      expect(screen.queryByRole('button',
        { name: /show only the lines that are blocking this bid/i })).not.toBeInTheDocument();
    });
  });

});
