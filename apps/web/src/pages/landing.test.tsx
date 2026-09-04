import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LandingPage } from './landing';
import { ESTIMATE } from '@/data/demo';

const renderPage = () => render(<MemoryRouter><LandingPage /></MemoryRouter>);

describe('landing page — the specified first deliverable', () => {
  it('shows the required navigation and both calls to action', () => {
    renderPage();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const label of ['Home', 'Features', 'About', 'Pricing', 'Login']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(within(nav).getByRole('link', { name: /start building estimates/i })).toHaveAttribute('href', '/signup');
  });

  it('renders the specified hero headline and subheadline', () => {
    renderPage();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Estimate Smarter.');
    expect(h1).toHaveTextContent('Build Better.');
    expect(h1).toHaveTextContent('Run Everything From the Ground Up.');
    expect(screen.getByText(/connects AI-assisted construction estimating/i)).toBeInTheDocument();
  });

  it('offers a primary and a secondary hero action', () => {
    renderPage();
    expect(screen.getAllByRole('link', { name: /start free/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /see how it works/i })).toHaveAttribute('href', '#how-it-works');
  });

  it('renders the three required benefit cards', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Build Better Estimates' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Understand Plans Faster' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Run the Job After You Win It' })).toBeInTheDocument();
  });

  it('names every construction sector the brief requires', () => {
    renderPage();
    for (const sector of [
      'Excavation', 'Earthwork', 'Heavy civil', 'Demolition', 'Utilities', 'Sitework',
      'Grading', 'Roadwork', 'Landscaping & site finishes', 'Remodeling', 'General construction',
    ]) {
      expect(screen.getByText(sector)).toBeInTheDocument();
    }
  });

  it('covers the security and control commitments', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Tenant isolation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Role-based permissions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Audit history' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Governed AI' })).toBeInTheDocument();
  });

  it('routes the pricing call to action at the subscription flow', () => {
    renderPage();
    expect(screen.getAllByRole('link', { name: /see pricing/i })[0]).toHaveAttribute('href', '/pricing');
  });

  it('renders the required footer link groups', () => {
    renderPage();
    const footer = screen.getByRole('contentinfo');
    for (const group of ['Product', 'Company', 'Support', 'Legal']) {
      expect(within(footer).getByRole('heading', { name: group })).toBeInTheDocument();
    }
    expect(within(footer).getByRole('link', { name: 'Privacy' })).toBeInTheDocument();
    expect(within(footer).getByRole('link', { name: 'Terms' })).toBeInTheDocument();
    expect(within(footer).getByRole('link', { name: 'Login' })).toBeInTheDocument();
  });

  it('shows real engine output in the product preview, not placeholder art', () => {
    renderPage();
    // The preview must reflect the actual computed estimate, so a change in the
    // engine shows up on the marketing page rather than drifting away from it.
    expect(screen.getByText(new RegExp(ESTIMATE.number))).toBeInTheDocument();
    expect(screen.getByText(String(ESTIMATE.weightedConfidence))).toBeInTheDocument();
    expect(screen.getByText(ESTIMATE.lines[0]!.description)).toBeInTheDocument();
  });
});
