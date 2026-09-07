/**
 * The words on a line, which are not read-only.
 *
 * They were, from the day the workspace was built: an estimator could change a
 * line's quantity, unit, crew, rate and markup and could not fix a typo in what
 * it said.
 *
 * The property worth holding is that one gesture does two things without
 * confusing them. Typing and pressing Enter changes the words and keeps the
 * library link — describing this job is not renaming a service. Picking a match
 * changes what the line *is*, and the screen says which of the unit, cost code
 * and production rate actually moved, because a swap that silently changes a
 * unit is one somebody discovers in a total.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LibraryService, RepointResult } from '@/lib/data/estimates';

const hoisted = vi.hoisted(() => ({
  services: [] as LibraryService[],
  words: [] as Array<{ lineId: string; fields: Record<string, unknown> }>,
  repointed: [] as Array<{ lineId: string; serviceId: string | null }>,
  result: { service: 'Storm sewer installation', changed: ['link', 'unit', 'cost_code'] } as RepointResult,
  failWith: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));

vi.mock('@/lib/data/estimates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/estimates')>(
    '@/lib/data/estimates');
  return {
    ...actual,
    searchServices: () => async () => hoisted.services,
    updateLine: async (_c: unknown, lineId: string, fields: Record<string, unknown>) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.words.push({ lineId, fields });
    },
    setLineService: async (_c: unknown, lineId: string, serviceId: string | null) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.repointed.push({ lineId, serviceId });
      return serviceId === null
        ? { service: null, changed: ['link'] } as RepointResult
        : hoisted.result;
    },
  };
});

const { LineDescription } = await import('./line-description');

const service = (over: Partial<LibraryService> = {}): LibraryService => ({
  id: 's-1', code: 'SVC-0050', name: 'Storm sewer installation', category: 'Utilities',
  defaultUnit: 'LF', supportedUnits: ['LF'], isOwn: false, ...over,
});

const show = (over: Partial<React.ComponentProps<typeof LineDescription>> = {}) => {
  const onChanged = vi.fn();
  render(<LineDescription lineId="l-1" description="Mass excavation"
    serviceName="Mass excavation" serviceId="s-old" editable onChanged={onChanged} {...over} />);
  return { onChanged };
};

const openCell = async () =>
  userEvent.click(await screen.findByRole('button', { name: /Change what line/ }));

beforeEach(() => {
  hoisted.services = [];
  hoisted.words = [];
  hoisted.repointed = [];
  hoisted.result = { service: 'Storm sewer installation', changed: ['link', 'unit', 'cost_code'] };
  hoisted.failWith = null;
});

// ---------------------------------------------------------------------------
describe('the words are not read-only', () => {
  it('opens for typing when the words are clicked', async () => {
    show();
    await openCell();
    expect(screen.getByLabelText('What this line says')).toHaveValue('Mass excavation');
  });

  it('changes the words and keeps the library link', async () => {
    /*
     * "Mass excavation — north half" is describing this job, not renaming the
     * service. Nothing is repointed.
     */
    show();
    await openCell();
    const field = screen.getByLabelText('What this line says');
    await userEvent.clear(field);
    await userEvent.type(field, 'Mass excavation — north half{Enter}');
    await waitFor(() => expect(hoisted.words).toEqual([
      { lineId: 'l-1', fields: { description: 'Mass excavation — north half' } },
    ]));
    expect(hoisted.repointed).toEqual([]);
  });

  it('writes nothing when the words did not change', async () => {
    show();
    await openCell();
    await userEvent.keyboard('{Enter}');
    expect(hoisted.words).toEqual([]);
  });

  it('writes nothing when the words are emptied', async () => {
    // A line with no description is a row nobody can read.
    show();
    await openCell();
    await userEvent.clear(screen.getByLabelText('What this line says'));
    await userEvent.keyboard('{Enter}');
    expect(hoisted.words).toEqual([]);
  });

  it('leaves it as it was on Escape', async () => {
    show();
    await openCell();
    await userEvent.type(screen.getByLabelText('What this line says'), ' more{Escape}');
    expect(hoisted.words).toEqual([]);
    expect(await screen.findByRole('button', { name: /Change what line/ })).toBeInTheDocument();
  });

  it('shows plain text, and no control, to somebody who cannot edit', () => {
    show({ editable: false });
    expect(screen.getByText('Mass excavation')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Change what line/ })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('typing searches the library', () => {
  it('suggests nothing until the words actually change', async () => {
    /*
     * Opening a cell to fix a comma should not offer to replace the line with
     * something else.
     */
    hoisted.services = [service()];
    show();
    await openCell();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('suggests matches once they do', async () => {
    hoisted.services = [service()];
    show();
    await openCell();
    await userEvent.clear(screen.getByLabelText('What this line says'));
    await userEvent.type(screen.getByLabelText('What this line says'), 'storm');
    expect(await screen.findByRole('option', { name: /Storm sewer installation/ }))
      .toBeInTheDocument();
  });

  it('repoints the line when a match is picked', async () => {
    hoisted.services = [service()];
    show();
    await openCell();
    await userEvent.clear(screen.getByLabelText('What this line says'));
    await userEvent.type(screen.getByLabelText('What this line says'), 'storm');
    await userEvent.click(await screen.findByRole('option', { name: /Storm sewer/ }));
    await waitFor(() => expect(hoisted.repointed).toEqual([{ lineId: 'l-1', serviceId: 's-1' }]));
  });

  it('says what came across with it', async () => {
    hoisted.services = [service()];
    show();
    await openCell();
    await userEvent.clear(screen.getByLabelText('What this line says'));
    await userEvent.type(screen.getByLabelText('What this line says'), 'storm');
    await userEvent.click(await screen.findByRole('option', { name: /Storm sewer/ }));
    expect(await screen.findByText(/with its unit, cost code/)).toBeInTheDocument();
  });

  it('says when the unit was held back because the line is already priced', async () => {
    /*
     * The refusal that matters. Somebody measured 100 CY; changing the unit
     * underneath them leaves the number and changes what it means.
     */
    hoisted.services = [service()];
    hoisted.result = { service: 'Storm sewer installation', unitHeld: true, changed: ['link'] };
    show();
    await openCell();
    await userEvent.clear(screen.getByLabelText('What this line says'));
    await userEvent.type(screen.getByLabelText('What this line says'), 'storm');
    await userEvent.click(await screen.findByRole('option', { name: /Storm sewer/ }));
    expect(await screen.findByText(/already priced/)).toBeInTheDocument();
  });

  it('marks the one it is already on rather than offering it as a change', async () => {
    hoisted.services = [service({ name: 'Mass excavation' })];
    show();
    await openCell();
    await userEvent.type(screen.getByLabelText('What this line says'), ' works');
    expect(await screen.findByText(/already this one/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('taking a line off the library', () => {
  it('is offered only when the line came from it', async () => {
    show();
    await openCell();
    expect(screen.getByRole('button', { name: /Take it off the library/ })).toBeInTheDocument();
  });

  it('is not offered on a line somebody typed', async () => {
    show({ serviceId: null, serviceName: null });
    await openCell();
    expect(screen.queryByRole('button', { name: /Take it off the library/ }))
      .not.toBeInTheDocument();
  });

  it('clears the link and says the words are yours', async () => {
    show();
    await openCell();
    await userEvent.click(screen.getByRole('button', { name: /Take it off the library/ }));
    await waitFor(() => expect(hoisted.repointed).toEqual([{ lineId: 'l-1', serviceId: null }]));
    expect(await screen.findByText(/words are yours now/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('when the database refuses', () => {
  it('shows the refusal rather than a generic failure', async () => {
    hoisted.failWith = 'This version is issued; make a new version to change it';
    show();
    await openCell();
    await userEvent.type(screen.getByLabelText('What this line says'), ' edited{Enter}');
    expect(await screen.findByRole('alert'))
      .toHaveTextContent('make a new version to change it');
  });

  it('leaves the cell open so the words are not lost', async () => {
    hoisted.failWith = 'nope';
    show();
    await openCell();
    await userEvent.type(screen.getByLabelText('What this line says'), ' edited{Enter}');
    await screen.findByRole('alert');
    expect(screen.getByLabelText('What this line says')).toHaveValue('Mass excavation edited');
  });
});
