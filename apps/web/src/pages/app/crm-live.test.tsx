/**
 * Customers, on real data.
 *
 * The fixture this replaces became actively wrong the moment an estimate could
 * name a client: add Maumee Development on an estimate, open the CRM, and find
 * five invented companies that are not yours and not the one you just added.
 *
 * So what is tested is mostly that the numbers are counted rather than carried:
 * lifetime value from awarded estimates, win rate over decided opportunities,
 * and nothing at all where there is nothing to count.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  customers: [] as unknown[],
  opportunities: [] as unknown[],
  fail: null as string | null,
  permissions: ['crm.read', 'crm.write'] as string[],
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/session', () => ({
  usePermissions: () => ({ can: (p: string) => hoisted.permissions.includes(p), loading: false }),
  useCompanyId: () => ({ companyId: 'company-1', loading: false }),
}));

vi.mock('@/lib/data/crm', async () => {
  const actual = await vi.importActual<typeof import('./../../lib/data/crm')>('@/lib/data/crm');
  return {
    ...actual,
    loadCrmCustomers: async () => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      return hoisted.customers;
    },
    loadOpportunities: async () => hoisted.opportunities,
  };
});

const { CrmLivePage } = await import('./crm-live');

const customer = (over: Record<string, unknown> = {}) => ({
  id: 'c-1', code: 'CUS-0001', name: 'Maumee Development Partners',
  customerType: 'developer', email: 'ap@maumee.test', phone: '419-555-0100',
  city: 'Maumee', state: 'OH', paymentTerms: 'Net 30',
  awardedValue: 1_482_000, awardedCount: 2, openValue: 250_000, openCount: 1,
  lastActivityAt: '2026-09-01T12:00:00Z', ...over,
});

describe('the customers screen', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.fail = null;
    hoisted.permissions = ['crm.read', 'crm.write'];
    hoisted.customers = [customer()];
    hoisted.opportunities = [];
  });

  it('lists the caller\'s own customers', async () => {
    renderPage(<CrmLivePage />);
    await waitFor(() =>
      expect(screen.getByText('Maumee Development Partners')).toBeInTheDocument());
    expect(screen.getByText(/CUS-0001 · Developer · Maumee, OH/)).toBeInTheDocument();
    // And not the sample dataset's companies.
    expect(screen.queryByText('Northwood Industrial REIT')).not.toBeInTheDocument();
  });

  it('counts what a customer has been worth from awarded estimates', async () => {
    /*
     * The fixture carried a `wonValue` per customer that nothing computed. A
     * stored total is wrong from the first award nobody remembered to add.
     */
    renderPage(<CrmLivePage />);
    await waitFor(() => expect(screen.getByText('$1,482,000.00')).toBeInTheDocument());
    expect(screen.getByText('2 jobs')).toBeInTheDocument();
    expect(screen.getByText('$250,000.00')).toBeInTheDocument();
    expect(screen.getByText('1 estimate')).toBeInTheDocument();
  });

  it('says a customer has won nothing rather than showing zero dollars', async () => {
    hoisted.customers = [customer({ awardedValue: 0, awardedCount: 0, openValue: 0, openCount: 0 })];
    renderPage(<CrmLivePage />);
    await waitFor(() => expect(screen.getByText('nothing yet')).toBeInTheDocument());
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('reports no win rate when nothing has been decided', async () => {
    // The screen it replaces read "62%", which was a constant.
    renderPage(<CrmLivePage />);
    await waitFor(() => expect(screen.getByText('nothing decided yet')).toBeInTheDocument());
    expect(screen.queryByText('62%')).not.toBeInTheDocument();
  });

  it('counts the win rate over decided opportunities', async () => {
    hoisted.opportunities = [
      { id: 'o-1', number: 'OPP-1', name: 'Culvert', customerName: 'Lucas County',
        stage: 'won', estimatedValue: 900_000, probability: 1, bidDueAt: null,
        expectedAwardAt: null, lossReason: null, winningCompetitor: null },
      { id: 'o-2', number: 'OPP-2', name: 'Pad', customerName: 'Northwood',
        stage: 'lost', estimatedValue: 400_000, probability: 0, bidDueAt: null,
        expectedAwardAt: null, lossReason: 'Price', winningCompetitor: 'Anderson' },
      { id: 'o-3', number: 'OPP-3', name: 'Grading', customerName: 'Maumee',
        stage: 'estimating', estimatedValue: 600_000, probability: 0.5, bidDueAt: null,
        expectedAwardAt: null, lossReason: null, winningCompetitor: null },
    ];
    renderPage(<CrmLivePage />);
    await waitFor(() => expect(screen.getByText('50%')).toBeInTheDocument());
    expect(screen.getByText('1 won, 1 lost')).toBeInTheDocument();
    // The one still being estimated is the only open pipeline.
    expect(screen.getByText('$600K')).toBeInTheDocument();
    expect(screen.getByText('$300K weighted by probability')).toBeInTheDocument();
  });

  it('does not weight an opportunity that has no probability', async () => {
    hoisted.opportunities = [{
      id: 'o-1', number: 'OPP-1', name: 'Grading', customerName: 'Maumee',
      stage: 'qualifying', estimatedValue: 600_000, probability: null, bidDueAt: null,
      expectedAwardAt: null, lossReason: null, winningCompetitor: null,
    }];
    renderPage(<CrmLivePage />);
    await waitFor(() => expect(screen.getByText('Pipeline')).toBeInTheDocument());
    // Zero weighted, and the row says why rather than showing $0.00.
    expect(screen.getByText('$0 weighted by probability')).toBeInTheDocument();
  });

  it('offers no way to add a customer without the permission', async () => {
    hoisted.permissions = ['crm.read'];
    renderPage(<CrmLivePage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Add customer/ })).toBeDisabled());
  });

  it('says plainly when there are no customers yet', async () => {
    hoisted.customers = [];
    renderPage(<CrmLivePage />);
    await waitFor(() => expect(screen.getByText('No customers yet')).toBeInTheDocument());
    expect(screen.getByText(/name a client when you create an estimate/)).toBeInTheDocument();
  });

  it('shows a read failure as a failure, not as sample customers', async () => {
    hoisted.fail = 'permission denied for relation customers';
    renderPage(<CrmLivePage />);
    await waitFor(() =>
      expect(screen.getByText('permission denied for relation customers')).toBeInTheDocument());
    expect(screen.queryByText('Maumee Development Partners')).not.toBeInTheDocument();
  });
});
