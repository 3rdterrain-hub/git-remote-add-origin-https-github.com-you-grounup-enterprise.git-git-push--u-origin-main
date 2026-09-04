/**
 * The first screen in this application that reads a record.
 *
 * It has to do three things and be seen to do them: show live figures when
 * there is a workspace behind it, say plainly when there is not, and show an
 * error as an error rather than substituting sample numbers.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  rows: [] as unknown[],
  fail: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/project-view', async () => {
  const actual = await vi.importActual<typeof import('./../../lib/data/project-view')>(
    '@/lib/data/project-view');
  return {
    ...actual,
    loadProjects: async () => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      return hoisted.rows;
    },
    loadRateVariance: async () => [],
  };
});

const { ProjectsPage } = await import('./projects');

const project = {
  id: 'p-1', number: 'PRJ-2026-011', name: 'Maumee Commerce Park', customer: 'Maumee Development',
  status: 'active', contractValue: 1_000_000, revisedContractValue: 1_050_000,
  budget: 800_000, actualCost: 500_000, committedCost: 250_000,
  billedToDate: 600_000, costToComplete: 50_000, openChangeOrders: 2, openRfis: 3,
};

describe('the projects screen', () => {
  beforeEach(() => { hoisted.configured = true; hoisted.fail = null; hoisted.rows = [project]; });

  it('shows figures read from the governed view', async () => {
    renderPage(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('PRJ-2026-011')).toBeInTheDocument());
    expect(screen.getByText('Maumee Development')).toBeInTheDocument();
    // The revised contract value, not the original: an executed change order is
    // part of what the job is worth.
    expect(screen.getAllByText('$1,050,000.00').length).toBeGreaterThan(0);
  });

  it('shows committed money beside spent money', async () => {
    // The distinction P07 and P13 were about: a commitment is money the company
    // can no longer choose not to spend.
    renderPage(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('PRJ-2026-011')).toBeInTheDocument());
    expect(screen.getByRole('columnheader', { name: 'Committed' })).toBeInTheDocument();
    expect(screen.getAllByText('$250,000.00').length).toBeGreaterThan(0);
  });

  it('shows an overcommitted project as a hole rather than as room', async () => {
    hoisted.rows = [{ ...project, actualCost: 600_000, committedCost: 250_000, costToComplete: -50_000 }];
    renderPage(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('PRJ-2026-011')).toBeInTheDocument());
    expect(screen.getByText('overcommitted against budget')).toBeInTheDocument();
  });

  it('claims no completion percentage anywhere', async () => {
    /*
     * The sample dataset carried one and nothing in the platform computes it.
     * An invented completion figure beside real money is exactly what this
     * conversion existed to remove, so its absence is asserted rather than
     * assumed.
     */
    renderPage(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('PRJ-2026-011')).toBeInTheDocument());
    expect(screen.queryByText(/complete$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Progress' })).not.toBeInTheDocument();
  });

  it('says so when there is no workspace behind it', async () => {
    hoisted.configured = false;
    renderPage(<ProjectsPage />);
    await waitFor(() =>
      expect(screen.getByText('Demonstration data')).toBeInTheDocument());
    expect(screen.getByText(/come from a sample project, not from a workspace/)).toBeInTheDocument();
  });

  it('shows an error as an error, never as sample data', async () => {
    hoisted.fail = 'could not reach the database';
    renderPage(<ProjectsPage />);
    await waitFor(() =>
      expect(screen.getByText('could not reach the database')).toBeInTheDocument());
    // Not the sample dataset's project, which is what a silent fallback would
    // have put on screen.
    expect(screen.queryByText('Demonstration data')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('tells somebody with no projects that they have none', async () => {
    hoisted.rows = [];
    renderPage(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeInTheDocument());
  });
});
