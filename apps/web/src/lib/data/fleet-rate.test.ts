/**
 * What a machine bills at, on the fleet screen.
 *
 * The utilization table read an hourly rate out of `EQUIPMENT_SPECS` — eight
 * demonstration machines with invented rates, keyed `EQ-EX-20`, `EQ-D6` and so
 * on — and subtracted a real asset's ownership cost from it to produce a
 * "spread". The assets were live. The rate was fiction.
 *
 * It was worse than fiction on real data: a company's own equipment codes never
 * appear in that constant, so the lookup fell through to `?? 0` and the spread
 * became the ownership cost with a minus sign in front of it. Every machine
 * read as losing money, in proportion to what it cost to buy.
 *
 * The rate comes from the equipment library now, resolved by RULE-003 — the
 * same answer the library screen gives, from the same function, so the two
 * cannot drift.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));

import { rateInForce } from './library';

const rate = (source: string, hourly: number) => ({ source, hourly_rate: hourly });

describe('the rate in force on a machine', () => {
  it('prefers a quote for this project over everything else', () => {
    expect(rateInForce([
      rate('global_seed', 100), rate('regional', 120),
      rate('tenant_approved', 150), rate('project_quote', 185),
    ])).toBe(185);
  });

  it('prefers the company rate over a regional one', () => {
    expect(rateInForce([rate('regional', 120), rate('tenant_approved', 150)])).toBe(150);
  });

  it('falls back to the published figure when that is all there is', () => {
    expect(rateInForce([rate('global_seed', 107.93)])).toBe(107.93);
  });

  it('does not let row order decide', () => {
    expect(rateInForce([rate('tenant_approved', 150), rate('global_seed', 100)]))
      .toBe(rateInForce([rate('global_seed', 100), rate('tenant_approved', 150)]));
  });

  it('says null when nobody has priced it, rather than zero', () => {
    /*
     * The whole point. Zero is a number, and a screen that subtracts an
     * ownership cost from it reports a loss that nobody incurred. Null forces
     * the caller to say "no rate yet" instead of computing something.
     */
    expect(rateInForce([])).toBeNull();
  });

  it('ignores a source that is not one of the four', () => {
    // `company_owned` was being asked for first for months. It is not a rate
    // source, so the lookup never matched and quietly fell through.
    expect(rateInForce([rate('company_owned', 999), rate('tenant_approved', 150)])).toBe(150);
  });

  it('treats a missing rate on the winning row as no rate', () => {
    expect(rateInForce([{ source: 'tenant_approved', hourly_rate: null }])).toBeNull();
  });
});
