/**
 * Finding a crew, a machine, a material or a sub by typing.
 *
 * "Add crew member" dropped a blank row and left an estimator to type the
 * classification, the burdened rate and the hours from memory, with 44
 * classifications and 240 machines sitting one table away.
 *
 * The property that matters most is what happens to a library row with no rate.
 * A machine from the resource catalog has none; a material nobody has costed
 * reads as not_costed rather than free. Both must arrive as "no rate yet" and
 * not as a zero — a resource priced at nothing still lets the line total, which
 * is the quietest way for a bid to be wrong.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LibraryPick } from '@/lib/data/estimates';

const hoisted = vi.hoisted(() => ({ rows: [] as LibraryPick[] }));

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));

vi.mock('@/lib/data/estimates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/estimates')>(
    '@/lib/data/estimates');
  const search = () => async () => hoisted.rows;
  return {
    ...actual,
    searchLaborRates: search, searchEquipment: search,
    searchMaterials: search, searchVendors: search,
  };
});

const { ResourcePicker } = await import('./resource-picker');

const pick = (over: Partial<LibraryPick> = {}): LibraryPick => ({
  id: 'r-1', code: 'LAB-OP1', name: 'Heavy Equipment Operator I',
  rate: 54, unit: 'HR', detail: 'Operator', isOwn: false, unpriced: false, ...over,
});

const show = (kind: 'labor' | 'equipment' | 'material' | 'subcontract' = 'labor') => {
  const onPick = vi.fn();
  const onBlank = vi.fn();
  render(<ResourcePicker kind={kind} label="Add crew" onPick={onPick} onBlank={onBlank} />);
  return { onPick, onBlank };
};

const openSearch = async () =>
  userEvent.click(await screen.findByRole('button', { name: /Add crew from the library/ }));

beforeEach(() => { hoisted.rows = [pick()]; });

// ---------------------------------------------------------------------------
describe('searching by typing', () => {
  it('offers the search and a blank row side by side', async () => {
    show();
    expect(await screen.findByRole('button', { name: /from the library/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Blank row/ })).toBeInTheDocument();
  });

  it('suggests as you type', async () => {
    show();
    await openSearch();
    await userEvent.type(screen.getByRole('combobox'), 'oper');
    expect(await screen.findByRole('option', { name: /Heavy Equipment Operator I/ }))
      .toBeInTheDocument();
  });

  it('shows what it costs beside the name', async () => {
    show();
    await openSearch();
    await userEvent.type(screen.getByRole('combobox'), 'oper');
    expect(await screen.findByText('$54.00/HR')).toBeInTheDocument();
  });

  it('puts the library row on the line with its rate', async () => {
    const { onPick } = show();
    await openSearch();
    await userEvent.type(screen.getByRole('combobox'), 'oper');
    await userEvent.click(await screen.findByRole('option', { name: /Operator/ }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Heavy Equipment Operator I',
      labor_rate_id: 'r-1',
      unit_rate: 54,
      base_rate: 54,
    })));
  });

  it('picks with the keyboard', async () => {
    const { onPick } = show();
    await openSearch();
    await userEvent.type(screen.getByRole('combobox'), 'oper');
    await screen.findByRole('option', { name: /Operator/ });
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(onPick).toHaveBeenCalled());
  });

  it('closes on Escape without picking anything', async () => {
    const { onPick } = show();
    await openSearch();
    await userEvent.type(screen.getByRole('combobox'), 'oper{Escape}');
    expect(onPick).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /from the library/ })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('a library row with no rate', () => {
  it('says so rather than showing a zero', async () => {
    /*
     * The 183 machines from the resource catalog have no rate at all. A zero
     * beside one would read as free.
     */
    hoisted.rows = [pick({ name: 'Boom Lift 45 ft', rate: null, unpriced: true })];
    show('equipment');
    await userEvent.click(await screen.findByRole('button', { name: /from the library/ }));
    await userEvent.type(screen.getByRole('combobox'), 'boom');
    expect(await screen.findByText('no rate yet')).toBeInTheDocument();
    expect(screen.queryByText('$0.00/HR')).not.toBeInTheDocument();
  });

  it('sends no rate onto the line either', async () => {
    hoisted.rows = [pick({ name: 'Boom Lift 45 ft', rate: null, unpriced: true })];
    const { onPick } = show('equipment');
    await userEvent.click(await screen.findByRole('button', { name: /from the library/ }));
    await userEvent.type(screen.getByRole('combobox'), 'boom');
    await userEvent.click(await screen.findByRole('option', { name: /Boom Lift/ }));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(onPick.mock.calls[0]![0]).not.toHaveProperty('unit_rate');
  });

  it('says the same of a material nobody has costed', async () => {
    hoisted.rows = [pick({ name: '#57 Crushed Stone', rate: 0, unit: 'TON', unpriced: true })];
    show('material');
    await userEvent.click(await screen.findByRole('button', { name: /from the library/ }));
    await userEvent.type(screen.getByRole('combobox'), 'stone');
    expect(await screen.findByText('no rate yet')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('what the library does not have', () => {
  it('still offers a blank row from inside the search', async () => {
    /*
     * Somebody adding a machine the library has never heard of should not have
     * to put it in the library first, mid-bid, to price a job today.
     */
    const { onBlank } = show();
    await openSearch();
    await userEvent.click(screen.getByRole('button', { name: /add a blank row/ }));
    expect(onBlank).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('each kind carries its own identifier', () => {
  it.each([
    ['equipment', 'equipment_id'],
    ['material', 'material_id'],
    ['subcontract', 'vendor_id'],
  ] as const)('%s sends %s', async (kind, key) => {
    const { onPick } = show(kind);
    await userEvent.click(await screen.findByRole('button', { name: /from the library/ }));
    await userEvent.type(screen.getByRole('combobox'), 'x');
    await userEvent.click(await screen.findAllByRole('option').then((o) => o[0]!));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ [key]: 'r-1' })));
  });
});
