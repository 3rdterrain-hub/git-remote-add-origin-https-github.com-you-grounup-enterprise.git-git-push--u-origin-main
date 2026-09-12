/**
 * The conditions on a line, opened by clicking the factor.
 *
 * `estimate_line_modifiers` has existed since migration 0006 and the engine has
 * always read it, but the only writers were the template and revision copiers —
 * so the COND. column rendered `1.0x` as gray text that could never be anything
 * else, on a column whose whole purpose is to be changed. The user pointed at it
 * directly: "condition should be selectable by clicking the 1.0x".
 *
 * What these hold down is the three things the control has to get right, each
 * stated from the failing side: the button opens, the justification is required
 * *before* the refusal rather than after it, the factors shown are the ones
 * recorded rather than whatever the library holds today, and the panel does not
 * claim to have moved a price the engine has not recomputed.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LineCondition } from '@/lib/data/estimates';
import type { ConditionModifierRow } from '@/lib/data/library';

const hoisted = vi.hoisted(() => ({
  configured: true,
  applied: [] as LineCondition[],
  library: [] as ConditionModifierRow[],
  addedWith: [] as Array<[string, string, string]>,
  removedWith: [] as Array<[string, string]>,
  fail: null as string | null,
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
    loadLineConditions: () => async () => hoisted.applied,
    applyLineCondition: async (_c: unknown, line: string, mod: string, why: string) => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      hoisted.addedWith.push([line, mod, why]);
    },
    removeLineCondition: async (_c: unknown, line: string, mod: string) => {
      hoisted.removedWith.push([line, mod]);
    },
  };
});

vi.mock('@/lib/data/library', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/library')>('@/lib/data/library');
  return { ...actual, loadConditionModifiers: async () => hoisted.library };
});

const { ConditionCell, asChange } = await import('./condition-cell');

const modifier = (over: Partial<ConditionModifierRow> = {}): ConditionModifierRow => ({
  id: 'mod-1', code: 'CM-ROCK', name: 'Rock in the trench', category: 'Subsurface',
  factors: { labor_cost: 1.35, production: 0.7 },
  applicationRule: 'multiply', scope: 'global' as ConditionModifierRow['scope'],
  editable: false, ...over,
});
const onLine = (over: Partial<LineCondition> = {}): LineCondition => ({
  modifierId: 'mod-1', code: 'CM-ROCK', name: 'Rock in the trench', category: 'Subsurface',
  applicationRule: 'multiply',
  appliedFactors: { labor_cost: 1.35, production: 0.7 },
  justification: 'Limestone ledge at 9 ft, not shown on the borings', ...over,
});

beforeEach(() => {
  hoisted.configured = true;
  hoisted.applied = [];
  hoisted.library = [modifier(), modifier({ id: 'mod-2', code: 'CM-WATER', name: 'Work over water' })];
  hoisted.addedWith = []; hoisted.removedWith = []; hoisted.fail = null;
});

const cell = (over: Partial<Parameters<typeof ConditionCell>[0]> = {}) =>
  render(<ConditionCell lineId="line-1" description="Trench excavation"
    productionModifier={1} editable onChanged={() => {}} {...over} />);

describe('reading a factor as a change', () => {
  it('says what the number does rather than what it is', () => {
    expect(asChange(1.35)).toBe('+35%');
    expect(asChange(0.7)).toBe('−30%');
    expect(asChange(1)).toBe('no change');
  });

  it('keeps a decimal only where there is one', () => {
    expect(asChange(1.155)).toBe('+15.5%');
    expect(asChange(1.15)).toBe('+15%');
  });
});

describe('the cell itself', () => {
  it('is a button, not text — which is the whole defect it fixes', async () => {
    cell();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Add a condition to Trench excavation/i })).toBeTruthy());
  });

  it('says how many conditions are on the line once there are some', async () => {
    hoisted.applied = [onLine()];
    cell();
    await waitFor(() => expect(screen.getByText('1 cond.')).toBeTruthy());
    expect(screen.getByRole('button', { name: /1 condition on Trench excavation/i })).toBeTruthy();
  });

  it('shows the engine own modifier when nothing has been applied by hand', async () => {
    cell({ productionModifier: 0.85 });
    await waitFor(() => expect(screen.getByText('0.85x')).toBeTruthy());
  });
});

describe('applying one', () => {
  it('will not apply until the reason is long enough to be a reason', async () => {
    /*
     * The table refuses a justification under ten characters. Asking here means
     * it is typed once rather than after a refusal — but the rule is the
     * database's, and the button has to agree with it rather than guess.
     */
    const user = userEvent.setup();
    cell();
    await user.click(await screen.findByRole('button', { name: /Add a condition/i }));
    await user.click(await screen.findByText('Rock in the trench'));

    const apply = screen.getByRole('button', { name: /Apply the condition/i });
    expect(apply.hasAttribute('disabled')).toBe(true);

    await user.type(screen.getByLabelText(/Why Rock in the trench applies here/i), 'too short');
    expect(screen.getByRole('button', { name: /Apply the condition/i }).hasAttribute('disabled')).toBe(true);

    await user.type(screen.getByLabelText(/Why Rock in the trench applies here/i), ' but now it is not');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Apply the condition/i }).hasAttribute('disabled')).toBe(false));
  });

  it('records the line, the condition and the reason', async () => {
    const user = userEvent.setup();
    cell();
    await user.click(await screen.findByRole('button', { name: /Add a condition/i }));
    await user.click(await screen.findByText('Work over water'));
    await user.type(screen.getByLabelText(/Why Work over water applies here/i),
      'Creek crossing, pumps running all shift');
    await user.click(screen.getByRole('button', { name: /Apply the condition/i }));

    await waitFor(() => expect(hoisted.addedWith).toHaveLength(1));
    expect(hoisted.addedWith[0]).toEqual([
      'line-1', 'mod-2', 'Creek crossing, pumps running all shift',
    ]);
  });

  it('shows the refusal rather than pretending it worked', async () => {
    const user = userEvent.setup();
    hoisted.fail = 'A condition needs a reason of at least ten characters';
    cell();
    await user.click(await screen.findByRole('button', { name: /Add a condition/i }));
    await user.click(await screen.findByText('Rock in the trench'));
    await user.type(screen.getByLabelText(/Why Rock in the trench applies here/i),
      'Ledge at nine feet');
    await user.click(screen.getByRole('button', { name: /Apply the condition/i }));
    await waitFor(() => expect(screen.getByText(/at least ten characters/)).toBeTruthy());
  });

  it('does not offer a condition the line already carries', async () => {
    const user = userEvent.setup();
    hoisted.applied = [onLine()];
    cell();
    await user.click(await screen.findByRole('button', { name: /1 condition on/i }));
    await waitFor(() => expect(screen.getByText('Work over water')).toBeTruthy());
    // `Rock in the trench` appears once — on the line, not in the list to add.
    expect(screen.getAllByText('Rock in the trench')).toHaveLength(1);
  });
});

