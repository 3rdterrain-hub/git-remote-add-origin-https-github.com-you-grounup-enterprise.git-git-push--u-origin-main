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
    expect(onSave).toHaveBeenCalledWith(52.75);
  });

  it('saves on Enter, because that is what people press', async () => {
    cell();
    await userEvent.click(screen.getByRole('button', { name: 'Change Base wage' }));
    const input = screen.getByLabelText('Base wage');
    await userEvent.clear(input);
    await userEvent.type(input, '60{Enter}');
    expect(onSave).toHaveBeenCalledWith(60);
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
