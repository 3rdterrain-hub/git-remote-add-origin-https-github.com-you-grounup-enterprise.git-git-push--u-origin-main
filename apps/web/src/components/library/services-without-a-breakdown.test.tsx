/**
 * Services nobody can price yet, and the door that was missing.
 *
 * `my_services_without_a_breakdown` was written for the 465 services that
 * arrived from the product master naming work sequences the task library did
 * not contain. It had no reader. When one was written the panel had nothing to
 * offer either: `customize_assembly` copies a template that exists, and the
 * whole problem is that none does.
 *
 * Migration 0141 is the door. The block was never the assembly — everything
 * that prices a line resolves through `services.default_assembly_id`, and a
 * catalog service row is one no tenant may write — so it takes the company its
 * own copy of the service first and attaches an empty sequence to that.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hoisted = vi.hoisted(() => ({
  configured: true,
  rows: [] as unknown[],
  fail: null as string | null,
  started: [] as Array<{ service: string; company: string }>,
  startFails: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/assemblies', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/assemblies')>(
    '@/lib/data/assemblies');
  return {
    ...actual,
    loadServicesWithoutABreakdown: async () => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      return hoisted.rows;
    },
    startABreakdown: async (service: string, company: string) => {
      if (hoisted.startFails) throw new Error(hoisted.startFails);
      hoisted.started.push({ service, company });
      return 'asm-new';
    },
  };
});

const { ServicesWithoutABreakdown } = await import('./services-without-a-breakdown');

const gap = (over: Record<string, unknown> = {}) => ({
  id: 's-1', code: 'SVC-33-41-00-014', name: 'Sheet pile wall, temporary',
  industry: 'Heavy civil', category: null, defaultUnit: 'SF',
  hasNoAssembly: true, steps: 0, ...over,
});

describe('a library with nothing wrong with it', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.rows = []; hoisted.fail = null;
    hoisted.started = []; hoisted.startFails = null;
  });

  it('shows nothing at all when every service can be built up', async () => {
    /*
     * A panel reading "0 services need a breakdown" on every healthy library is
     * one people learn to skip, and then skip on the day an import puts four
     * hundred rows in it.
     */
    const { container } = render(<ServicesWithoutABreakdown companyId="co-1" canEdit />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows a read failure rather than pretending the library is clean', async () => {
    hoisted.fail = 'permission denied for view my_services_without_a_breakdown';
    render(<ServicesWithoutABreakdown companyId="co-1" canEdit />);
    await waitFor(() =>
      expect(screen.getByText(/permission denied/)).toBeInTheDocument());
  });
});

describe('a library with services nobody can price', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.fail = null;
    hoisted.started = []; hoisted.startFails = null;
    hoisted.rows = [
      gap(),
      gap({ id: 's-2', code: 'SVC-31-23-16-002', name: 'Dewatering wellpoints',
        hasNoAssembly: false, steps: 0, defaultUnit: 'LF' }),
    ];
  });

  it('counts them and tells the two problems apart', async () => {
    // No sequence at all is a different fix from a sequence with no steps in
    // it, and telling them apart is the difference between a list and a task.
    render(<ServicesWithoutABreakdown companyId="co-1" canEdit />);
    await waitFor(() =>
      expect(screen.getByText('2 services nobody can price yet')).toBeInTheDocument());
    expect(screen.getByText('No work sequence')).toBeInTheDocument();
    expect(screen.getByText('Sequence has no steps')).toBeInTheDocument();
    expect(screen.getByText(/1 of these name no work sequence at all/)).toBeInTheDocument();
  });

  it('says a line can still be bid without one', async () => {
    // True, and the alternative — implying the estimate is blocked — would send
    // somebody hunting for a fault instead of typing the rate they already have.
    render(<ServicesWithoutABreakdown companyId="co-1" canEdit />);
    await waitFor(() =>
      expect(screen.getByText(/type a unit cost on the line and say where/))
        .toBeInTheDocument());
  });

  it('starts a breakdown against the caller\'s own company', async () => {
    const user = userEvent.setup();
    render(<ServicesWithoutABreakdown companyId="co-real" canEdit />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Build it up/ }))
      .toHaveLength(2));

    await user.click(screen.getAllByRole('button', { name: /Build it up/ })[0]!);
    await waitFor(() => expect(hoisted.started)
      .toEqual([{ service: 's-1', company: 'co-real' }]));
    expect(screen.getByText('Started — add its steps')).toBeInTheDocument();
  });

  it('hands the caller the sequence that now needs filling', async () => {
    const onStarted = vi.fn();
    const user = userEvent.setup();
    render(<ServicesWithoutABreakdown companyId="co-1" canEdit onStarted={onStarted} />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Build it up/ }).length)
      .toBeGreaterThan(0));
    await user.click(screen.getAllByRole('button', { name: /Build it up/ })[0]!);
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('asm-new'));
  });

  it('shows a refusal as a refusal', async () => {
    hoisted.startFails = 'Building up a service needs the libraries.write permission.';
    const user = userEvent.setup();
    render(<ServicesWithoutABreakdown companyId="co-1" canEdit />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Build it up/ }).length)
      .toBeGreaterThan(0));
    await user.click(screen.getAllByRole('button', { name: /Build it up/ })[0]!);
    await waitFor(() =>
      expect(screen.getByText(/needs the libraries.write permission/)).toBeInTheDocument());
  });

  it('offers no button to somebody who may not write the library, and says why', async () => {
    render(<ServicesWithoutABreakdown companyId="co-1" canEdit={false} />);
    await waitFor(() =>
      expect(screen.getByText('2 services nobody can price yet')).toBeInTheDocument());
    for (const b of screen.getAllByRole('button', { name: /Build it up/ })) {
      expect(b).toBeDisabled();
    }
    expect(screen.getByText(/the catalog service is left exactly as it is/))
      .toBeInTheDocument();
  });

  it('cannot start one without a company to start it against', async () => {
    render(<ServicesWithoutABreakdown companyId={null} canEdit />);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Build it up/ })[0]!).toBeDisabled());
  });
});