describe('what the panel shows about an applied condition', () => {
  it('shows the factors as recorded, per cost bucket', async () => {
    const user = userEvent.setup();
    hoisted.applied = [onLine({ appliedFactors: { labor_cost: 1.2, disposal_cost: 1.5 } })];
    cell();
    await user.click(await screen.findByRole('button', { name: /1 condition on/i }));
    await waitFor(() => expect(screen.getByText('+20%')).toBeTruthy());
    expect(screen.getByText('+50%')).toBeTruthy();
  });

  it('shows the reason somebody gave', async () => {
    const user = userEvent.setup();
    hoisted.applied = [onLine()];
    cell();
    await user.click(await screen.findByRole('button', { name: /1 condition on/i }));
    await waitFor(() =>
      expect(screen.getByText(/Limestone ledge at 9 ft/)).toBeTruthy());
  });

  it('says the price has not moved, because the engine is the only thing that writes one', async () => {
    const user = userEvent.setup();
    cell();
    await user.click(await screen.findByRole('button', { name: /Add a condition/i }));
    await waitFor(() =>
      expect(screen.getByText(/Nothing here has moved the price yet/)).toBeTruthy());
  });

  it('removes one', async () => {
    const user = userEvent.setup();
    hoisted.applied = [onLine()];
    cell();
    await user.click(await screen.findByRole('button', { name: /1 condition on/i }));
    await user.click(await screen.findByRole('button', { name: 'Remove Rock in the trench' }));
    await waitFor(() => expect(hoisted.removedWith).toEqual([['line-1', 'mod-1']]));
  });
});

describe('on a version that is frozen', () => {
  it('still opens, and says why nothing can be changed', async () => {
    const user = userEvent.setup();
    hoisted.applied = [onLine()];
    cell({ editable: false });
    await user.click(await screen.findByRole('button', { name: /1 condition on/i }));
    await waitFor(() =>
      expect(screen.getByText(/Create a revision to change what conditions apply/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Apply the condition/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Rock in the trench' })).toBeNull();
  });
});
