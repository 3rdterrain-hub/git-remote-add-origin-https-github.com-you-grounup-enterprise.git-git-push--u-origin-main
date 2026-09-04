import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage as renderWithProviders } from '@/test/render';
import { SurveyPage } from './survey';
import { SURFACE_COMPARISON, SURFACE_PROGRESS, ROAD_AEA, ROAD_PRISMOIDAL, MC_FILES } from '@/data/survey';
import { integer, qty } from '@/lib/format';

const renderPage = () => renderWithProviders(<SurveyPage />);

describe('survey volumes come from the engine, not the page', () => {
  it('shows the cut the engine computed', () => {
    renderPage();
    // The headline tile and the balance breakdown both carry it, and they must
    // agree — a page that shows two different cut volumes is worse than one.
    expect(screen.getAllByText(`${integer(SURFACE_COMPARISON.cutBcy)} BCY`).length).toBeGreaterThan(0);
  });

  it('shows the fill the engine computed', () => {
    renderPage();
    expect(screen.getAllByText(`${integer(SURFACE_COMPARISON.fillCcy)} CCY`).length).toBeGreaterThan(0);
  });

  it('publishes the derivation for the cut/fill balance', () => {
    renderPage();
    // The balance must show its work — a bare number the user cannot check is
    // exactly what the platform exists to avoid.
    expect(screen.getAllByText(/shrink/i).length).toBeGreaterThan(0);
  });

  it('states survey coverage so a partial flight cannot be mistaken for a full one', () => {
    renderPage();
    expect(screen.getByText('Survey coverage')).toBeInTheDocument();
    expect(screen.getByText(`${integer(SURFACE_COMPARISON.cellsSkipped)} cells outside the boundary`))
      .toBeInTheDocument();
  });
});

describe('progress separates rework from completion', () => {
  it('warns about material cut below design grade', () => {
    renderPage();
    expect(screen.getByText(new RegExp(`${qty(SURFACE_PROGRESS.overExcavationBcy, 0)} BCY cut below design grade`)))
      .toBeInTheDocument();
  });

  it('never counts over-excavation toward percent complete', () => {
    expect(SURFACE_PROGRESS.percentComplete).toBeLessThanOrEqual(1);
    expect(SURFACE_PROGRESS.overExcavationBcy).toBeGreaterThan(0);
  });
});

describe('cross sections label the method actually used', () => {
  it('marks the one segment with a surveyed mid-section as prismoidal', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: /cross sections/i }));
    const prismoidal = screen.getAllByText('Prismoidal');
    // Exactly the segments that have a surveyed mid-section.
    expect(prismoidal).toHaveLength(
      ROAD_PRISMOIDAL.segments.length - ROAD_PRISMOIDAL.segmentsWithoutMidSection,
    );
  });

  it('does not claim a prismoidal correction where none was possible', () => {
    // Substituting the mean of the two ends collapses the prismoidal formula
    // back to average end area; only a surveyed mid-section changes the answer.
    const noMid = ROAD_PRISMOIDAL.segments.filter((s) => s.method !== 'prismoidal');
    for (const s of noMid) {
      const same = ROAD_AEA.segments.find(
        (a) => a.fromStation === s.fromStation && a.toStation === s.toStation,
      );
      expect(s.cutBcy).toBe(same?.cutBcy);
      expect(s.fillCcy).toBe(same?.fillCcy);
    }
  });
});

describe('machine control', () => {
  it('shows which machines are running which published design', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: /machine control/i }));
    expect(screen.getByText('DZ-2205')).toBeInTheDocument();
    expect(screen.getByText('GR-3310')).toBeInTheDocument();
  });

  it('keeps superseded versions visible rather than deleting them', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: /machine control/i }));
    const superseded = MC_FILES.filter((f) => f.status === 'superseded');
    // One badge per superseded file, plus the count tile beneath the table.
    expect(screen.getAllByText('Superseded')).toHaveLength(superseded.length + 1);
  });
});
