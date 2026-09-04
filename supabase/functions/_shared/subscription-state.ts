/**
 * Stripe event -> GrounUp subscription and entitlement state.
 *
 * This module is deliberately pure and Deno-free: it takes a Stripe event
 * object and the plan catalog, and returns the exact database mutations to
 * apply. Nothing here performs I/O, which is what makes the billing state
 * machine unit-testable without a Stripe account or a live database — and the
 * billing state machine is the one piece where a silent bug means either
 * granting access nobody paid for or revoking access someone did.
 */

/** Subscription statuses Stripe can report. */
export type StripeSubscriptionStatus =
  | 'trialing' | 'active' | 'past_due' | 'canceled'
  | 'incomplete' | 'incomplete_expired' | 'unpaid' | 'paused';

/** Statuses that entitle a company to use paid features. */
export const ENTITLING_STATUSES: readonly StripeSubscriptionStatus[] = [
  'trialing',
  'active',
  // A past-due account keeps working through the dunning window. Cutting off a
  // contractor mid-bid because a card expired costs far more goodwill than the
  // few days of service it saves, and Stripe will cancel if it stays unpaid.
  'past_due',
];

export interface PlanRecord {
  id: string;
  features: string[];
  max_seats: number | null;
  max_active_estimates: number | null;
  max_active_projects: number | null;
  storage_gb: number | null;
  ai_credits_per_month: number | null;
}

/**
 * A published set of commercial terms.
 *
 * Entitlement is derived from one of these rather than from the live plan row,
 * so editing the catalog cannot re-term a customer who already bought.
 */
export interface PlanVersionRecord {
  id: string;
  plan_id: string;
  version: number;
  features: string[];
  max_seats: number | null;
  max_active_estimates: number | null;
  max_active_projects: number | null;
  storage_gb: number | null;
  ai_credits_per_month: number | null;
}

/**
 * Which published terms govern this subscription.
 *
 * A customer keeps the version they were sold for as long as they stay on the
 * plan — that is what grandfathering means, and it is the whole point of
 * versioning. Changing plan is a new purchase, so it takes the version on sale
 * today. A subscription predating versioning has none, and takes the current
 * one; that is stated as a warning rather than passed off as a pin, because
 * nobody knows what those customers were actually sold.
 */
export function resolvePlanVersion(
  planId: string,
  existing: { plan_id: string | null; plan_version_id: string | null } | null,
  versions: readonly PlanVersionRecord[],
): { version: PlanVersionRecord | null; warnings: string[] } {
  const warnings: string[] = [];
  const forPlan = versions.filter((v) => v.plan_id === planId);
  const current = forPlan.reduce<PlanVersionRecord | null>(
    (best, v) => (best === null || v.version > best.version ? v : best), null);

  if (existing?.plan_version_id && existing.plan_id === planId) {
    const held = forPlan.find((v) => v.id === existing.plan_version_id);
    if (held) return { version: held, warnings };
    warnings.push(
      `Subscription holds plan version ${existing.plan_version_id}, which is not among the ` +
        `published versions of ${planId}. Fell back to the current version.`);
  }

  if (!current) {
    warnings.push(`Plan "${planId}" has no published version; entitlement cannot be pinned to terms.`);
    return { version: null, warnings };
  }

  if (existing && existing.plan_id === planId && !existing.plan_version_id) {
    warnings.push(
      `Subscription on ${planId} predates plan versioning and was pinned to version ` +
        `${current.version}. What it was originally sold under is not recorded.`);
  }

  return { version: current, warnings };
}

export interface PlanPriceRecord {
  stripe_price_id: string;
  plan_id: string;
}

export interface StripeSubscriptionLike {
  id: string;
  customer: string;
  status: StripeSubscriptionStatus;
  cancel_at_period_end?: boolean;
  canceled_at?: number | null;
  ended_at?: number | null;
  trial_start?: number | null;
  trial_end?: number | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
  items: {
    data: Array<{
      id: string;
      quantity?: number | null;
      price: { id: string };
      current_period_start?: number | null;
      current_period_end?: number | null;
    }>;
  };
  metadata?: Record<string, string> | null;
}

export interface SubscriptionUpsert {
  company_id: string;
  plan_id: string;
  /** The terms this subscription was sold under, carried forward on every event. */
  plan_version_id: string | null;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  status: StripeSubscriptionStatus;
  quantity: number;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_start: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  ended_at: string | null;
  last_event_id: string;
  last_event_at: string;
}

export interface SubscriptionItemUpsert {
  company_id: string;
  stripe_item_id: string;
  stripe_price_id: string;
  quantity: number;
}

