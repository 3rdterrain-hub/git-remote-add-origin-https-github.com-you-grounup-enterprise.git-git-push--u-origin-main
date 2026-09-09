/**
 * The blank line, and what happens when the library does not have it.
 *
 * An estimator types "Haul and place 8 inch aggregate base" because nothing
 * matched, wins the job, and types it again next month spelled differently. The
 * library has been read-only from inside the application since migration 0004,
 * so the one person who knew taught the platform nothing.
 *
 * Two properties matter more than the rest. The offer to save appears only once
 * the library has actually answered with nothing — while a search is running,
 * or after two letters, it would be an accusation that something is missing
 * that nobody has looked for. And when the library write is refused, the *line*
 * still exists: losing both would be the worst outcome of asking for one.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LibraryService } from '@/lib/data/estimates';

const hoisted = vi.hoisted(() => ({
  configured: true,
  services: [] as LibraryService[],
  slow: false,
  added: [] as Array<Record<string, unknown>>,
  savedToLibrary: [] as Array<Record<string, unknown>>,
  saveResult: { id: 's-1', code: 'C-0001', name: 'x', status: 'active' },
  saveError: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/estimates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/estimates')>(
    '@/lib/data/estimates');
  return {
    ...actual,
    searchServices: () => async () => {
      if (hoisted.slow) await new Promise((r) => setTimeout(r, 10_000));
      return hoisted.services;
    },
    addLine: async (_c: unknown, input: Record<string, unknown>) => {
      hoisted.added.push(input);
      return 'line-1';
    },
    insertLineAfter: async (_c: unknown, input: Record<string, unknown>) => {
      hoisted.added.push(input);
      return 'line-2';
    },
    saveLineToLibrary: async (_c: unknown, input: Record<string, unknown>) => {
      if (hoisted.saveError) throw new Error(hoisted.saveError);
      hoisted.savedToLibrary.push(input);
      return hoisted.saveResult;
    },
  };
});

const { NewLineRow } = await import('./new-line-row');

const show = (afterLineId: string | null = null) => {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  // No table wrapper any more: a line is a card, and the blank row that adds
  // one is a card too.
  render(
    <NewLineRow versionId="v-1" afterLineId={afterLineId}
      onDone={onDone} onCancel={onCancel} />,
  );
  return { onDone, onCancel };
};

const service = (over: Partial<LibraryService> = {}): LibraryService => ({
  id: 's-9', code: 'SVC-0006', name: 'Mass excavation', category: 'Earthwork',
  defaultUnit: 'CY', supportedUnits: ['CY'], isOwn: false, ...over,
});

const OFFER = /Nothing in the library matches/;

beforeEach(() => {
  hoisted.configured = true;
  hoisted.services = [];
  hoisted.slow = false;
  hoisted.added = [];
  hoisted.savedToLibrary = [];
  hoisted.saveResult = { id: 's-1', code: 'C-0001', name: 'x', status: 'active' };
  hoisted.saveError = null;
});

// ---------------------------------------------------------------------------
describe('when the offer to save appears', () => {
  it('is not there before anything is typed', async () => {
    show();
    expect(screen.queryByText(OFFER)).not.toBeInTheDocument();
  });

  it('is not there after two letters, which is not a search yet', async () => {
    show();
    await userEvent.type(screen.getByLabelText('What is this line?'), 'ha');
    expect(screen.queryByText(OFFER)).not.toBeInTheDocument();
  });

  it('is not there while the library is still being asked', async () => {
    /*
     * The distinction that matters: "the library has nothing" and "the library
     * has not answered" look identical on screen and are different claims.
     */
    hoisted.slow = true;
    show();
    await userEvent.type(screen.getByLabelText('What is this line?'), 'aggregate base');
    expect(screen.queryByText(OFFER)).not.toBeInTheDocument();
  });

  it('is not there when the library did match something', async () => {
    hoisted.services = [service()];
    show();
    await userEvent.type(screen.getByLabelText('What is this line?'), 'mass exc');
    await screen.findByRole('listbox');
    expect(screen.queryByText(OFFER)).not.toBeInTheDocument();
  });

  it('appears once the library has answered with nothing', async () => {
    show();
    await userEvent.type(screen.getByLabelText('What is this line?'), 'aggregate base');
    expect(await screen.findByText(OFFER)).toBeInTheDocument();
  });

  it('goes away again once a library match is picked', async () => {
    hoisted.services = [service()];
    show();
    await userEvent.type(screen.getByLabelText('What is this line?'), 'mass');
    await userEvent.click(await screen.findByRole('option', { name: /Mass excavation/ }));
    expect(screen.queryByText(OFFER)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('saving it', () => {
  it('adds the line without saving when the box is not ticked', async () => {
    const { onDone } = show();
    await userEvent.type(screen.getByLabelText('What is this line?'), 'aggregate base');
    await screen.findByText(OFFER);
    await userEvent.click(screen.getByLabelText('Add this line'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(hoisted.added).toHaveLength(1);
    expect(hoisted.savedToLibrary).toEqual([]);
  });

  it('saves the line it just created, not the words on screen', async () => {
    /*
     * The library entry is made from the line, so the service carries the same
     * unit and cost code the estimator settled on rather than a second reading
     * of what they typed.
     */
    const { onDone } = show();
    await userEvent.type(screen.getByLabelText('What is this line?'), 'aggregate base');
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByLabelText('Add this line'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(hoisted.savedToLibrary).toEqual([{ lineId: 'line-1' }]);
  });

  it('saves against the inserted line when adding under another', async () => {
    const { onDone } = show('after-me');
    await userEvent.type(screen.getByLabelText('What is this line?'), 'aggregate base');
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByLabelText('Add this line'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(hoisted.savedToLibrary).toEqual([{ lineId: 'line-2' }]);
  });
});

// ---------------------------------------------------------------------------
describe('when the library refuses', () => {
  it('keeps the line, and says the library is what failed', async () => {
    /*
     * The line is what the estimator asked for. Losing it because a library
     * write was refused would be the worst possible reading of "also save
     * this".
     */
    hoisted.saveError = 'Saving to the library needs the libraries.write permission.';
    const { onDone } = show();
    await userEvent.type(screen.getByLabelText('What is this line?'), 'aggregate base');
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByLabelText('Add this line'));

    expect(await screen.findByText(/The line was added\./)).toBeInTheDocument();
    expect(screen.getByText(/needs the libraries.write permission/)).toBeInTheDocument();
    expect(hoisted.added).toHaveLength(1);
    expect(onDone).not.toHaveBeenCalled();
  });
});
