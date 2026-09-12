/**
 * The haul profiles, and the door onto them.
 *
 * `trucking_rates` had six readers and no writer. The platform cannot ship a
 * haul rate — `company_id` is `not null` — and no screen could create one, so
 * the Hauling tab listed a table that could never have anything in it and the
 * typed picker on a line searched the same emptiness.
 *
 * What these hold down is the part a form can get wrong in a way a constraint
 * only catches afterwards: migration 0067 says a pricing basis must carry its
 * own figure, and a screen that offered all three rate boxes at once would
 * invite somebody to fill in two and wonder which one the bid used.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TruckingRateRow } from '@/lib/data/library';

const hoisted = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<[string, Record<string, unknown>]>,
  retired: [] as string[],
  fail: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));

vi.mock('@/lib/data/library', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/library')>('@/lib/data/library');
  return {
    ...actual,
    nextHaulCode: async () => 'HAUL-0007',
    createTruckingRate: async (_c: unknown, input: Record<string, unknown>) => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      hoisted.created.push(input); return 'new-id';
    },
    updateTruckingRate: async (_c: unknown, id: string, patch: Record<string, unknown>) => {
      hoisted.updated.push([id, patch]);
    },
    retireTruckingRate: async (_c: unknown, id: string) => { hoisted.retired.push(id); },
  };
});

const { HaulProfiles, whatIsMissing, cycleMinutes } = await import('./haul-profiles');

const rate = (over: Partial<TruckingRateRow> = {}): TruckingRateRow => ({
  id: 't-1', code: 'HAUL-0001', name: 'Quad-axle dump', truckType: 'quad',
  capacity: 16, capacityUnit: 'CY', hourlyRate: 95, preliminaryUnitRate: null,
  pricingBasis: 'cycle', ratePerTrip: null, minimumBillableQuantity: null,
  chargesWholeTrips: true,
  loadMinutes: 6, dumpMinutes: 2, delayMinutes: 3,
  loadedSpeedMph: 30, emptySpeedMph: 35, vendorName: null, status: 'active', ...over,
});

const show = (rates: TruckingRateRow[] = [], canEdit = true) => {
  const onChanged = vi.fn();
  render(<HaulProfiles rates={rates} companyId="co-1" canEdit={canEdit} onChanged={onChanged} />);
  return { onChanged };
};

beforeEach(() => {
  hoisted.created = []; hoisted.updated = []; hoisted.retired = []; hoisted.fail = null;
});

describe('what a basis has to carry', () => {
  const base = {
    name: 'Quad', truckType: 'quad', capacity: 16, capacityUnit: 'CY',
    hourlyRate: 0, ratePerTrip: 0, preliminaryUnitRate: 0,
    minimumBillableQuantity: 0, chargesWholeTrips: true,
    loadMinutes: 6, dumpMinutes: 2, delayMinutes: 3,
    loadedSpeedMph: 30, emptySpeedMph: 35,
  };

  it('wants an hourly rate for an hourly haul', () => {
    expect(whatIsMissing({ ...base, pricingBasis: 'cycle' }))
      .toMatch(/hourly haul needs an hourly rate/i);
    expect(whatIsMissing({ ...base, pricingBasis: 'cycle', hourlyRate: 95 })).toBeNull();
  });

  it('wants a price a trip for a trip-priced haul', () => {
    expect(whatIsMissing({ ...base, pricingBasis: 'per_trip' }))
      .toMatch(/price a trip/i);
    expect(whatIsMissing({ ...base, pricingBasis: 'per_trip', ratePerTrip: 240 })).toBeNull();
  });

  it('wants a rate per unit for a unit-priced haul', () => {
    expect(whatIsMissing({ ...base, pricingBasis: 'per_unit' }))
      .toMatch(/rate per unit/i);
    expect(whatIsMissing({ ...base, pricingBasis: 'per_unit', preliminaryUnitRate: 12 }))
      .toBeNull();
  });

  it('wants a name and a capacity whatever the basis', () => {
    expect(whatIsMissing({ ...base, name: '  ', hourlyRate: 95, pricingBasis: 'cycle' }))
      .toMatch(/name/i);
    expect(whatIsMissing({ ...base, capacity: 0, hourlyRate: 95, pricingBasis: 'cycle' }))
      .toMatch(/capacity/i);
  });
});

describe('the cycle it shows you', () => {
  it('adds the driving to the load, dump and delay', () => {
    // 10 miles at 30 loaded and 35 empty, plus 6 + 2 + 3 minutes of standing.
    const minutes = cycleMinutes({
      loadMinutes: 6, dumpMinutes: 2, delayMinutes: 3,
      loadedSpeedMph: 30, emptySpeedMph: 35,
    } as Parameters<typeof cycleMinutes>[0]);
    expect(minutes).toBeCloseTo((10 / 30 + 10 / 35) * 60 + 11, 3);
  });

  it('says nothing rather than dividing by a speed of zero', () => {
    expect(cycleMinutes({
      loadMinutes: 0, dumpMinutes: 0, delayMinutes: 0,
      loadedSpeedMph: 0, emptySpeedMph: 35,
    } as Parameters<typeof cycleMinutes>[0])).toBeNull();
  });
});

describe('the empty library', () => {
  it('says what to do rather than showing a bare table', async () => {
    show([]);
    expect(await screen.findByText(/No haul profiles yet/)).toBeTruthy();
  });

  it('offers the add control', async () => {
    show([]);
    expect(await screen.findByRole('button', { name: /Add a haul profile/i })).toBeTruthy();
  });
});

describe('adding one', () => {
  it('takes the code from the database rather than picking one', async () => {
    const user = userEvent.setup();
    show([]);
    await user.click(await screen.findByRole('button', { name: /Add a haul profile/i }));
    await user.type(screen.getByLabelText('Name'), 'Tri-axle — Vasquez');
    await user.clear(screen.getByLabelText('Rate / hr'));
    await user.type(screen.getByLabelText('Rate / hr'), '110');
    await user.click(screen.getByRole('button', { name: /Save the profile/i }));

    await waitFor(() => expect(hoisted.created).toHaveLength(1));
    expect(hoisted.created[0]).toMatchObject({
      companyId: 'co-1', code: 'HAUL-0007',
      name: 'Tri-axle — Vasquez', pricingBasis: 'cycle', hourlyRate: 110,
    });
  });

  it('shows only the figure the chosen basis prices from', async () => {
    const user = userEvent.setup();
    show([]);
    await user.click(await screen.findByRole('button', { name: /Add a haul profile/i }));
    expect(screen.getByLabelText('Rate / hr')).toBeTruthy();
    expect(screen.queryByLabelText('Rate / trip')).toBeNull();

    await user.selectOptions(screen.getByLabelText('Priced by'), 'per_trip');
    expect(screen.getByLabelText('Rate / trip')).toBeTruthy();
    expect(screen.queryByLabelText('Rate / hr')).toBeNull();
  });

  it('sends the figure the basis needs and clears the ones it does not', async () => {
    const user = userEvent.setup();
    show([]);
    await user.click(await screen.findByRole('button', { name: /Add a haul profile/i }));
    await user.type(screen.getByLabelText('Name'), 'Trip haul');
    await user.selectOptions(screen.getByLabelText('Priced by'), 'per_trip');
    await user.clear(screen.getByLabelText('Rate / trip'));
    await user.type(screen.getByLabelText('Rate / trip'), '240');
    await user.click(screen.getByRole('button', { name: /Save the profile/i }));

    await waitFor(() => expect(hoisted.created).toHaveLength(1));
    expect(hoisted.created[0]).toMatchObject({
      pricingBasis: 'per_trip', ratePerTrip: 240, hourlyRate: 0,
      preliminaryUnitRate: null,
    });
  });

  it('says what is missing instead of letting the constraint say it', async () => {
    const user = userEvent.setup();
    show([]);
    await user.click(await screen.findByRole('button', { name: /Add a haul profile/i }));
    await user.type(screen.getByLabelText('Name'), 'No rate');
    await user.click(screen.getByRole('button', { name: /Save the profile/i }));
    expect(await screen.findByText(/hourly haul needs an hourly rate/i)).toBeTruthy();
    expect(hoisted.created).toHaveLength(0);
  });

  it('shows a refusal from the database rather than pretending it saved', async () => {
    const user = userEvent.setup();
    hoisted.fail = 'duplicate key value violates unique constraint';
    show([]);
    await user.click(await screen.findByRole('button', { name: /Add a haul profile/i }));
    await user.type(screen.getByLabelText('Name'), 'Clash');
    await user.clear(screen.getByLabelText('Rate / hr'));
    await user.type(screen.getByLabelText('Rate / hr'), '95');
    await user.click(screen.getByRole('button', { name: /Save the profile/i }));
    expect(await screen.findByText(/duplicate key/i)).toBeTruthy();
  });
});

describe('changing one', () => {
  it('opens on what it already holds', async () => {
    const user = userEvent.setup();
    show([rate()]);
    await user.click(await screen.findByRole('button', { name: /Edit Quad-axle dump/i }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Quad-axle dump');
    expect((screen.getByLabelText('Rate / hr') as HTMLInputElement).value).toBe('95');
  });

  it('sends only the profile it was told to change', async () => {
    const user = userEvent.setup();
    show([rate()]);
    await user.click(await screen.findByRole('button', { name: /Edit Quad-axle dump/i }));
    await user.clear(screen.getByLabelText('Rate / hr'));
    await user.type(screen.getByLabelText('Rate / hr'), '105');
    await user.click(screen.getByRole('button', { name: /Save the profile/i }));

    await waitFor(() => expect(hoisted.updated).toHaveLength(1));
    expect(hoisted.updated[0]![0]).toBe('t-1');
    expect(hoisted.updated[0]![1]).toMatchObject({ hourlyRate: 105 });
  });

  it('archives rather than deletes, so an issued estimate can still look it up', async () => {
    const user = userEvent.setup();
    show([rate()]);
    await user.click(await screen.findByRole('button', { name: /Stop offering Quad-axle dump/i }));
    await waitFor(() => expect(hoisted.retired).toEqual(['t-1']));
  });

  it('leaves an archived profile off the list', async () => {
    show([rate({ status: 'archived' })]);
    expect(await screen.findByText(/No haul profiles yet/)).toBeTruthy();
  });
});

describe('without permission to change the library', () => {
  it('shows the profiles and none of the controls', async () => {
    show([rate()], false);
    expect(await screen.findByText('Quad-axle dump')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add a haul profile/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit Quad-axle dump/i })).toBeNull();
  });
});
