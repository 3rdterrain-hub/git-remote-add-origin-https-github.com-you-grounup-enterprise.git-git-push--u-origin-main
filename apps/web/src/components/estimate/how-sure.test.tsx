/**
 * The control that answers "not confident enough to bid".
 *
 * The engine scores a line's confidence from four inputs, three of which are
 * attestations by the estimator. They are columns on the line, read by the
 * pricing function and handed to the engine — and no screen could set one.
 *
 * The consequence was not a cosmetic score: all three false on a hand-entered
 * quantity scores around 30, which routes to senior review, which blocks issue,
 * which blocks approval, which means a typed estimate could never be approved,
 * issued or awarded into a project. The screen said "1 line is not confident
 * enough to bid" and offered nothing that could answer it.
 *
 * What is tested is the joint: the control writes the column names the database
 * takes, it writes only the one that changed, and it says what ticking one
 * does — because a control that silently moves a bid from unbiddable to
 * biddable is one people tick without reading.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LineRow } from '@/lib/data/estimates';

/** The repository root, for reading the enum this list has to match. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');

const hoisted = vi.hoisted(() => ({
  writes: [] as Array<Record<string, unknown>>,
  fails: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/estimates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/estimates')>('@/lib/data/estimates');
  return {
    ...actual,
    updateLine: async (_c: unknown, _id: string, fields: Record<string, unknown>) => {
      if (hoisted.fails) throw new Error(hoisted.fails);
      hoisted.writes.push(fields);
    },
  };
});

const { HowSure, METHODS } = await import('./how-sure');

const line = (over: Partial<LineRow> = {}): LineRow => ({
  id: 'l-1', sortOrder: 10, lineNumber: null, description: 'Electrical duct bank installation',
  serviceId: null, serviceName: null, costCode: null, costCodeId: null, notes: null,
  unit: 'LF', measuredQuantity: 500, adjustedQuantity: 500,
  unitCost: 42.5, totalDirectCost: 21250, laborHours: 0, equipmentHours: 0,
  confidenceBand: 'low', blocksIssue: true, hasProductionRate: false,
  clientVisible: true, markupOverride: null, wastePercent: 0, quantityExpression: null,
  markupRate: 0.34, markupAmount: 7225, totalPrice: 28475, unitPrice: 56.95,
  parametricCostPerUnit: 42.5, parametricBasis: 'Quoted', productionModifier: 1,
  measurementMethod: 'explicit_dimension',
  checkPrimarySource: false, checkCrossSource: false, checkReconciliation: false,
  ...over,
});

const show = (over: Partial<LineRow> = {}, editable = true) =>
  render(<HowSure line={line(over)} editable={editable} onChanged={() => { hoisted.writes.push({ reread: true }); }} />);

describe('how sure are you of that quantity', () => {
  beforeEach(() => { hoisted.writes = []; hoisted.fails = null; });

  it('says what the checks do, so nobody ticks one without knowing', async () => {
    show();
    expect(screen.getByText(/routes to senior review and holds the whole estimate back/))
      .toBeInTheDocument();
    expect(screen.getByText(/Nothing here changes a cost/)).toBeInTheDocument();
  });

  it('writes the column name the database takes, not a camel-cased one', async () => {
    /*
     * `checkPrimarySource` would match nothing in `update_estimate_line`, which
     * refuses an unknown field by name rather than writing nothing and
     * reporting success. This is that guard met from the other side.
     */
    show();
    await userEvent.click(screen.getByRole('checkbox', { name: /Taken from the governing document/ }));
    await waitFor(() => expect(hoisted.writes[0]).toEqual({ check_primary_source: true }));
  });

  it('writes only the check that changed', async () => {
    show({ checkPrimarySource: true });
    await userEvent.click(screen.getByRole('checkbox', { name: /Confirmed against a second source/ }));
    await waitFor(() => expect(hoisted.writes[0]).toEqual({ check_cross_source: true }));
  });

  it('takes a check back off, because it is a claim somebody can withdraw', async () => {
    show({ checkReconciliation: true });
    await userEvent.click(screen.getByRole('checkbox', { name: /Arithmetic reproduced/ }));
    await waitFor(() => expect(hoisted.writes[0]).toEqual({ check_reconciliation: false }));
  });

  it('offers exactly the quantity bases `app.measurement_method` has', () => {
    /*
     * An option the enum does not carry is a write the database refuses; one it
     * carries and this list omits is a basis nobody can record. Both are the
     * same defect, so the list is asserted against the enum itself rather than
     * against a copy of it — `owner_provided` was in the first draft of this
     * component and is not a value the type has.
     */
    const enumValues = readFileSync(
      join(ROOT, 'supabase/migrations/0001_foundation.sql'), 'utf8')
      .split('create type app.measurement_method as enum (')[1]!
      .split(')')[0]!
      .match(/'([a-z_]+)'/g)!
      .map((v) => v.slice(1, -1));

    expect([...METHODS.map((m) => m.value)].sort()).toEqual([...enumValues].sort());
    for (const m of METHODS) expect(m.label.length, m.value).toBeGreaterThan(4);
  });

  it('counts what has been answered, and names the empty case', async () => {
    show();
    expect(screen.getByText(/Nothing checked/)).toBeInTheDocument();
    show({ checkPrimarySource: true, checkCrossSource: true });
    expect(await screen.findByText(/2 of 3 checked/)).toBeInTheDocument();
  });

  it('names each box by the claim, not by the claim plus its explanation', () => {
    /*
     * A wrapping label folds both into one accessible name, so a screen reader
     * reads the whole sentence before saying what is being ticked. The claim
     * names it; the sentence describes it.
     */
    const { container } = show();
    // The name is the claim alone.
    const box = screen.getByRole('checkbox', { name: 'Taken from the governing document' });
    // The sentence is still attached, as a description rather than as the name.
    const describedBy = box.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(container.querySelector(`#${CSS.escape(describedBy!)}`)?.textContent)
      .toMatch(/that governs/);
  });

  it('will not offer a basis the database refuses on a rate-priced line', async () => {
    /*
     * Migration 0066: a line priced at a typed rate *is* an allowance, and the
     * constraint holds it there so a conceptual line cannot be relabeled into
     * the approval gate the label decides. A select that offered the choice
     * would be a control that takes a value and changes nothing.
     */
    show({ parametricCostPerUnit: 42.5, parametricBasis: 'Quoted' });
    expect(screen.getByRole('combobox', { name: /How the quantity was arrived at/ }))
      .toBeDisabled();
    expect(screen.getByText(/an allowance by definition/)).toBeInTheDocument();
    // And it says what actually changes it, rather than leaving a dead end.
    expect(screen.getByText(/Build the line up/)).toBeInTheDocument();
  });

  it('leaves the basis editable on a line that is built up', async () => {
    show({ parametricCostPerUnit: null, parametricBasis: null });
    expect(screen.getByRole('combobox', { name: /How the quantity was arrived at/ }))
      .not.toBeDisabled();
  });

  it('says the score only moves when the engine prices it again', async () => {
    // RULE: the engine is the only thing permitted to write a confidence.
    show();
    expect(screen.getByText(/Price the estimate again/)).toBeInTheDocument();
  });

  it('shows the database refusal rather than pretending the tick landed', async () => {
    hoisted.fails = 'Version is issued and cannot be edited';
    show();
    await userEvent.click(screen.getByRole('checkbox', { name: /Taken from the governing document/ }));
    expect(await screen.findByText('Version is issued and cannot be edited')).toBeInTheDocument();
  });

  it('gives a frozen version nothing to press', async () => {
    show({}, false);
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
  });
});
