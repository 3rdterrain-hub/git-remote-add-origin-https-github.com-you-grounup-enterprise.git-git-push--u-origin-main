/**
 * The operator console.
 *
 * The dangerous version of this screen takes ten minutes to build and shows an
 * operator everything. What is tested most carefully here is therefore what the
 * console does *not* do — and the corresponding database tests assert the same
 * boundary from the other side, because a screen that merely omits a control is
 * not a boundary.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  admin: true,
  companies: [] as unknown[],
  webhooks: [] as unknown[],
  stuck: [] as unknown[],
  overrides: [] as unknown[],
  replays: [] as unknown[],
  replayError: null as string | null,
  set: [] as unknown[],
  cleared: [] as unknown[],
  setError: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));
vi.mock('@/lib/data/admin', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/admin')>('@/lib/data/admin');
  return {
    ...actual,
    loadAdminCompanies: async () => hoisted.companies,
    loadWebhookHealth: async () => hoisted.webhooks,
    loadStuckEvents: async () => hoisted.stuck,
    loadOverrides: async () => hoisted.overrides,
    replayStripeEvent: async (eventId: string, reason: string) => {
      if (hoisted.replayError) throw new Error(hoisted.replayError);
      hoisted.replays.push([eventId, reason]);
    },
    isPlatformAdmin: async () => hoisted.admin,
    setFeatureOverride: async (_c: unknown, input: unknown) => {
      if (hoisted.setError) throw new Error(hoisted.setError);
      hoisted.set.push(input);
    },
    clearFeatureOverride: async (_c: unknown, id: string, f: string) => {
      hoisted.cleared.push([id, f]);
    },
  };
});

const { AdminCompanies } = await import('./admin');

const company = {
  companyId: 'c-1', name: 'Ridgeline Construction', slug: 'ridgeline',
  createdAt: '2026-01-15T00:00:00Z', planId: 'business',
  entitlementActive: true, entitlementSource: 'stripe_webhook',
  entitlementValidUntil: null, subscriptionStatus: 'active',
  currentPeriodEnd: '2026-10-01T00:00:00Z', cancelAtPeriodEnd: false,
  memberCount: 12, ownerEmail: 'dana@ridgeline.test', overrideCount: 0,
  estimateCount: 47, projectCount: 9,
};

const stuckEvent = {
  eventId: 'evt_1', type: 'invoice.paid', receivedAt: '2026-09-01T10:00:00Z',
  processingState: 'failed', processingError: 'timeout', attempts: 3,
  livemode: true, companyId: 'c-1', companyName: 'Ridgeline Construction',
  stripeCustomerId: 'cus_x', lastAttempt: null, attemptsByHand: 0, lastError: null,
};

describe('the operator console', () => {
  beforeEach(() => {
    hoisted.configured = true;
    hoisted.admin = true;
    hoisted.companies = [company];
    hoisted.webhooks = [];
    hoisted.stuck = [];
    hoisted.overrides = [];
    hoisted.set = [];
    hoisted.cleared = [];
    hoisted.setError = null;
    hoisted.replays = [];
    hoisted.replayError = null;
  });

  it('lists tenants with what the operator needs to run the business', async () => {
    renderPage(<AdminCompanies />);
    await waitFor(() => expect(screen.getByText('Ridgeline Construction')).toBeInTheDocument());
    expect(screen.getByText('dana@ridgeline.test')).toBeInTheDocument();
    expect(screen.getByText('business')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('shows counts of a customer’s work and never its contents', async () => {
    /*
     * The line this whole feature is drawn on, asserted from the screen's side.
     * Knowing Ridgeline has 47 estimates is the operator's business. Knowing
     * what Ridgeline bid is not, and there is nowhere here to find out.
     */
    renderPage(<AdminCompanies />);
    await waitFor(() => expect(screen.getByText('47')).toBeInTheDocument());
    expect(screen.getByText('9')).toBeInTheDocument();
    for (const forbidden of [/bid price/i, /contract value/i, /estimate name/i]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument();
    }
  });

  it('tells somebody who is not an operator that nothing would load anyway', async () => {
    /*
     * Honest rather than coy. The views return nothing to them and the controls
     * refuse them; the message says so instead of implying the screen is the
     * thing keeping them out.
     */
    hoisted.admin = false;
    renderPage(<AdminCompanies />);
    await waitFor(() =>
      expect(screen.getByText('This console is for platform operators')).toBeInTheDocument());
    expect(screen.getByText(/return nothing to a caller who is not an operator/)).toBeInTheDocument();
    expect(screen.queryByText('Ridgeline Construction')).not.toBeInTheDocument();
  });

  it('raises the alarm on a webhook that never finished', async () => {
    // A subscription that silently failed to activate is a customer who paid
    // and cannot use what they paid for.
    hoisted.stuck = [stuckEvent];
    renderPage(<AdminCompanies />);
    await waitFor(() =>
      expect(screen.getByText(/1 Stripe event\(s\) arrived and never finished/)).toBeInTheDocument());
    expect(screen.getByText(/cannot use what they paid for/)).toBeInTheDocument();
  });

  it('will not replay an event without a reason', async () => {
    /*
     * A replay writes a customer's subscription and entitlement. The reason is
     * required by the database too — this only stops somebody reaching a
     * refusal they could have been spared.
     */
    hoisted.stuck = [stuckEvent];
    renderPage(<AdminCompanies />);
    await userEvent.click(await screen.findByRole('tab', { name: /stripe events/i }));
    const button = await screen.findByRole('button', { name: /apply it again/i });
    expect(button).toBeDisabled();

    await userEvent.type(
      screen.getByLabelText(/why you are applying it/i),
      'Customer paid on the 3rd and has no access');
    expect(button).toBeEnabled();
  });

  it('sends only the event id and the reason', async () => {
    // Never a payload. What gets applied is read from the database inside the
    // function, so this screen cannot influence what reaches a customer.
    hoisted.stuck = [stuckEvent];
    renderPage(<AdminCompanies />);
    await userEvent.click(await screen.findByRole('tab', { name: /stripe events/i }));
    await userEvent.type(
      await screen.findByLabelText(/why you are applying it/i),
      'Customer paid and has no access');
    await userEvent.click(screen.getByRole('button', { name: /apply it again/i }));

    await waitFor(() => expect(hoisted.replays).toHaveLength(1));
    expect(hoisted.replays[0]).toEqual(['evt_1', 'Customer paid and has no access']);
  });

  it('says so when a replay fails rather than looking successful', async () => {
    hoisted.stuck = [stuckEvent];
    hoisted.replayError = 'Stripe returned 404 for that subscription';
    renderPage(<AdminCompanies />);
    await userEvent.click(await screen.findByRole('tab', { name: /stripe events/i }));
    await userEvent.type(
      await screen.findByLabelText(/why you are applying it/i),
      'Another attempt at this one');
    await userEvent.click(screen.getByRole('button', { name: /apply it again/i }));

    await waitFor(() =>
      expect(screen.getByText(/Stripe returned 404/)).toBeInTheDocument());
  });

  it('shows what has already been tried by hand', async () => {
    hoisted.stuck = [{
      ...stuckEvent, attemptsByHand: 2,
      lastAttempt: '2026-09-02T09:00:00Z',
      lastError: 'Stripe returned 404 for that subscription',
    }];
    renderPage(<AdminCompanies />);
    await userEvent.click(await screen.findByRole('tab', { name: /stripe events/i }));
    expect(await screen.findByText(/Tried 2 times by hand/)).toBeInTheDocument();
  });

  it('filters the tenant list', async () => {
    hoisted.companies = [company, { ...company, companyId: 'c-2', name: 'Northshore', slug: 'northshore' }];
    renderPage(<AdminCompanies />);
    await waitFor(() => expect(screen.getByText('Northshore')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Filter companies'), 'north');
    await waitFor(() =>
      expect(screen.queryByText('Ridgeline Construction')).not.toBeInTheDocument());
    expect(screen.getByText('Northshore')).toBeInTheDocument();
  });

  it('applies a feature override with its reason', async () => {
    renderPage(<AdminCompanies />);
    await waitFor(() => expect(screen.getByText('Ridgeline Construction')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /^Features/ }));
    await userEvent.type(screen.getByLabelText('Feature key'), 'ai_plan_review');
    await userEvent.type(screen.getByLabelText('Why'), 'Evaluating for an upgrade');
    await userEvent.click(screen.getByRole('button', { name: /Apply override/ }));
    await waitFor(() => expect(hoisted.set).toHaveLength(1));
    expect(hoisted.set[0]).toMatchObject({
      companyId: 'c-1', feature: 'ai_plan_review', effect: 'grant',
      reason: 'Evaluating for an upgrade',
    });
  });

  it('will not apply an override without a reason worth the name', async () => {
    // The database refuses one under five characters regardless. This is the
    // form agreeing with the rule rather than being the rule.
    renderPage(<AdminCompanies />);
    await waitFor(() => expect(screen.getByText('Ridgeline Construction')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /^Features/ }));
    await userEvent.type(screen.getByLabelText('Feature key'), 'ai_plan_review');
    await userEvent.type(screen.getByLabelText('Why'), 'meh');
    expect(screen.getByRole('button', { name: /Apply override/ })).toBeDisabled();
  });

  it('shows a refused override rather than pretending it applied', async () => {
    hoisted.setError = 'Only a platform operator may change a company\'s features';
    renderPage(<AdminCompanies />);
    await waitFor(() => expect(screen.getByText('Ridgeline Construction')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /^Features/ }));
    await userEvent.type(screen.getByLabelText('Feature key'), 'x');
    await userEvent.type(screen.getByLabelText('Why'), 'Because I said so');
    await userEvent.click(screen.getByRole('button', { name: /Apply override/ }));
    await waitFor(() =>
      expect(screen.getByText(/Only a platform operator/)).toBeInTheDocument());
  });

  it('flags an override that will never expire', async () => {
    // One with no end is a decision somebody has to remember.
    hoisted.overrides = [{
      id: 'o-1', companyId: 'c-1', feature: 'white_label', effect: 'grant',
      reason: 'Enterprise contract', grantedAt: '2026-02-01T00:00:00Z', validUntil: null,
    }];
    renderPage(<AdminCompanies />);
    await waitFor(() => expect(screen.getByText('Ridgeline Construction')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('tab', { name: /Overrides/ }));
    await waitFor(() => expect(screen.getByText('no end date')).toBeInTheDocument());
  });

  it('withdraws an override', async () => {
    hoisted.overrides = [{
      id: 'o-1', companyId: 'c-1', feature: 'white_label', effect: 'grant',
      reason: 'Enterprise contract', grantedAt: '2026-02-01T00:00:00Z', validUntil: null,
    }];
    renderPage(<AdminCompanies />);
    await waitFor(() => expect(screen.getByText('Ridgeline Construction')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /^Features/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(hoisted.cleared).toEqual([['c-1', 'white_label']]));
  });

  it('says plainly that a demonstration build has no tenants to operate', async () => {
    hoisted.configured = false;
    renderPage(<AdminCompanies />);
    await waitFor(() =>
      expect(screen.getByText('The operator console needs a configured workspace')).toBeInTheDocument());
  });
});
