/**
 * The plan sets you cannot take off yet.
 *
 * Nothing in the platform ever created a `document_sheets` row, so uploading a
 * plan set filed the document and stopped — and the takeoff screen told
 * somebody who had just uploaded a drawing that there were "no sheets uploaded
 * yet". Everything from now on gets its sheets on upload. This is the way back
 * for everything already in storage, which would otherwise never appear
 * anywhere and never say why.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UnsheetedPlanSet } from '@/lib/data/takeoff';
import { UnsheetedPlanSets } from './unsheeted-plan-sets';

const hoisted = vi.hoisted(() => ({
  calls: [] as Array<{ version: string; pages: number }>,
  made: 0,
  failWith: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));

vi.mock('@/lib/data/takeoff', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/takeoff')>('@/lib/data/takeoff');
  return {
    ...actual,
    setDocumentPageCount: async (_c: unknown, version: string, pages: number) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.calls.push({ version, pages });
      return hoisted.made;
    },
  };
});

const plan = (over: Partial<UnsheetedPlanSet> = {}): UnsheetedPlanSet => ({
  documentVersionId: 'dv-1',
  documentName: 'Kingsway — civil set',
  fileName: 'kingsway-civil.pdf',
  documentType: 'plan_set',
  pageCount: null,
  createdAt: '2026-09-01T10:00:00Z',
  ...over,
});

const onSheeted = vi.fn();

beforeEach(() => {
  hoisted.calls = [];
  hoisted.made = 24;
  hoisted.failWith = null;
  onSheeted.mockClear();
});

const panel = (plans: UnsheetedPlanSet[]) =>
  render(<UnsheetedPlanSets plans={plans} onSheeted={onSheeted} />);

describe('plan sets with no sheets', () => {
  it('says nothing at all when every plan set has its sheets', () => {
    const { container } = panel([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('names them, and counts them in words that match', () => {
    panel([plan()]);
    expect(screen.getByText('One uploaded plan set has no sheets yet')).toBeInTheDocument();
    expect(screen.getByText('Kingsway — civil set')).toBeInTheDocument();
    expect(screen.getByText('kingsway-civil.pdf')).toBeInTheDocument();
  });

  it('counts more than one correctly', () => {
    panel([plan(), plan({ documentVersionId: 'dv-2', documentName: 'Structural' })]);
    expect(screen.getByText('2 uploaded plan sets have no sheets yet')).toBeInTheDocument();
  });

  it('sends the page count that was typed', async () => {
    panel([plan()]);
    await userEvent.type(screen.getByLabelText('Pages in Kingsway — civil set'), '24');
    await userEvent.click(screen.getByRole('button', { name: 'Make sheets' }));
    await waitFor(() => expect(hoisted.calls).toEqual([{ version: 'dv-1', pages: 24 }]));
  });

  it('takes Enter as well as the button, because the count is one field', async () => {
    panel([plan()]);
    await userEvent.type(
      screen.getByLabelText('Pages in Kingsway — civil set'), '12{Enter}');
    await waitFor(() => expect(hoisted.calls).toEqual([{ version: 'dv-1', pages: 12 }]));
  });

  it('says how many sheets it made, and where to go next', async () => {
    hoisted.made = 24;
    panel([plan()]);
    await userEvent.type(screen.getByLabelText('Pages in Kingsway — civil set'), '24');
    await userEvent.click(screen.getByRole('button', { name: 'Make sheets' }));
    expect(await screen.findByText(/24 sheets made for Kingsway — civil set/))
      .toBeInTheDocument();
  });

  it('says so rather than claiming success when they already existed', async () => {
    hoisted.made = 0;
    panel([plan()]);
    await userEvent.type(screen.getByLabelText('Pages in Kingsway — civil set'), '24');
    await userEvent.click(screen.getByRole('button', { name: 'Make sheets' }));
    expect(await screen.findByText(/already had its sheets/)).toBeInTheDocument();
  });

  it('re-reads the sheet list once there is something in it', async () => {
    panel([plan()]);
    await userEvent.type(screen.getByLabelText('Pages in Kingsway — civil set'), '24');
    await userEvent.click(screen.getByRole('button', { name: 'Make sheets' }));
    await waitFor(() => expect(onSheeted).toHaveBeenCalledTimes(1));
  });

  it('refuses a count that is not a whole number of pages', async () => {
    panel([plan()]);
    await userEvent.type(screen.getByLabelText('Pages in Kingsway — civil set'), '2.5');
    await userEvent.click(screen.getByRole('button', { name: 'Make sheets' }));
    expect(screen.getByText(/A whole number, one or more/)).toBeInTheDocument();
    expect(hoisted.calls).toEqual([]);
  });

  it('refuses an empty count rather than sending zero', async () => {
    panel([plan()]);
    await userEvent.click(screen.getByRole('button', { name: 'Make sheets' }));
    expect(screen.getByText(/A whole number, one or more/)).toBeInTheDocument();
    expect(hoisted.calls).toEqual([]);
  });

  it('shows what the database refused rather than a generic failure', async () => {
    hoisted.failWith = 'Making the sheets of a plan set needs the documents.write permission.';
    panel([plan()]);
    await userEvent.type(screen.getByLabelText('Pages in Kingsway — civil set'), '24');
    await userEvent.click(screen.getByRole('button', { name: 'Make sheets' }));
    expect(await screen.findByText(
      'Making the sheets of a plan set needs the documents.write permission.'))
      .toBeInTheDocument();
  });

  it('keeps each row its own, so two plan sets do not share a count', async () => {
    panel([plan(), plan({ documentVersionId: 'dv-2', documentName: 'Structural' })]);
    await userEvent.type(screen.getByLabelText('Pages in Kingsway — civil set'), '24');
    expect(screen.getByLabelText('Pages in Structural')).toHaveValue('');
  });
});
