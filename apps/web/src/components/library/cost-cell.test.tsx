/**
 * Changing a cost.
 *
 * These are the numbers every estimate is built from, so what this control has
 * to communicate is not how to type a number — it is what changing one does.
 * Two facts, and the second is what makes the first safe: a change applies to
 * future estimates, and changes nothing already issued, because a library
 * snapshot copies the rows that priced an estimate at the moment it went out.
 *
 * Without the second, editing a rate would silently rewrite history and nobody
 * would dare touch it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/misc';
import { CostCell } from './cost-cell';

const onSave = vi.fn();
beforeEach(() => onSave.mockClear());

const cell = (over = {}) => render(
  <TooltipProvider>
    <CostCell value={48.5} editable label="Base wage" onSave={onSave} {...over} />
  </TooltipProvider>);

describe('editing a cost', () => {
  it('shows the current cost', () => {
    cell();
    expect(screen.getByText('$48.50')).toBeInTheDocument();
  });

  it('saves a new cost', async () => {
    cell();
    await userEvent.click(screen.getByRole('button', { name: 'Change Base wage' }));
    const input = screen.getByLabelText('Base wage');
    await userEvent.clear(input);
    await userEvent.type(input, '52.75');
    await userEvent.click(screen.getByRole('button', { name: 'Save Base wage' }));
    expect(onSave).toHaveBeenCalledWith(52.75, '');
  });

  it('saves on Enter, because that is what people press', async () => {
    cell();
    await userEvent.click(screen.getByRole('button', { name: 'Change Base wage' }));
    const input = screen.getByLabelText('Base wage');
    await userEvent.clear(input);
    await userEvent.type(input, '60{Enter}');
    expect(onSave).toHaveBeenCalledWith(60, '');
  });

  it('says what a change affects, at the moment of changing it', async () => {
    /*
     * The reassurance that makes this usable. An estimator who thinks editing a
     * rate might rewrite an issued bid will never edit one.
     */
    cell();
    await userEvent.click(screen.getByRole('button', { name: 'Change Base wage' }));
    expect(screen.getByText(/Applies to future estimates/)).toBeInTheDocument();
    expect(screen.getByText(/Issued ones keep the rate that priced them/)).toBeInTheDocument();
  });

  it('refuses a negative cost without calling out', async () => {
    cell();
    await userEvent.click(screen.getByRole('button', { name: 'Change Base wage' }));
    const input = screen.getByLabelText('Base wage');
    await userEvent.clear(input);
    await userEvent.type(input, '-5{Enter}');
    expect(screen.getByText('A cost must be zero or more')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('refuses text', async () => {
    cell();
    await userEvent.click(screen.getByRole('button', { name: 'Change Base wage' }));
    const input = screen.getByLabelText('Base wage');
    await userEvent.clear(input);
    await userEvent.type(input, 'about fifty{Enter}');
    expect(screen.getByText('A cost must be zero or more')).toBeInTheDocument();
  });

  it('abandons the edit on Escape', async () => {
    cell();
    await userEvent.click(screen.getByRole('button', { name: 'Change Base wage' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('$48.50')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('will not let a catalog rate be edited, and says why', async () => {
    /*
     * Row level security refuses it regardless. Saying so here means somebody
     * learns the rule rather than meeting a policy error.
     */
    cell({ editable: false });
    expect(screen.queryByRole('button', { name: 'Change Base wage' })).not.toBeInTheDocument();
    expect(screen.getByText('$48.50')).toBeInTheDocument();
  });

  it('shows where a rate came from when there is something to say', () => {
    cell({ hint: 'Tenant approved, from 2026-01-01' });
    expect(screen.getByText('Tenant approved, from 2026-01-01')).toBeInTheDocument();
  });
});

/**
 * A zero that nobody chose.
 *
 * The materials catalog ships 333 materials and prices five of them, because a
 * platform knows what a material is and has no business claiming to know what
 * it costs you. Rendering the other 328 as `$0.00` would be the exact silence
 * `cost_state` exists to break — a price of nothing looks like a price.
 */
describe('a cost nobody has set', () => {
  it('says so instead of showing zero dollars', () => {
    cell({ value: 0, unset: true });
    expect(screen.getByText('Set a cost')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('opens on an empty field rather than on a zero to delete', async () => {
    cell({ value: 0, unset: true });
    await userEvent.click(screen.getByRole('button', { name: 'Set Base wage' }));
    expect(screen.getByLabelText('Base wage')).toHaveValue('');
  });

  it('refuses an empty field rather than saving it as zero', async () => {
    cell({ value: 0, unset: true });
    await userEvent.click(screen.getByRole('button', { name: 'Set Base wage' }));
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('A cost must be zero or more')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('still says so when the row cannot be edited', () => {
    cell({ value: 0, unset: true, editable: false });
    expect(screen.getByText('Not costed')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });
});

/**
 * Saving does something other than change this row.
 *
 * A catalog material belongs to no company and every company reads it, so a
 * price typed onto one goes on a copy. That is worth saying at the moment the
 * number is typed, not discovered afterwards when the id changed.
 */
describe('when saving makes a copy', () => {
  it('says what saving will do, in place of the usual line', async () => {
    cell({ note: 'Saving makes your copy of this catalog material.' });
    await userEvent.click(screen.getByRole('button', { name: 'Change Base wage' }));
    expect(screen.getByText('Saving makes your copy of this catalog material.'))
      .toBeInTheDocument();
    expect(screen.queryByText(/Applies to future estimates/)).not.toBeInTheDocument();
  });

  it('keeps the usual line when there is nothing special to say', async () => {
    cell();
    await userEvent.click(screen.getByRole('button', { name: 'Change Base wage' }));
    expect(screen.getByText(/Applies to future estimates/)).toBeInTheDocument();
  });
});

/**
 * Where the price came from.
 *
 * `app.set_material_cost` refuses a price called estimated or quoted that does
 * not name a supplier, a quote, or how it was worked out — "a quote and a guess
 * are different claims and the estimate should be able to tell them apart".
 * Asking here means somebody types it once; not asking means they meet the
 * refusal after typing the number, which teaches them the field is hostile
 * rather than that provenance matters.
 */
describe('a price that has to say where it came from', () => {
  it('asks, when the caller says the database will', async () => {
    cell({ sourcePrompt: 'Where this price came from' });
    await userEvent.click(screen.getByRole('button', { name: 'Change Base wage' }));
    expect(screen.getByLabelText('Where this price came from')).toBeInTheDocument();
  });

  it('does not ask when nothing requires it', async () => {
    cell();
    await userEvent.click(screen.getByRole('button', { name: 'Change Base wage' }));
    expect(screen.queryByLabelText('Where this price came from')).not.toBeInTheDocument();
  });

  it('refuses to save a price with nothing behind it', async () => {
    cell({ sourcePrompt: 'Where this price came from' });
    await userEvent.click(screen.getByRole('button', { name: 'Change Base wage' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save Base wage' }));
    expect(screen.getByText('Say where this price came from')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('sends the number and the source together', async () => {
    cell({ sourcePrompt: 'Where this price came from' });
    await userEvent.click(screen.getByRole('button', { name: 'Change Base wage' }));
    await userEvent.type(
      screen.getByLabelText('Where this price came from'), 'Gerken quote GK-5520');
    const amount = screen.getByLabelText('Base wage');
    await userEvent.clear(amount);
    await userEvent.type(amount, '88{Enter}');
    expect(onSave).toHaveBeenCalledWith(88, 'Gerken quote GK-5520');
  });

  it('forgets the source between edits rather than reusing the last one', async () => {
    cell({ sourcePrompt: 'Where this price came from' });
    await userEvent.click(screen.getByRole('button', { name: 'Change Base wage' }));
    await userEvent.type(screen.getByLabelText('Where this price came from'), 'An invoice');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Change Base wage' }));
    expect(screen.getByLabelText('Where this price came from')).toHaveValue('');
  });
});
