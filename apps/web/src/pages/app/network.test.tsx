/**
 * The GrounUp Network, live.
 *
 * The page rendered five invented vendors from `@/data/survey` on a live route
 * while `network_vendors` and `network_ratings` sat governed and unread since
 * migration 0023 — O-025.
 *
 * Most of these are about what the screen must *not* say. It is the only place
 * in the application that shows rows another company wrote, so the failures
 * worth pinning are disclosure failures: naming a rater, publishing without
 * consent, showing an average as though one opinion settled it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { NetworkVendor, NetworkRating } from '@/lib/data/network';

const hoisted = vi.hoisted(() => ({
  configured: true,
  vendors: [] as NetworkVendor[],
  ratings: [] as NetworkRating[],
  published: [] as { id: string; published: boolean }[],
  consents: [] as { id: string; how: string }[],
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/network', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/network')>('@/lib/data/network');
  return {
    ...actual,
    loadNetworkVendors: async () => hoisted.vendors,
    loadNetworkRatings: async () => hoisted.ratings,
    publishNetworkVendor: async (id: string, published = true) => {
      hoisted.published.push({ id, published });
    },
    recordNetworkConsent: async (id: string, how: string) => {
      hoisted.consents.push({ id, how });
    },
  };
});

vi.mock('@/lib/data/session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/session')>('@/lib/data/session');
  return {
    ...actual,
    useCompanyId: () => ({ companyId: 'co-1', loading: false }),
    usePermissions: () => ({ can: () => true, loading: false }),
  };
});

vi.mock('@/lib/data/projects', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/projects')>('@/lib/data/projects');
  return { ...actual, listProjects: async () => [] };
});

const { NetworkPage } = await import('./network');

const vendor = (over: Partial<NetworkVendor> = {}): NetworkVendor => ({
  id: 'nv-1', legalName: 'Buckeye Dewatering LLC', displayName: 'Buckeye Dewatering',
  trades: ['Dewatering'], regions: ['Northwest Ohio'], city: 'Toledo', state: 'OH',
  website: null, contactEmail: null, contactPhone: null,
  insuranceExpiresOn: '2027-03-31', bondingCapacity: 2_000_000,
  isDbe: false, isMbe: false, isWbe: false, certifications: [],
  isPublished: true, publishedAt: '2026-05-01T00:00:00Z',
  isMine: false, consentOnRecord: true, consentNote: null,
  ratingCount: 1, averageOverall: 4.3, averageSafety: 5, wouldHireAgainCount: 1,
  daysUntilInsuranceLapses: 200, insuranceLapsed: false, ...over,
});

const rating = (over: Partial<NetworkRating> = {}): NetworkRating => ({
  id: 'r-1', vendorId: 'nv-1', vendorName: 'Buckeye Dewatering',
  quality: 5, schedule: 4, safety: 5, communication: 4, overall: 4.5,
  wouldHireAgain: true, comment: 'Kept the hole dry through 3 in of rain.',
  contractValue: 24_800, createdAt: '2026-06-01T00:00:00Z',
  isMine: false, projectNumber: null, ...over,
});

/*
 * Three vendors, because the directory behavior worth pinning is *separation*:
 * a trade filter that keeps everything, a search that matches everything and an
 * ordering over one row all pass while doing nothing.
 */
const directory = (): NetworkVendor[] => [
  vendor({ id: 'nv-1', displayName: 'Buckeye Dewatering', trades: ['Dewatering'],
    city: 'Toledo', state: 'OH', averageOverall: 4.3, ratingCount: 2 }),
  vendor({ id: 'nv-2', displayName: 'Vega Traffic Control', trades: ['Maintenance of traffic'],
    city: 'Perrysburg', state: 'OH', regions: ['Northwest Ohio'],
    isDbe: true, isWbe: true, averageOverall: 4.9, ratingCount: 3,
    insuranceExpiresOn: '2026-09-30', daysUntilInsuranceLapses: 13, insuranceLapsed: false }),
  vendor({ id: 'nv-3', displayName: 'Fort Miami Precast', trades: ['Precast structures'],
    city: 'Maumee', state: 'OH', isMine: true, isPublished: false, consentOnRecord: true,
    ratingCount: 0, averageOverall: null, wouldHireAgainCount: 0 }),
];

const show = () => render(<MemoryRouter><NetworkPage /></MemoryRouter>);

beforeEach(() => {
  hoisted.configured = true;
  hoisted.vendors = [vendor()];
  hoisted.ratings = [rating()];
  hoisted.published = [];
  hoisted.consents = [];
});

