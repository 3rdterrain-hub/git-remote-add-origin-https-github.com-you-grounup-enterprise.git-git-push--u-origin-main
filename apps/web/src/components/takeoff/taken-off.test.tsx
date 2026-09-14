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
import type { CalibrationRow, MeasurementRow } from '@/lib/data/takeoff';
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

/*
 * One foot per point, so the traced rectangle below is 40 ft by 31 ft and the
 * quantity is arithmetic a reader can check: 1,240 SF.
 */
const calibration = (over: Partial<CalibrationRow> = {}): CalibrationRow => ({
  id: 'c-1', sheetId: 's-1',
  from: { x: 0, y: 0 }, to: { x: 100, y: 0 },
  knownDistanceFeet: 100, basis: 'known_dimension',
  reference: '100\' property line', measurementMethod: 'scaled_from_dimension',
  ...over,
} as CalibrationRow);

const RECTANGLE = [
  { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 31 }, { x: 0, y: 31 },
];

const measurement = (over: Partial<MeasurementRow> = {}): MeasurementRow => ({
  id: 'm-1', sheetId: 's-1', calibrationId: 'c-1',
  name: 'Slab, north bay', trade: null, kind: 'area', unit: 'SF',
  geometry: RECTANGLE, deductions: [], isClosed: true,
  pitchRise: null, pitchRun: null, depthFeet: null, widthFeet: null,
  countPer: 1, multiplier: 1, lifts: [], freeboardFeet: null,
  appliedLineItemId: null, appliedQuantity: null, appliedAt: null,
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

const panel = (ms: MeasurementRow[], editable = true, cs: CalibrationRow[] = [calibration()]) =>
  render(<TakenOff measurements={ms} calibrations={cs} lines={lines}
    editable={editable} onChanged={onChanged} />);

describe('measurements kept on a sheet', () => {
  it('says nothing at all when none have been taken', () => {
    const { container } = panel([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('names each one and what it measured, before it is on any line', () => {
    /*
     * This column read "not applied" on every kept shape, which is the one
     * thing a takeoff list must never say about something already traced.
     */
    panel([measurement()]);
    expect(screen.getByText('Slab, north bay')).toBeInTheDocument();
    expect(screen.getByText('area')).toBeInTheDocument();
    expect(screen.getByText('1,240.00 SF')).toBeInTheDocument();
  });

  it('measures the shape rather than sending the repeat count', async () => {
    /*
     * The defect this replaced: `appliedQuantity ?? multiplier * countPer`,
     * and nothing writes `applied_quantity` until a measurement is applied —
     * so every apply from this panel sent 1. A traced 1,240 SF pad went onto
     * the estimate as one square foot, and the estimate did not complain.
     */
    panel([measurement()]);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Line for Slab, north bay' }), 'l-1');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(hoisted.applied).toHaveLength(1));
    expect(hoisted.applied[0]!.quantity).toBeCloseTo(1240, 6);
  });

  it('subtracts the openings that were banked with it', async () => {
    panel([measurement({ deductions: [[
      { x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 },
    ]] })]);
    expect(screen.getByText('1,140.00 SF')).toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Line for Slab, north bay' }), 'l-1');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(hoisted.applied).toHaveLength(1));
    expect(hoisted.applied[0]!.quantity).toBeCloseTo(1140, 6);
  });

  it('says so rather than guessing when the calibration behind it is gone', async () => {
    // A length with no scale is a number of pixels.
    panel([measurement()], true, []);
    expect(screen.getByText('no scale')).toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Line for Slab, north bay' }), 'l-1');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText(/cannot be put on a line/)).toBeInTheDocument();
    expect(hoisted.applied).toEqual([]);
  });

  it('needs no calibration to count markers', () => {
    panel([measurement({
      kind: 'count', unit: 'EA', isClosed: false, countPer: 3, multiplier: 2,
    })], true, []);
    // Four markers, three fixtures each, on two identical elevations.
    expect(screen.getByText('24.00 EA')).toBeInTheDocument();
  });

  it('says when the line disagrees with what the shape now measures', () => {
    /*
     * A shape retraced after it was applied. The line still carries the old
     * number, and the difference is the whole reason to look.
     */
    panel([measurement({ appliedQuantity: 900, appliedAt: '2026-09-08T10:00:00Z' })]);
    expect(screen.getByText('1,240.00 SF')).toBeInTheDocument();
    expect(screen.getByText('line has 900.00')).toBeInTheDocument();
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
    expect(hoisted.applied[0]).toMatchObject({ measurementId: 'm-1', lineItemId: 'l-1' });
    expect(hoisted.applied[0]!.quantity).toBeCloseTo(1240, 6);
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
