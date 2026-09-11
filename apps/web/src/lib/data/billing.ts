/**
 * Billing, read from the state a verified webhook wrote.
 *
 * This screen was the last one in the application computing from literals. Five
 * usage bars, four invoices, a plan, a period, a card and the word "Active"
 * were all typed into the component — `{ metric: 'Seats', used: 7, limit: 10 }`
 * — drawn in the same colors and the same shapes as everything real beside
 * them. A customer looking at their own billing page saw somebody else's
 * numbers presented as theirs, which is worse here than anywhere: this is the
 * page a dispute starts on.
 *
 * Nothing new was needed in the database to fix it. Migration 0009 built the
 * subscriptions, entitlements, invoices and usage tables; 0031 built
 * `reporting_plan_usage` for the three enforced limits; 0069 built
 * `reporting_company_usage` for the three metered ones; 0077 built `my_plan`.
 * Every one of them was tested and none of them had a reader. This file is the
 * door.
 *
 * Two properties the reads are shaped around:
 *
 *   * **The number shown is the number enforced.** Seats, estimates and
 *     projects come from the same view the limit check reads, so a screen
 *     saying 7 of 10 and a refusal at the eleventh cannot disagree.
 *   * **Nothing here is writable from the browser.** There is no INSERT or
 *     UPDATE policy on any of these tables for `authenticated`: they are
 *     written exclusively by the stripe-webhook function under the service
 *     role. That is the structural form of "a browser redirect grants nothing".
 */
import { unwrap, type Query } from './query';

/** The statuses that mean a subscription is the live one for a company. */
const LIVE: readonly string[] = ['trialing', 'active', 'past_due', 'unpaid', 'paused'];

/**
 * Every read here is curried on the company.
 *
 * Row level security already limits the caller to their own companies, so an
 * unfiltered read is safe — it is only *ambiguous*, and somebody who belongs to
 * two would get whichever row came back first. On a page about money that is
 * not a defect worth having.
 */
type ForCompany<T> = (companyId: string | null) => Query<T>;

export interface MyPlan {
  companyId: string;
  planId: string | null;
  planName: string | null;
  tagline: string | null;
  features: string[];
  everythingIncluded: boolean;
  accessValidUntil: string | null;
  entitlementSource: string | null;
  onTheFreePlan: boolean;
}

/**
 * Which plan a company is actually on.
 *
 * Derived rather than read off a subscription row, because the two can differ
 * legitimately: an enterprise contract or an attributed manual grant entitles a
 * company with no Stripe subscription at all, and a canceled subscription still
 * entitles until its period ends.
 */
export const loadMyPlan: ForCompany<MyPlan | null> = (companyId) => async (client) => {
  let query = client
    .from('my_plan')
    .select('company_id, plan_id, plan_name, tagline, features, everything_included, access_valid_until, entitlement_source, on_the_free_plan');
  if (companyId) query = query.eq('company_id', companyId);
  const rows = unwrap(await query.limit(1)) as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) return null;
  return {
    companyId: String(r.company_id),
    planId: (r.plan_id as string | null) ?? null,
    planName: (r.plan_name as string | null) ?? null,
    tagline: (r.tagline as string | null) ?? null,
    features: (r.features as string[] | null) ?? [],
    everythingIncluded: Boolean(r.everything_included),
    accessValidUntil: (r.access_valid_until as string | null) ?? null,
    entitlementSource: (r.entitlement_source as string | null) ?? null,
    onTheFreePlan: Boolean(r.on_the_free_plan),
  };
};

export interface SubscriptionView {
  planId: string;
  planName: string;
  status: string;
  /** Whether this is the subscription currently governing access. */
  isLive: boolean;
  quantity: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  paymentBrand: string | null;
  paymentLast4: string | null;
  /** When a verified webhook last advanced this row. */
  lastEventAt: string | null;
  /**
   * What the next invoice comes to, in cents, from the prices on the
   * subscription's own items rather than from today's catalog — a company on a
   * grandfathered price is charged the price they hold, and this is that price.
   * Null when no licensed item carries an amount the platform can see.
   */
  recurringCents: number | null;
  interval: 'month' | 'year' | null;
  /** True when part of the bill is metered, so the total is a floor. */
  hasMeteredItems: boolean;
}

