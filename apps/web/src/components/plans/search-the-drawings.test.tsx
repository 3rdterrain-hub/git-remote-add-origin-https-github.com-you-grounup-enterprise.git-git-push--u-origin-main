/**
 * Searching what the drawings say.
 *
 * `document_sheets.extracted_text` carried a trigram index and a comment saying
 * it was for search; migration 0036 wrote `app.search_document_text` to fulfill
 * that, observing "nothing queried it" — and then nothing queried the fix, for
 * eleven migrations, because it had no `public.` wrapper.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hoisted = vi.hoisted(() => ({
  hits: [] as unknown[],
  asked: [] as string[],
  fails: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/plans', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/plans')>('@/lib/data/plans');
  return {
    ...actual,
    searchSheetText: async (q: string) => {
      if (hoisted.fails) throw new Error(hoisted.fails);
      hoisted.asked.push(q);
      return hoisted.hits;
    },
  };
});

const { SearchTheDrawings } = await import('./search-the-drawings');

const hit = (over: Record<string, unknown> = {}) => ({
  documentId: 'd-1', documentName: 'Civil set', versionNumber: 1, pageNumber: 4,
  sheetNumber: 'C-210',
  snippet: '…Provide cathodic protection at all ductile iron fittings…',
  rank: 0.4, ...over,
});

describe('searching inside the drawings', () => {
  beforeEach(() => { hoisted.hits = []; hoisted.asked = []; hoisted.fails = null; });

  it('says what it is for, beside the search that does the other thing', () => {
    render(<SearchTheDrawings />);
    expect(screen.getByText(/matches a sheet by its number and its title/)).toBeInTheDocument();
    expect(screen.getByText(/reads what the sheets actually say/)).toBeInTheDocument();
  });

  it('shows nothing until something is asked', () => {
    render(<SearchTheDrawings />);
    expect(screen.getByText(/Type at least two characters/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('will not search on a single character', async () => {
    render(<SearchTheDrawings />);
    await userEvent.type(screen.getByLabelText('Search the text of every sheet'), 'c');
    expect(screen.getByRole('button', { name: 'Search the drawings' })).toBeDisabled();
  });

  it('searches on submit rather than on every keystroke', async () => {
    /*
     * A trigram scan across every sheet of every plan set is not a
     * keystroke-cost operation, and a dropdown firing one per letter is how a
     * search feature becomes the slowest thing on a page.
     */
    hoisted.hits = [hit()];
    render(<SearchTheDrawings />);
    await userEvent.type(screen.getByLabelText('Search the text of every sheet'), 'cathodic');
    expect(hoisted.asked).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Search the drawings' }));
    await waitFor(() => expect(hoisted.asked).toEqual(['cathodic']));
  });

  it('shows the sheet, the page and why it matched', async () => {
    hoisted.hits = [hit()];
    render(<SearchTheDrawings />);
    await userEvent.type(screen.getByLabelText('Search the text of every sheet'), 'cathodic');
    await userEvent.click(screen.getByRole('button', { name: 'Search the drawings' }));
    expect(await screen.findByText('C-210')).toBeInTheDocument();
    expect(screen.getByText('Civil set')).toBeInTheDocument();
    expect(screen.getByText(/rev 1 · page 4/)).toBeInTheDocument();
    // The snippet is the answer, not a link to go and find it.
    expect(screen.getByText(/Provide cathodic protection/)).toBeInTheDocument();
  });

  it('falls back to the page number where a sheet has no number', async () => {
    hoisted.hits = [hit({ sheetNumber: null })];
    render(<SearchTheDrawings />);
    await userEvent.type(screen.getByLabelText('Search the text of every sheet'), 'cathodic');
    await userEvent.click(screen.getByRole('button', { name: 'Search the drawings' }));
    expect(await screen.findByText('p. 4')).toBeInTheDocument();
  });

  it('says nothing matched, and why a sheet might not be searchable yet', async () => {
    render(<SearchTheDrawings />);
    await userEvent.type(screen.getByLabelText('Search the text of every sheet'), 'dewatering');
    await userEvent.click(screen.getByRole('button', { name: 'Search the drawings' }));
    expect(await screen.findByText(/Nothing in the drawings says/)).toBeInTheDocument();
    expect(screen.getByText(/still in the ingestion pipeline has none yet/)).toBeInTheDocument();
  });

  it('shows the refusal rather than an empty result that looks like no match', async () => {
    hoisted.fails = 'permission denied for function search_document_text';
    render(<SearchTheDrawings />);
    await userEvent.type(screen.getByLabelText('Search the text of every sheet'), 'cathodic');
    await userEvent.click(screen.getByRole('button', { name: 'Search the drawings' }));
    expect(await screen.findByText(/permission denied/)).toBeInTheDocument();
  });
});
