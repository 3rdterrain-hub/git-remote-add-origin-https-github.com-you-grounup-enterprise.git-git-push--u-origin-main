/**
 * Survey and earthwork, live.
 *
 * The page ran the real cut/fill analysis over two invented elevation grids —
 * a correct calculation of a job that does not exist.
 *
 * What these hold down is what the page refuses to assume. Swell and shrink are
 * the company's own figures; the unsuitable fraction is *not* assumed, because
 * no column records one and the fixture's six percent would move thousands of
 * yards of import on a number nobody chose.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type {
  SurveyRow, SurfaceComparisonRow, MachineFileRow, SurfaceGrid, SoilDefaults,
} from '@/lib/data/survey';

const hoisted = vi.hoisted(() => ({
  configured: true,
  surveys: [] as SurveyRow[],
  comparisons: [] as SurfaceComparisonRow[],
  files: [] as MachineFileRow[],
  soil: null as SoilDefaults | null,
  grids: {} as Record<string, SurfaceGrid | null>,
  asBuiltId: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/survey', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/survey')>('@/lib/data/survey');
  return {
    ...actual,
    loadSurveys: async () => hoisted.surveys,
    loadSurfaceComparisons: async () => hoisted.comparisons,
    loadMachineFiles: async () => hoisted.files,
    loadSoilDefaults: async () => hoisted.soil,
    loadSurfaceGrid: (id: string) => async () => hoisted.grids[id] ?? null,
    loadAsBuiltSurfaceId: () => async () => hoisted.asBuiltId,
  };
});

const { SurveyPage } = await import('./survey');

const comparison = (over: Partial<SurfaceComparisonRow> = {}): SurfaceComparisonRow => ({
  id: 'c-1', name: 'Phase 2 mass grading', computedAt: '2026-05-04T12:00:00Z',
  projectId: 'p-1', projectNumber: 'PRJ-2026-0011',
  cutBcy: 12_000, fillCcy: 8_000, netBcy: 4_000,
  cutAreaSf: 120_000, fillAreaSf: 90_000,
  maxCutDepthFt: 6.4, maxFillDepthFt: 3.2, coverage: 1,
  existingSurfaceId: 's-e', designSurfaceId: 's-d',
  existingSurfaceName: 'Existing ground', designSurfaceName: 'Design subgrade', ...over,
});

const survey = (over: Partial<SurveyRow> = {}): SurveyRow => ({
  id: 'v-1', name: 'Phase 2 topo', captureMethod: 'gps_rover',
  capturedOn: '2026-05-01', capturedBy: 'M. Ruiz',
  horizontalDatum: 'NAD83', verticalDatum: 'NAVD88',
  coordinateSystem: 'OH North', units: 'us_survey_feet',
  pointCount: 4_210, areaSf: 210_000,
  projectId: 'p-1', projectNumber: 'PRJ-2026-0011',
  surfaces: [{ id: 's-e', name: 'Existing ground', role: 'existing', cellSizeFt: 10 }], ...over,
});

const file = (over: Partial<MachineFileRow> = {}): MachineFileRow => ({
  id: 'f-1', name: 'Phase 2 subgrade', fileFormat: 'ttm', vendor: 'trimble',
  version: 3, status: 'published', publishedAt: '2026-05-02T00:00:00Z',
  supersededById: null, projectNumber: 'PRJ-2026-0011', surfaceName: 'Design subgrade',
  assignedTo: [{ assetCode: 'DZ-2201', assetId: 'as-1', acknowledged: false }], ...over,
});

const show = () => render(<MemoryRouter><SurveyPage /></MemoryRouter>);

beforeEach(() => {
  hoisted.configured = true;
  hoisted.surveys = [survey()];
  hoisted.comparisons = [comparison()];
  hoisted.files = [file()];
  hoisted.soil = { swellPercent: 0.25, shrinkPercent: 0.1 };
  hoisted.asBuiltId = null;
  hoisted.grids = {
    's-e': { id: 's-e', name: 'Existing ground', rows: 2, cols: 2, cellSizeFt: 10,
      elevations: [104, 103, 101, null], origin: { easting: 1000, northing: 2000 } },
    's-d': { id: 's-d', name: 'Design subgrade', rows: 2, cols: 2, cellSizeFt: 10,
      elevations: [100, 100, 103, 100], origin: { easting: 1000, northing: 2000 } },
  };
});

describe('the volumes', () => {
  it('shows what was stored when the comparison was made', async () => {
    /* The figure appears on the tile and again on the card; both are correct,
       so the assertion is that it is shown, not that it is shown once. */
    show();
    await waitFor(() => expect(screen.getAllByText('12,000 BCY').length).toBeGreaterThan(0));
    expect(screen.getAllByText('8,000 CCY').length).toBeGreaterThan(0);
  });

  it('names the two surfaces it compared', async () => {
    show();
    await waitFor(() =>
      expect(screen.getByText(/Existing ground against Design subgrade/i)).toBeTruthy());
  });

  it('says the volumes are as computed, with the date', async () => {
    show();
    await waitFor(() => expect(screen.getByText(/as computed when the comparison was made/i))
      .toBeTruthy());
  });
});

