import { describe, expect, it } from 'vitest';
import {
  deriveState, ENTITLING_STATUSES, HANDLED_EVENT_TYPES, isHandled,
  resolvePlanId, resolvePlanVersion, resolveRequestedPrice,
  type PlanRecord, type PlanPriceRecord, type PlanVersionRecord, type StripeSubscriptionLike,
} from '../../supabase/functions/_shared/subscription-state.js';

const PLANS: PlanRecord[] = [
  { id: 'starter', features: ['estimating'], max_seats: 3, max_active_estimates: 25, max_active_projects: 10, storage_gb: 10, ai_credits_per_month: 250 },
  { id: 'professional', features: ['estimating', 'projects', 'ai_plan_review'], max_seats: 10, max_active_estimates: 250, max_active_projects: 75, storage_gb: 100, ai_credits_per_month: 2000 },
  { id: 'enterprise', features: ['*'], max_seats: null, max_active_estimates: null, max_active_projects: null, storage_gb: null, ai_credits_per_month: null },
];

const PRICES: PlanPriceRecord[] = [
  { stripe_price_id: 'price_starter_m', plan_id: 'starter' },
  { stripe_price_id: 'price_pro_m', plan_id: 'professional' },
  { stripe_price_id: 'price_pro_y', plan_id: 'professional' },
  { stripe_price_id: 'price_ent_m', plan_id: 'enterprise' },
];

const COMPANY = '11111111-1111-4111-8111-111111111111';
const PERIOD_START = 1_767_225_600; // 2026-01-01T00:00:00Z
const PERIOD_END = 1_769_904_000;   // 2026-02-01T00:00:00Z
const EVENT_CREATED = 1_767_225_700;

const sub = (over: Partial<StripeSubscriptionLike> = {}): StripeSubscriptionLike => ({
  id: 'sub_123',
  customer: 'cus_123',
  status: 'active',
  current_period_start: PERIOD_START,
  current_period_end: PERIOD_END,
  cancel_at_period_end: false,
  items: { data: [{ id: 'si_1', quantity: 1, price: { id: 'price_pro_m' } }] },
  ...over,
});

describe('plan resolution', () => {
  it('resolves the plan from the price the customer was actually charged', () => {
    const r = resolvePlanId(sub(), PRICES);
    expect(r.planId).toBe('professional');
    expect(r.warnings).toEqual([]);
  });

  it('falls back to metadata for a subscription created outside the app, and says so', () => {
    const r = resolvePlanId(
      sub({ items: { data: [{ id: 'si', quantity: 1, price: { id: 'price_unknown' } }] }, metadata: { grounup_plan_id: 'business' } }),
      PRICES,
    );
    expect(r.planId).toBe('business');
    expect(r.warnings[0]).toContain('fell back to the grounup_plan_id metadata');
  });

  it('refuses to guess when the price is unknown and there is no metadata', () => {
    const r = resolvePlanId(sub({ items: { data: [{ id: 'si', quantity: 1, price: { id: 'price_unknown' } }] } }), PRICES);
    expect(r.planId).toBeNull();
    expect(r.warnings[0]).toContain('not in the GrounUp plan catalog');
  });

  it('warns when a subscription spans more than one plan', () => {
    const r = resolvePlanId(
      sub({ items: { data: [
        { id: 'a', quantity: 1, price: { id: 'price_pro_m' } },
        { id: 'b', quantity: 1, price: { id: 'price_ent_m' } },
      ] } }),
      PRICES,
    );
    expect(r.warnings[0]).toContain('maps to more than one plan');
  });
});

