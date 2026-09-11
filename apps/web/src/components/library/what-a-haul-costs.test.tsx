/**
 * Pricing a quantity against every haul rate, on each rate's own basis.
 *
 * `app.haul_cost` was written in 0067 with its reasoning stated: the trip
 * arithmetic is duplicated from the engine because "a company comparing quotes
 * on a screen should not need an Edge Function round trip per row". There was
 * no screen, and no `public.` wrapper until 0147.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TruckingRateRow } from '@/lib/data/library';

const hoisted = vi.hoisted(() => ({
  answers: new Map<string, unknown>(),
  asked: [] as Array<{ id: string; quantity: number }>,
  fails: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/library', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/library')>('@/lib/data/library');
  return {
    ...actual,
    haulCost: async (_c: unknown, id: string, quantity: number) => {
      if (hoisted.fails) throw new Error(hoisted.fails);
      hoisted.asked.push({ id, quantity });
      return hoisted.answers.get(id) ?? null;
    },
  };
});

const { WhatAHaulCosts } = await import('./what-a-haul-costs');

const rate = (over: Partial<TruckingRateRow> = {}): TruckingRateRow => ({
  id: 'tr-1', code: 'TR-TRI', name: 'Tri-axle', truckType: 'tri_axle',
  capacity: 18, capacityUnit: 'TON', hourlyRate: 0, preliminaryUnitRate: null,
  pricingBasis: 'per_trip', ratePerTrip: 210, minimumBillableQuantity: null,
  chargesWholeTrips: true, loadMinutes: 8, dumpMinutes: 2, delayMinutes: 0,
  loadedSpeedMph: 30, emptySpeedMph: 35, vendorName: null, status: 'active',
  ...over,
});

describe('what a haul costs', () => {
  beforeEach(() => { hoisted.answers = new Map(); hoisted.asked = []; hoisted.fails = null; });

  it('shows nothing at all when there are no haul rates', () => {
    const { container } = render(<WhatAHaulCosts rates={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('explains that rates are not converted between units', () => {
    render(<WhatAHaulCosts rates={[rate()]} />);
    expect(screen.getByText(/Rates are not converted between/)).toBeInTheDocument();
  });

  it('prices every rate at once, so the bases can be compared', async () => {
    hoisted.answers.set('tr-1', {
      pricingBasis: 'per_trip', tripsPaid: 6, cost: 1260,
      effectiveRatePerUnit: 12.6, unusedCapacity: 8,
    });
    hoisted.answers.set('tr-2', {
      pricingBasis: 'per_unit', tripsPaid: null, cost: 1100,
      effectiveRatePerUnit: 11, unusedCapacity: null,
    });
    render(<WhatAHaulCosts rates={[rate(), rate({ id: 'tr-2', code: 'TR-UNIT', name: 'Broker, per ton', pricingBasis: 'per_unit', ratePerTrip: null })]} />);
    await userEvent.type(screen.getByLabelText('Quantity to move'), '100');
    await userEvent.click(screen.getByRole('button', { name: /Price it/ }));

    await waitFor(() => expect(hoisted.asked).toHaveLength(2));
    expect(hoisted.asked.every((a) => a.quantity === 100)).toBe(true);
    // 100 tons at 18 a load is 5.56 loads, charged as 6 whole trips.
    expect(await screen.findByText('6.00')).toBeInTheDocument();
    expect(screen.getByText('$1,260.00')).toBeInTheDocument();
    expect(screen.getByText('$1,100.00')).toBeInTheDocument();
  });

  it('shows the capacity paid for and not used, which is the trip basis’ cost', async () => {
    hoisted.answers.set('tr-1', {
      pricingBasis: 'per_trip', tripsPaid: 6, cost: 1260,
      effectiveRatePerUnit: 12.6, unusedCapacity: 8,
    });
    render(<WhatAHaulCosts rates={[rate()]} />);
    await userEvent.type(screen.getByLabelText('Quantity to move'), '100');
    await userEvent.click(screen.getByRole('button', { name: /Price it/ }));
    expect(await screen.findByText('8.00 TON')).toBeInTheDocument();
  });

  it('shows an em dash for a cycle haul rather than inventing a cost', async () => {
    /*
     * The reason for asking the database instead of multiplying here: a cycle
     * rate has no cost without a cycle analysis, and one derived from the
     * hourly rate alone is the shortcut that basis exists to avoid.
     */
    hoisted.answers.set('tr-1', {
      pricingBasis: 'cycle', tripsPaid: null, cost: null,
      effectiveRatePerUnit: null, unusedCapacity: null,
    });
    render(<WhatAHaulCosts rates={[rate({ pricingBasis: 'cycle', ratePerTrip: null })]} />);
    await userEvent.type(screen.getByLabelText('Quantity to move'), '100');
    await userEvent.click(screen.getByRole('button', { name: /Price it/ }));
    expect(await screen.findByText(/has no cost without a cycle analysis/)).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
  });

  it('will not price nothing', async () => {
    render(<WhatAHaulCosts rates={[rate()]} />);
    expect(screen.getByRole('button', { name: /Price it/ })).toBeDisabled();
  });

  it('shows a refusal rather than a blank table', async () => {
    hoisted.fails = 'permission denied for function haul_cost';
    render(<WhatAHaulCosts rates={[rate()]} />);
    await userEvent.type(screen.getByLabelText('Quantity to move'), '100');
    await userEvent.click(screen.getByRole('button', { name: /Price it/ }));
    expect(await screen.findByText(/permission denied/)).toBeInTheDocument();
  });
});
