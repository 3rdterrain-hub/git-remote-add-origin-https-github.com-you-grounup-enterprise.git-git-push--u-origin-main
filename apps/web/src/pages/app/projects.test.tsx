/**
 * The first screen in this application that reads a record.
 *
 * It has to do three things and be seen to do them: show live figures when
 * there is a workspace behind it, say plainly when there is not, and show an
 * error as an error rather than substituting sample numbers.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

/*
 * Each of the four boxes summed a column of the table below it and then left
 * the reader to find the rows that made the number. Each is now the filter for
 * its own figure.
 */
describe('the boxes across the top', () => {
  const second = {
    ...project, id: 'p-2', number: 'PRJ-2026-012', name: 'Sylvania Transfer Station',
    customer: 'Lucas County', status: 'closed',
    billedToDate: 1_050_000, costToComplete: -75_000, openChangeOrders: 0, openRfis: 0,
  };

  beforeEach(() => {
    hoisted.configured = true; hoisted.fail = null;
    hoisted.rows = [project, second];
  });

  it('leaves the tiles counting everything until one is pressed', async () => {
    renderPage(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('PRJ-2026-011')).toBeInTheDocument());
    expect(screen.getByText('PRJ-2026-012')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
  });

  it('shows only the active projects from the contract value tile', async () => {
    const user = userEvent.setup();
    renderPage(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('PRJ-2026-012')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'List the active projects' }));
    await waitFor(() => expect(screen.getByText('Active projects')).toBeInTheDocument());
    expect(screen.getByText('PRJ-2026-011')).toBeInTheDocument();
    expect(screen.queryByText('PRJ-2026-012')).not.toBeInTheDocument();
  });

  it('shows only what is committed past its budget, which is the point of the tile',
    async () => {
      const user = userEvent.setup();
      renderPage(<ProjectsPage />);
      await waitFor(() => expect(screen.getByText('PRJ-2026-011')).toBeInTheDocument());

      await user.click(screen.getByRole('button',
        { name: 'List the projects committed past their budget' }));
      await waitFor(() =>
        expect(screen.getByText('Projects committed past their budget')).toBeInTheDocument());
      expect(screen.getByText('PRJ-2026-012')).toBeInTheDocument();
      expect(screen.queryByText('PRJ-2026-011')).not.toBeInTheDocument();
    });

  it('shows what is left to bill, not what has been billed', async () => {
    // The second project is billed to its full contract value; the first is not.
    const user = userEvent.setup();
    renderPage(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('PRJ-2026-012')).toBeInTheDocument());

    await user.click(screen.getByRole('button',
      { name: 'List the projects with contract value left to bill' }));
    await waitFor(() => expect(
      screen.getByText('Projects with contract value left to bill')).toBeInTheDocument());
    expect(screen.getByText('PRJ-2026-011')).toBeInTheDocument();
    expect(screen.queryByText('PRJ-2026-012')).not.toBeInTheDocument();
  });

  it('shows the projects an open change order or RFI belongs to', async () => {
    const user = userEvent.setup();
    renderPage(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('PRJ-2026-012')).toBeInTheDocument());

    await user.click(screen.getByRole('button',
      { name: 'List the projects with an open change order or RFI' }));
    await waitFor(() => expect(
      screen.getByText('Projects with an open change order or RFI')).toBeInTheDocument());
    expect(screen.getByText('PRJ-2026-011')).toBeInTheDocument();
    expect(screen.queryByText('PRJ-2026-012')).not.toBeInTheDocument();
  });

  it('marks the pressed tile and puts everything back when it is pressed again', async () => {
    const user = userEvent.setup();
    renderPage(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('PRJ-2026-012')).toBeInTheDocument());

    const tile = screen.getByRole('button', { name: 'List the active projects' });
    expect(tile).toHaveAttribute('aria-pressed', 'false');
    await user.click(tile);
    await waitFor(() => expect(
      screen.getByRole('button', { name: 'List the active projects' }))
      .toHaveAttribute('aria-pressed', 'true'));

    await user.click(screen.getByRole('button', { name: 'List the active projects' }));
    await waitFor(() => expect(screen.getByText('PRJ-2026-012')).toBeInTheDocument());
  });

  it('offers a way back that says how many are being hidden', async () => {
    const user = userEvent.setup();
    renderPage(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('PRJ-2026-012')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'List the active projects' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Show all 2' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Show all 2' }));
    await waitFor(() => expect(screen.getByText('PRJ-2026-012')).toBeInTheDocument());
  });

  it('says the filter found nothing rather than showing an empty table', async () => {
    hoisted.rows = [{ ...project, openChangeOrders: 0, openRfis: 0 }];
    const user = userEvent.setup();
    renderPage(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('PRJ-2026-011')).toBeInTheDocument());

    await user.click(screen.getByRole('button',
      { name: 'List the projects with an open change order or RFI' }));
    await waitFor(() =>
      expect(screen.getByText('Nothing is open on any project')).toBeInTheDocument());
    expect(screen.getByText('None of the 1 project on this page match.')).toBeInTheDocument();
  });
});