describe('entitlement is granted only for statuses that were paid for', () => {
  it('grants on active', () => {
    const s = deriveState(sub({ status: 'active' }), COMPANY, PLANS, PRICES, 'evt_1', EVENT_CREATED);
    expect(s.entitlement.is_active).toBe(true);
    expect(s.entitlement.features).toEqual(['estimating', 'projects', 'ai_plan_review']);
    expect(s.entitlement.plan_id).toBe('professional');
  });

  it('grants during a trial and expires exactly at trial end', () => {
    const s = deriveState(sub({ status: 'trialing', trial_start: PERIOD_START, trial_end: PERIOD_END }),
      COMPANY, PLANS, PRICES, 'evt_2', EVENT_CREATED);
    expect(s.entitlement.is_active).toBe(true);
    expect(s.entitlement.valid_until).toBe('2026-02-01T00:00:00.000Z');
  });

  it('keeps a past-due account working through the dunning window', () => {
    const s = deriveState(sub({ status: 'past_due' }), COMPANY, PLANS, PRICES, 'evt_3', EVENT_CREATED);
    expect(s.entitlement.is_active).toBe(true);
  });

  it('revokes on canceled, and zeroes every limit', () => {
    const s = deriveState(sub({ status: 'canceled', ended_at: PERIOD_END }), COMPANY, PLANS, PRICES, 'evt_4', EVENT_CREATED);
    expect(s.entitlement.is_active).toBe(false);
    expect(s.entitlement.features).toEqual([]);
    expect(s.entitlement.max_seats).toBe(0);
    expect(s.entitlement.valid_until).toBeNull();
  });

  it.each(['incomplete', 'incomplete_expired', 'unpaid', 'paused'] as const)(
    'revokes on %s — a subscription that was never paid grants nothing',
    (status) => {
      const s = deriveState(sub({ status }), COMPANY, PLANS, PRICES, 'evt_x', EVENT_CREATED);
      expect(s.entitlement.is_active).toBe(false);
      expect(s.entitlement.features).toEqual([]);
    },
  );

  it('declares exactly which statuses entitle', () => {
    expect([...ENTITLING_STATUSES]).toEqual(['trialing', 'active', 'past_due']);
  });

  it('grants nothing when the price maps to no known plan, even if active', () => {
    const s = deriveState(
      sub({ items: { data: [{ id: 'si', quantity: 1, price: { id: 'price_unknown' } }] } }),
      COMPANY, PLANS, PRICES, 'evt_5', EVENT_CREATED,
    );
    expect(s.entitlement.is_active).toBe(false);
    expect(s.warnings.some((w) => w.includes('not in the GrounUp plan catalog'))).toBe(true);
  });

  it('grants nothing when metadata names a plan that is not in the catalog', () => {
    const s = deriveState(
      sub({ items: { data: [{ id: 'si', quantity: 1, price: { id: 'price_unknown' } }] }, metadata: { grounup_plan_id: 'made_up' } }),
      COMPANY, PLANS, PRICES, 'evt_6', EVENT_CREATED,
    );
    expect(s.entitlement.is_active).toBe(false);
    expect(s.warnings.some((w) => w.includes('not present in the plan catalog'))).toBe(true);
  });
});

describe('grace window', () => {
  it('extends access three days past the paid period so a delayed webhook cannot lock a customer out', () => {
    const s = deriveState(sub(), COMPANY, PLANS, PRICES, 'evt_7', EVENT_CREATED);
    // Period ends 2026-02-01; entitlement is valid to 2026-02-04.
    expect(s.entitlement.valid_until).toBe('2026-02-04T00:00:00.000Z');
  });

  it('flags an entitling subscription that reports no period end', () => {
    const s = deriveState(
      sub({ current_period_start: null, current_period_end: null }),
      COMPANY, PLANS, PRICES, 'evt_8', EVENT_CREATED,
    );
    expect(s.entitlement.valid_until).toBeNull();
    expect(s.warnings.some((w) => w.includes('reports no period end'))).toBe(true);
  });

  it('reads period dates from the subscription item when Stripe puts them there', () => {
    const s = deriveState(
      sub({
        current_period_start: undefined, current_period_end: undefined,
        items: { data: [{ id: 'si', quantity: 1, price: { id: 'price_pro_m' },
                         current_period_start: PERIOD_START, current_period_end: PERIOD_END }] },
      }),
      COMPANY, PLANS, PRICES, 'evt_9', EVENT_CREATED,
    );
    expect(s.subscription.current_period_end).toBe('2026-02-01T00:00:00.000Z');
  });
});

describe('subscription row mapping', () => {
  it('maps every field Stripe reports, and stamps the event that produced it', () => {
    const s = deriveState(
      sub({ cancel_at_period_end: true, canceled_at: PERIOD_START }),
      COMPANY, PLANS, PRICES, 'evt_10', EVENT_CREATED,
    );
    expect(s.subscription).toMatchObject({
      company_id: COMPANY,
      plan_id: 'professional',
      stripe_customer_id: 'cus_123',
      stripe_subscription_id: 'sub_123',
      status: 'active',
      cancel_at_period_end: true,
      canceled_at: '2026-01-01T00:00:00.000Z',
      last_event_id: 'evt_10',
    });
    expect(s.subscription.last_event_at).toBe('2026-01-01T00:01:40.000Z');
  });

  it('sums seat quantity across items', () => {
    const s = deriveState(
      sub({ items: { data: [
        { id: 'a', quantity: 4, price: { id: 'price_pro_m' } },
        { id: 'b', quantity: 3, price: { id: 'price_pro_m' } },
      ] } }),
      COMPANY, PLANS, PRICES, 'evt_11', EVENT_CREATED,
    );
    expect(s.subscription.quantity).toBe(7);
    expect(s.items).toHaveLength(2);
  });

  it('defaults a null quantity to one seat rather than zero', () => {
    const s = deriveState(
      sub({ items: { data: [{ id: 'a', quantity: null, price: { id: 'price_pro_m' } }] } }),
      COMPANY, PLANS, PRICES, 'evt_12', EVENT_CREATED,
    );
    expect(s.subscription.quantity).toBe(1);
  });

  it('carries unlimited plan limits through as null, not zero', () => {
    const s = deriveState(
      sub({ items: { data: [{ id: 'a', quantity: 1, price: { id: 'price_ent_m' } }] } }),
      COMPANY, PLANS, PRICES, 'evt_13', EVENT_CREATED,
    );
    expect(s.entitlement.plan_id).toBe('enterprise');
    expect(s.entitlement.max_seats).toBeNull();
    expect(s.entitlement.features).toEqual(['*']);
  });
});

