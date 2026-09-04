/**
 * Putting a measured quantity onto an estimate line.
 *
 * The step that makes measuring worth anything, and the one with the most ways
 * to be quietly wrong. Two things it must never do: write a number without
 * saying where it came from, and let the estimator choose how the platform
 * describes the way it was measured — that comes from the calibration, and it
 * decides the line's confidence and whether the estimate may be issued.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApplyPanel } from './apply-panel';
import type { LineOption } from '@/lib/data/takeoff';

const lines: LineOption[] = [
  { id: 'l-1', description: 'Storm main', estimateNumber: 'EST-2026-0184',
    versionNumber: 3, unit: 'LF', measuredQuantity: 0 },
];

const onApply = vi.fn();

function panel(over: Partial<React.ComponentProps<typeof ApplyPanel>> = {}) {
  return render(<ApplyPanel
    quantity={160} unit="LF" measurementMethod="verified_scale"
    lines={lines} linesLoading={false} busy={false}
    onApply={onApply} applied={null} error={null} {...over} />);
}

describe('applying a measurement', () => {
  beforeEach(() => { onApply.mockClear(); });

  it('states what will be written before it writes it', () => {
    panel();
    expect(screen.getByText(/160.00 LF/)).toBeInTheDocument();
    expect(screen.getByText('verified scale')).toBeInTheDocument();
  });

  it('says the measurement method is not the estimator’s to choose', () => {
    /*
     * Said in the place the choice would otherwise appear to be, because an
     * estimator who learns here that recalibrating properly changes the answer
     * will go and recalibrate.
     */
    panel();
    expect(screen.getByText(/comes from the scale, not from this form/)).toBeInTheDocument();
    expect(screen.getByText(/whether the estimate can be issued/)).toBeInTheDocument();
  });

  it('will not apply without a name and a line', async () => {
    // An unnamed measurement on a bid is a number nobody can trace back.
    panel();
    expect(screen.getByRole('button', { name: /Save and apply/ })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Name this measurement'), 'Storm main');
    expect(screen.getByRole('button', { name: /Save and apply/ })).toBeDisabled();
  });

  it('applies with the name, trade and line it was given', async () => {
    /*
     * The line is preselected here rather than chosen through the dropdown.
     * The listbox opens into a portal jsdom gives no pointer geometry to, so
     * driving it is not possible in this environment — and a test that reached
     * past the form to call the handler directly would assert nothing about the
     * form. Stated rather than hidden: **choosing a line from the dropdown is
     * not covered by an automated test**, and was checked by hand.
     */
    panel({ defaultLineItemId: 'l-1' });
    await userEvent.type(screen.getByLabelText('Name this measurement'), 'Storm main — C-301');
    await userEvent.type(screen.getByLabelText('Trade (optional)'), 'Utilities');
    await userEvent.click(screen.getByRole('button', { name: /Save and apply/ }));
    expect(onApply).toHaveBeenCalledWith({
      name: 'Storm main — C-301', trade: 'Utilities', lineItemId: 'l-1',
    });
  });

  it('trims whitespace off the name rather than storing it', async () => {
    // A measurement named "  " passes a length check and is unfindable.
    panel({ defaultLineItemId: 'l-1' });
    await userEvent.type(screen.getByLabelText('Name this measurement'), '  Storm main  ');
    await userEvent.click(screen.getByRole('button', { name: /Save and apply/ }));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Storm main' }));
  });

  it('stays disabled when the name is only whitespace', async () => {
    panel({ defaultLineItemId: 'l-1' });
    await userEvent.type(screen.getByLabelText('Name this measurement'), '   ');
    expect(screen.getByRole('button', { name: /Save and apply/ })).toBeDisabled();
  });

  it('explains an empty line list rather than showing nothing', () => {
    /*
     * An issued version is frozen by RULE-009, so it cannot take a quantity.
     * Saying so is more use than an empty dropdown.
     */
    panel({ lines: [] });
    expect(screen.getByText(/An issued version is frozen/)).toBeInTheDocument();
  });

  it('shows a refusal rather than pretending it applied', async () => {
    panel({ error: 'That measurement has no scale, so there is nothing to say about how it was measured' });
    expect(screen.getByText(/nothing to say about how it was measured/)).toBeInTheDocument();
  });

  it('confirms what landed, and warns that retracing will unsettle it', () => {
    panel({ applied: { name: 'Storm main', quantity: 160, unit: 'LF' } });
    expect(screen.getByText('Storm main applied')).toBeInTheDocument();
    expect(screen.getByText(/no longer matches the drawing/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save and apply/ })).not.toBeInTheDocument();
  });

  it('carries an approximate scale through to the estimator plainly', () => {
    panel({ measurementMethod: 'approximate_scale' });
    expect(screen.getByText('approximate scale')).toBeInTheDocument();
  });
});