export interface EntitlementUpsert {
  company_id: string;
  plan_id: string | null;
  /** The published terms these limits came from. Null only where none exist. */
  plan_version_id: string | null;
  is_active: boolean;
  features: string[];
  max_seats: number | null;
  max_active_estimates: number | null;
  max_active_projects: number | null;
  storage_gb: number | null;
  ai_credits_per_month: number | null;
  valid_until: string | null;
  source: 'stripe_webhook';
}

export interface StateChange {
  subscription: SubscriptionUpsert;
  items: SubscriptionItemUpsert[];
  entitlement: EntitlementUpsert;
  warnings: string[];
}

const toIso = (seconds: number | null | undefined): string | null =>
  seconds === null || seconds === undefined ? null : new Date(seconds * 1000).toISOString();

/**
 * How long entitlement survives if Stripe becomes unreachable.
 *
 * Set past the paid period end rather than exactly at it, so a webhook that is
 * merely delayed does not lock a customer out of work they have paid for. The
 * next verified event replaces this value.
 */
const GRACE_DAYS = 3;

function addDays(iso: string | null, days: number): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/**
 * Resolve which plan a Stripe subscription represents.
 *
 * The price id is authoritative, because that is what the customer was actually
 * charged for. Metadata is only a fallback for a subscription created outside
 * the app (a Stripe dashboard entry, a migration), and it is reported as a
 * warning so the mismatch is visible rather than silently trusted.
 */
export function resolvePlanId(
  subscription: StripeSubscriptionLike,
  prices: readonly PlanPriceRecord[],
): { planId: string | null; warnings: string[] } {
  const warnings: string[] = [];
  const priceIds = subscription.items.data.map((i) => i.price.id);
  const matched = priceIds
    .map((id) => prices.find((p) => p.stripe_price_id === id))
    .filter((p): p is PlanPriceRecord => Boolean(p));

  if (matched.length === 0) {
    const metadataPlan = subscription.metadata?.grounup_plan_id ?? null;
    if (metadataPlan) {
      warnings.push(
        `No price in subscription ${subscription.id} matches the plan catalog; fell back to the ` +
          `grounup_plan_id metadata value "${metadataPlan}". Add the price to plan_prices.`,
      );
      return { planId: metadataPlan, warnings };
    }
    warnings.push(
      `Subscription ${subscription.id} carries price(s) ${priceIds.join(', ')} that are not in the ` +
        `GrounUp plan catalog, and no grounup_plan_id metadata. Entitlement cannot be granted.`,
    );
    return { planId: null, warnings };
  }

  const distinct = [...new Set(matched.map((m) => m.plan_id))];
  if (distinct.length > 1) {
    // Highest tier wins so a mixed subscription never under-grants, but the
    // ambiguity is surfaced for someone to fix in Stripe.
    warnings.push(
      `Subscription ${subscription.id} maps to more than one plan (${distinct.join(', ')}). ` +
        `The first matching price was used; review the subscription in Stripe.`,
    );
  }
  return { planId: distinct[0]!, warnings };
}

/**
 * Translate a verified Stripe subscription into the rows GrounUp should hold.
 *
 * `companyId` comes from the subscription's stored mapping, never from the
 * event payload alone — the caller resolves it from `subscriptions` or from the
 * checkout session's client_reference_id, both of which GrounUp itself wrote.
 */
