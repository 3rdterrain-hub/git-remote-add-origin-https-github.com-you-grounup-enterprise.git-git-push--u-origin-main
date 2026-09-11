/**
 * Telling an estimate where the work is, after the fact.
 *
 * The new-estimate dialog asks for the site now, which covers a bid invitation
 * that arrived with an address on it. This is the other half, and it is the
 * half `set_estimate_site` was written for: the answer often arrives later and
 * changes. Without it an estimate created before anybody knew could never be
 * told — which is the state all three of the live estimates were in.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hoisted = vi.hoisted(() => ({
  saved: [] as Array<{ id: string; site: Record<string, unknown> }>,
  fails: null as string | null,
  reread: 0,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/estimates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/estimates')>('@/lib/data/estimates');
  return {
    ...actual,
    setEstimateSite: async (_c: unknown, id: string, site: Record<string, unknown>) => {
      if (hoisted.fails) throw new Error(hoisted.fails);
      hoisted.saved.push({ id, site });
    },
  };
});

const { WhereTheWorkIs } = await import('./where-the-work-is');

const show = (over: Partial<Parameters<typeof WhereTheWorkIs>[0]> = {}) =>
  render(<WhereTheWorkIs estimateId="e-1" address={null} city={null} state={null}
    editable onSaved={() => { hoisted.reread += 1; }} {...over} />);

/** The card is shut by default, so every test opens it first. */
const open = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /Where the work is/ }));
  return user;
};

describe('where the work is', () => {
  beforeEach(() => { hoisted.saved = []; hoisted.fails = null; hoisted.reread = 0; });

  it('reads "not stated" while shut, so it need not be opened to be checked', () => {
    show();
    expect(screen.getByText('not stated')).toBeInTheDocument();
  });

  it('shows the site it already has, while shut', () => {
    show({ address: '1400 Venice Rd', city: 'Sandusky', state: 'OH' });
    expect(screen.getByText('1400 Venice Rd, Sandusky, OH')).toBeInTheDocument();
  });

  it('says what the site is for, and that it prices nothing', async () => {
    show();
    expect(screen.getByText(/copies the site onto the project/)).toBeInTheDocument();
    expect(screen.getByText(/not used to price anything/)).toBeInTheDocument();
  });

  it('saves all three', async () => {
    show();
    const user = await open();
    await user.type(screen.getByLabelText('Site address'), '640 Tyler St');
    await user.type(screen.getByLabelText('City'), 'Fremont');
    await user.type(screen.getByLabelText('State'), 'OH');
    await user.click(screen.getByRole('button', { name: 'Save the site' }));
    await waitFor(() => expect(hoisted.saved).toEqual([
      { id: 'e-1', site: { address: '640 Tyler St', city: 'Fremont', state: 'OH' } },
    ]));
    // And tells the page to re-read, or the header keeps the old summary.
    await waitFor(() => expect(hoisted.reread).toBe(1));
  });

  it('will not save when nothing has changed', async () => {
    show({ address: '1400 Venice Rd', city: 'Sandusky', state: 'OH' });
    await open();
    expect(screen.getByRole('button', { name: 'Save the site' })).toBeDisabled();
  });

  it('lets all three be cleared, because none is better than a guess', async () => {
    show({ address: '1400 Venice Rd', city: 'Sandusky', state: 'OH' });
    const user = await open();
    await user.clear(screen.getByLabelText('Site address'));
    await user.clear(screen.getByLabelText('City'));
    await user.clear(screen.getByLabelText('State'));
    await user.click(screen.getByRole('button', { name: 'Save the site' }));
    await waitFor(() => expect(hoisted.saved[0]!.site)
      .toEqual({ address: '', city: '', state: '' }));
  });

  it('goes read-only once the estimate has gone out, and says why', async () => {
    /*
     * The database refuses it too. The card says the reason rather than
     * vanishing, because a field that disappears reads as a bug.
     */
    show({ editable: false, address: '1400 Venice Rd', city: 'Sandusky', state: 'OH' });
    await open();
    expect(screen.getByText(/where the work is was part of what went out/))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Site address')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save the site' })).not.toBeInTheDocument();
  });

  it('shows the database refusal rather than claiming it saved', async () => {
    hoisted.fails = 'This estimate is issued; where the work is was part of what went out';
    show();
    const user = await open();
    await user.type(screen.getByLabelText('City'), 'Fremont');
    await user.click(screen.getByRole('button', { name: 'Save the site' }));
    expect(await screen.findByText(/part of what went out/)).toBeInTheDocument();
  });

  it('holds the state field to two characters', async () => {
    show();
    await open();
    expect(screen.getByLabelText('State')).toHaveAttribute('maxlength', '2');
  });
});