export const loadMySubscription: ForCompany<SubscriptionView | null> = (companyId) => async (client) => {
  let query = client
    .from('subscriptions')
    .select(
      'id, plan_id, status, quantity, current_period_start, current_period_end, trial_end, '
      + 'cancel_at_period_end, canceled_at, last_event_at, '
      + 'default_payment_method_brand, default_payment_method_last4, created_at, '
      + 'plans(name)');
  if (companyId) query = query.eq('company_id', companyId);
  /*
   * Through `unknown`, because an embedded relation is typed as either the rows
   * or PostgREST's own error shape and the two do not overlap. `unwrap` has
   * already thrown on the error case; this only tells the compiler so.
   */
  const rows = unwrap(
    await query.order('created_at', { ascending: false })) as unknown as Array<Record<string, unknown>>;
  if (rows.length === 0) return null;

  /*
   * The live one, or the most recent if none is live. A company that canceled
   * last month has a row, and showing it as their subscription is right —
   * showing it as active would not be, which is what `isLive` is for.
   */
  const row = rows.find((r) => LIVE.includes(String(r.status))) ?? rows[0]!;
  const plan = row.plans as { name?: string } | null;

  const items = unwrap(await client
    .from('subscription_items')
    .select('quantity, stripe_price_id, plan_prices(unit_amount_cents, interval, usage_type)')
    .eq('subscription_id', String(row.id))) as unknown as Array<Record<string, unknown>>;

  let cents = 0;
  let seen = false;
  let interval: 'month' | 'year' | null = null;
  let metered = false;
  for (const item of items) {
    const price = item.plan_prices as
      { unit_amount_cents?: number; interval?: string; usage_type?: string } | null;
    if (!price) continue;
    if (price.usage_type === 'metered') { metered = true; continue; }
    seen = true;
    cents += Number(price.unit_amount_cents ?? 0) * Number(item.quantity ?? 1);
    interval = (price.interval as 'month' | 'year' | undefined) ?? interval;
  }

  return {
    planId: String(row.plan_id),
    planName: plan?.name ?? String(row.plan_id),
    status: String(row.status),
    isLive: LIVE.includes(String(row.status)),
    quantity: Number(row.quantity ?? 1),
    currentPeriodStart: (row.current_period_start as string | null) ?? null,
    currentPeriodEnd: (row.current_period_end as string | null) ?? null,
    trialEnd: (row.trial_end as string | null) ?? null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    canceledAt: (row.canceled_at as string | null) ?? null,
    paymentBrand: (row.default_payment_method_brand as string | null) ?? null,
    paymentLast4: (row.default_payment_method_last4 as string | null) ?? null,
    lastEventAt: (row.last_event_at as string | null) ?? null,
    recurringCents: seen ? cents : null,
    interval,
    hasMeteredItems: metered,
  };
};

export interface UsageLine {
  metric: string;
  used: number;
  /** Null is unlimited, which is not the same as zero. */
  limit: number | null;
  unit: string;
  /** What the figure counts, for the reader who is about to hit the limit. */
  note: string;
}

/**
 * What the company has used against what it is allowed.
 *
 * Two views, because the platform measures two different kinds of thing and
 * says so. `reporting_plan_usage` holds the three limits that are *enforced* —
 * a refusal happens at the boundary — and `reporting_company_usage` holds what
 * is *metered*: storage occupied now, AI requests made this period.
 *
 * Seats appear from the enforced side rather than the billable side on purpose.
 * They are different counts and both are correct: billing counts people who can
 * sign in, and the limit counts them plus the invitations already sent. The one
 * on this bar is the one that will refuse the next invitation.
 */
