/**
 * What you are measuring, picked before you trace.
 *
 * Every takeoff product estimators use puts this panel ahead of the drawing
 * tools, and not from habit: the thing owns the color that keeps forty
 * overlapping traces legible, and the depth that turns a traced polygon into
 * cubic yards. Ask for either afterwards and you ask once per shape.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UNITS_FOR_STYLE, type ConditionRow, type NewCondition } from '@/lib/data/conditions';
import { ConditionList } from './condition-list';

const hoisted = vi.hoisted(() => ({
  rows: [] as ConditionRow[],
  created: [] as NewCondition[],
  failWith: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/conditions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/conditions')>(
    '@/lib/data/conditions');
  return {
    ...actual,
    loadConditions: () => async () => hoisted.rows,
    createCondition: async (_c: unknown, input: NewCondition) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.created.push(input);
      return 'c-new';
    },
  };
});

const cond = (over: Partial<ConditionRow> = {}): ConditionRow => ({
  id: 'c-1', companyId: 'co-1', estimateVersionId: 'ev-1', lineItemId: 'l-1',
  name: '6 inch concrete sidewalk', style: 'area', unit: 'SF', color: '#7C3AED',
  depthFeet: null, widthFeet: null, countPer: 1, multiplier: 1,
  serviceId: null, costCodeId: null, trade: null, notes: null, sortOrder: 0,
  inLibrary: false, traced: 0, quantity: 0, sheets: 0, totalPrice: null,
  ...over,
});

const onSelect = vi.fn();
const onHighlight = vi.fn();

const panel = (editable = true) => render(
  <ConditionList versionId="ev-1" selectedId={null}
    onSelect={onSelect} onHighlight={onHighlight} editable={editable} />);

beforeEach(() => {
  hoisted.rows = [];
  hoisted.created = [];
  hoisted.failWith = null;
  onSelect.mockClear();
  onHighlight.mockClear();
});

describe('the list of things being measured', () => {
  it('says what to do when nothing is set up yet', async () => {
    panel();
    expect(await screen.findByText('Nothing set up to measure yet')).toBeInTheDocument();
  });

  it('shows each one with its own color', async () => {
    hoisted.rows = [
      cond(),
      cond({ id: 'c-2', name: 'Curb and gutter', style: 'linear', unit: 'LF',
        color: '#059669' }),
    ];
    panel();
    await screen.findByText('6 inch concrete sidewalk');
    expect(screen.getByText('Curb and gutter')).toBeInTheDocument();
    /* Two swatches, two colors — the thing that keeps a busy sheet readable. */
    const swatches = document.querySelectorAll('span[style*="background-color"]');
    expect(swatches).toHaveLength(2);
  });

  it('says plainly when something has nothing traced for it', async () => {
    /*
     * A condition with no shapes is something somebody meant to measure and
     * did not, and the cheap moment to notice is before the bid goes out.
     */
    hoisted.rows = [cond({ traced: 0 })];
    panel();
    expect(await screen.findByText('nothing traced')).toBeInTheDocument();
  });

  it('shows the running quantity and how many tracings made it', async () => {
    hoisted.rows = [cond({ traced: 12, quantity: 1200 })];
    panel();
    expect(await screen.findByText(/1,200\.00 SF/)).toBeInTheDocument();
    expect(screen.getByText('(12)')).toBeInTheDocument();
  });

  it('picks one to trace against, and lets go of it again', async () => {
    hoisted.rows = [cond()];
    const user = userEvent.setup();
    const { rerender } = render(<ConditionList versionId="ev-1" selectedId={null}
      onSelect={onSelect} onHighlight={onHighlight} editable />);

    const row = await screen.findByRole('button', { name: /6 inch concrete sidewalk/ });
    expect(row).toHaveAttribute('aria-pressed', 'false');
    await user.click(row);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-1' }));

    /* Chosen now, so clicking it again puts the tool down. */
    onSelect.mockClear();
    rerender(<ConditionList versionId="ev-1" selectedId="c-1"
      onSelect={onSelect} onHighlight={onHighlight} editable />);
    const chosen = screen.getByRole('button', { name: /6 inch concrete sidewalk/ });
    expect(chosen).toHaveAttribute('aria-pressed', 'true');
    await user.click(chosen);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('lights up one thing\'s tracings when it is pointed at', async () => {
    /* On-Screen Takeoff's "Select Objects": the list is the index into the drawing. */
    hoisted.rows = [cond()];
    const user = userEvent.setup();
    panel();
    await user.hover(await screen.findByRole('button', { name: /6 inch concrete sidewalk/ }));
    expect(onHighlight).toHaveBeenCalledWith('c-1');
    await user.unhover(screen.getByRole('button', { name: /6 inch concrete sidewalk/ }));
    expect(onHighlight).toHaveBeenLastCalledWith(null);
  });

  it('offers only the units that suit how it is measured', async () => {
    const user = userEvent.setup();
    panel();
    await user.click(await screen.findByRole('button', { name: /Add something to measure/ }));
    /* An area cannot be reported in cubic yards. */
    expect(screen.getByLabelText('Reported in')).toHaveTextContent('SF');
  });

  it('does not ask for a depth on something measured flat', async () => {
    /*
     * The interactive half of this rule — switching the style to Volume and
     * seeing the depth appear — cannot be driven here: Radix's select wants
     * pointer-capture APIs jsdom does not implement, and a test that fights the
     * environment tests the environment. The mapping it depends on is asserted
     * below, and the database refuses a depth on a style that cannot carry one
     * (`takeoff_conditions_depth_suits_style`, migration 0178).
     */
    const user = userEvent.setup();
    panel();
    await user.click(await screen.findByRole('button', { name: /Add something to measure/ }));
    expect(screen.queryByLabelText('Depth in feet')).not.toBeInTheDocument();
  });

  it('offers each style only the units that can report it', () => {
    expect(UNITS_FOR_STYLE.area).toEqual(['SF', 'SY', 'ACRE']);
    expect(UNITS_FOR_STYLE.volume).toEqual(['CY']);
    expect(UNITS_FOR_STYLE.count).toEqual(['EA']);
    expect(UNITS_FOR_STYLE.linear).toEqual(['LF']);
    /* A pond is bid by what comes out of it, what lines it, or what it holds. */
    expect(UNITS_FOR_STYLE.basin).toContain('GAL');
    /* No style reports in a unit that does not measure its dimension. */
    expect(UNITS_FOR_STYLE.area).not.toContain('CY');
    expect(UNITS_FOR_STYLE.linear).not.toContain('SF');
  });


  it('will not add one without a name, because the name is what you pick it by', async () => {
    const user = userEvent.setup();
    panel();
    await user.click(await screen.findByRole('button', { name: /Add something to measure/ }));
    expect(screen.getByRole('button', { name: 'Add it' })).toBeDisabled();
  });

  it('adds one', async () => {
    const user = userEvent.setup();
    panel();
    await user.click(await screen.findByRole('button', { name: /Add something to measure/ }));
    await user.type(screen.getByLabelText('What is it'), '6 inch concrete sidewalk');
    await user.click(screen.getByRole('button', { name: 'Add it' }));
    await waitFor(() => expect(hoisted.created).toHaveLength(1));
    expect(hoisted.created[0]).toMatchObject({
      versionId: 'ev-1', name: '6 inch concrete sidewalk', style: 'area', unit: 'SF',
    });
  });

  it('says what the database refused', async () => {
    hoisted.failWith = 'A condition needs a name — it is what you will pick it by';
    const user = userEvent.setup();
    panel();
    await user.click(await screen.findByRole('button', { name: /Add something to measure/ }));
    await user.type(screen.getByLabelText('What is it'), 'x');
    await user.click(screen.getByRole('button', { name: 'Add it' }));
    expect(await screen.findByText(/A condition needs a name/)).toBeInTheDocument();
  });

  it('shows the list to somebody who may only read, without the add', async () => {
    hoisted.rows = [cond()];
    panel(false);
    expect(await screen.findByText('6 inch concrete sidewalk')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add something to measure/ }))
      .not.toBeInTheDocument();
  });
});