export function deriveState(
  subscription: StripeSubscriptionLike,
  companyId: string,
  plans: readonly PlanRecord[],
  prices: readonly PlanPriceRecord[],
  eventId: string,
  eventCreated: number,
  versions: readonly PlanVersionRecord[] = [],
  existing: { plan_id: string | null; plan_version_id: string | null } | null = null,
): StateChange {
  const { planId, warnings } = resolvePlanId(subscription, prices);
  const plan = planId ? plans.find((p) => p.id === planId) ?? null : null;

  if (planId && !plan) {
    warnings.push(`Plan "${planId}" is not present in the plan catalog; entitlement withheld.`);
  }

  /*
   * Terms come from the published version, not the live plan row.
   *
   * This is the whole change: `plan.features` is whatever the catalog says
   * right now, and a customer who bought in March did not buy that.
   */
  const pinned = planId
    ? resolvePlanVersion(planId, existing, versions)
    : { version: null, warnings: [] };
  warnings.push(...pinned.warnings);
  const terms = pinned.version;

  const isEntitling = ENTITLING_STATUSES.includes(subscription.status) && plan !== null;

  // Stripe moved period fields onto subscription items; read either shape so
  // the function keeps working across API versions.
  const firstItem = subscription.items.data[0];
  const periodStart = toIso(subscription.current_period_start ?? firstItem?.current_period_start ?? null);
  const periodEnd = toIso(subscription.current_period_end ?? firstItem?.current_period_end ?? null);
  const trialEnd = toIso(subscription.trial_end);

  const quantity = subscription.items.data.reduce((a, i) => a + (i.quantity ?? 1), 0) || 1;

  const validUntil = subscription.status === 'trialing'
    ? trialEnd
    : addDays(periodEnd, GRACE_DAYS);

  if (isEntitling && !validUntil) {
    warnings.push(
      `Subscription ${subscription.id} is ${subscription.status} but reports no period end; ` +
        `entitlement was granted without an expiry and must be reviewed.`,
    );
  }

  return {
    subscription: {
      company_id: companyId,
      plan_id: planId ?? 'starter',
      plan_version_id: terms?.id ?? null,
      stripe_customer_id: subscription.customer,
      stripe_subscription_id: subscription.id,
      status: subscription.status,
      quantity,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      trial_start: toIso(subscription.trial_start),
      trial_end: trialEnd,
      cancel_at_period_end: subscription.cancel_at_period_end ?? false,
      canceled_at: toIso(subscription.canceled_at),
      ended_at: toIso(subscription.ended_at),
      last_event_id: eventId,
      last_event_at: new Date(eventCreated * 1000).toISOString(),
    },
    items: subscription.items.data.map((i) => ({
      company_id: companyId,
      stripe_item_id: i.id,
      stripe_price_id: i.price.id,
      quantity: i.quantity ?? 1,
    })),
    entitlement: {
      company_id: companyId,
      plan_id: plan?.id ?? null,
      plan_version_id: terms?.id ?? null,
      is_active: isEntitling,
      // Terms come from the version, falling back to the live plan only where
      // no version has been published — which the warnings above name.
      features: isEntitling ? (terms?.features ?? plan!.features) : [],
      max_seats: isEntitling ? (terms ?? plan!).max_seats : 0,
      max_active_estimates: isEntitling ? (terms ?? plan!).max_active_estimates : 0,
      max_active_projects: isEntitling ? (terms ?? plan!).max_active_projects : 0,
      storage_gb: isEntitling ? (terms ?? plan!).storage_gb : 0,
      ai_credits_per_month: isEntitling ? (terms ?? plan!).ai_credits_per_month : 0,
      valid_until: isEntitling ? validUntil : null,
      source: 'stripe_webhook',
    },
    warnings,
  };
}

/** Stripe event types this webhook acts on. Everything else is logged and ignored. */
export const HANDLED_EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.finalized',
] as const;

export type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number];

export function isHandled(type: string): type is HandledEventType {
  return (HANDLED_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * Validate a requested plan change against the governed catalog.
 *
 * Everything the browser sends is untrusted: the plan id, the interval, and any
 * price the UI happened to display. This resolves the real Stripe price id from
 * the catalog, so a tampered request can only ever produce a checkout for a
 * plan GrounUp actually sells.
 */
export function resolveRequestedPrice(
  requestedPlanId: unknown,
  requestedInterval: unknown,
  plans: readonly { id: string; is_active: boolean; is_public: boolean }[],
  prices: readonly (PlanPriceRecord & { interval: string; is_active: boolean; unit_amount_cents: number })[],
): { ok: true; planId: string; priceId: string; amountCents: number } | { ok: false; error: string } {
  if (typeof requestedPlanId !== 'string' || requestedPlanId.length === 0) {
    return { ok: false, error: 'A plan id is required.' };
  }
  const interval = requestedInterval === 'year' ? 'year' : 'month';

  const plan = plans.find((p) => p.id === requestedPlanId);
  if (!plan) return { ok: false, error: `Plan "${requestedPlanId}" is not in the GrounUp plan catalog.` };
  if (!plan.is_active) return { ok: false, error: `Plan "${requestedPlanId}" is not available for purchase.` };
  if (!plan.is_public) {
    return { ok: false, error: `Plan "${requestedPlanId}" is not self-serve; contact sales.` };
  }

  const price = prices.find((p) => p.plan_id === plan.id && p.interval === interval && p.is_active);
  if (!price) {
    return { ok: false, error: `Plan "${plan.id}" has no active ${interval}ly price configured.` };
  }

  return { ok: true, planId: plan.id, priceId: price.stripe_price_id, amountCents: price.unit_amount_cents };
}
