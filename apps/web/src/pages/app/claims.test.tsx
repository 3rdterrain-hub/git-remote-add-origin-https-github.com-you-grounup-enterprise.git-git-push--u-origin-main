import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderPage as renderWithProviders } from '@/test/render';
import { ClaimsPage } from './claims';
import { CLAIMS } from '@/data/survey';

const renderPage = () => renderWithProviders(<ClaimsPage />);

describe('the notice clock is the point of the page', () => {
  it('lists every claim', () => {
    renderPage();
    for (const c of CLAIMS) {
      expect(screen.getByText(c.number)).toBeInTheDocument();
      expect(screen.getByText(c.title)).toBeInTheDocument();
    }
  });

  it('raises an alert for a claim whose notice period is closing', () => {
    renderPage();
    // CL-2026-003 has no notice served and is inside the window.
    expect(screen.getByText(/within the notice window/i)).toBeInTheDocument();
    expect(screen.getAllByText(/CL-2026-003/)).not.toHaveLength(0);
  });

  it('says how much margin a served notice had', () => {
    renderPage();
    expect(screen.getAllByText(/inside the period/i).length).toBeGreaterThan(0);
  });

  it('shows the award rather than the ask once a claim is settled', () => {
    renderPage();
    const settled = CLAIMS.find((c) => c.status === 'settled')!;
    expect(screen.getByText('Awarded')).toBeInTheDocument();
    // The claim card shows the award and the "recovered to date" tile totals
    // it; with one settled claim those are the same figure, and should be.
    expect(screen.getAllByText(`$${settled.costAwarded!.toLocaleString()}.00`).length).toBeGreaterThan(0);
    // What must NOT appear on a settled claim is the original ask.
    expect(screen.queryByText(`$${settled.costClaimed.toLocaleString()}.00`)).not.toBeInTheDocument();
  });

  it('warns when a live claim has no contemporaneous records attached', () => {
    renderPage();
    expect(screen.getByText(/No daily reports are linked yet/i)).toBeInTheDocument();
  });
});
