/**
 * What has been taken off this sheet.
 *
 * Finishing a shape keeps it with no line on it, which is the order a takeoff is
 * actually done in — you measure what is in front of you and decide where it
 * goes afterwards. But until this list existed the second half never happened:
 * a kept measurement was drawn back on the sheet and could not be applied,
 * renamed or removed. A working feature with no door, and a new one rather than
 * an inherited one.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeasurementRow } from '@/lib/data/takeoff';
import { TakenOff } from './taken-off';

const hoisted = vi.hoisted(() => ({
  applied: [] as Array<Record<string, unknown>>,
  removed: [] as string[],
  failWith: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));

vi.mock('@/lib/data/takeoff', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/takeoff')>('@/lib/data/takeoff');
  return {
    ...actual,
    applySavedMeasurement: async (_c: unknown, input: Record<string, unknown>) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.applied.push(input);
    },
    deleteMeasurement: async (_c: unknown, id: string) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.removed.push(id);
    },
  };
});

const measurement = (over: Partial<MeasurementRow> = {}): MeasurementRow => ({
  id: 'm-1', sheetId: 's-1', calibrationId: 'c-1',
  name: 'Slab, north bay', trade: null, kind: 'area', unit: 'SF',
  geometry: [], deductions: [], isClosed: true,
  pitchRise: null, pitchRun: null, depthFeet: null, widthFeet: null,
  countPer: 1, multiplier: 1,
  appliedLineItemId: null, appliedQuantity: 1240, appliedAt: null,
  ...over,
} as MeasurementRow);

const lines = [
  { id: 'l-1', description: 'Slab on grade', unit: 'SF' },
  { id: 'l-2', description: 'Mass excavation', unit: 'CY' },
];

const onChanged = vi.fn();

beforeEach(() => {
  hoisted.applied = []; hoisted.removed = []; hoisted.failWith = null;
  onChanged.mockClear();
});

const panel = (ms: MeasurementRow[], editable = true) =>
  render(<TakenOff measurements={ms} lines={lines} editable={editable} onChanged={onChanged} />);

describe('measurements kept on a sheet', () => {
  it('says nothing at all when none have been taken', () => {
    const { container } = panel([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('names each one and what it measured', () => {
    panel([measurement()]);
    expect(screen.getByText('Slab, north bay')).toBeInTheDocument();
    expect(screen.getByText('area')).toBeInTheDocument();
    expect(screen.getByText('1,240.00 SF')).toBeInTheDocument();
  });

  it('offers the open estimate lines to put it on', () => {
    panel([measurement()]);
    const select = screen.getByRole('combobox', { name: 'Line for Slab, north bay' });
    expect(within(select).getByRole('option', { name: 'Slab on grade (SF)' }))
      .toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Mass excavation (CY)' }))
      .toBeInTheDocument();
  });

  it('puts it on the line that was chosen', async () => {
    panel([measurement()]);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Line for Slab, north bay' }), 'l-1');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(hoisted.applied).toHaveLength(1));
    expect(hoisted.applied[0]).toMatchObject({
      measurementId: 'm-1', lineItemId: 'l-1', quantity: 1240,
    });
  });

  it('refuses to apply before a line is chosen, rather than guessing one', async () => {
    panel([measurement()]);
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByText(/Choose the line this belongs on first/)).toBeInTheDocument();
    expect(hoisted.applied).toEqual([]);
  });

  it('re-reads the sheet once something has changed', async () => {
    panel([measurement()]);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Line for Slab, north bay' }), 'l-1');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('says when one is already on the estimate, and offers no second apply', () => {
    panel([measurement({ appliedLineItemId: 'l-1', appliedAt: '2026-09-08T10:00:00Z' })]);
    expect(screen.getByText('on the estimate')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
  });

  it('takes one off the sheet', async () => {
    // A mis-traced shape has to be removable or the sheet fills with attempts
    // and nobody can tell which one the estimate is standing on.
    panel([measurement()]);
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove Slab, north bay from this sheet' }));
    await waitFor(() => expect(hoisted.removed).toEqual(['m-1']));
  });

  it('shows what the database refused rather than a generic failure', async () => {
    hoisted.failWith = 'That estimate version is approved and frozen.';
    panel([measurement()]);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Line for Slab, north bay' }), 'l-1');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('That estimate version is approved and frozen.'))
      .toBeInTheDocument();
  });

  it('offers nothing to change on a version that cannot be edited', () => {
    panel([measurement()], false);
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    // But it still says what was measured.
    expect(screen.getByText('Slab, north bay')).toBeInTheDocument();
  });

  it('keeps each row its own, so two measurements do not share a chosen line', async () => {
    panel([measurement(), measurement({ id: 'm-2', name: 'Slab, south bay' })]);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Line for Slab, north bay' }), 'l-1');
    expect(screen.getByRole('combobox', { name: 'Line for Slab, south bay' }))
      .toHaveValue('');
  });
});
