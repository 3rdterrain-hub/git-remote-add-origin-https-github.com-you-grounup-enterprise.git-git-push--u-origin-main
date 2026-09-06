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
import { screen, waitFor } from '@testing-library/react';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  version: null as unknown,
  fail: null as string | null,
  permissions: ['estimates.read', 'estimates.write', 'estimates.approve', 'estimates.issue'] as string[],
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
  return { ...actual, useParams: () => ({ estimateId: 'v-1' }) };
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
  };
});

const { EstimateVersionPage } = await import('./estimate-version');

const line = (over: Record<string, unknown> = {}) => ({
  id: 'l-1', sortOrder: 10, lineNumber: null, description: 'Mass excavation',
  serviceId: 's-1', serviceName: 'Mass excavation', costCode: 'CC-0006',
  unit: 'CY', measuredQuantity: 12_000, adjustedQuantity: 12_000,
  unitCost: 4.25, totalDirectCost: 51_000, laborHours: 180, equipmentHours: 210,
  confidenceBand: 'high', blocksIssue: false, hasProductionRate: true, ...over,
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
  lines: [line()], ...over,
});

describe('the estimate workspace', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.fail = null;
    hoisted.permissions = ['estimates.read', 'estimates.write', 'estimates.approve', 'estimates.issue'];
    hoisted.version = version();
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
    expect(screen.queryByText('Mass excavation')).not.toBeInTheDocument();
  });
});
