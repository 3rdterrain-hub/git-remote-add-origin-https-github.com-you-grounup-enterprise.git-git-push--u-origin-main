/**
 * The forecast at the site, and the sentence that says when it is not.
 *
 * Migration 0105 fetched the forecast from the company's coordinates — the
 * yard — and nothing in the platform could hold one for a job site, though
 * `projects` has carried the site's own coordinates since 0007. The thing worth
 * testing hardest is not the list of days: it is that a forecast taken sixty
 * miles away is labeled as such. A card that showed both the same way would
 * make the distinction unobservable, which is the failure being corrected.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hoisted = vi.hoisted(() => ({
  days: [] as unknown[],
  now: null as unknown,
  week: null as unknown,
  refreshed: [] as Array<{ company: string; project: string; force: boolean }>,
  source: 'site' as 'site' | 'yard_for_site' | 'yard',
  refreshFails: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
  callFunction: async () => ({ refreshed: true }),
}));

vi.mock('@/lib/data/project', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/project')>('@/lib/data/project');
  return {
    ...actual,
    loadSiteWeather: () => async () => hoisted.days,
    loadSiteWeatherNow: () => async () => hoisted.now,
    loadWorkableDays: () => async () => hoisted.week,
    refreshSiteWeather: async (company: string, project: string, force: boolean) => {
      if (hoisted.refreshFails) throw new Error(hoisted.refreshFails);
      hoisted.refreshed.push({ company, project, force });
      return { refreshed: true, source: hoisted.source, days: 7, workable: 5, efficiency: 0.7143 };
    },
  };
});

const { SiteWeather } = await import('./site-weather');

const day = (over: Record<string, unknown> = {}) => ({
  day: '2026-09-11', highF: 68, lowF: 51, precipInches: 0, precipChance: 10,
  snowInches: 0, windGustMph: 12, summary: 'Mostly clear',
  workable: true, lostReason: null, fetchedAt: '2026-09-10T12:00:00Z', ...over,
});

const show = (siteNamed = true, canRefresh = true) =>
  render(<SiteWeather companyId="co-1" projectId="p-1"
    siteNamed={siteNamed} canRefresh={canRefresh} />);

describe('the forecast at the site', () => {
  /** What `app.workable_days_at` answers for this project. */
  const week = (workable: number, total: number, source: 'site' | 'yard' = 'site') =>
    ({ total, workable, efficiency: total === 0 ? null : workable / total, source });

  beforeEach(() => {
    hoisted.days = []; hoisted.now = null; hoisted.week = null; hoisted.refreshed = [];
    hoisted.source = 'site'; hoisted.refreshFails = null;
  });

  it('takes the count from the database rather than counting the rows it holds', async () => {
    /*
     * `app.workable_days_at` is also what decides which forecast applies, so
     * counting rows here would answer a question nobody asked — and would drop
     * the site-or-yard distinction the whole card exists for.
     */
    hoisted.days = [day()];
    hoisted.week = week(5, 7);
    show();
    expect(await screen.findByText(/5 workable days of 7/)).toBeInTheDocument();
    expect(screen.getByText(/71% of the next seven/)).toBeInTheDocument();
  });

  it('counts the workable days and says which threshold stopped the others', async () => {
    hoisted.days = [
      day(),
      day({ day: '2026-09-12', precipInches: 0.85, summary: 'Rain', workable: false, lostReason: 'Rain' }),
      day({ day: '2026-09-13', windGustMph: 41, summary: 'Overcast', workable: false, lostReason: 'High wind' }),
    ];
    hoisted.week = week(1, 3);
    show();
    expect(await screen.findByText(/1 workable day of 3/)).toBeInTheDocument();
    // Twice: the day's own summary, and the badge saying that is what lost it.
    expect(screen.getAllByText('Rain')).toHaveLength(2);
    expect(screen.getByText('High wind')).toBeInTheDocument();
    // The gust is worth showing precisely because it is what lost the day.
    expect(screen.getByText('gusts 41 mph')).toBeInTheDocument();
  });

  it('keeps what it is doing right now apart from what the day will be', async () => {
    hoisted.days = [day()];
    hoisted.week = week(1, 1);
    hoisted.now = {
      observedAt: '2026-09-10T14:00:00Z', fetchedAt: '2026-09-10T14:00:00Z',
      temperatureF: 57.2, windMph: 14.5, precipInches: 0.04, summary: 'Light rain',
    };
    show();
    expect(await screen.findByText('Right now')).toBeInTheDocument();
    expect(screen.getByText('57°F')).toBeInTheDocument();
    expect(screen.getByText('Light rain')).toBeInTheDocument();
    // The day itself is still clear; a card folding the two together would lose that.
    expect(screen.getByText('Mostly clear')).toBeInTheDocument();
  });

  it('says plainly when the forecast is the yard’s rather than the site’s', async () => {
    /*
     * The whole reason for the card. An efficiency taken sixty miles away is a
     * different claim, and one shown identically to a site forecast is a claim
     * nobody can check.
     */
    hoisted.days = [day()];
    hoisted.week = week(1, 1, 'yard');
    show(false);
    expect(await screen.findByText('This is the forecast at your yard, not at the site'))
      .toBeInTheDocument();
  });

  it('does not claim the yard when the site has its own coordinates', async () => {
    hoisted.days = [day()];
    hoisted.week = week(1, 1, 'site');
    show(true);
    await screen.findByText(/1 workable day of 1/);
    expect(screen.queryByText(/forecast at your yard/)).not.toBeInTheDocument();
  });

  it('says so after a refresh that could not place the site', async () => {
    hoisted.days = [day()];
    hoisted.week = week(1, 1, 'site');
    hoisted.source = 'yard_for_site';
    show(true);
    await screen.findByText(/1 workable day of 1/);
    await userEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    expect(await screen.findByText('This is the forecast at your yard, not at the site'))
      .toBeInTheDocument();
  });

  it('fetches for this project, not for the company yard', async () => {
    show();
    await screen.findByText('No forecast yet');
    await userEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(hoisted.refreshed)
      .toEqual([{ company: 'co-1', project: 'p-1', force: true }]));
  });

  it('shows the reason a refresh failed rather than an empty card', async () => {
    hoisted.refreshFails = 'This company has no city or postal code.';
    show();
    await screen.findByText('No forecast yet');
    await userEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    expect(await screen.findByText('This company has no city or postal code.'))
      .toBeInTheDocument();
  });

  it('tells somebody with no site address what to do about it', async () => {
    show(false);
    expect(await screen.findByText(/Add a site address or coordinates/)).toBeInTheDocument();
  });

  it('gives somebody without projects.write nothing to press', async () => {
    show(true, false);
    await screen.findByText('No forecast yet');
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeDisabled();
  });
});
