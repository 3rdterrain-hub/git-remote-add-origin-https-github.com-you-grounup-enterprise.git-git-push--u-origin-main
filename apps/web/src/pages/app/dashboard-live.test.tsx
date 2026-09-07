/**
 * The first screen, on real data.
 *
 * The fixture it replaces carried three figures nothing computed — a pipeline,
 * a backlog, and a win rate of 62% that was a constant. So most of what is
 * tested here is restraint: that the screen counts what it can count, says so
 * when it cannot, and never fills a space with a number it invented.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  bids: [] as unknown[],
  proposals: [] as unknown[],
  who: { firstName: 'Tyree', fullName: 'Tyree Myers', email: 't@r.test',
         companyName: 'Ridgeline Excavating' } as {
           firstName: string | null; fullName: string | null;
           email: string | null; companyName: string | null },
  weather: [] as unknown[],
  weatherFails: null as string | null,
  money: null as unknown,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
  callFunction: async () => ({ refreshed: true, efficiency: 0.71 }),
}));

/*
 * The dashboard is arranged per person now, so a test has to say which
 * arrangement it is looking at. The shipped one is the interesting case.
 */
vi.mock('@/lib/data/preferences', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/preferences')>(
    '@/lib/data/preferences');
  return {
    ...actual,
    loadDashboardPreference: async () => ({ order: [], hidden: [], layout: 'tabs' }),
    saveDashboardPreference: async () => {},
  };
});

vi.mock('@/lib/data/session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/session')>(
    '@/lib/data/session');
  return {
    ...actual,
    usePermissions: () => ({ can: () => true, loading: false }),
    loadWhoAmI: async () => hoisted.who,
  };
});

vi.mock('@/lib/data/project-view', async () => {
  const actual = await vi.importActual<typeof import('./../../lib/data/project-view')>(
    '@/lib/data/project-view');
  return { ...actual, loadRateVariance: async () => [] };
});

vi.mock('@/lib/data/estimates', async () => {
  const actual = await vi.importActual<typeof import('./../../lib/data/estimates')>(
    '@/lib/data/estimates');
  return { ...actual, loadMyCompanyId: async () => 'company-1' };
});

vi.mock('@/lib/data/dashboard', async () => {
  const actual = await vi.importActual<typeof import('./../../lib/data/dashboard')>(
    '@/lib/data/dashboard');
  return {
    ...actual,
    loadDueBids: async () => hoisted.bids,
    loadAwaitingAnswer: async () => hoisted.proposals,
    loadWeather: async () => {
      if (hoisted.weatherFails) throw new Error(hoisted.weatherFails);
      return hoisted.weather;
    },
    loadMoney: async () => hoisted.money,
  };
});

const { DashboardLivePage } = await import('./dashboard-live');

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

const bid = (over: Record<string, unknown> = {}) => ({
  id: 'e-1', versionId: 'v-1', number: 'E-2026-0001', name: 'Quarry haul road',
  customerName: 'Maumee Development', dueAt: inDays(3), dueKind: 'bid',
  status: 'draft', bidPrice: 250_000, priced: true, blockedFromIssue: false,
  daysAway: 3, ...over,
});

const money = {
  billedToDate: 900_000, actualCost: 600_000, committedCost: 100_000,
  contractValue: 1_500_000, activeProjects: 2,
};

