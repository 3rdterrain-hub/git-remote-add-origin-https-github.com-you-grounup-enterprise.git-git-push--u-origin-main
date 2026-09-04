import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage as renderWithProviders } from '@/test/render';
import { NetworkPage } from './network';
import { NETWORK_VENDORS, vendorScore } from '@/data/survey';

const renderPage = () => renderWithProviders(<NetworkPage />);

describe('the vendor directory', () => {
  it('lists every vendor by default', () => {
    renderPage();
    for (const v of NETWORK_VENDORS) {
      expect(screen.getByText(v.displayName)).toBeInTheDocument();
    }
  });

  it('marks a vendor you have not published as private', () => {
    renderPage();
    const privateCount = NETWORK_VENDORS.filter((v) => !v.isPublished).length;
    expect(screen.getAllByText('Private')).toHaveLength(privateCount);
  });

  it('orders by performance so the best-rated vendor leads', () => {
    renderPage();
    const best = [...NETWORK_VENDORS].sort((a, b) => (vendorScore(b) ?? 0) - (vendorScore(a) ?? 0))[0]!;
    const headings = screen.getAllByRole('heading');
    expect(headings.map((h) => h.textContent).join(' ')).toContain(best.displayName);
  });

  it('filters by trade', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Dewatering' }));
    expect(screen.getByText('Buckeye Dewatering')).toBeInTheDocument();
    expect(screen.queryByText('Vega Traffic Control')).not.toBeInTheDocument();
  });

  it('searches across trade, name, city and region', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/search the vendor network/i), 'maumee');
    // Matches Maumee Valley Trucking by name and Fort Miami Precast by city.
    expect(screen.getByText('Maumee Valley Trucking')).toBeInTheDocument();
    expect(screen.getByText('Fort Miami Precast')).toBeInTheDocument();
    expect(screen.queryByText('Norwalk Concrete Industries')).not.toBeInTheDocument();
  });

  it('flags a certificate of insurance that is about to lapse', () => {
    renderPage();
    // Vega expires 2026-09-15, inside the 45-day window from 2026-09-02.
    expect(screen.getByText(/Expires in 13 days/)).toBeInTheDocument();
  });

  it('says plainly that a vendor has no history rather than implying a score', () => {
    renderPage();
    expect(screen.getByText('No history yet')).toBeInTheDocument();
  });

  it('explains what publishing does and does not share', () => {
    renderPage();
    expect(screen.getByText(/your contracts with that vendor, your rates, your bids/i)).toBeInTheDocument();
  });
});