describe('event routing', () => {
  it('handles exactly the declared event types', () => {
    for (const t of HANDLED_EVENT_TYPES) expect(isHandled(t)).toBe(true);
    expect(isHandled('customer.subscription.updated')).toBe(true);
    expect(isHandled('charge.refunded')).toBe(false);
    expect(isHandled('anything.else')).toBe(false);
  });
});

describe('plan request validation — everything from the browser is untrusted', () => {
  const catalogPlans = [
    { id: 'starter', is_active: true, is_public: true },
    { id: 'professional', is_active: true, is_public: true },
    { id: 'legacy', is_active: false, is_public: true },
    { id: 'partner_white_label', is_active: true, is_public: false },
  ];
  const catalogPrices = [
    { stripe_price_id: 'price_starter_m', plan_id: 'starter', interval: 'month', is_active: true, unit_amount_cents: 9900 },
    { stripe_price_id: 'price_pro_m', plan_id: 'professional', interval: 'month', is_active: true, unit_amount_cents: 29900 },
    { stripe_price_id: 'price_pro_y', plan_id: 'professional', interval: 'year', is_active: true, unit_amount_cents: 299000 },
    { stripe_price_id: 'price_partner_m', plan_id: 'partner_white_label', interval: 'month', is_active: true, unit_amount_cents: 1 },
  ];

  it('resolves the real price id from the catalog, never from the request', () => {
    const r = resolveRequestedPrice('professional', 'year', catalogPlans, catalogPrices);
    expect(r).toEqual({ ok: true, planId: 'professional', priceId: 'price_pro_y', amountCents: 299000 });
  });

  it('defaults an unrecognized interval to monthly rather than failing open', () => {
    const r = resolveRequestedPrice('professional', 'decade', catalogPlans, catalogPrices);
    expect(r).toMatchObject({ ok: true, priceId: 'price_pro_m' });
  });

  it('rejects a plan that is not in the catalog', () => {
    expect(resolveRequestedPrice('free_forever', 'month', catalogPlans, catalogPrices))
      .toEqual({ ok: false, error: 'Plan "free_forever" is not in the GrounUp plan catalog.' });
  });

  it('rejects a retired plan', () => {
    expect(resolveRequestedPrice('legacy', 'month', catalogPlans, catalogPrices))
      .toEqual({ ok: false, error: 'Plan "legacy" is not available for purchase.' });
  });

  it('rejects a non-public plan, so a $0.01 partner price cannot be self-served', () => {
    const r = resolveRequestedPrice('partner_white_label', 'month', catalogPlans, catalogPrices);
    expect(r).toEqual({ ok: false, error: 'Plan "partner_white_label" is not self-serve; contact sales.' });
  });

  it('rejects a plan with no active price for the requested interval', () => {
    expect(resolveRequestedPrice('starter', 'year', catalogPlans, catalogPrices))
      .toEqual({ ok: false, error: 'Plan "starter" has no active yearly price configured.' });
  });

  it('rejects a non-string plan id', () => {
    expect(resolveRequestedPrice(null, 'month', catalogPlans, catalogPrices)).toEqual({ ok: false, error: 'A plan id is required.' });
    expect(resolveRequestedPrice(42, 'month', catalogPlans, catalogPrices)).toEqual({ ok: false, error: 'A plan id is required.' });
    expect(resolveRequestedPrice({ id: 'enterprise' }, 'month', catalogPlans, catalogPrices)).toEqual({ ok: false, error: 'A plan id is required.' });
  });
});

// ---------------------------------------------------------------------------
// Plan versioning
//
// Entitlement used to be copied from the live plan row, so editing the catalog
// re-termed every existing subscriber on their next webhook. These tests hold
// the pin in place.
// ---------------------------------------------------------------------------
const VERSIONS: PlanVersionRecord[] = [
  { id: 'v-pro-1', plan_id: 'professional', version: 1,
    features: ['estimating', 'projects', 'ai_plan_review'],
    max_seats: 10, max_active_estimates: 250, max_active_projects: 75, storage_gb: 100, ai_credits_per_month: 2000 },
  { id: 'v-pro-2', plan_id: 'professional', version: 2,
    features: ['estimating', 'projects'],
    max_seats: 8, max_active_estimates: 200, max_active_projects: 60, storage_gb: 100, ai_credits_per_month: 1500 },
  { id: 'v-starter-1', plan_id: 'starter', version: 1,
    features: ['estimating'],
    max_seats: 3, max_active_estimates: 25, max_active_projects: 10, storage_gb: 10, ai_credits_per_month: 250 },
];