export const loadUsage: ForCompany<UsageLine[]> = (companyId) => async (client) => {
  let plans = client.from('reporting_plan_usage').select('resource, used, allowed');
  let companies = client.from('reporting_company_usage')
    .select('seats, ai_requests_this_period, ai_credits_included, storage_gb, storage_gb_included, files_without_a_size');
  if (companyId) {
    plans = plans.eq('company_id', companyId);
    companies = companies.eq('company_id', companyId);
  }
  const [planRows, companyRows] = await Promise.all([plans, companies]);

  const plan = unwrap(planRows) as Array<Record<string, unknown>>;
  const company = (unwrap(companyRows) as Array<Record<string, unknown>>)[0] ?? null;

  const enforced = (resource: string) => plan.find((r) => String(r.resource) === resource);
  const line = (
    metric: string, row: Record<string, unknown> | undefined, unit: string, note: string,
  ): UsageLine | null => (row
    ? {
      metric,
      used: Number(row.used ?? 0),
      limit: row.allowed == null ? null : Number(row.allowed),
      unit,
      note,
    }
    : null);

  const lines: Array<UsageLine | null> = [
    line('Seats', enforced('users'), '',
      'People who can sign in, plus invitations already sent.'),
    line('Active estimates', enforced('active estimates'), '',
      'Everything not archived or lost.'),
    line('Active projects', enforced('active projects'), '',
      'Everything not closed or canceled.'),
  ];

  if (company) {
    const unsized = Number(company.files_without_a_size ?? 0);
    lines.push({
      metric: 'Storage',
      used: Number(company.storage_gb ?? 0),
      limit: company.storage_gb_included == null ? null : Number(company.storage_gb_included),
      unit: ' GB',
      note: unsized > 0
        ? `What is held right now, not everything ever uploaded. ${unsized} ${unsized === 1 ? 'file has' : 'files have'} no recorded size and are not in this figure.`
        : 'What is held right now, not everything ever uploaded.',
    });
    lines.push({
      metric: 'AI credits this period',
      used: Number(company.ai_requests_this_period ?? 0),
      limit: company.ai_credits_included == null ? null : Number(company.ai_credits_included),
      unit: '',
      note: 'Requests since the current billing period began.',
    });
  }

  return lines.filter((l): l is UsageLine => l !== null);
};

/** Billable seats: people who can sign in. What the invoice is counted on. */
export const loadBillableSeats: ForCompany<number | null> = (companyId) => async (client) => {
  let query = client.from('reporting_company_usage').select('seats');
  if (companyId) query = query.eq('company_id', companyId);
  const rows = unwrap(await query.limit(1)) as Array<Record<string, unknown>>;
  return rows[0] ? Number(rows[0].seats ?? 0) : null;
};

export interface InvoiceView {
  id: string;
  number: string | null;
  status: string;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  hostedUrl: string | null;
  pdfUrl: string | null;
  issuedAt: string | null;
  paidAt: string | null;
}

/**
 * What has actually been charged.
 *
 * Mirrored from Stripe by the webhook rather than fetched live, so the history
 * renders when Stripe is unreachable — and Stripe stays the system of record,
 * which is what the links to the hosted invoice and the PDF are for.
 */
export const loadInvoices: ForCompany<InvoiceView[]> = (companyId) => async (client) => {
  let query = client
    .from('billing_invoices')
    .select('id, number, status, amount_due_cents, amount_paid_cents, currency, period_start, period_end, hosted_invoice_url, invoice_pdf_url, issued_at, paid_at');
  if (companyId) query = query.eq('company_id', companyId);
  const rows = unwrap(await query
    .order('issued_at', { ascending: false, nullsFirst: false })
    .limit(24)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    number: (r.number as string | null) ?? null,
    status: String(r.status),
    amountDueCents: Number(r.amount_due_cents ?? 0),
    amountPaidCents: Number(r.amount_paid_cents ?? 0),
    currency: String(r.currency ?? 'USD'),
    periodStart: (r.period_start as string | null) ?? null,
    periodEnd: (r.period_end as string | null) ?? null,
    hostedUrl: (r.hosted_invoice_url as string | null) ?? null,
    pdfUrl: (r.invoice_pdf_url as string | null) ?? null,
    issuedAt: (r.issued_at as string | null) ?? null,
    paidAt: (r.paid_at as string | null) ?? null,
  }));
};

