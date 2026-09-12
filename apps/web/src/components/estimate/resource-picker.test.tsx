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
    searchMaterials: search, searchVendors: search, searchTruckingRates: search,
  };
});

const { ResourcePicker, ResourceName } = await import('./resource-picker');

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

// ---------------------------------------------------------------------------
// What a row already on the line *is*
// ---------------------------------------------------------------------------

/**
 * The name of an existing row used to be a plain text box, and that was not a
 * cosmetic problem. It wrote `description` and nothing else, so renaming
 * "Crushed stone" to "Pit run" left `material_id` pointing at crushed stone —
 * and `capture_library_snapshot` reads that link to record what priced the
 * version, so the audit trail and the line disagreed and the bid went out.
 *
 * Migration 0151 made the link writable on update at all; these hold down what
 * the screen does with that.
 */
const named = (over: Partial<Parameters<typeof ResourceName>[0]> = {}) => {
  const onChange = vi.fn();
  render(<ResourceName kind="material" label="Material" value="Crushed stone"
    linked onChange={onChange} {...over} />);
  return { onChange };
};

const openName = async (name = /Material: Crushed stone/) =>
  userEvent.click(await screen.findByRole('button', { name }));

describe('the identity of a row on the line', () => {
  beforeEach(() => { hoisted.rows = [pick({ id: 'm-2', name: 'Pit run', rate: 18, unit: 'CY' })]; });

  it('shows what it is, and says it is changeable', async () => {
    named();
    expect(await screen.findByRole('button', { name: /Material: Crushed stone/ })).toBeTruthy();
    // Not a text box — the thing it replaced.
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('marks a row the library does not stand behind', async () => {
    named({ linked: false, value: 'Something off the truck' });
    expect(await screen.findByText('typed')).toBeTruthy();
  });

  it('moves the link with the name when a library row is picked', async () => {
    const { onChange } = named();
    await openName();
    await userEvent.click(await screen.findByRole('option', { name: /Pit run/ }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Pit run', material_id: 'm-2' }));
  });

  it('removes the link when a name is typed by hand', async () => {
    /*
     * A row somebody renamed themselves is no longer the library row it came
     * from, and leaving the old link is the same lie in the other direction.
     * Null rather than omitted, because 0151 reads these six by key presence.
     */
    const { onChange } = named();
    await openName();
    const box = await screen.findByRole('combobox');
    await userEvent.clear(box);
    await userEvent.type(box, 'Screened sand from the pit{Enter}');
    expect(onChange).toHaveBeenCalledWith({
      description: 'Screened sand from the pit', material_id: null,
    });
  });

  it('can drop the link and keep the name', async () => {
    const { onChange } = named();
    await openName();
    await userEvent.click(await screen.findByRole('button', { name: /Unlink from the library/ }));
    expect(onChange).toHaveBeenCalledWith({ material_id: null });
  });

  it('offers no unlink where there is no link', async () => {
    named({ linked: false });
    await openName();
    expect(screen.queryByRole('button', { name: /Unlink from the library/ })).toBeNull();
  });

  it('searches the whole list before anything is typed', async () => {
    // Seeded with the current name, a first search for that name would return
    // the row it already is — useless to somebody who opened it to change it.
    named();
    await openName();
    expect(await screen.findByRole('option', { name: /Pit run/ })).toBeTruthy();
  });

  it('changes nothing on Escape', async () => {
    const { onChange } = named();
    await openName();
    await userEvent.keyboard('{Escape}');
    expect(onChange).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /Material: Crushed stone/ })).toBeTruthy();
  });

  it('is inert on a version that is frozen', async () => {
    named({ disabled: true });
    const button = await screen.findByRole('button', { name: /Material: Crushed stone/ });
    expect(button.hasAttribute('disabled')).toBe(true);
  });
});

describe('hauling, which had no typed search at all', () => {
  beforeEach(() => {
    hoisted.rows = [pick({
      id: 't-1', code: 'TRK-QUAD', name: 'Quad-axle dump', rate: 95, unit: 'HR',
      detail: 'quad · 16 CY', isOwn: true,
      extra: {
        truck_capacity: 16, load_minutes: 6, dump_minutes: 2,
        queue_minutes: 3, average_speed_mph: 32.5,
      },
    })];
  });

  it('brings the truck cycle with the truck', async () => {
    const onPick = vi.fn();
    render(<ResourcePicker kind="trucking" label="Add hauling"
      onPick={onPick} onBlank={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Add hauling from the library/ }));
    await userEvent.click(await screen.findByRole('option', { name: /Quad-axle dump/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({
      trucking_rate_id: 't-1', description: 'Quad-axle dump', unit_rate: 95,
      truck_capacity: 16, load_minutes: 6, dump_minutes: 2, queue_minutes: 3,
      average_speed_mph: 32.5,
      // A row created from a profile is priced by the trip; that is what a
      // profile is for.
      haul_mode: 'trip',
    }));
  });

  it('leaves an existing row priced however it already was', async () => {
    /*
     * Capacity and the load, dump and queue times belong to the machine and
     * come with it. How the haul is priced, and the route it runs, belong to
     * the job — choosing a different truck must not overwrite either.
     */
    const onChange = vi.fn();
    render(<ResourceName kind="trucking" label="Truck" value="Tandem" linked
      onChange={onChange} />);
    await userEvent.click(await screen.findByRole('button', { name: /Truck: Tandem/ }));
    await userEvent.click(await screen.findByRole('option', { name: /Quad-axle dump/ }));
    const sent = onChange.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.trucking_rate_id).toBe('t-1');
    expect(sent.truck_capacity).toBe(16);
    expect(sent).not.toHaveProperty('haul_mode');
    expect(sent).not.toHaveProperty('round_trip_miles');
  });
});