describe('the dashboard', () => {
  beforeEach(() => {
    hoisted.configured = true;
    hoisted.bids = [bid()];
    hoisted.proposals = [];
    hoisted.weather = [];
    hoisted.weatherFails = null;
    hoisted.money = money;
  });

  it('counts what is due from the caller\'s own estimates', async () => {
    renderPage(<DashboardLivePage />);
    // In the due list and again on the week strip, which is the point of both.
    await waitFor(() => expect(screen.getAllByText('E-2026-0001').length).toBe(2));
    expect(screen.getByText('in 3d')).toBeInTheDocument();
    expect(screen.getAllByText(/bid due/).length).toBeGreaterThan(0);
  });

  it('distinguishes a bid deadline from a price going stale', async () => {
    // The dates look the same and what to do about them does not: one means
    // finish it, the other means reprice it.
    hoisted.bids = [bid({ id: 'x', number: 'E-2', dueKind: 'expiry', daysAway: 5 })];
    renderPage(<DashboardLivePage />);
    await waitFor(() => expect(screen.getByText(/price expires/)).toBeInTheDocument());
  });

  it('says which bids are already past the date, before anything else', async () => {
    hoisted.bids = [bid({ daysAway: -2, dueAt: inDays(-2) })];
    renderPage(<DashboardLivePage />);
    await waitFor(() => expect(screen.getByText(/bid is past the date/)).toBeInTheDocument());
    expect(screen.getByText('2d late')).toBeInTheDocument();
  });

  it('does not price a bid the engine has not cleared', async () => {
    // Showing the money would read as a number ready to send.
    hoisted.bids = [bid({ blockedFromIssue: true })];
    renderPage(<DashboardLivePage />);
    await waitFor(() => expect(screen.getByText('not cleared to issue')).toBeInTheDocument());
    expect(screen.queryByText('$250,000.00')).not.toBeInTheDocument();
  });

  it('says an unpriced estimate is unpriced rather than worth nothing', async () => {
    hoisted.bids = [bid({ priced: false, bidPrice: 0 })];
    renderPage(<DashboardLivePage />);
    await waitFor(() => expect(screen.getByText('not priced yet')).toBeInTheDocument());
  });

  it('totals what is sitting with customers, and flags what has lapsed', async () => {
    hoisted.proposals = [
      { id: 'p-1', number: 'P-1', title: 'Haul road', customerName: 'Maumee',
        totalPrice: 250_000, issuedAt: inDays(-40), daysOut: 40, lapsed: true },
      { id: 'p-2', number: 'P-2', title: 'Sitework', customerName: 'Kesler',
        totalPrice: 100_000, issuedAt: inDays(-5), daysOut: 5, lapsed: false },
    ];
    renderPage(<DashboardLivePage />);
    /* The figure across the top is always there, whichever tab is open. */
    await waitFor(() => expect(screen.getByText('1 past its validity')).toBeInTheDocument());
    expect(screen.getByText('$350K')).toBeInTheDocument();

    /*
     * The panel itself lives under Winning work now that the dashboard is
     * grouped, and Radix renders only the open tab.
     */
    await userEvent.click(screen.getByRole('tab', { name: 'Winning work' }));
    expect(await screen.findByText('out 5 days')).toBeInTheDocument();
  });

  it('reports the calendar efficiency the weather actually implies', async () => {
    /*
     * The figure `calendar_efficiency` has always taken from a guess. Five
     * workable days out of seven is 71%, and it is countable.
     */
    const today = new Date().toISOString().slice(0, 10);
    hoisted.weather = Array.from({ length: 7 }, (_, i) => ({
      day: i === 0 ? today
        : new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10),
      highF: 62, lowF: 44, precipInches: i < 2 ? 0.4 : 0, precipChance: 80,
      summary: i < 2 ? 'Rain' : 'Partly cloudy',
      workable: i >= 2, lostReason: i < 2 ? 'Rain' : null,
    }));
    renderPage(<DashboardLivePage />);
    await waitFor(() =>
      expect(screen.getByText(/5 of 7 days workable — 71% calendar efficiency/))
        .toBeInTheDocument());
    expect(screen.getAllByText(/· Rain/).length).toBe(2);
  });

  it('says why the forecast is missing rather than showing an empty card', async () => {
    // An empty weather card reads as "nothing coming", which is the one thing
    // a failed read does not mean.
    hoisted.weatherFails = "Could not find the table 'public.my_weather' in the schema cache";
    renderPage(<DashboardLivePage />);
    await waitFor(() =>
      expect(screen.getByText(/Could not find the table 'public.my_weather'/))
        .toBeInTheDocument());
  });

  it('offers to fetch a forecast that has never been fetched', async () => {
    renderPage(<DashboardLivePage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Fetch it/ })).toBeInTheDocument());
    expect(screen.getByText(/feeds the calendar efficiency an estimate is priced with/))
      .toBeInTheDocument();
  });

  it('shows money billed against money spent, from the governed view', async () => {
    renderPage(<DashboardLivePage />);
    // Billed less spent, from `reporting_project_financials` — the same view
    // the reports and the public API read, so the two cannot disagree.
    await waitFor(() => expect(screen.getByText('$300K')).toBeInTheDocument());
    expect(screen.getByText('across 2 active projects')).toBeInTheDocument();
  });

  it('carries no win rate and no percent complete', async () => {
    /*
     * Both were on the fixture and neither had anything behind it. The platform
     * has no progress measurement to derive a completion percentage from, and
     * the win rate was a constant.
     */
    renderPage(<DashboardLivePage />);
    await waitFor(() => expect(screen.getAllByText('E-2026-0001').length).toBeGreaterThan(0));
    expect(screen.queryByText(/62%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/complete/i)).not.toBeInTheDocument();
  });

  it('puts a bid on the day it is due, beside that day\'s weather', async () => {
    /*
     * The pairing is the reason the strip exists. A bid due Thursday is a
     * different problem when Thursday is the day it rains.
     */
    const third = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    hoisted.weather = [{
      day: third, highF: 48, lowF: 38, precipInches: 0.6, precipChance: 90,
      summary: 'Rain', workable: false, lostReason: 'Rain',
    }];
    renderPage(<DashboardLivePage />);
    await waitFor(() => expect(screen.getAllByText('E-2026-0001').length).toBe(2));
    /*
     * The bid and the reason that day is lost sit in the same cell. The merge
     * itself is asserted against `buildWeek` in week-ahead.test.tsx; this
     * checks the strip actually renders both halves.
     */
    const cell = screen.getAllByText('E-2026-0001')[1]!.closest('li[class*="min-h-28"]');
    expect(cell?.textContent).toContain('Rain');
  });

  it('says plainly when there is nothing due yet', async () => {
    hoisted.bids = [];
    renderPage(<DashboardLivePage />);
    await waitFor(() => expect(screen.getByText('Nothing has a date on it')).toBeInTheDocument());
  });

  // -------------------------------------------------------------------------
  describe('what a person meets when they sign in', () => {
    it('is called what the navigation calls it', async () => {
      /*
       * The heading is the name of the screen, not a salutation. Somebody who
       * clicks "Dashboard" has to land somewhere that says "Dashboard" — the
       * greeting reads underneath it, where it costs nobody an inference.
       */
      renderPage(<DashboardLivePage />);
      expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' }))
        .toBeInTheDocument();
    });

    it('greets them by name, with the company they are in', async () => {
      renderPage(<DashboardLivePage />);
      expect(await screen.findByText(/Good (morning|afternoon|evening), Tyree/))
        .toBeInTheDocument();
      expect(screen.getByText(/Ridgeline Excavating/)).toBeInTheDocument();
    });

    it('greets without a name rather than greeting a null', async () => {
      /*
       * A person who signed up with no profile name still deserves a sentence
       * that reads properly. "Good morning, null" is the failure this guards.
       */
      hoisted.who = { firstName: null, fullName: null, email: null, companyName: null };
      renderPage(<DashboardLivePage />);
      const line = await screen.findByText(/^Good (morning|afternoon|evening)$/);
      expect(line).toBeInTheDocument();
      expect(line.textContent).not.toMatch(/null|undefined|,\s*$/);
    });

    it("says today's weather in the greeting, not behind a tab", async () => {
      const today = new Date().toISOString().slice(0, 10);
      hoisted.weather = [{
        day: today, highF: 62, lowF: 44, precipInches: 0, precipChance: 10,
        summary: 'Partly cloudy', workable: true, lostReason: null,
      }];
      renderPage(<DashboardLivePage />);
      expect(await screen.findByText(/Partly cloudy, 62°\/44° — workable/)).toBeInTheDocument();
    });

    it('says why a day is not workable rather than only that it is not', async () => {
      const today = new Date().toISOString().slice(0, 10);
      hoisted.weather = [{
        day: today, highF: 41, lowF: 33, precipInches: 0.8, precipChance: 90,
        summary: 'Rain', workable: false, lostReason: 'Rain over half an inch',
      }];
      renderPage(<DashboardLivePage />);
      expect(await screen.findByText(/Rain, 41°\/33° — Rain over half an inch/))
        .toBeInTheDocument();
    });

    it('counts the workable days in the week beside it', async () => {
      const day = (i: number) =>
        new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10);
      hoisted.weather = Array.from({ length: 7 }, (_, i) => ({
        day: i === 0 ? new Date().toISOString().slice(0, 10) : day(i),
        highF: 60, lowF: 40, precipInches: i < 2 ? 0.5 : 0, precipChance: 50,
        summary: i < 2 ? 'Rain' : 'Clear', workable: i >= 2,
        lostReason: i < 2 ? 'Rain' : null,
      }));
      renderPage(<DashboardLivePage />);
      expect(await screen.findByText(/5 of 7 days workable this week/)).toBeInTheDocument();
    });

    it('says nothing about weather when there is no forecast', async () => {
      hoisted.weather = [];
      renderPage(<DashboardLivePage />);
      await screen.findByText(/Good (morning|afternoon|evening)/);
      expect(screen.queryByText(/days workable this week/)).not.toBeInTheDocument();
    });
  });

});