describe('the soil the balance uses', () => {
  it('takes swell and shrink from the company', async () => {
    show();
    await waitFor(() => expect(screen.getByText(/Makes compacted at 10% shrink/)).toBeTruthy());
    expect(screen.getByText(/To truck at 25% swell/)).toBeTruthy();
  });

  it('assumes no unsuitable fraction, and says why', async () => {
    /*
     * The fixture assumed six percent. Nothing records one for a site, so the
     * balance assumes none — and the page has to say that rather than let a
     * reader think the number was considered.
     */
    show();
    await waitFor(() =>
      expect(screen.getByText(/No unsuitable fraction is assumed/i)).toBeTruthy());
    expect(screen.queryByText(/Unsuitable at/)).toBeNull();
  });

  it('says so plainly when the company figures have not been read', async () => {
    hoisted.soil = null;
    show();
    await waitFor(() =>
      expect(screen.getByText(/needs the company's swell and shrink figures/i)).toBeTruthy());
  });
});

describe('the depth map', () => {
  it('draws from the two real grids', async () => {
    show();
    const map = await screen.findByRole('img', { name: /Cut and fill depth map, 2 by 2/i });
    expect(map).toBeTruthy();
  });

  it('scales to the depths actually present rather than a constant', async () => {
    // Existing 104 against design 100 is the deepest cut in the fixture.
    show();
    await waitFor(() => expect(screen.getByText(/Cut, to 4(\.\d+)? ft/)).toBeTruthy());
    expect(screen.getByText(/Fill, to 2(\.\d+)? ft/)).toBeTruthy();
  });

  it('says alignment is checkable when both surfaces carry a georeference', async () => {
    /*
     * Migration 0047 added the origin for exactly this: two grids of the same
     * shape over different ground produce a volume that is entirely fictitious
     * and entirely plausible. The page has to say which case it is in.
     */
    show();
    await waitFor(() =>
      expect(screen.getByText(/tell whether they cover the same ground/i)).toBeTruthy());
  });

  it('warns when neither surface carries one', async () => {
    hoisted.grids['s-e'] = { ...hoisted.grids['s-e']!, origin: null };
    hoisted.grids['s-d'] = { ...hoisted.grids['s-d']!, origin: null };
    show();
    await waitFor(() =>
      expect(screen.getByText(/alignment is not verified/i)).toBeTruthy());
  });

  it('says the volumes still stand when there is no grid to draw', async () => {
    hoisted.grids = { 's-e': null, 's-d': null };
    show();
    await waitFor(() =>
      expect(screen.getByText(/carry no elevation grid/i)).toBeTruthy());
    expect(screen.getByText(/volumes above still stand/i)).toBeTruthy();
  });
});

describe('coverage and progress', () => {
  it('states survey coverage so a partial flight is not read as a full one', async () => {
    /* Carried over from the file this replaces. A volume over four fifths of a
       site is not a volume for the site. */
    hoisted.comparisons = [comparison({ coverage: 0.82 })];
    show();
    await waitFor(() => expect(screen.getByText('Survey coverage')).toBeTruthy());
    expect(screen.getByText('82.0%')).toBeTruthy();
  });

  it('keeps over-excavation out of the progress figure', async () => {
    /*
     * The behavior worth the most on this page, carried over. A cell cut below
     * design grade is not finished work — it is fill to bring back — and
     * counting it is how a job reports ninety-five percent and loses a week.
     */
    hoisted.asBuiltId = 's-b';
    hoisted.grids['s-b'] = { id: 's-b', name: 'As-built', rows: 2, cols: 2, cellSizeFt: 10,
      elevations: [100, 100, 99, 100], origin: { easting: 1000, northing: 2000 } };
    show();
    /* The panel reads three grids before it can compare them, so the wait is on
       the result rather than on the card that will hold it. */
    await waitFor(() => expect(screen.getByText(/Cut past design grade/)).toBeTruthy());
    expect(screen.getByText(/To bring back and recompact/)).toBeTruthy();
    expect(screen.getByText(/Over-excavation is not progress/)).toBeTruthy();
  });

  it('shows no progress panel when nothing has been built yet', async () => {
    hoisted.asBuiltId = null;
    show();
    await waitFor(() => expect(screen.getByText('Measured to priced')).toBeTruthy());
    expect(screen.queryByText('Progress to grade')).toBeNull();
  });
});

describe('the tiles', () => {
  /* All carried over from the file this replaces. */
  it('explains why cut and fill are not the same unit', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /What is behind Fill/i }));
    expect(await screen.findByText(/different units of the same dirt/i)).toBeTruthy();
    expect(screen.getByText(/equal cut and fill is not balanced/i)).toBeTruthy();
  });

  it('names the third unit, which is the one the haul is priced in', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /What is behind Balance/i }));
    await waitFor(() => expect(screen.getByText(/loose in the bed|bank yards and the job needs/i))
      .toBeTruthy());
  });

  it('sends the cut figure to the card that turns it into a priced quantity', async () => {
    const user = userEvent.setup();
    show();
    await user.click(
      await screen.findByRole('button', { name: /how the measured cut becomes a priced quantity/i }));
    expect(await screen.findByText('Measured to priced')).toBeTruthy();
  });

  it('publishes the derivation for the cut/fill balance', async () => {
    // A balance figure nobody can reproduce is a number to argue with.
    show();
    await waitFor(() => expect(screen.getByText(/reusable/i)).toBeTruthy());
  });
});