/** How a subscription status reads to somebody who is not a billing engineer. */
export const STATUS_SAYS: Record<string, { label: string; tone: 'success' | 'warn' | 'danger' | 'default' }> = {
  active: { label: 'Active', tone: 'success' },
  trialing: { label: 'In trial', tone: 'success' },
  past_due: { label: 'Payment overdue', tone: 'warn' },
  unpaid: { label: 'Unpaid', tone: 'danger' },
  paused: { label: 'Paused', tone: 'warn' },
  canceled: { label: 'Canceled', tone: 'default' },
  incomplete: { label: 'Never completed', tone: 'warn' },
  incomplete_expired: { label: 'Expired before it started', tone: 'default' },
};

export interface BillingTerm {
  kind: string;
  percentOff: number | null;
  seatPriceCents: number | null;
  reason: string | null;
  validUntil: string | null;
  createdAt: string;
  /** What a seat actually costs this company after the terms are applied. */
  seatPriceMonthCents: number | null;
  seatPriceYearCents: number | null;
}

/**
 * Why this company's invoice is what it is.
 *
 * Migration 0076 built `company_billing_terms` — a negotiated discount, a fixed
 * seat price, a nonprofit rate — and `my_billing_terms` to show it, with a
 * comment saying in as many words that a customer unable to see why their
 * invoice is what it is would be its own defect. The view was then read by
 * nothing for the same reason everything else on this page was: the billing
 * screen was a fixture. A company with a negotiated 20% could see the list
 * price and never the 20%.
 *
 * Revoked terms are excluded by the view, so anything returned here is live.
 */
export const loadBillingTerms: ForCompany<BillingTerm[]> = (companyId) => async (client) => {
  let query = client
    .from('my_billing_terms')
    .select('kind, percent_off, seat_price_cents, reason, valid_until, created_at,'
      + ' seat_price_month_cents, seat_price_year_cents');
  if (companyId) query = query.eq('company_id', companyId);
  const rows = unwrap(await query.order('created_at', { ascending: false })) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    kind: String(r.kind),
    percentOff: r.percent_off === null || r.percent_off === undefined ? null : Number(r.percent_off),
    seatPriceCents: r.seat_price_cents === null || r.seat_price_cents === undefined
      ? null : Number(r.seat_price_cents),
    reason: (r.reason as string | null) ?? null,
    validUntil: (r.valid_until as string | null) ?? null,
    createdAt: String(r.created_at),
    seatPriceMonthCents: r.seat_price_month_cents === null || r.seat_price_month_cents === undefined
      ? null : Number(r.seat_price_month_cents),
    seatPriceYearCents: r.seat_price_year_cents === null || r.seat_price_year_cents === undefined
      ? null : Number(r.seat_price_year_cents),
  }));
};

export interface RefundView {
  kind: string;
  amountCents: number;
  currency: string;
  /** The state in words. The view writes this; the screen never invents one. */
  standing: string;
  requestedAt: string;
  appliedAt: string | null;
}

/**
 * Money coming back, and where it has got to.
 *
 * Migration 0085 built refund requests with a deliberate split: the internal
 * reason and the note between operators stay inside, and the customer sees the
 * state in plain words — 'Being reviewed', 'Refunded to your card'. Getting that
 * split right and then never rendering it meant a customer who had been
 * promised a credit had no way to see it existed, and would ask again.
 *
 * The phrase is taken from the view rather than mapped here on purpose: two
 * places deciding what 'applied' means to a customer is how they come to
 * disagree.
 */
export const loadRefunds: ForCompany<RefundView[]> = (companyId) => async (client) => {
  let query = client
    .from('my_refunds')
    .select('kind, amount_cents, currency, standing, requested_at, applied_at');
  if (companyId) query = query.eq('company_id', companyId);
  const rows = unwrap(await query.order('requested_at', { ascending: false })) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    kind: String(r.kind),
    amountCents: Number(r.amount_cents ?? 0),
    currency: String(r.currency ?? 'USD'),
    standing: String(r.standing ?? ''),
    requestedAt: String(r.requested_at),
    appliedAt: (r.applied_at as string | null) ?? null,
  }));
};

/** How far along a refund is, for the badge beside it. */
export const REFUND_TONE: Record<string, 'success' | 'warn' | 'danger' | 'default'> = {
  'Being reviewed': 'warn',
  'Approved, being processed': 'warn',
  'Refunded to your card': 'success',
  'Credited to your next invoice': 'success',
  'Not approved': 'default',
  'Could not be processed': 'danger',
};
