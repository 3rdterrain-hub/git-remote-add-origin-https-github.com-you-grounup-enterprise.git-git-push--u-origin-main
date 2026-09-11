/**
 * Estimating, on live data.
 *
 * This screen listed six invented bids and computed a win rate from a constant.
 * The tests below are mostly about what it must *not* do: report a number
 * nothing computed, present an unpriced estimate as being worth zero dollars,
 * or offer an action the database would refuse.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  rows: [] as unknown[],
  fail: null as string | null,
  permissions: ['estimates.read', 'estimates.write'] as string[],
  created: [] as Array<Record<string, unknown>>,
  sited: [] as Array<{ id: string; site: Record<string, unknown> }>,
  customers: [] as unknown[],
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/session', () => ({
  usePermissions: () => ({ can: (p: string) => hoisted.permissions.includes(p), loading: false }),
}));

vi.mock('@/lib/data/templates', () => ({
  loadTemplates: async () => [],
  loadTemplateLines: () => async () => [],
}));

vi.mock('@/lib/data/estimates', async () => {
  const actual = await vi.importActual<typeof import('./../../lib/data/estimates')>(
    '@/lib/data/estimates');
  return {
    ...actual,
    loadEstimates: async () => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      return hoisted.rows;
    },
    loadCustomers: async () => hoisted.customers,
    loadMyCompanyId: async () => 'co-1',
    createEstimate: async (_c: unknown, input: Record<string, unknown>) => {
      hoisted.created.push(input);
      return 'e-new';
    },
    setEstimateSite: async (_c: unknown, id: string, site: Record<string, unknown>) => {
      hoisted.sited.push({ id, site });
    },
  };
});

const { EstimatesPage } = await import('./estimates');

const estimate = (over: Record<string, unknown> = {}) => ({
  id: 'e-1', number: 'E-2026-0001', name: 'Quarry haul road', status: 'issued',
  customerName: 'Maumee Development', customerId: 'c-1', bidDueAt: null,
  expiresAt: null, expired: false,
  createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-09-01T10:00:00Z',
  currentVersionId: 'v-1', bidPrice: 250_000, directCost: 190_000,
  blockedFromIssue: false, confidence: 91.5, versionNumber: 1,
  pricedAt: '2026-09-01T09:00:00Z', ...over,
});

describe('the estimating screen', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.fail = null;
    hoisted.permissions = ['estimates.read', 'estimates.write'];
    hoisted.rows = [estimate()];
    hoisted.created = []; hoisted.sited = []; hoisted.customers = [];
  });

  it('lists the caller\'s own estimates', async () => {
    renderPage(<EstimatesPage />);
    await waitFor(() => expect(screen.getByText('E-2026-0001')).toBeInTheDocument());
    expect(screen.getByText('Quarry haul road')).toBeInTheDocument();
    expect(screen.getByText('Maumee Development')).toBeInTheDocument();
    expect(screen.getAllByText('$250,000.00').length).toBeGreaterThan(0);
  });

  it('says an unpriced estimate is unpriced rather than worth nothing', async () => {
    // Zero dollars and "nobody has run the engine yet" are different facts, and
    // showing the first for the second is how a bid goes out at the wrong number.
    hoisted.rows = [estimate({ bidPrice: 0, pricedAt: null, confidence: null, status: 'draft' })];
    renderPage(<EstimatesPage />);
    await waitFor(() => expect(screen.getByText('not priced')).toBeInTheDocument());
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('counts the win rate instead of asserting one', async () => {
    hoisted.rows = [
      estimate({ id: 'a', number: 'E-1', status: 'awarded', bidPrice: 300_000 }),
      estimate({ id: 'b', number: 'E-2', status: 'lost', bidPrice: 100_000 }),
      // Still out with the customer: not won, not lost, not counted either way.
      estimate({ id: 'c', number: 'E-3', status: 'issued', bidPrice: 900_000 }),
    ];
    renderPage(<EstimatesPage />);
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument());
    expect(screen.getByText(/across 2 decided bids/)).toBeInTheDocument();
  });

  it('reports no win rate at all when nothing has been decided', async () => {
    hoisted.rows = [estimate({ status: 'draft', pricedAt: null, bidPrice: 0 })];
    renderPage(<EstimatesPage />);
    await waitFor(() => expect(screen.getByText('nothing awarded or lost yet')).toBeInTheDocument());
  });

  it('flags an estimate the engine has not cleared to issue', async () => {
    hoisted.rows = [estimate({ blockedFromIssue: true })];
    renderPage(<EstimatesPage />);
    await waitFor(() =>
      expect(screen.getByLabelText('Not cleared to issue')).toBeInTheDocument());
    expect(screen.getByText('the engine has not cleared these to bid')).toBeInTheDocument();
  });

  it('shows when an estimate was made, and when its price stops being good', async () => {
    // Midday rather than midnight, so the assertion does not depend on which
    // side of UTC the machine running it happens to sit.
    hoisted.rows = [estimate({ expiresAt: '2026-10-01T12:00:00Z' })];
    renderPage(<EstimatesPage />);
    await waitFor(() => expect(screen.getByText('Oct 1, 2026')).toBeInTheDocument());
    expect(screen.getByText('Aug 25, 2026')).toBeInTheDocument();
  });

  it('says plainly when an estimate does not expire', async () => {
    // Absent an expiry the honest answer is "it does not expire", not a blank
    // that reads as missing data.
    renderPage(<EstimatesPage />);
    await waitFor(() => expect(screen.getByText('does not expire')).toBeInTheDocument());
  });

  it('marks an estimate whose price has stopped being good', async () => {
    hoisted.rows = [estimate({ status: 'draft', expiresAt: '2026-08-01T12:00:00Z', expired: true })];
    renderPage(<EstimatesPage />);
    await waitFor(() => expect(screen.getByText(/Aug 1, 2026 · expired/)).toBeInTheDocument());
    expect(screen.getByText('prices that have stopped being good')).toBeInTheDocument();
  });

  it('counts an expiry coming up inside a week', async () => {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    hoisted.rows = [estimate({ status: 'issued', expiresAt: soon })];
    renderPage(<EstimatesPage />);
    await waitFor(() => expect(screen.getByText('1 more within a week')).toBeInTheDocument());
  });

  it('does not offer to create one without the permission to', async () => {
    hoisted.permissions = ['estimates.read'];
    renderPage(<EstimatesPage />);
    await waitFor(() => expect(screen.getByText('E-2026-0001')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /new estimate/i })).toBeDisabled();
  });

  it('shows an error as an error, never as sample numbers', async () => {
    hoisted.fail = 'permission denied for relation estimates';
    renderPage(<EstimatesPage />);
    await waitFor(() =>
      expect(screen.getByText('permission denied for relation estimates')).toBeInTheDocument());
    // The fixture's estimates must not appear behind the error.
    expect(screen.queryByText('EST-2026-0179')).not.toBeInTheDocument();
  });

  it('says plainly when there is no workspace behind it', async () => {
    hoisted.configured = false;
    renderPage(<EstimatesPage />);
    await waitFor(() => expect(screen.getByText(/demonstration/i)).toBeInTheDocument());
  });

  // -------------------------------------------------------------------------
  describe('the boxes across the top', () => {
    /*
     * Every tile in this application was a `div`. "Blocked from issue: 2" told
     * an estimator there were two and gave them no way to see which — the
     * answer was on the same page, behind a control that did not exist.
     */
    beforeEach(() => {
      hoisted.rows = [
        estimate({ id: 'e-1', number: 'E-2026-0001', status: 'issued' }),
        estimate({ id: 'e-2', number: 'E-2026-0002', status: 'draft',
                   blockedFromIssue: true, pricedAt: null, bidPrice: 0 }),
        estimate({ id: 'e-3', number: 'E-2026-0003', status: 'awarded' }),
        estimate({ id: 'e-4', number: 'E-2026-0004', status: 'lost', bidPrice: 100_000 }),
      ];
    });

    it('shows the estimates a tile counts when the tile is clicked', async () => {
      renderPage(<EstimatesPage />);
      await waitFor(() => expect(screen.getByText('E-2026-0001')).toBeInTheDocument());

      await userEvent.click(screen.getByRole('button',
        { name: /show the estimates the engine has blocked/i }));
      await waitFor(() => expect(screen.queryByText('E-2026-0001')).not.toBeInTheDocument());
      expect(screen.getByText('E-2026-0002')).toBeInTheDocument();
    });

    it('says which tile the list is showing', async () => {
      renderPage(<EstimatesPage />);
      const tile = await screen.findByRole('button',
        { name: /show the estimates the engine has blocked/i });
      expect(tile).toHaveAttribute('aria-pressed', 'false');
      await userEvent.click(tile);
      await waitFor(() => expect(tile).toHaveAttribute('aria-pressed', 'true'));
    });

    it('shows the bids that were decided, from the win-rate tile', async () => {
      renderPage(<EstimatesPage />);
      await waitFor(() => expect(screen.getByText('E-2026-0001')).toBeInTheDocument());
      await userEvent.click(screen.getByRole('button',
        { name: /show the bids that were won or lost/i }));
      await waitFor(() => expect(screen.queryByText('E-2026-0002')).not.toBeInTheDocument());
      expect(screen.getByText('E-2026-0003')).toBeInTheDocument();
      expect(screen.getByText('E-2026-0004')).toBeInTheDocument();
    });

    it('gets back to everything from the first tile', async () => {
      renderPage(<EstimatesPage />);
      await waitFor(() => expect(screen.getByText('E-2026-0001')).toBeInTheDocument());
      await userEvent.click(screen.getByRole('button',
        { name: /show the estimates the engine has blocked/i }));
      await waitFor(() => expect(screen.queryByText('E-2026-0001')).not.toBeInTheDocument());
      await userEvent.click(screen.getByRole('button', { name: /show every estimate/i }));
      await waitFor(() => expect(screen.getByText('E-2026-0001')).toBeInTheDocument());
    });

    it('responds even when it counts nothing, and says the list is empty', async () => {
      /*
       * These were left inert, which was defensible and wrong in practice: an
       * inert tile looks exactly like a working one, so a screen where two of
       * five respond reads as a screen where none of them do. Filtering to an
       * empty table is a better answer than a control that ignores the press.
       */
      hoisted.rows = [estimate()];
      renderPage(<EstimatesPage />);
      await waitFor(() => expect(screen.getByText('E-2026-0001')).toBeInTheDocument());

      await userEvent.click(screen.getByRole('button',
        { name: /show the estimates the engine has blocked/i }));
      expect(await screen.findByText('No estimates match those filters')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument();
    });
  });


  // --------------------------------------------------------- where the work is
  describe('the site on a new estimate', () => {
    /*
     * `estimates.site_address`, `site_city` and `site_state` have existed since
     * migration 0006 and were asked for by nothing until 0148.
     * `award_estimate_version` copies them onto the project, so an estimate
     * that never carried a site produced a project that did not know where it
     * was — and a weather panel reporting from the yard with no way to change
     * it. Found by awarding a real estimate and reading the project.
     */
    const openDialog = async () => {
      const user = userEvent.setup();
      renderPage(<EstimatesPage />);
      await waitFor(() => expect(screen.getByText('E-2026-0001')).toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: /New estimate/ }));
      return user;
    };

    it('asks for it, and says what it is for', async () => {
      await openDialog();
      expect(await screen.findByLabelText('Site address')).toBeInTheDocument();
      expect(screen.getByLabelText('City')).toBeInTheDocument();
      expect(screen.getByLabelText('State')).toBeInTheDocument();
      expect(screen.getByText(/copies the site onto the project/)).toBeInTheDocument();
    });

    it('carries all three to the database', async () => {
      const user = await openDialog();
      await user.type(await screen.findByLabelText('Project name'), 'Sandusky transfer station');
      await user.type(screen.getByLabelText('Site address'), '1400 Venice Rd');
      await user.type(screen.getByLabelText('City'), 'Sandusky');
      await user.type(screen.getByLabelText('State'), 'OH');
      await user.click(screen.getByRole('button', { name: /Create estimate/ }));

      await waitFor(() => expect(hoisted.created).toHaveLength(1));
      expect(hoisted.created[0]).toMatchObject({
        siteAddress: '1400 Venice Rd', siteCity: 'Sandusky', siteState: 'OH',
      });
    });

    it('sends null rather than empty strings when nobody says', async () => {
      // An empty string is a site somebody recorded as blank; null is one
      // nobody has been asked for yet, and the two mean different things.
      const user = await openDialog();
      await user.type(await screen.findByLabelText('Project name'), 'No site yet');
      await user.click(screen.getByRole('button', { name: /Create estimate/ }));

      await waitFor(() => expect(hoisted.created).toHaveLength(1));
      expect(hoisted.created[0]).toMatchObject({
        siteAddress: null, siteCity: null, siteState: null,
      });
    });

    it('requires the name and nothing else', async () => {
      /*
       * Asked directly, so it is pinned. Nine fields and one of them is
       * mandatory: the button is disabled under two characters of name and
       * `create_estimate` refuses the same thing, so a browser cannot get round
       * it. Everything else is a thing you may not know yet when the invitation
       * arrives — the number generates, the expiry is optional by design, and
       * the site can be set once somebody has driven out to look at it.
       */
      const user = await openDialog();
      const create = screen.getByRole('button', { name: /Create estimate/ });
      expect(create).toBeDisabled();

      await user.type(await screen.findByLabelText('Project name'), 'A');
      expect(create).toBeDisabled();          // one character is not a name

      await user.type(screen.getByLabelText('Project name'), 'cme quarry');
      expect(create).toBeEnabled();           // and nothing else was filled in

      await user.click(create);
      await waitFor(() => expect(hoisted.created).toHaveLength(1));
      expect(hoisted.created[0]).toMatchObject({
        name: 'Acme quarry', customerId: null, number: null,
        bidDueAt: null, expiresAt: null, description: null,
        siteAddress: null, siteCity: null, siteState: null,
      });
    });

    it('holds the state field to two characters', async () => {
      await openDialog();
      expect(await screen.findByLabelText('State')).toHaveAttribute('maxlength', '2');
    });
  });
});