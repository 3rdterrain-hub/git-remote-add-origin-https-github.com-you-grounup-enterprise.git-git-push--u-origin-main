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
