/**
 * Proposals, on live data.
 *
 * The two things this screen must not do: recompute the price a customer was
 * sent, and treat a proposal still sitting with a customer as one they turned
 * down.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  rows: [] as unknown[],
  version: null as unknown,
  fail: null as string | null,
  permissions: ['estimates.read', 'estimates.issue'] as string[],
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/session', () => ({
  usePermissions: () => ({ can: (p: string) => hoisted.permissions.includes(p), loading: false }),
}));

vi.mock('@/lib/data/estimates', async () => {
  const actual = await vi.importActual<typeof import('./../../lib/data/estimates')>(
    '@/lib/data/estimates');
  return {
    ...actual,
    loadProposals: async () => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      return hoisted.rows;
    },
    loadVersion: () => async () => hoisted.version,
  };
});

const { ProposalsLivePage } = await import('./proposals-live');

const proposal = (over: Record<string, unknown> = {}) => ({
  id: 'pp-1', number: 'P-2026-0001', title: 'Quarry haul road',
  customerName: 'Maumee Development', status: 'issued', totalPrice: 250_000,
  validityDays: 30, coverLetter: null, paymentTerms: null,
  showLineDetail: false, showUnitPrices: true,
  issuedAt: '2026-09-02T10:00:00Z', viewedAt: null, acceptedAt: null,
  acceptedByName: null, declinedAt: null,
  estimateVersionId: 'v-1', estimateNumber: 'E-2026-0001', estimateVersion: 1, ...over,
});

const version = {
  id: 'v-1', estimateId: 'e-1', estimateNumber: 'E-2026-0001', estimateName: 'Quarry haul road',
  customerName: 'Maumee Development', versionNumber: 1, status: 'issued',
  directCost: 200_000, indirectCost: 0, totalMarkup: 50_000, totalPrice: 250_000,
  bidPrice: 250_000, totalLaborHours: 100, totalEquipmentHours: 100,
  blockedFromIssue: false, confidence: 90, engineVersion: 'engine-2.0.0',
  calculatedAt: '2026-09-01T09:00:00Z', librarySnapshotId: 'snap-1',
  approvedAt: null, issuedAt: null, costs: {},
  lines: [
    { id: 'l-1', sortOrder: 10, lineNumber: null, description: 'Mass excavation',
      serviceId: 's-1', serviceName: 'Mass excavation', costCode: 'CC-0006', unit: 'CY',
      measuredQuantity: 12_000, adjustedQuantity: 12_000, unitCost: 12.5,
      totalDirectCost: 150_000, laborHours: 60, equipmentHours: 60,
      confidenceBand: 'high', blocksIssue: false, hasProductionRate: true,
      clientVisible: true, markupOverride: null, wastePercent: 0, productionModifier: 1 },
    { id: 'l-2', sortOrder: 20, lineNumber: null, description: 'Aggregate base',
      serviceId: 's-2', serviceName: 'Aggregate base', costCode: 'CC-0031', unit: 'TON',
      measuredQuantity: 2_000, adjustedQuantity: 2_000, unitCost: 25,
      totalDirectCost: 50_000, laborHours: 40, equipmentHours: 40,
      confidenceBand: 'high', blocksIssue: false, hasProductionRate: true,
      clientVisible: true, markupOverride: null, wastePercent: 0, productionModifier: 1 },
  ],
  show: { labor: false, equipment: false, materials: true, hauling: true,
          subcontract: true },
};

describe('the proposals screen', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.fail = null;
    hoisted.permissions = ['estimates.read', 'estimates.issue'];
    hoisted.rows = [proposal()];
    hoisted.version = version;
  });

  it('shows the price the customer was sent, not one it recomputed', async () => {
    renderPage(<ProposalsLivePage />);
    // The number appears in the list, the card title and the document header.
    await waitFor(() => expect(screen.getAllByText('P-2026-0001').length).toBeGreaterThan(1));
    // The estimate behind it is a second read, so wait for it rather than
    // assuming it landed with the first.
    await waitFor(() => expect(screen.getByText('CC-0006')).toBeInTheDocument());
    // The sections roll up to exactly the frozen total.
    expect(screen.getAllByText('$250,000.00').length).toBeGreaterThan(0);
  });

  it('counts acceptance over what was answered, not over what was sent', async () => {
    hoisted.rows = [
      proposal({ id: 'a', number: 'P-1', status: 'accepted', acceptedByName: 'M. Reyes',
                 acceptedAt: '2026-09-03T10:00:00Z', totalPrice: 300_000 }),
      proposal({ id: 'b', number: 'P-2', status: 'declined', totalPrice: 100_000 }),
      // Still with the customer. Not an acceptance, and not a decline either.
      proposal({ id: 'c', number: 'P-3', status: 'issued', totalPrice: 900_000 }),
    ];
    renderPage(<ProposalsLivePage />);
    await waitFor(() => expect(screen.getByText('50%')).toBeInTheDocument());
    expect(screen.getByText('by count, across 2 answered')).toBeInTheDocument();
  });

  it('reports no acceptance rate when nothing has been answered', async () => {
    renderPage(<ProposalsLivePage />);
    await waitFor(() => expect(screen.getByText('nothing answered yet')).toBeInTheDocument());
  });

  it('offers the two answers a customer can give on an issued proposal', async () => {
    renderPage(<ProposalsLivePage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /accepted/i })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /declined/i })).toBeInTheDocument();
  });

  it('offers no answer to somebody who cannot issue', async () => {
    hoisted.permissions = ['estimates.read'];
    renderPage(<ProposalsLivePage />);
    await waitFor(() => expect(screen.getAllByText('P-2026-0001').length).toBeGreaterThan(1));
    expect(screen.queryByRole('button', { name: /^accepted$/i })).not.toBeInTheDocument();
  });

  it('names who signed an accepted proposal', async () => {
    hoisted.rows = [proposal({
      status: 'accepted', acceptedByName: 'M. Reyes', acceptedAt: '2026-09-03T10:00:00Z',
    })];
    renderPage(<ProposalsLivePage />);
    await waitFor(() => expect(screen.getByText(/Signed by M\. Reyes/)).toBeInTheDocument());
    // And it is no longer something anyone can answer.
    expect(screen.queryByRole('button', { name: /^declined$/i })).not.toBeInTheDocument();
  });

  it('says an issued proposal is frozen', async () => {
    renderPage(<ProposalsLivePage />);
    await waitFor(() =>
      expect(screen.getByText('This proposal is issued and frozen')).toBeInTheDocument());
  });

  it('shows a read failure as a failure', async () => {
    hoisted.fail = 'permission denied for relation proposals';
    renderPage(<ProposalsLivePage />);
    await waitFor(() =>
      expect(screen.getByText('permission denied for relation proposals')).toBeInTheDocument());
    expect(screen.queryByText('PROP-2026-0184')).not.toBeInTheDocument();
  });
});