describe('which terms govern a subscription', () => {
  it('takes the current version for a new subscription', () => {
    const r = resolvePlanVersion('professional', null, VERSIONS);
    expect(r.version?.id).toBe('v-pro-2');
    expect(r.warnings).toEqual([]);
  });

  it('keeps the version a customer already holds', () => {
    // Grandfathering is the entire point. A customer who bought version 1 keeps
    // version 1 while they stay on the plan.
    const r = resolvePlanVersion('professional',
      { plan_id: 'professional', plan_version_id: 'v-pro-1' }, VERSIONS);
    expect(r.version?.version).toBe(1);
    expect(r.warnings).toEqual([]);
  });

  it('takes the current version when the customer changes plan', () => {
    // Changing plan is a new purchase, and a new purchase is on today's terms.
    const r = resolvePlanVersion('starter',
      { plan_id: 'professional', plan_version_id: 'v-pro-1' }, VERSIONS);
    expect(r.version?.id).toBe('v-starter-1');
  });

  it('says so when a subscription predates versioning', () => {
    const r = resolvePlanVersion('professional',
      { plan_id: 'professional', plan_version_id: null }, VERSIONS);
    expect(r.version?.id).toBe('v-pro-2');
    expect(r.warnings.join(' ')).toContain('predates plan versioning');
    expect(r.warnings.join(' ')).toContain('is not recorded');
  });

  it('falls back and warns when the held version has vanished', () => {
    const r = resolvePlanVersion('professional',
      { plan_id: 'professional', plan_version_id: 'v-ghost' }, VERSIONS);
    expect(r.version?.id).toBe('v-pro-2');
    expect(r.warnings.join(' ')).toContain('not among the published versions');
  });

  it('warns rather than guessing when a plan has no published version', () => {
    const r = resolvePlanVersion('enterprise', null, VERSIONS);
    expect(r.version).toBeNull();
    expect(r.warnings.join(' ')).toContain('no published version');
  });
});

describe('entitlement follows the terms that were sold, not the catalog', () => {
  it('grants the held version even after the plan has changed', () => {
    // The live `professional` plan now grants three features; version 2 grants
    // two. A customer on version 1 keeps all three.
    const state = deriveState(sub(), COMPANY, PLANS, PRICES, 'evt_1', EVENT_CREATED,
      VERSIONS, { plan_id: 'professional', plan_version_id: 'v-pro-1' });
    expect(state.entitlement.plan_version_id).toBe('v-pro-1');
    expect(state.entitlement.features).toEqual(['estimating', 'projects', 'ai_plan_review']);
    expect(state.entitlement.max_seats).toBe(10);
  });

  it('grants the current version to somebody buying today', () => {
    const state = deriveState(sub(), COMPANY, PLANS, PRICES, 'evt_1', EVENT_CREATED, VERSIONS, null);
    expect(state.entitlement.plan_version_id).toBe('v-pro-2');
    expect(state.entitlement.features).toEqual(['estimating', 'projects']);
    expect(state.entitlement.max_seats).toBe(8);
  });

  it('pins the same version onto the subscription row', () => {
    const state = deriveState(sub(), COMPANY, PLANS, PRICES, 'evt_1', EVENT_CREATED,
      VERSIONS, { plan_id: 'professional', plan_version_id: 'v-pro-1' });
    expect(state.subscription.plan_version_id).toBe('v-pro-1');
    expect(state.subscription.plan_version_id).toBe(state.entitlement.plan_version_id);
  });

  it('falls back to the live plan when no version exists, and says it did', () => {
    // Better than granting nothing, but it must not pass silently.
    const state = deriveState(sub(), COMPANY, PLANS, PRICES, 'evt_1', EVENT_CREATED, [], null);
    expect(state.entitlement.plan_version_id).toBeNull();
    expect(state.entitlement.features).toEqual(['estimating', 'projects', 'ai_plan_review']);
    expect(state.warnings.join(' ')).toContain('no published version');
  });

  it('grants nothing at all on a status nobody paid for, version or no version', () => {
    const state = deriveState(sub({ status: 'canceled' }), COMPANY, PLANS, PRICES,
      'evt_1', EVENT_CREATED, VERSIONS, { plan_id: 'professional', plan_version_id: 'v-pro-1' });
    expect(state.entitlement.is_active).toBe(false);
    expect(state.entitlement.features).toEqual([]);
    expect(state.entitlement.max_seats).toBe(0);
  });
});
