/**
 * The door onto the starter library.
 *
 * Built without one first. The door inventory caught it — "1 with no reader" —
 * which is the check that exists because a working feature nothing can reach is
 * the defect this build produces most, and I had just produced it again while
 * writing about producing it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hoisted = vi.hoisted(() => ({
  result: { crews: 7, machines: 9, assemblies: 59, components: 133, rates: 47 },
  fail: null as string | null,
  calls: [] as Array<string | null | undefined>,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/library', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/library')>('@/lib/data/library');
  return {
    ...actual,
    installStarterLibrary: async (id?: string | null) => {
      hoisted.calls.push(id);
      if (hoisted.fail) throw new Error(hoisted.fail);
      return hoisted.result;
    },
  };
});

const { StarterLibrary } = await import('./starter-library');

describe('the starter library', () => {
  beforeEach(() => { hoisted.fail = null; hoisted.calls = []; });

  it('says what the shipped catalog is missing, which is why this exists', () => {
    render(<StarterLibrary companyId="c-1" />);
    expect(screen.getByText(/no assembly with a resource in it/)).toBeInTheDocument();
  });

  it('installs against the company it was given', async () => {
    const user = userEvent.setup();
    render(<StarterLibrary companyId="c-1" />);
    await user.click(screen.getByRole('button', { name: /install the starter library/i }));
    await waitFor(() => expect(hoisted.calls).toEqual(['c-1']));
  });

  it('reports what landed, in the terms somebody asked the question in', async () => {
    const user = userEvent.setup();
    render(<StarterLibrary companyId="c-1" />);
    await user.click(screen.getByRole('button', { name: /install the starter library/i }));
    expect(await screen.findByText(/59 assemblies with 133 resource components/))
      .toBeInTheDocument();
    expect(screen.getByText(/the wrench will tell you what it takes/)).toBeInTheDocument();
  });

  it('tells the page to re-read its counts', async () => {
    const user = userEvent.setup();
    const onInstalled = vi.fn();
    render(<StarterLibrary companyId="c-1" onInstalled={onInstalled} />);
    await user.click(screen.getByRole('button', { name: /install the starter library/i }));
    await waitFor(() => expect(onInstalled).toHaveBeenCalled());
  });

  it('shows the refusal rather than swallowing it', async () => {
    hoisted.fail = 'You do not have permission to change the library';
    const user = userEvent.setup();
    render(<StarterLibrary companyId="c-1" />);
    await user.click(screen.getByRole('button', { name: /install the starter library/i }));
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });

  it('says running it again doubles nothing', async () => {
    const user = userEvent.setup();
    render(<StarterLibrary companyId="c-1" />);
    await user.click(screen.getByRole('button', { name: /install the starter library/i }));
    expect(await screen.findByText(/nothing doubles/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /install again/i })).toBeInTheDocument();
  });
});