describe('the captures', () => {
  it('shows both datums, because a volume across two of them is wrong by the offset', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('tab', { name: /Surveys/i }));
    await waitFor(() => expect(screen.getByText('NAD83 / NAVD88')).toBeTruthy());
  });
});

describe('machine control', () => {
  it('warns about a machine that has not acknowledged its file', async () => {
    show();
    await waitFor(() => expect(screen.getByText(/has not acknowledged its file/i)).toBeTruthy());
    expect(screen.getByText(/Sent and acknowledged are different facts/i)).toBeTruthy();
  });

  it('says nothing when every machine has acknowledged', async () => {
    hoisted.files = [file({
      assignedTo: [{ assetCode: 'DZ-2201', assetId: 'as-1', acknowledged: true }],
    })];
    show();
    await waitFor(() => expect(screen.getByText('Surveys')).toBeTruthy());
    expect(screen.queryByText(/has not acknowledged/i)).toBeNull();
  });

  it('links the machine, because a reference is a link', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('tab', { name: /Machine control/i }));
    const link = await screen.findByRole('link', { name: 'DZ-2201' });
    expect(link.getAttribute('href')).toContain('as-1');
  });

  it('narrows the machine control files to the published ones', async () => {
    const user = userEvent.setup();
    hoisted.files = [file(), file({ id: 'f-2', name: 'Old subgrade', supersededById: 'f-1' })];
    show();
    await user.click(await screen.findByRole('tab', { name: /Machine control/i }));
    expect(await screen.findByText('Old subgrade')).toBeTruthy();
    await user.click(screen.getByLabelText(/Only the files a machine could be cutting to/i));
    await waitFor(() => expect(screen.queryByText('Old subgrade')).toBeNull());
    expect(screen.getByText('Phase 2 subgrade')).toBeTruthy();
  });

  it('marks a superseded file rather than hiding it', async () => {
    const user = userEvent.setup();
    hoisted.files = [file({ supersededById: 'f-2' })];
    show();
    await user.click(await screen.findByRole('tab', { name: /Machine control/i }));
    expect(await screen.findByText('Superseded')).toBeTruthy();
  });
});

describe('what was removed', () => {
  it('offers no cross-sections tab, because nothing stores a cross section', async () => {
    /*
     * The engine's average-end-area and prismoidal comparison are real and
     * tested. No alignment or cross-section table exists, so the tab was a
     * picture of a calculation over invented stations.
     */
    show();
    await waitFor(() => expect(screen.getByRole('tab', { name: /Surface volumes/i })).toBeTruthy());
    expect(screen.queryByRole('tab', { name: /Cross sections/i })).toBeNull();
  });
});

describe('without a workspace', () => {
  it('says it is a demonstration rather than showing invented volumes', async () => {
    hoisted.configured = false;
    show();
    await waitFor(() => expect(screen.queryByText('12,000 BCY')).toBeNull());
  });
});
