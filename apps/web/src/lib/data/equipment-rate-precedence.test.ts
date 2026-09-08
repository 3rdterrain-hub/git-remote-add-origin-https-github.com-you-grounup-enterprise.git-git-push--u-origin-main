/**
 * Which rate the equipment list shows.
 *
 * RULE-003 puts a quote for this project above the company's approved rate,
 * above a regional figure, above what the platform ships. The engine resolves
 * it that way at pricing time; this screen has to agree, because a rate shown
 * beside a machine that is not the rate the estimate uses is the same defect as
 * a labor cost that cannot be reproduced by hand — plausible, silent, and wrong
 * exactly when somebody checks it.
 *
 * It did not agree. The lookup asked for `company_owned` first, which is not a
 * value of `app.rate_source` and so never matched, then `tenant_approved`, then
 * whichever row the database returned first. `project_quote` — the highest
 * precedence there is — was never preferred at all.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));

import { loadEquipmentOptions } from './library';

/** A client that hands back one machine carrying the rates given. */
const clientWith = (rates: Array<Record<string, unknown>>) => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({
      data: [{
        id: 'eq-1', name: 'Excavator, hydraulic', equipment_class: 'Earthmoving Equipment',
        fuel_gallons_per_hour: 6, mobilization_cost: 500,
        company_id: 'co-1', enterprise_group_id: null,
        equipment_rates: rates,
      }],
      error: null,
    }),
  };
  return { from: () => builder } as never;
};

const rate = (source: string, hourly: number) => ({
  source, hourly_rate: hourly, daily_rate: null, weekly_rate: null,
  monthly_rate: null, effective_date: '2026-01-01',
});

const rateShown = async (rates: Array<Record<string, unknown>>) =>
  (await loadEquipmentOptions(clientWith(rates)))[0]!.hourlyRate;

describe('the rate a machine shows', () => {
  it('prefers a quote for this project over everything else', async () => {
    // Deliberately last in the array: row order must not decide this.
    expect(await rateShown([
      rate('global_seed', 100), rate('regional', 120),
      rate('tenant_approved', 150), rate('project_quote', 185),
    ])).toBe(185);
  });

  it('prefers the company rate over a regional one', async () => {
    expect(await rateShown([rate('regional', 120), rate('tenant_approved', 150)])).toBe(150);
  });

  it('prefers a regional rate over what the platform ships', async () => {
    expect(await rateShown([rate('global_seed', 100), rate('regional', 120)])).toBe(120);
  });

  it('falls back to the published figure when that is all there is', async () => {
    expect(await rateShown([rate('global_seed', 107.93)])).toBe(107.93);
  });

  it('does not let row order decide, in either direction', async () => {
    const a = await rateShown([rate('tenant_approved', 150), rate('global_seed', 100)]);
    const b = await rateShown([rate('global_seed', 100), rate('tenant_approved', 150)]);
    expect(a).toBe(b);
    expect(a).toBe(150);
  });

  it('reports no rate as zero rather than inventing one', async () => {
    // The screen renders this as "No rate yet" rather than $0.00, because a
    // machine that prices at nothing and says nothing is how a machine ends up
    // on the job and off the bid.
    expect(await rateShown([])).toBe(0);
  });

  it('ignores a source that is not in the enum at all', async () => {
    // `company_owned` was being asked for first and is not a rate source. A
    // lookup for a value the database cannot hold silently never matches.
    expect(await rateShown([
      rate('company_owned', 999), rate('tenant_approved', 150),
    ])).toBe(150);
  });
});