describe('what a rating does and does not disclose', () => {
  it('never names the company that left a rating', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Buckeye Dewatering')).toBeTruthy());
    expect(screen.getByText('A contractor on the network')).toBeTruthy();
    expect(screen.queryByText(/Ridgeline|Kesler|Gerken/)).toBeNull();
  });

  it('names your own rating, because you already know you left it', async () => {
    hoisted.ratings = [rating({ isMine: true, projectNumber: 'PRJ-2026-0011' })];
    show();
    await waitFor(() => expect(screen.getByText(/Your company · PRJ-2026-0011/)).toBeTruthy());
  });

  it('shows the rating count beside the average, never the average alone', async () => {
    /*
     * One rating rendered as "4.3" is a number with more authority than it has
     * earned. The count is what tells a reader how much of a record it is.
     */
    hoisted.vendors = [vendor({ ratingCount: 1, averageOverall: 4.3 })];
    show();
    await waitFor(() => expect(screen.getByText('4.3')).toBeTruthy());
    expect(screen.getByText('(1)')).toBeTruthy();
    expect(screen.getByLabelText('4.3 out of 5 from 1 ratings')).toBeTruthy();
  });

  it('says a vendor has no history rather than scoring them zero', async () => {
    hoisted.vendors = [vendor({ ratingCount: 0, averageOverall: null, wouldHireAgainCount: 0 })];
    hoisted.ratings = [];
    show();
    await waitFor(() => expect(screen.getByText('No history yet')).toBeTruthy());
    expect(screen.queryByText('0.0')).toBeNull();
  });
});

describe('consent, which publication depends on', () => {
  it('will not offer to publish a listing with no consent on record', async () => {
    hoisted.vendors = [vendor({
      isMine: true, isPublished: false, consentOnRecord: false, ratingCount: 0,
      averageOverall: null, wouldHireAgainCount: 0,
    })];
    hoisted.ratings = [];
    show();
    const publish = await screen.findByRole('button', { name: /Publish to the network/ });
    expect(publish).toBeDisabled();
    expect(publish.getAttribute('title')).toMatch(/consent has to be on record first/i);
  });

  it('says at the top which listings are held back, and why', async () => {
    hoisted.vendors = [vendor({
      displayName: 'Fort Miami Precast', isMine: true, isPublished: false,
      consentOnRecord: false, ratingCount: 0, averageOverall: null, wouldHireAgainCount: 0,
    })];
    hoisted.ratings = [];
    show();
    await waitFor(() => expect(screen.getByText(/1 listing waiting on consent/)).toBeTruthy());
    expect(screen.getByText(/Fort Miami Precast — private until you record/)).toBeTruthy();
  });

  it('records how they agreed, not merely that they did', async () => {
    hoisted.vendors = [vendor({
      isMine: true, isPublished: false, consentOnRecord: false, ratingCount: 0,
      averageOverall: null, wouldHireAgainCount: 0,
    })];
    hoisted.ratings = [];
    show();
    await userEvent.click(await screen.findByRole('button', { name: /Record their consent/ }));
    const how = screen.getByLabelText(/How they agreed to be listed/);
    /* Empty is refused: "consent exists" without "here is what it was" is the
       claim that falls apart the day a vendor says they never agreed. */
    expect(screen.getByRole('button', { name: /Record it/ })).toBeDisabled();
    await userEvent.type(how, 'Signed form returned by email, 3 March');
    await userEvent.click(screen.getByRole('button', { name: /Record it/ }));
    await waitFor(() => expect(hoisted.consents).toEqual([
      { id: 'nv-1', how: 'Signed form returned by email, 3 March' },
    ]));
  });

  it('publishes a listing whose consent is on record', async () => {
    hoisted.vendors = [vendor({
      isMine: true, isPublished: false, consentOnRecord: true, ratingCount: 0,
      averageOverall: null, wouldHireAgainCount: 0,
    })];
    hoisted.ratings = [];
    show();
    await userEvent.click(await screen.findByRole('button', { name: /Publish to the network/ }));
    await waitFor(() => expect(hoisted.published).toEqual([{ id: 'nv-1', published: true }]));
  });
});

describe('whose listing it is', () => {
  it('does not offer to rate your own listing', async () => {
    hoisted.vendors = [vendor({ isMine: true })];
    show();
    await waitFor(() => expect(screen.getByText('Your listing')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Rate them/ })).toBeNull();
  });

  it('offers to rate somebody else’s published listing', async () => {
    show();
    expect(await screen.findByRole('button', { name: /Rate them/ })).toBeTruthy();
  });

  it('does not offer consent or publication on a listing you do not own', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Buckeye Dewatering')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Publish to the network/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Record their consent/ })).toBeNull();
  });
});

describe('insurance, dated by the database', () => {
  it('reads a lapsed certificate as expired rather than counting down', async () => {
    hoisted.vendors = [vendor({
      insuranceExpiresOn: '2026-01-31', daysUntilInsuranceLapses: -40, insuranceLapsed: true,
    })];
    show();
    await waitFor(() => expect(screen.getByText(/Expired /)).toBeTruthy());
  });

  it('says nothing is on file rather than showing a covered vendor', async () => {
    hoisted.vendors = [vendor({
      insuranceExpiresOn: null, daysUntilInsuranceLapses: null, insuranceLapsed: false,
    })];
    show();
    await waitFor(() => expect(screen.getByText('No certificate on file')).toBeTruthy());
  });
});

