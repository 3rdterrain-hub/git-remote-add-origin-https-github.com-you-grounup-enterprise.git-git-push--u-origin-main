/**
 * The website shows the catalog, or it shows nothing it made up.
 *
 * Two ways this page told a visitor something the database had not said, and
 * both were live:
 *
 *   * **The comparison table was positional.** `row.values[i]` indexed a
 *     four-entry array written for the starter/professional/business/enterprise
 *     ladder. The catalog retired all four and now publishes two plans, so
 *     every live plan was handed a *retired* plan's column — the only paid plan
 *     was being shown Professional's answers, marking procurement, fleet,
 *     scheduling, divisions and calibration as not included in the plan
 *     somebody was about to buy. It grants `*`. It includes all of them.
 *
 *   * **A failed price read rendered $0.** The catalog query's error was
 *     checked and the price query's was discarded, and every amount is read
 *     with `?? 0`. So a tightened policy or a dropped connection produced a
 *     correct-looking page quoting nothing, on the screen where somebody
 *     decides to pay.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  configured: true,
  catalog: [] as unknown[],
  catalogError: null as { message: string } | null,
  prices: [] as unknown[],
  priceError: null as { message: string } | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() {
    if (!hoisted.configured) return null;
    return {
      from(table: string) {
        const result = table === 'plans'
          ? { data: hoisted.catalog, error: hoisted.catalogError }
          : { data: hoisted.prices, error: hoisted.priceError };
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => Promise.resolve(result),
          then: (fn: (r: unknown) => unknown) => Promise.resolve(result).then(fn),
        };
        return chain;
      },
    };
  },
}));

const { loadPlanPrices, comparisonValue, COMPARISON, PLANS, grants } =
  await import('./plans');

const catalogRow = (over: Record<string, unknown> = {}) => ({
  id: 'grounup', name: 'GrounUp', tagline: 'Everything, priced per person.',
  description: 'One plan. Everything in it.',
  features: ['*'],
  max_seats: null, max_active_estimates: null, max_active_projects: null,
  storage_gb: 100, ai_credits_per_month: 500, trial_days: 14, sort_order: 10, ...over,
});

const freeRow = catalogRow({
  id: 'free', name: 'Free', tagline: 'Free forever.',
  features: ['estimating', 'takeoff', 'master_libraries', 'crm_basic', 'proposals', 'documents'],
  max_seats: 1, max_active_estimates: 5, max_active_projects: null,
  storage_gb: 1, ai_credits_per_month: 25, trial_days: 0, sort_order: 0,
});

describe('what the pricing page reads', () => {
  beforeEach(() => {
    hoisted.configured = true;
    hoisted.catalogError = null; hoisted.priceError = null;
    hoisted.catalog = [freeRow, catalogRow()];
    hoisted.prices = [
      { plan_id: 'free', interval: 'month', unit_amount_cents: 0, is_active: true, is_chargeable: false },
      { plan_id: 'grounup', interval: 'month', unit_amount_cents: 14_900, is_active: true, is_chargeable: true },
      { plan_id: 'grounup', interval: 'year', unit_amount_cents: 149_000, is_active: true, is_chargeable: true },
    ];
  });

  it('quotes the price the catalog carries, not one compiled into the page', async () => {
    const plans = await loadPlanPrices();
    const grounup = plans.find((p) => p.id === 'grounup')!;
    expect(grounup.monthlyCents).toBe(14_900);
    expect(grounup.yearlyCents).toBe(149_000);
    // And it is a different number from the shipped fixture, so this cannot
    // pass by the two happening to agree.
    expect(PLANS.some((p) => p.monthlyCents === 14_900)).toBe(false);
  });

  it('follows a price change without a release', async () => {
    hoisted.prices = [
      { plan_id: 'grounup', interval: 'month', unit_amount_cents: 17_500, is_active: true, is_chargeable: true },
    ];
    const plans = await loadPlanPrices();
    expect(plans.find((p) => p.id === 'grounup')!.monthlyCents).toBe(17_500);
  });

  it('shows the shipped defaults rather than $0 when the price read fails', async () => {
    // The catalog still reads; only the prices fail. Before, that rendered
    // every plan at zero on the page where somebody decides to pay.
    hoisted.priceError = { message: 'permission denied for table plan_prices' };
    const plans = await loadPlanPrices();
    expect(plans).toEqual(PLANS);
    expect(plans.every((p) => p.monthlyCents > 0)).toBe(true);
  });

  it('shows the shipped defaults when the catalog read fails', async () => {
    hoisted.catalogError = { message: 'JWT expired' };
    expect(await loadPlanPrices()).toEqual(PLANS);
  });

  it('carries each plan its own entitlements', async () => {
    const plans = await loadPlanPrices();
    expect(plans.find((p) => p.id === 'grounup')!.features).toEqual(['*']);
    expect(plans.find((p) => p.id === 'free')!.features).toContain('estimating');
    expect(plans.find((p) => p.id === 'free')!.features).not.toContain('projects');
  });
});

describe('what the comparison table says about a plan', () => {
  const grounup = { id: 'grounup', features: ['*'], limits: { estimates: 'Unlimited', projects: 'Unlimited', storage: '100 GB included', ai: '500 AI credits a month' } } as never;
  const free = { id: 'free', features: ['estimating', 'takeoff', 'master_libraries', 'crm_basic', 'proposals', 'documents'], limits: { estimates: '5 active estimates', projects: 'Unlimited', storage: '1 GB included', ai: '25 AI credits a month' } } as never;

  it('includes everything in a plan that grants everything', () => {
    /*
     * The defect, stated as a property. Under the positional table the only
     * paid plan sat in column two and was answered from Professional's row:
     * procurement, fleet, scheduling, divisions and calibration all read as
     * excluded from the plan that includes them.
     */
    const gated = COMPARISON.flatMap((g) => g.rows).filter((r) => r.feature);
    expect(gated.length).toBeGreaterThan(8);
    for (const row of gated) {
      expect(comparisonValue(row, grounup), row.label).toBe(true);
    }
  });

  it('excludes from the free plan exactly what the free plan does not grant', () => {
    const say = (label: string) =>
      comparisonValue(COMPARISON.flatMap((g) => g.rows).find((r) => r.label === label)!, free);
    expect(say('Deterministic estimating engine')).toBe(true);
    expect(say('Document storage and versioning')).toBe(true);
    expect(say('Award estimate to project')).toBe(false);
    expect(say('Procurement and fleet')).toBe(false);
    expect(say('AI plan and specification review')).toBe(false);
  });

  it('says a platform property is true for everybody, because it is not sold', () => {
    const row = COMPARISON.flatMap((g) => g.rows).find((r) => r.label === 'Row level tenant isolation')!;
    expect(comparisonValue(row, free)).toBe(true);
    expect(comparisonValue(row, grounup)).toBe(true);
  });

  it('reads a limit off the plan rather than out of a list', () => {
    const row = COMPARISON.flatMap((g) => g.rows).find((r) => r.label === 'AI credits per month')!;
    expect(comparisonValue(row, free)).toBe('25 AI credits a month');
    expect(comparisonValue(row, grounup)).toBe('500 AI credits a month');
  });

  it('answers by plan id where the catalog has no key for the row', () => {
    const row = COMPARISON.flatMap((g) => g.rows).find((r) => r.label === 'White label')!;
    expect(comparisonValue(row, free)).toBe(false);
    // Not positional: the answer travels with the id, so publishing or
    // retiring a plan cannot shift a column onto the wrong one.
    expect(row.byPlan?.partner_white_label).toBe(true);
  });

  it('treats a wildcard grant as granting a key nobody has named', () => {
    expect(grants({ features: ['*'] }, 'something_added_next_year')).toBe(true);
    expect(grants({ features: ['estimating'] }, 'something_added_next_year')).toBe(false);
  });
});
