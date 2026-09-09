/**
 * Safety, read from the governed schema.
 *
 * Two things this page never showed are the two this build had to fix in the
 * schema: TRIR and DART, which P29 found defined against a view that could not
 * produce them, and lapsed credentials, which P09 found stored rather than
 * derived so an expired license kept reading valid.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  // Typed explicitly: a rate is null when there are no hours behind it, and an
  // inferred `number` would hide that in the one test that asserts it.
  rates: { trir: 1.5, dart: 0.8, recordables: 3, hoursObserved: 400_000, lostTimeCases: 1 } as {
    trir: number | null; dart: number | null;
    recordables: number; hoursObserved: number; lostTimeCases: number;
  },
  credentials: [] as unknown[],
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));
vi.mock('@/lib/data/safety', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/safety')>('@/lib/data/safety');
  return {
    ...actual,
    loadIncidents: async () => [],
    loadObservations: async () => [],
    loadToolboxTalks: async () => [],
    loadInspections: async () => [],
    loadDeficiencies: async () => [],
    loadSafetyRates: async () => hoisted.rates,
    loadLapsedCredentials: async () => hoisted.credentials,
  };
});

const { SafetyPage } = await import('./safety');

describe('the safety page', () => {
  beforeEach(() => {
    hoisted.configured = true;
    hoisted.rates = { trir: 1.5, dart: 0.8, recordables: 3, hoursObserved: 400_000, lostTimeCases: 1 };
    hoisted.credentials = [];
  });

  it('shows TRIR and DART with the hours behind them', async () => {
    // A rate over two weeks of timesheets is not the same claim as a rate over
    // a year, and the denominator is what somebody checking it asks for first.
    renderPage(<SafetyPage />);
    await waitFor(() => expect(screen.getByText('TRIR')).toBeInTheDocument());
    expect(screen.getByText('1.50')).toBeInTheDocument();
    expect(screen.getByText('0.80')).toBeInTheDocument();
    expect(screen.getByText('400,000')).toBeInTheDocument();
  });

  it('says DART counts cases rather than days', async () => {
    // The defect P29 corrected: a case costing sixty restricted days counted
    // sixty in a rate that counts cases.
    renderPage(<SafetyPage />);
    await waitFor(() =>
      expect(screen.getAllByText(/cases, not days/).length).toBeGreaterThan(0));
  });

  it('refuses to publish a rate with no hours behind it', async () => {
    /*
     * An invented denominator would produce a confident and unfounded safety
     * figure — the exact class of defect P29 removed. The page says why instead.
     */
    hoisted.rates = { trir: null, dart: null, recordables: 2, hoursObserved: 0, lostTimeCases: 0 };
    renderPage(<SafetyPage />);
    await waitFor(() =>
      expect(screen.getByText('No approved hours to compute a rate against')).toBeInTheDocument());
    expect(screen.queryByText('TRIR')).not.toBeInTheDocument();
  });

  it('lists a lapsed credential and the work it blocks', async () => {
    hoisted.credentials = [{
      credentialId: 'c-1', employeeName: 'Ray Delgado', credentialName: 'CDL Class A',
      standing: 'expired', expiresOn: '2026-02-15', daysRemaining: -200,
      blocksWorkTypes: ['cdl_driving'],
    }];
    renderPage(<SafetyPage />);
    await waitFor(() => expect(screen.getByText('Ray Delgado')).toBeInTheDocument());
    expect(screen.getByText('CDL Class A')).toBeInTheDocument();
    expect(screen.getByText('cdl_driving')).toBeInTheDocument();
    expect(screen.getByText(/200 days ago/)).toBeInTheDocument();
  });

  it('says nothing about credentials when none has lapsed', async () => {
    renderPage(<SafetyPage />);
    await waitFor(() => expect(screen.getByText('TRIR')).toBeInTheDocument());
    expect(screen.queryByText('Credentials lapsed or lapsing')).not.toBeInTheDocument();
  });

  it('labels the page when there is no workspace behind it', async () => {
    hoisted.configured = false;
    renderPage(<SafetyPage />);
    await waitFor(() => expect(screen.getByText('Demonstration data')).toBeInTheDocument());
  });
});

/*
 * TRIR and DART are the two figures a contractor is prequalified on, and the
 * page showed each as a number with a formula in six words underneath it.
 */
describe('the boxes across the top', () => {
  beforeEach(() => {
    hoisted.configured = true;
    hoisted.rates = { trir: 1.5, dart: 0.8, recordables: 3, hoursObserved: 400_000, lostTimeCases: 1 };
    hoisted.credentials = [];
  });

  it('shows the arithmetic behind TRIR, with this page\'s own numbers in it', async () => {
    const user = userEvent.setup();
    renderPage(<SafetyPage />);
    await waitFor(() => expect(screen.getByText('TRIR')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'What is behind TRIR' }));

    expect(screen.getByText(/3 recordable incidents × 200,000 ÷ 400,000 approved hours = 1.50/))
      .toBeInTheDocument();
    expect(screen.getByText(/a hundred full-time workers for a year/)).toBeInTheDocument();
  });

  it('says why DART counts cases and not days', async () => {
    const user = userEvent.setup();
    renderPage(<SafetyPage />);
    await waitFor(() => expect(screen.getByText('DART')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'What is behind DART' }));
    expect(screen.getByText(/One case costing sixty restricted days counts once/))
      .toBeInTheDocument();
  });

  it('opens the punch list from the tile that counts punch items', async () => {
    const user = userEvent.setup();
    renderPage(<SafetyPage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open the punch list' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Open the punch list' }));
    expect(screen.getByRole('tab', { name: /Punch list/ })).toHaveAttribute('data-state', 'active');
  });

  it('says so rather than showing an empty list when nothing is recordable', async () => {
    const user = userEvent.setup();
    renderPage(<SafetyPage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'List the OSHA recordable incidents' }))
        .toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'List the OSHA recordable incidents' }));
    expect(screen.getByText(/Showing the OSHA recordable incidents/)).toBeInTheDocument();
  });
});