describe('an unconnected environment', () => {
  it('says it is a demonstration rather than presenting the sample as the network', async () => {
    hoisted.configured = false;
    show();
    await waitFor(() => expect(screen.getByText(/demonstration/i)).toBeTruthy());
  });

  it('offers no writer against a directory that is not there', async () => {
    hoisted.configured = false;
    show();
    await waitFor(() => expect(screen.getByText(/demonstration/i)).toBeTruthy());
    expect(screen.getByRole('button', { name: /Add a vendor/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Rate them/ })).toBeNull();
  });

  it('keeps the sample ratings anonymous, exactly as production does', async () => {
    hoisted.configured = false;
    show();
    await waitFor(() => expect(screen.getAllByText('A contractor on the network').length)
      .toBeGreaterThan(0));
    expect(screen.queryByText(/Ridgeline Excavating/)).toBeNull();
  });
});

describe('an empty network', () => {
  it('says nothing is listed rather than showing an empty search', async () => {
    hoisted.vendors = [];
    hoisted.ratings = [];
    show();
    await waitFor(() => expect(screen.getByText(/Nothing is listed on the network yet/)).toBeTruthy());
  });
});

/*
 * The directory behavior that predates the conversion. These were written
 * against the fixture and are kept against live rows — a screen that reads a
 * table instead of an array is not an excuse to stop proving that its search
 * narrows anything.
 */
describe('finding a vendor in the directory', () => {
  beforeEach(() => { hoisted.vendors = directory(); hoisted.ratings = []; });

  it('lists every vendor by default', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Buckeye Dewatering')).toBeTruthy());
    expect(screen.getByText('Vega Traffic Control')).toBeTruthy();
    expect(screen.getByText('Fort Miami Precast')).toBeTruthy();
  });

  it('marks a vendor you have not published as private', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Fort Miami Precast')).toBeTruthy());
    expect(screen.getAllByText('Private')).toHaveLength(1);
  });

  it('orders by performance so the best-rated vendor leads', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Vega Traffic Control')).toBeTruthy());
    const headings = screen.getAllByRole('heading').map((h) => h.textContent ?? '');
    const vega = headings.findIndex((t) => t.includes('Vega Traffic Control'));
    const buckeye = headings.findIndex((t) => t.includes('Buckeye Dewatering'));
    expect(vega).toBeGreaterThanOrEqual(0);
    expect(vega).toBeLessThan(buckeye);
  });

  it('filters by trade', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Dewatering' }));
    expect(screen.getByText('Buckeye Dewatering')).toBeTruthy();
    expect(screen.queryByText('Vega Traffic Control')).toBeNull();
  });

  it('searches across trade, name, city and region', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Buckeye Dewatering')).toBeTruthy());
    await userEvent.type(screen.getByLabelText(/search the vendor network/i), 'maumee');
    expect(screen.getByText('Fort Miami Precast')).toBeTruthy();
    expect(screen.queryByText('Buckeye Dewatering')).toBeNull();
  });

  it('flags a certificate of insurance that is about to lapse', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Expires in 13 days')).toBeTruthy());
  });

  it('explains what publishing does and does not share', async () => {
    show();
    await waitFor(() => expect(
      screen.getByText(/your contracts with that vendor, your rates, your bids/i),
    ).toBeTruthy());
  });
});

/*
 * Four boxes counting vendors that are in the list below them, over a directory
 * of fifty cards. Each is a lens on that list rather than a second list.
 */
describe('the boxes across the top', () => {
  beforeEach(() => { hoisted.vendors = directory(); hoisted.ratings = []; });

  it('narrows the directory to the vendors whose insurance needs attention', async () => {
    show();
    await userEvent.click(await screen.findByRole('button',
      { name: 'List the vendors whose insurance needs attention' }));
    expect(screen.getByText(/Showing the vendors whose insurance needs attention/)).toBeTruthy();
    expect(screen.getByText('Vega Traffic Control')).toBeTruthy();
    /* Covered to 2027 — filtered out, or the assertion above proves nothing. */
    expect(screen.queryByText('Buckeye Dewatering')).toBeNull();
  });

  it('composes with the search rather than replacing it', async () => {
    show();
    await userEvent.click(await screen.findByRole('button',
      { name: 'List the certified DBE, MBE and WBE vendors' }));
    expect(screen.getByText('Vega Traffic Control')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Search the vendor network'), 'zzzzzz');
    expect(screen.getByText(/Showing the DBE, MBE and WBE certified vendors/)).toBeTruthy();
    expect(screen.getByText('No vendor matches that search.')).toBeTruthy();
  });

  it('puts every vendor back', async () => {
    show();
    await userEvent.click(await screen.findByRole('button',
      { name: 'List the vendors somebody has rated' }));
    await userEvent.click(screen.getByRole('button', { name: 'Show all 3' }));
    expect(screen.queryByText(/Showing the vendors with performance history/)).toBeNull();
    expect(screen.getByText('Fort Miami Precast')).toBeTruthy();
  });
});
