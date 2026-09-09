/**
 * Billing was the last screen computing from literals.
 *
 * `{ metric: 'Seats', used: 7, limit: 10 }`, four invoices, "Visa ···· 4242",
 * a period of 1 August to 1 September and the word "Active" were typed into the
 * component. They rendered in the same shapes and colors as everything real
 * beside them, so a customer looking at their own billing page saw somebody
 * else's figures presented as theirs — on the one page where a disagreement
 * becomes a dispute.
 *
 * These tests hold the replacement: every figure comes from state a
 * signature-verified webhook wrote, or from the two views the limit checks
 * themselves read.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  companyId: 'co-1' as string | null,
  canManage: true,
  plan: null as unknown,
  subscription: null as unknown,
  usage: [] as unknown[],
  invoices: [] as unknown[],
  seats: null as number | null,
  planFails: null as string | null,
  portalCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
  callFunction: async (name: string, body: Record<string, unknown>) => {
    hoisted.portalCalls.push({ name, ...body });
    return { url: 'https://billing.stripe.com/session/live_xyz' };
  },
}));

vi.mock('@/lib/data/session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/session')>('@/lib/data/session');
  return {
    ...actual,
    usePermissions: () => ({ can: (p: string) => (p === 'billing.manage' ? hoisted.canManage : true), loading: false }),
    useCompanyId: () => ({ companyId: hoisted.companyId, loading: false }),
  };
});

vi.mock('@/lib/data/billing', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/billing')>('@/lib/data/billing');
  return {
    ...actual,
    loadMyPlan: () => async () => {
      if (hoisted.planFails) throw new Error(hoisted.planFails);
      return hoisted.plan;
    },
    loadMySubscription: () => async () => hoisted.subscription,
    loadUsage: () => async () => hoisted.usage,
    loadInvoices: () => async () => hoisted.invoices,
    loadBillableSeats: () => async () => hoisted.seats,
  };
});

const { BillingPage } = await import('./billing');

const plan = (over: Record<string, unknown> = {}) => ({
  companyId: 'co-1', planId: 'professional', planName: 'Professional',
  tagline: 'For a growing contractor', features: ['estimating', 'projects'],
  everythingIncluded: false, accessValidUntil: null,
  entitlementSource: 'stripe_webhook', onTheFreePlan: false, ...over,
});

const subscription = (over: Record<string, unknown> = {}) => ({
  planId: 'professional', planName: 'Professional', status: 'active', isLive: true,
  quantity: 9, currentPeriodStart: '2026-08-14T00:00:00Z', currentPeriodEnd: '2026-09-14T00:00:00Z',
  trialEnd: null, cancelAtPeriodEnd: false, canceledAt: null,
  paymentBrand: 'mastercard', paymentLast4: '8391',
  lastEventAt: '2026-08-14T04:11:00Z',
  recurringCents: 44_100, interval: 'month' as const, hasMeteredItems: false, ...over,
});

const usage = [
  { metric: 'Seats', used: 9, limit: 12, unit: '', note: 'People who can sign in, plus invitations already sent.' },
  { metric: 'Active estimates', used: 63, limit: null, unit: '', note: 'Everything not archived or lost.' },
  { metric: 'Storage', used: 41, limit: 100, unit: ' GB', note: 'What is held right now, not everything ever uploaded.' },
];

const invoice = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1', number: 'GU-2026-0918', status: 'paid',
  amountDueCents: 44_100, amountPaidCents: 44_100, currency: 'USD',
  periodStart: '2026-08-14T00:00:00Z', periodEnd: '2026-09-14T00:00:00Z',
  hostedUrl: 'https://invoice.stripe.com/i/live_1', pdfUrl: 'https://files.stripe.com/live_1.pdf',
  issuedAt: '2026-08-14T00:00:00Z', paidAt: '2026-08-14T00:02:00Z', ...over,
});

describe('the billing screen', () => {
  beforeEach(() => {
    hoisted.configured = true;
    hoisted.companyId = 'co-1';
    hoisted.canManage = true;
    hoisted.planFails = null;
    hoisted.portalCalls = [];
    hoisted.plan = plan();
    hoisted.subscription = subscription();
    hoisted.usage = usage;
    hoisted.invoices = [invoice()];
    hoisted.seats = 9;
  });

  it('shows the plan, the price and the period from the subscription on record', async () => {
    renderPage(<BillingPage />);
    await waitFor(() => expect(screen.getAllByText('Professional').length).toBeGreaterThan(0));
    // $441.00 — nine seats at the price this company holds, not a catalog list price.
    expect(screen.getAllByText('$441.00').length).toBeGreaterThan(0);
    expect(screen.getByText(/billed monthly, next on/)).toBeInTheDocument();
  });

  it('shows the payment method the webhook recorded, and only its last four', async () => {
    renderPage(<BillingPage />);
    await waitFor(() => expect(screen.getByText('Mastercard ···· 8391')).toBeInTheDocument());
    // Nothing that could be a card number is anywhere on the page.
    expect(document.body.textContent).not.toMatch(/\d{13,19}/);
  });

  it('says when the webhook last advanced the subscription', async () => {
    renderPage(<BillingPage />);
    await waitFor(() =>
      expect(screen.getByText(/from the Stripe webhook of/)).toBeInTheDocument());
  });

  it('reads a status a person can act on rather than the Stripe word', async () => {
    hoisted.subscription = subscription({ status: 'past_due' });
    renderPage(<BillingPage />);
    await waitFor(() =>
      expect(screen.getAllByText('Payment overdue').length).toBeGreaterThan(0));
  });

  it('shows an unlimited allowance as unlimited, not as a full bar', async () => {
    renderPage(<BillingPage />);
    await waitFor(() => expect(screen.getByText('of unlimited')).toBeInTheDocument());
    expect(screen.getByText(/No limit on this plan/)).toBeInTheDocument();
  });

  it('counts seats the way the limit counts them, and says so', async () => {
    renderPage(<BillingPage />);
    await waitFor(() => expect(screen.getByText('9 / 12')).toBeInTheDocument());
    // The billable count is a different number and is named as such rather than
    // silently substituted for the enforced one.
    expect(screen.getByText('9 billable seats on the invoice')).toBeInTheDocument();
  });

  it('warns when the subscription will not renew, and turns auto-renew off', async () => {
    hoisted.subscription = subscription({ cancelAtPeriodEnd: true });
    renderPage(<BillingPage />);
    await waitFor(() =>
      expect(screen.getByText('This subscription will not renew')).toBeInTheDocument());
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByText(/billed monthly, ends/)).toBeInTheDocument();
  });

  it('links an invoice to Stripe rather than showing a dead button', async () => {
    renderPage(<BillingPage />);
    await waitFor(() => expect(screen.getByText('GU-2026-0918')).toBeInTheDocument());
    const pdf = screen.getByRole('link', { name: /PDF/ });
    expect(pdf).toHaveAttribute('href', 'https://files.stripe.com/live_1.pdf');
    expect(pdf).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('says an invoice has no document rather than offering one', async () => {
    hoisted.invoices = [invoice({ pdfUrl: null, hostedUrl: null })];
    renderPage(<BillingPage />);
    await waitFor(() => expect(screen.getByText('not published')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /PDF/ })).not.toBeInTheDocument();
  });

  it('shows what was paid when it differs from what was due', async () => {
    hoisted.invoices = [invoice({ status: 'open', amountPaidCents: 0 })];
    renderPage(<BillingPage />);
    await waitFor(() => expect(screen.getByText('$0.00 paid')).toBeInTheDocument());
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('opens the portal for the caller\'s own company, not a sample one', async () => {
    // The defect this conversion found: the page passed the demonstration
    // dataset's company id to a live Edge Function.
    hoisted.companyId = 'co-real-42';
    const user = userEvent.setup();
    renderPage(<BillingPage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Manage payment method/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Manage payment method/ }));

    await waitFor(() => expect(hoisted.portalCalls).toHaveLength(1));
    expect(hoisted.portalCalls[0]).toMatchObject({
      name: 'create-billing-portal-session', companyId: 'co-real-42',
    });
  });

  it('says there is no paid subscription rather than inventing one', async () => {
    hoisted.subscription = null;
    hoisted.plan = plan({ planId: 'free', planName: 'Free', onTheFreePlan: true, tagline: null });
    renderPage(<BillingPage />);
    await waitFor(() => expect(screen.getByText('No paid subscription')).toBeInTheDocument());
    expect(screen.getByText(/on the free plan, which needs no subscription/)).toBeInTheDocument();
    /*
     * And nothing pretends to be a price or a status. Asserted on the tile
     * rather than on the page: past invoices are still listed below, and they
     * are real — a company that stopped paying still has a billing history.
     */
    const cost = screen.getByRole('button', { name: 'Show what has actually been charged' });
    expect(within(cost).getByText('—')).toBeInTheDocument();
    expect(within(cost).getByText('no priced subscription item')).toBeInTheDocument();
  });

  it('offers no cancel button when there is nothing live to cancel', async () => {
    hoisted.subscription = null;
    renderPage(<BillingPage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancel subscription' })).toBeDisabled());
  });

  it('says nothing has been invoiced rather than showing an empty table', async () => {
    hoisted.invoices = [];
    renderPage(<BillingPage />);
    await waitFor(() =>
      expect(screen.getByText('Nothing has been invoiced yet')).toBeInTheDocument());
  });

  it('shows an error as an error, never as sample figures', async () => {
    hoisted.planFails = 'JWT expired';
    renderPage(<BillingPage />);
    await waitFor(() => expect(screen.getByText('JWT expired')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    /*
     * Shown as a failure, not swapped for the sample dataset — which is what
     * this page did on every render before it read anything.
     */
    expect(screen.queryByText('Demonstration data')).not.toBeInTheDocument();
  });

  it('lets somebody read billing without letting them change it', async () => {
    hoisted.canManage = false;
    renderPage(<BillingPage />);
    await waitFor(() =>
      expect(screen.getByText('You can view billing but not change it')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Manage payment method/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel subscription' })).toBeDisabled();
    // Reading still works: the figures are there.
    expect(screen.getAllByText('Professional').length).toBeGreaterThan(0);
  });

  it('names an entitlement that did not come from Stripe', async () => {
    hoisted.plan = plan({ entitlementSource: 'enterprise_contract' });
    const user = userEvent.setup();
    renderPage(<BillingPage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'What is behind Subscription status' }))
        .toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'What is behind Subscription status' }));
    expect(screen.getByText(/comes from enterprise contract rather/)).toBeInTheDocument();
  });

  it('still says a redirect grants nothing', async () => {
    const user = userEvent.setup();
    renderPage(<BillingPage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'What is behind Subscription status' }))
        .toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'What is behind Subscription status' }));
    expect(screen.getByText(/Coming back from a checkout page does not activate anything/))
      .toBeInTheDocument();
  });

  it('shows the usage note under each bar, so a number is never bare', async () => {
    renderPage(<BillingPage />);
    await waitFor(() => expect(screen.getByText('9 / 12')).toBeInTheDocument());
    const usageCard = document.getElementById('usage-this-period')!;
    expect(within(usageCard).getByText(/plus invitations already sent/)).toBeInTheDocument();
    expect(within(usageCard).getByText(/not everything ever uploaded/)).toBeInTheDocument();
  });
});
