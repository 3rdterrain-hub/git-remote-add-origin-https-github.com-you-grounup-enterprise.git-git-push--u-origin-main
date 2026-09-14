/**
 * Naming a sheet, at the sheet.
 *
 * Every field behind this form has been on `document_sheets` since migration
 * 0005 and nothing ever wrote one, so a fourteen-sheet civil set read "p.1"
 * through "p.14" and the estimator had to remember which page was the site
 * plan.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlanSheet, SheetIdentity as Identity } from '@/lib/data/sheets';
import { SheetIdentity } from './sheet-identity';

const hoisted = vi.hoisted(() => ({
  calls: [] as Array<{ sheet: string; identity: Identity }>,
  failWith: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));

vi.mock('@/lib/data/sheets', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/sheets')>('@/lib/data/sheets');
  return {
    ...actual,
    identifySheet: async (_c: unknown, sheet: string, identity: Identity) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.calls.push({ sheet, identity });
    },
  };
});

const sheet = (over: Partial<PlanSheet> = {}): PlanSheet => ({
  id: 'sh-1',
  companyId: 'co-1',
  documentId: 'doc-1',
  documentName: 'AutoZone 5436 — civil set',
  documentVersionId: 'dv-1',
  storageBucket: 'project-documents',
  storagePath: 'co-1/autozone.pdf',
  pageNumber: 5,
  sheetNumber: null,
  sheetTitle: null,
  discipline: null,
  drawingScale: null,
  revision: null,
  revisionDate: null,
  label: 'p.5',
  unnamed: true,
  measurementCount: 0,
  calibrationCount: 0,
  ...over,
});

const onSaved = vi.fn();

beforeEach(() => {
  hoisted.calls = [];
  hoisted.failWith = null;
  onSaved.mockClear();
});

describe('naming a sheet', () => {
  it('opens itself on a sheet nobody has named', () => {
    render(<SheetIdentity sheet={sheet()} onSaved={onSaved} />);
    expect(screen.getByLabelText('Sheet number')).toBeInTheDocument();
    expect(screen.getByText(/Page 5 of AutoZone 5436 — civil set/)).toBeInTheDocument();
  });

  it('stays out of the way on a sheet that has one', () => {
    render(<SheetIdentity onSaved={onSaved} sheet={sheet({
      sheetNumber: 'C1.0', sheetTitle: 'Site Plan', discipline: 'Civil',
      drawingScale: '1" = 20\'', revision: '2',
      label: 'C1.0 — Site Plan', unnamed: false,
    })} />);
    expect(screen.queryByLabelText('Sheet number')).not.toBeInTheDocument();
    expect(screen.getByText('C1.0 — Site Plan')).toBeInTheDocument();
    expect(screen.getByText('Civil')).toBeInTheDocument();
    expect(screen.getByText('rev 2')).toBeInTheDocument();
  });

  it('sends what was typed, and says it saved', async () => {
    const user = userEvent.setup();
    render(<SheetIdentity sheet={sheet()} onSaved={onSaved} />);
    await user.type(screen.getByLabelText('Sheet number'), 'C1.0');
    await user.type(screen.getByLabelText('Sheet title'), 'Overall Site Plan');
    await user.type(screen.getByLabelText('Scale printed on the sheet'), '1" = 20\'');
    await user.type(screen.getByLabelText('Revision'), '2');
    await user.click(screen.getByRole('button', { name: 'Save sheet name' }));

    await waitFor(() => expect(hoisted.calls).toHaveLength(1));
    expect(hoisted.calls[0]!.sheet).toBe('sh-1');
    expect(hoisted.calls[0]!.identity).toMatchObject({
      sheetNumber: 'C1.0', sheetTitle: 'Overall Site Plan',
      drawingScale: '1" = 20\'', revision: '2',
    });
    expect(onSaved).toHaveBeenCalled();
    expect(await screen.findByText('saved')).toBeInTheDocument();
  });

  it('says what the scale on the title block is for, because it is not for measuring', () => {
    render(<SheetIdentity sheet={sheet()} onSaved={onSaved} />);
    expect(screen.getByText(/It is not used to measure/)).toBeInTheDocument();
  });

  it('takes a discipline nobody listed', async () => {
    /*
     * The column is free text on purpose: a set that arrives with a discipline
     * nobody thought of still has to be nameable. A sheet already carrying one
     * opens with it in the box rather than silently dropping to the twelve
     * offered.
     */
    const user = userEvent.setup();
    render(<SheetIdentity onSaved={onSaved} sheet={sheet({ discipline: 'Geotechnical' })} />);
    const other = screen.getByRole('textbox', { name: 'Discipline' });
    expect(other).toHaveValue('Geotechnical');

    await user.type(screen.getByLabelText('Sheet number'), 'G1');
    await user.click(screen.getByRole('button', { name: 'Save sheet name' }));
    await waitFor(() => expect(hoisted.calls).toHaveLength(1));
    expect(hoisted.calls[0]!.identity.discipline).toBe('Geotechnical');
  });

  it('keeps the form open and says why when it will not save', async () => {
    hoisted.failWith = 'You do not have permission to change this document';
    const user = userEvent.setup();
    render(<SheetIdentity sheet={sheet()} onSaved={onSaved} />);
    await user.type(screen.getByLabelText('Sheet number'), 'C1.0');
    await user.click(screen.getByRole('button', { name: 'Save sheet name' }));

    expect(await screen.findByText('You do not have permission to change this document'))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Sheet number')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('reloads when the picker moves to another sheet', async () => {
    const { rerender } = render(<SheetIdentity onSaved={onSaved} sheet={sheet({
      sheetNumber: 'C1.0', sheetTitle: 'Site Plan', label: 'C1.0 — Site Plan', unnamed: false,
    })} />);
    expect(screen.getByText('C1.0 — Site Plan')).toBeInTheDocument();

    rerender(<SheetIdentity onSaved={onSaved} sheet={sheet({ id: 'sh-2', pageNumber: 6 })} />);
    await waitFor(() =>
      expect(screen.getByLabelText('Sheet number')).toHaveValue(''));
  });
});
