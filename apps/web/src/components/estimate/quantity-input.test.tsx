/**
 * The quantity cell that does the arithmetic.
 *
 * The property worth holding: a refusal is never a number. An expression that
 * cannot be read has to leave the field alone and say what is wrong — a cell
 * that silently took the readable half of `120 * 4 +` would put a wrong
 * quantity on a bid that looked entirely deliberate.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuantityInput } from './quantity-input';

const cell = (over: Partial<Parameters<typeof QuantityInput>[0]> = {}) => {
  const onCommit = vi.fn();
  render(<QuantityInput quantity={0} expression={null} unit="CY"
    label="Quantity for this line" onCommit={onCommit} {...over} />);
  return { onCommit, field: screen.getByLabelText('Quantity for this line') };
};

describe('working out a quantity in the cell', () => {
  it('takes a plain number, and does not call it a calculation', async () => {
    const { onCommit, field } = cell();
    await userEvent.clear(field);
    await userEvent.type(field, '1800');
    await userEvent.tab();
    expect(onCommit).toHaveBeenCalledWith(1800, null);
  });

  it('works out an expression and keeps what was typed', async () => {
    const { onCommit, field } = cell();
    await userEvent.clear(field);
    await userEvent.type(field, '120 * 4 * 0.667');
    await userEvent.tab();
    expect(onCommit).toHaveBeenCalledWith(320.16, '120 * 4 * 0.667');
  });

  it('shows the answer while it is being typed', async () => {
    const { field } = cell();
    await userEvent.clear(field);
    await userEvent.type(field, '3,180 - 240');
    expect(screen.getByText('= 2,940.00 CY')).toBeInTheDocument();
  });

  it('commits on Enter as well as on leaving the cell', async () => {
    const { onCommit, field } = cell();
    await userEvent.clear(field);
    await userEvent.type(field, '42 * 1.2{Enter}');
    expect(onCommit).toHaveBeenCalledWith(50.4, '42 * 1.2');
  });

  it('says nothing and writes nothing when the number has not changed', async () => {
    const { onCommit, field } = cell({ quantity: 1800 });
    await userEvent.click(field);
    await userEvent.tab();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('refusing rather than guessing', () => {
  it('writes nothing when the expression cannot be read', async () => {
    const { onCommit, field } = cell();
    await userEvent.clear(field);
    await userEvent.type(field, '120 * 4 +');
    await userEvent.tab();
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(/stops before it is finished/i)).toBeInTheDocument();
  });

  it('keeps what was typed, because losing it would be worse than showing it wrong', async () => {
    const { field } = cell();
    await userEvent.clear(field);
    await userEvent.type(field, '(120 * 4');
    await userEvent.tab();
    expect(field).toHaveValue('(120 * 4');
    expect(screen.getByText(/never closed/i)).toBeInTheDocument();
  });

  it('refuses a negative quantity, which is not a thing to build', async () => {
    const { onCommit, field } = cell();
    await userEvent.clear(field);
    await userEvent.type(field, '240 - 300');
    await userEvent.tab();
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(/cannot be negative/i)).toBeInTheDocument();
  });

  it('puts back the last good value on Escape', async () => {
    const { field } = cell({ quantity: 1800 });
    await userEvent.clear(field);
    await userEvent.type(field, 'rubbish{Escape}');
    expect(field).toHaveValue('1800');
  });
});

describe('showing the working', () => {
  it('shows the calculation a quantity came from', () => {
    cell({ quantity: 320.16, expression: '120 * 4 * 0.667' });
    expect(screen.getByLabelText('Quantity for this line')).toHaveValue('120 * 4 * 0.667');
    expect(screen.getByText('= 320.16 CY')).toBeInTheDocument();
  });

  it('shows a plain number as itself, with nothing to explain', () => {
    cell({ quantity: 1800, expression: null });
    expect(screen.getByLabelText('Quantity for this line')).toHaveValue('1800');
    expect(screen.queryByText(/^=/)).not.toBeInTheDocument();
  });

  it('is read-only on a version that is frozen', () => {
    const { field } = cell({ quantity: 1800, disabled: true });
    expect(field).toBeDisabled();
  });
});
