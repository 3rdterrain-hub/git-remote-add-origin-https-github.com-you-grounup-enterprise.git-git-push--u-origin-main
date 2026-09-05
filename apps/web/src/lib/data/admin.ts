/**
 * Running the platform, as opposed to using it.
 *
 * Everything else in this application reads one company's own records. These
 * read across all of them, which is why the boundary is drawn in the database
 * rather than here: `admin_companies` and `admin_webhook_health` are the only
 * two definer views in the schema, they carry operational fact and no customer
 * business data, and they return nothing at all to somebody who is not a
 * platform operator.
 *
 * So there is no permission check in this module. There is nothing here worth
 * hiding that the database does not already refuse to hand over.
 */
import { callFunction } from '@/lib/supabase';
import { unwrap, type Query } from './query';

export interface AdminCompany {
  companyId: string;
  name: string;
  slug: string;
  createdAt: string;
  planId: string | null;
  entitlementActive: boolean;
  entitlementSource: string | null;
  entitlementValidUntil: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  memberCount: number;
  ownerEmail: string | null;
  overrideCount: number;
  /** Counts, never contents. */
  estimateCount: number;
  projectCount: number;
}

export const loadAdminCompanies: Query<AdminCompany[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_companies')
    .select('company_id, name, slug, created_at, plan_id, entitlement_active, entitlement_source, entitlement_valid_until, subscription_status, current_period_end, cancel_at_period_end, member_count, owner_email, override_count, estimate_count, project_count')
    .order('created_at', { ascending: false })
    .limit(500)) as Array<Record<string, unknown>>;
  return rows.map((c) => ({
    companyId: String(c.company_id),
    name: String(c.name),
    slug: String(c.slug),
    createdAt: String(c.created_at),
    planId: (c.plan_id as string | null) ?? null,
    entitlementActive: Boolean(c.entitlement_active),
    entitlementSource: (c.entitlement_source as string | null) ?? null,
    entitlementValidUntil: (c.entitlement_valid_until as string | null) ?? null,
    subscriptionStatus: (c.subscription_status as string | null) ?? null,
    currentPeriodEnd: (c.current_period_end as string | null) ?? null,
    cancelAtPeriodEnd: Boolean(c.cancel_at_period_end),
    memberCount: Number(c.member_count ?? 0),
    ownerEmail: (c.owner_email as string | null) ?? null,
    overrideCount: Number(c.override_count ?? 0),
    estimateCount: Number(c.estimate_count ?? 0),
    projectCount: Number(c.project_count ?? 0),
  }));
};

export interface WebhookEvent {
  eventId: string;
  type: string;
  receivedAt: string;
  processedAt: string | null;
  processingState: string | null;
  processingError: string | null;
  attempts: number;
  livemode: boolean;
  unprocessed: boolean;
}

export const loadWebhookHealth: Query<WebhookEvent[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_webhook_health')
    .select('event_id, type, received_at, processed_at, processing_state, processing_error, attempts, livemode, unprocessed')
    .limit(200)) as Array<Record<string, unknown>>;
  return rows.map((e) => ({
    eventId: String(e.event_id),
    type: String(e.type),
    receivedAt: String(e.received_at),
    processedAt: (e.processed_at as string | null) ?? null,
    processingState: (e.processing_state as string | null) ?? null,
    processingError: (e.processing_error as string | null) ?? null,
    attempts: Number(e.attempts ?? 0),
    livemode: Boolean(e.livemode),
    unprocessed: Boolean(e.unprocessed),
  }));
};

export interface Override {
  id: string;
  companyId: string;
  feature: string;
  effect: 'grant' | 'revoke';
  reason: string;
  grantedAt: string;
  validUntil: string | null;
}

export const loadOverrides: Query<Override[]> = async (client) => {
  const rows = unwrap(await client
    .from('entitlement_overrides')
    .select('id, company_id, feature, effect, reason, granted_at, valid_until')
    .is('revoked_at', null)
    .order('granted_at', { ascending: false })) as Array<Record<string, unknown>>;
  return rows.map((o) => ({
    id: String(o.id),
    companyId: String(o.company_id),
    feature: String(o.feature),
    effect: o.effect as Override['effect'],
    reason: String(o.reason),
    grantedAt: String(o.granted_at),
    validUntil: (o.valid_until as string | null) ?? null,
  }));
};

type Rpc = {
  rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/** Whether the signed-in person operates the platform. */
export async function isPlatformAdmin(client: Rpc): Promise<boolean> {
  const { data, error } = await client.rpc('is_platform_admin', {});
  if (error) throw new Error(error.message);
  return data === true;
}

/**
 * Turn a feature on or off for one company.
 *
 * The reason is required by the database, not by this function — an override
 * nobody can explain eighteen months later is the thing being prevented, and
 * enforcing that in a form would leave every other caller free to skip it.
 */
export async function setFeatureOverride(
  client: Rpc,
  input: { companyId: string; feature: string; effect: 'grant' | 'revoke';
           reason: string; validUntil?: string | null },
): Promise<void> {
  const { error } = await client.rpc('set_feature_override', {
    p_company: input.companyId,
    p_feature: input.feature,
    p_effect: input.effect,
    p_reason: input.reason,
    p_valid_until: input.validUntil ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Withdraw an override, returning the company to whatever its plan says. */
export async function clearFeatureOverride(
  client: Rpc, companyId: string, feature: string, reason: string,
): Promise<void> {
  const { error } = await client.rpc('clear_feature_override', {
    p_company: companyId, p_feature: feature, p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Roles, proposals and where the potential is
// ---------------------------------------------------------------------------
export type OperatorRole = 'superadmin' | 'sales';

export interface Operator {
  id: string;
  userId: string;
  email: string | null;
  role: OperatorRole;
  /** Which platform role they hold, and therefore what they may do. */
  roleKey: string;
  reason: string;
  grantedAt: string;
  revokedAt: string | null;
}

export const loadOperators: Query<Operator[]> = async (client) => {
  const rows = unwrap(await client
    .from('platform_admins')
    .select('id, user_id, role, role_key, reason, granted_at, revoked_at, user_profiles(email)')
    .order('granted_at', { ascending: false })) as Array<Record<string, unknown>>;
  return rows.map((o) => {
    const p = o.user_profiles as { email?: string } | Array<{ email?: string }> | null;
    const one = Array.isArray(p) ? p[0] : p;
    return {
      id: String(o.id), userId: String(o.user_id),
      email: one?.email ?? null,
      role: o.role as OperatorRole,
      roleKey: String(o.role_key ?? o.role),
      reason: String(o.reason),
      grantedAt: String(o.granted_at),
      revokedAt: (o.revoked_at as string | null) ?? null,
    };
  });
};

export interface UpsellPotential {
  companyId: string;
  name: string;
  currentPlan: string | null;
  currentPlanName: string | null;
  /* Seats in use against seats billed: the whole relationship on a per-seat plan. */
  seatsInUse: number;
  seatsBilled: number | null;
  seatsUnbilled: number;
  aiRequestsThisPeriod: number;
  aiCreditsIncluded: number | null;
  storageGb: number;
  storageGbIncluded: number | null;
  entitlementSource: string | null;
  trialEnds: string | null;
  subscriptionStatus: string | null;
  /** Why this customer is worth a call, derived rather than guessed. Null is a real answer. */
  signal: string | null;
  openProposals: number;
}

export const loadUpsellPotential: Query<UpsellPotential[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_upsell_potential')
    .select('company_id, name, current_plan, current_plan_name, seats_in_use, seats_billed, seats_unbilled, ai_requests_this_period, ai_credits_included, storage_gb, storage_gb_included, entitlement_source, trial_ends, subscription_status, signal, open_proposals')
    .order('name')) as Array<Record<string, unknown>>;
  return rows.map((u) => ({
    companyId: String(u.company_id), name: String(u.name),
    currentPlan: (u.current_plan as string | null) ?? null,
    currentPlanName: (u.current_plan_name as string | null) ?? null,
    seatsInUse: Number(u.seats_in_use ?? 0),
    seatsBilled: u.seats_billed == null ? null : Number(u.seats_billed),
    seatsUnbilled: Number(u.seats_unbilled ?? 0),
    aiRequestsThisPeriod: Number(u.ai_requests_this_period ?? 0),
    aiCreditsIncluded: u.ai_credits_included == null ? null : Number(u.ai_credits_included),
    storageGb: Number(u.storage_gb ?? 0),
    storageGbIncluded: u.storage_gb_included == null ? null : Number(u.storage_gb_included),
    entitlementSource: (u.entitlement_source as string | null) ?? null,
    trialEnds: (u.trial_ends as string | null) ?? null,
    subscriptionStatus: (u.subscription_status as string | null) ?? null,
    signal: (u.signal as string | null) ?? null,
    openProposals: Number(u.open_proposals ?? 0),
  }));
};

export interface Proposal {
  id: string;
  companyId: string;
  proposedPlanId: string | null;
  proposedFeatures: string[];
  rationale: string;
  estimatedMonthlyCents: number | null;
  state: 'proposed' | 'approved' | 'rejected' | 'withdrawn' | 'applied';
  proposedBy: string | null;
  proposedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

export const loadProposals: Query<Proposal[]> = async (client) => {
  const rows = unwrap(await client
    .from('upsell_proposals')
    .select('id, company_id, proposed_plan_id, proposed_features, rationale, estimated_monthly_cents, state, proposed_by, proposed_at, decided_at, decision_note')
    .order('proposed_at', { ascending: false })
    .limit(300)) as Array<Record<string, unknown>>;
  return rows.map((p) => ({
    id: String(p.id), companyId: String(p.company_id),
    proposedPlanId: (p.proposed_plan_id as string | null) ?? null,
    proposedFeatures: (p.proposed_features as string[]) ?? [],
    rationale: String(p.rationale),
    estimatedMonthlyCents: p.estimated_monthly_cents == null
      ? null : Number(p.estimated_monthly_cents),
    state: p.state as Proposal['state'],
    proposedBy: (p.proposed_by as string | null) ?? null,
    proposedAt: String(p.proposed_at),
    decidedAt: (p.decided_at as string | null) ?? null,
    decisionNote: (p.decision_note as string | null) ?? null,
  }));
};

export interface PlanRow {
  id: string; name: string; tagline: string | null; tier: number;
  isPublic: boolean; isActive: boolean;
  maxSeats: number | null; maxActiveEstimates: number | null;
  maxActiveProjects: number | null; storageGb: number | null;
  aiCreditsPerMonth: number | null; features: string[]; trialDays: number;
}

export const loadPlans: Query<PlanRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('plans')
    .select('id, name, tagline, tier, is_public, is_active, max_seats, max_active_estimates, max_active_projects, storage_gb, ai_credits_per_month, features, trial_days')
    .order('tier')) as Array<Record<string, unknown>>;
  return rows.map((p) => ({
    id: String(p.id), name: String(p.name),
    tagline: (p.tagline as string | null) ?? null,
    tier: Number(p.tier ?? 0),
    isPublic: Boolean(p.is_public), isActive: Boolean(p.is_active),
    maxSeats: p.max_seats == null ? null : Number(p.max_seats),
    maxActiveEstimates: p.max_active_estimates == null ? null : Number(p.max_active_estimates),
    maxActiveProjects: p.max_active_projects == null ? null : Number(p.max_active_projects),
    storageGb: p.storage_gb == null ? null : Number(p.storage_gb),
    aiCreditsPerMonth: p.ai_credits_per_month == null ? null : Number(p.ai_credits_per_month),
    features: (p.features as string[]) ?? [],
    trialDays: Number(p.trial_days ?? 0),
  }));
};

/** Whether the signed-in operator is the one who decides. */
export async function isSuperadmin(client: Rpc): Promise<boolean> {
  const { data, error } = await client.rpc('is_superadmin', {});
  if (error) throw new Error(error.message);
  return data === true;
}

export async function proposeUpsell(
  client: Rpc,
  input: { companyId: string; planId: string | null; features: string[];
           rationale: string; estimatedMonthlyCents: number | null },
): Promise<void> {
  const { error } = await client.rpc('propose_upsell', {
    p_company: input.companyId,
    p_plan_id: input.planId,
    p_features: input.features,
    p_rationale: input.rationale,
    p_estimated_monthly_cents: input.estimatedMonthlyCents,
  });
  if (error) throw new Error(error.message);
}

export async function decideUpsell(
  client: Rpc, proposalId: string, approve: boolean, note: string | null,
): Promise<void> {
  const { error } = await client.rpc('decide_upsell', {
    p_proposal: proposalId, p_approve: approve, p_note: note,
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Prices, and the first operator seat
// ---------------------------------------------------------------------------
export interface PlanPriceRow {
  planId: string;
  interval: 'month' | 'year';
  unitAmountCents: number;
  currency: string;
  stripePriceId: string;
  isActive: boolean;
}

export const loadPlanPrices: Query<PlanPriceRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('plan_prices')
    .select('plan_id, interval, unit_amount_cents, currency, stripe_price_id, is_active')
    .order('plan_id')) as Array<Record<string, unknown>>;
  return rows.map((p) => ({
    planId: String(p.plan_id),
    interval: p.interval as 'month' | 'year',
    unitAmountCents: Number(p.unit_amount_cents ?? 0),
    currency: String(p.currency),
    stripePriceId: String(p.stripe_price_id),
    isActive: Boolean(p.is_active),
  }));
};

/**
 * Publish a price.
 *
 * The Stripe price id is required by the database, not by this function. GrounUp
 * does not create prices in Stripe — the object has to exist there first — and
 * quoting a number checkout cannot charge is worse than quoting none.
 */
export async function setPlanPrice(
  client: Rpc,
  input: { planId: string; interval: 'month' | 'year';
           unitAmountCents: number; stripePriceId: string; currency?: string },
): Promise<void> {
  const { error } = await client.rpc('set_plan_price', {
    p_plan_id: input.planId,
    p_interval: input.interval,
    p_unit_amount_cents: input.unitAmountCents,
    p_stripe_price_id: input.stripePriceId,
    p_currency: input.currency ?? 'USD',
  });
  if (error) throw new Error(error.message);
}

/** Whether nobody yet holds the superadmin seat, so a screen may offer it. */
export async function superadminSeatIsOpen(client: Rpc): Promise<boolean> {
  const { data, error } = await client.rpc('superadmin_seat_is_open', {});
  if (error) throw new Error(error.message);
  return data === true;
}

/** Take the first operator seat. Works once, for the earliest account. */
export async function claimFirstSuperadmin(client: Rpc): Promise<void> {
  const { error } = await client.rpc('claim_first_superadmin', {});
  if (error) throw new Error(error.message);
}

/**
 * Take somebody on, in a named role.
 *
 * They must already have an account. GrounUp does not create logins for people
 * — that is the identity provider's job, and issuing credentials this platform
 * cannot manage or revoke would be worse than asking them to sign up first.
 */
export async function hireOperator(
  client: Rpc, email: string, reason: string, roleKey = 'sales',
): Promise<void> {
  const { error } = await client.rpc('hire_operator', {
    p_email: email.trim(), p_reason: reason.trim(), p_role_key: roleKey,
  });
  if (error) throw new Error(error.message);
}

/** Withdraw operator access. Retires the grant; it stays answerable. */
export async function revokeOperator(
  client: Rpc, userId: string, reason: string,
): Promise<void> {
  const { error } = await client.rpc('revoke_operator', {
    p_user_id: userId, p_reason: reason.trim(),
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Roles, and what each kind of operator may do
//
// The console asks the database what the signed-in operator may do rather than
// deciding from a role name. Hiding a control is a courtesy on top of a
// refusal — every function behind these screens checks for itself — but the
// courtesy should at least be accurate.
// ---------------------------------------------------------------------------
export interface PlatformRoleRow {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  assignable: boolean;
  isSystem: boolean;
}

export interface PlatformPermissionRow {
  key: string;
  label: string;
  description: string;
  isPowerful: boolean;
}

export const loadPlatformRoles: Query<PlatformRoleRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('platform_roles')
    .select('key, name, description, permissions, assignable, is_system')
    .order('sort_order')) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    key: String(r.key),
    name: String(r.name),
    description: String(r.description),
    permissions: (r.permissions as string[]) ?? [],
    assignable: Boolean(r.assignable),
    isSystem: Boolean(r.is_system),
  }));
};

export const loadPlatformPermissions: Query<PlatformPermissionRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('platform_permissions')
    .select('key, label, description, is_powerful')
    .order('sort_order')) as Array<Record<string, unknown>>;
  return rows.map((p) => ({
    key: String(p.key),
    label: String(p.label),
    description: String(p.description),
    isPowerful: Boolean(p.is_powerful),
  }));
};

/** Which of the platform permissions the signed-in operator holds. */
export async function myOperatorPermissions(
  client: Rpc, keys: string[],
): Promise<Set<string>> {
  const answers = await Promise.all(keys.map(async (key) => {
    const { data, error } = await client.rpc('operator_can', { p_permission: key });
    if (error) throw new Error(error.message);
    return [key, data === true] as const;
  }));
  return new Set(answers.filter(([, held]) => held).map(([key]) => key));
}

export async function setRolePermissions(
  client: Rpc, key: string, permissions: string[], reason: string,
): Promise<void> {
  const { error } = await client.rpc('set_role_permissions', {
    p_key: key, p_permissions: permissions, p_reason: reason.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function createPlatformRole(
  client: Rpc,
  input: { key: string; name: string; description: string; permissions: string[] },
): Promise<void> {
  const { error } = await client.rpc('create_platform_role', {
    p_key: input.key.trim(), p_name: input.name.trim(),
    p_description: input.description.trim(), p_permissions: input.permissions,
  });
  if (error) throw new Error(error.message);
}

export async function setOperatorRole(
  client: Rpc, userId: string, roleKey: string, reason: string,
): Promise<void> {
  const { error } = await client.rpc('set_operator_role', {
    p_user_id: userId, p_role_key: roleKey, p_reason: reason.trim(),
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Companies created by hand, and the customers who are not on the list price
// ---------------------------------------------------------------------------

/**
 * Put a company on the platform for somebody else.
 *
 * They must already have an account here. GrounUp never issues a login on
 * somebody's behalf — the operator sends them to sign up, then names their
 * address here — so nobody ends up with credentials this platform set for them.
 */
export async function createCompanyFor(
  client: Rpc,
  input: { ownerEmail: string; name: string; reason: string; slug?: string },
): Promise<string> {
  const { data, error } = await client.rpc('create_company_for', {
    p_owner_email: input.ownerEmail.trim(),
    p_name: input.name.trim(),
    p_reason: input.reason.trim(),
    p_slug: input.slug?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export type BillingTermKind = 'free' | 'percent_off' | 'fixed_seat_price';

export interface BillingTermRow {
  id: string;
  companyId: string;
  companyName: string;
  kind: BillingTermKind;
  percentOff: number | null;
  seatPriceCents: number | null;
  stripeCouponId: string | null;
  appliesInStripe: boolean;
  reason: string;
  validUntil: string | null;
  grantedByEmail: string | null;
  seats: number;
  seatPriceMonthCents: number | null;
  monthlyCents: number | null;
}

export const loadBillingTerms: Query<BillingTermRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_billing_terms')
    .select('id, company_id, company_name, kind, percent_off, seat_price_cents, stripe_coupon_id, applies_in_stripe, reason, valid_until, granted_by_email, seats, seat_price_month_cents, monthly_cents')
    .order('company_name')) as Array<Record<string, unknown>>;
  return rows.map((t) => ({
    id: String(t.id),
    companyId: String(t.company_id),
    companyName: String(t.company_name),
    kind: t.kind as BillingTermKind,
    percentOff: t.percent_off == null ? null : Number(t.percent_off),
    seatPriceCents: t.seat_price_cents == null ? null : Number(t.seat_price_cents),
    stripeCouponId: t.stripe_coupon_id == null ? null : String(t.stripe_coupon_id),
    appliesInStripe: Boolean(t.applies_in_stripe),
    reason: String(t.reason),
    validUntil: t.valid_until == null ? null : String(t.valid_until),
    grantedByEmail: t.granted_by_email == null ? null : String(t.granted_by_email),
    seats: Number(t.seats ?? 0),
    seatPriceMonthCents: t.seat_price_month_cents == null
      ? null : Number(t.seat_price_month_cents),
    monthlyCents: t.monthly_cents == null ? null : Number(t.monthly_cents),
  }));
};

export async function setBillingTerms(
  client: Rpc,
  input: {
    companyId: string; kind: BillingTermKind; reason: string;
    percentOff?: number | null; seatPriceCents?: number | null;
    validUntil?: string | null; stripeCouponId?: string | null;
  },
): Promise<void> {
  const { error } = await client.rpc('set_billing_terms', {
    p_company: input.companyId,
    p_kind: input.kind,
    p_reason: input.reason.trim(),
    p_percent_off: input.percentOff ?? null,
    p_seat_price_cents: input.seatPriceCents ?? null,
    p_valid_until: input.validUntil ?? null,
    p_stripe_coupon_id: input.stripeCouponId?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

export async function clearBillingTerms(
  client: Rpc, companyId: string, reason: string,
): Promise<void> {
  const { error } = await client.rpc('clear_billing_terms', {
    p_company: companyId, p_reason: reason.trim(),
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// What the business is doing
//
// Revenue is what Stripe bills, read from the subscription items its webhooks
// mirrored. What GrounUp's own catalog says a customer should pay is carried
// beside it rather than instead of it, so a disagreement is visible instead of
// averaged away.
// ---------------------------------------------------------------------------
export interface Revenue {
  companies: number;
  paying: number;
  trialing: number;
  inArrears: number;
  leaving: number;
  onFree: number;
  onTerms: number;
  seatsInUse: number;
  seatsBilled: number;
  mrrCents: number;
  arrCents: number;
  givenAwayCents: number;
  discountedCents: number;
  seatsUnbilled: number;
  accountsThatDisagree: number;
}

export const loadRevenue: Query<Revenue | null> = async (client) => {
  const rows = unwrap(await client
    .from('admin_revenue')
    .select('*')) as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) return null;
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    companies: n('companies'), paying: n('paying'), trialing: n('trialing'),
    inArrears: n('in_arrears'), leaving: n('leaving'), onFree: n('on_free'),
    onTerms: n('on_terms'), seatsInUse: n('seats_in_use'),
    seatsBilled: n('seats_billed'), mrrCents: n('mrr_cents'), arrCents: n('arr_cents'),
    givenAwayCents: n('given_away_cents'), discountedCents: n('discounted_cents'),
    seatsUnbilled: n('seats_unbilled'),
    accountsThatDisagree: n('accounts_that_disagree'),
  };
};

export interface RevenueByCompany {
  companyId: string;
  name: string;
  createdAt: string;
  planName: string | null;
  subscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean;
  seats: number;
  seatsBilled: number | null;
  billedMonthlyCents: number;
  expectedMonthlyCents: number;
  listMonthlyCents: number;
  terms: BillingTermKind | null;
  onTheFreePlan: boolean;
}

export const loadRevenueByCompany: Query<RevenueByCompany[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_revenue_by_company')
    .select('company_id, name, created_at, plan_name, subscription_status, cancel_at_period_end, seats, seats_billed, billed_monthly_cents, expected_monthly_cents, list_monthly_cents, terms, on_the_free_plan')) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    companyId: String(r.company_id),
    name: String(r.name),
    createdAt: String(r.created_at),
    planName: (r.plan_name as string | null) ?? null,
    subscriptionStatus: (r.subscription_status as string | null) ?? null,
    cancelAtPeriodEnd: Boolean(r.cancel_at_period_end),
    seats: Number(r.seats ?? 0),
    seatsBilled: r.seats_billed == null ? null : Number(r.seats_billed),
    billedMonthlyCents: Number(r.billed_monthly_cents ?? 0),
    expectedMonthlyCents: Number(r.expected_monthly_cents ?? 0),
    listMonthlyCents: Number(r.list_monthly_cents ?? 0),
    terms: (r.terms as BillingTermKind | null) ?? null,
    onTheFreePlan: Boolean(r.on_the_free_plan),
  })).sort((x, y) => y.billedMonthlyCents - x.billedMonthlyCents);
};

export interface GrowthMonth {
  month: string;
  newCompanies: number;
  newUsers: number;
  newSubscriptions: number;
  canceledSubscriptions: number;
}

export const loadGrowth: Query<GrowthMonth[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_growth')
    .select('month, new_companies, new_users, new_subscriptions, canceled_subscriptions')
    .order('month')) as Array<Record<string, unknown>>;
  return rows.map((g) => ({
    month: String(g.month),
    newCompanies: Number(g.new_companies ?? 0),
    newUsers: Number(g.new_users ?? 0),
    newSubscriptions: Number(g.new_subscriptions ?? 0),
    canceledSubscriptions: Number(g.canceled_subscriptions ?? 0),
  }));
};

export interface RecentSignup {
  userId: string;
  email: string | null;
  fullName: string | null;
  createdAt: string;
  companyId: string | null;
  companyName: string | null;
  isOwner: boolean;
  noCompanyYet: boolean;
}

export const loadRecentSignups: Query<RecentSignup[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_recent_signups')
    .select('user_id, email, full_name, created_at, company_id, company_name, is_owner, no_company_yet')) as Array<Record<string, unknown>>;
  return rows.map((u) => ({
    userId: String(u.user_id),
    email: (u.email as string | null) ?? null,
    fullName: (u.full_name as string | null) ?? null,
    createdAt: String(u.created_at),
    companyId: (u.company_id as string | null) ?? null,
    companyName: (u.company_name as string | null) ?? null,
    isOwner: Boolean(u.is_owner),
    noCompanyYet: Boolean(u.no_company_yet),
  }));
};

// ---------------------------------------------------------------------------
// Looking inside one customer's subscription
//
// A support session, not impersonation. It opens a view of one company's
// billing for a stated reason and a fixed hour, writes itself into that
// company's own audit ledger, and never becomes the customer — so nothing an
// operator does is ever recorded as the customer having done it.
// ---------------------------------------------------------------------------
export interface CompanyBilling {
  companyId: string;
  companyName: string;
  slug: string;
  companySince: string;
  planId: string;
  planName: string | null;
  planFeatures: string[];
  entitlementSource: string | null;
  entitlementActive: boolean;
  accessValidUntil: string | null;
  grantReason: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  subscriptionStatus: string | null;
  seatsBilled: number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  trialEnd: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  billedMonthlyCents: number;
  seats: number;
  aiRequestsThisPeriod: number;
  aiCreditsIncluded: number | null;
  storageGb: number;
  storageGbIncluded: number | null;
  terms: BillingTermKind | null;
  percentOff: number | null;
  agreedSeatPriceCents: number | null;
  termsReason: string | null;
  seatPriceMonthCents: number | null;
  liveOverrides: number;
  unprocessedEvents: number;
}

export const loadCompanyBilling = (companyId: string): Query<CompanyBilling | null> =>
  async (client) => {
    const rows = unwrap(await client
      .from('admin_company_billing')
      .select('*')
      .eq('company_id', companyId)) as Array<Record<string, unknown>>;
    const r = rows[0];
    if (!r) return null;
    const num = (k: string) => Number(r[k] ?? 0);
    const orNull = (k: string) => (r[k] == null ? null : Number(r[k]));
    const str = (k: string) => (r[k] == null ? null : String(r[k]));
    return {
      companyId: String(r.company_id), companyName: String(r.company_name),
      slug: String(r.slug), companySince: String(r.company_since),
      planId: String(r.plan_id), planName: str('plan_name'),
      planFeatures: (r.plan_features as string[]) ?? [],
      entitlementSource: str('entitlement_source'),
      entitlementActive: Boolean(r.entitlement_active),
      accessValidUntil: str('access_valid_until'),
      grantReason: str('grant_reason'),
      stripeSubscriptionId: str('stripe_subscription_id'),
      stripeCustomerId: str('stripe_customer_id'),
      subscriptionStatus: str('subscription_status'),
      seatsBilled: orNull('seats_billed'),
      currentPeriodStart: str('current_period_start'),
      currentPeriodEnd: str('current_period_end'),
      cancelAtPeriodEnd: Boolean(r.cancel_at_period_end),
      canceledAt: str('canceled_at'), trialEnd: str('trial_end'),
      cardBrand: str('card_brand'), cardLast4: str('card_last4'),
      billedMonthlyCents: num('billed_monthly_cents'),
      seats: num('seats'),
      aiRequestsThisPeriod: num('ai_requests_this_period'),
      aiCreditsIncluded: orNull('ai_credits_included'),
      storageGb: num('storage_gb'),
      storageGbIncluded: orNull('storage_gb_included'),
      terms: (r.terms as BillingTermKind | null) ?? null,
      percentOff: orNull('percent_off'),
      agreedSeatPriceCents: orNull('agreed_seat_price_cents'),
      termsReason: str('terms_reason'),
      seatPriceMonthCents: orNull('seat_price_month_cents'),
      liveOverrides: num('live_overrides'),
      unprocessedEvents: num('unprocessed_events'),
    };
  };

export interface CompanyInvoice {
  stripeInvoiceId: string;
  number: string | null;
  status: string;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  hostedInvoiceUrl: string | null;
  createdAt: string;
}

export const loadCompanyInvoices = (companyId: string): Query<CompanyInvoice[]> =>
  async (client) => {
    const rows = unwrap(await client
      .from('admin_company_invoices')
      .select('*')
      .eq('company_id', companyId)) as Array<Record<string, unknown>>;
    return rows.map((i) => ({
      stripeInvoiceId: String(i.stripe_invoice_id),
      number: (i.number as string | null) ?? null,
      status: String(i.status),
      amountDueCents: Number(i.amount_due_cents ?? 0),
      amountPaidCents: Number(i.amount_paid_cents ?? 0),
      currency: String(i.currency),
      periodStart: (i.period_start as string | null) ?? null,
      periodEnd: (i.period_end as string | null) ?? null,
      hostedInvoiceUrl: (i.hosted_invoice_url as string | null) ?? null,
      createdAt: String(i.created_at),
    }));
  };

export async function openSupportSession(
  client: Rpc, companyId: string, reason: string, minutes = 60,
): Promise<void> {
  const { error } = await client.rpc('open_support_session', {
    p_company: companyId, p_reason: reason.trim(), p_minutes: minutes,
  });
  if (error) throw new Error(error.message);
}

export async function closeSupportSession(client: Rpc, companyId: string): Promise<void> {
  const { error } = await client.rpc('close_support_session', { p_company: companyId });
  if (error) throw new Error(error.message);
}

export async function isSupporting(client: Rpc, companyId: string): Promise<boolean> {
  const { data, error } = await client.rpc('is_supporting', { p_company: companyId });
  if (error) throw new Error(error.message);
  return data === true;
}

// ---------------------------------------------------------------------------
// Who came, and who tried
// ---------------------------------------------------------------------------
export interface TrafficDay {
  day: string;
  views: number;
  visitors: number;
  landingViews: number;
  pricingViews: number;
  signupViews: number;
  phoneViews: number;
}

export const loadTraffic: Query<TrafficDay[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_traffic')
    .select('day, views, visitors, landing_views, pricing_views, signup_views, phone_views')) as Array<Record<string, unknown>>;
  return rows.map((t) => ({
    day: String(t.day),
    views: Number(t.views ?? 0),
    visitors: Number(t.visitors ?? 0),
    landingViews: Number(t.landing_views ?? 0),
    pricingViews: Number(t.pricing_views ?? 0),
    signupViews: Number(t.signup_views ?? 0),
    phoneViews: Number(t.phone_views ?? 0),
  }));
};

export interface TrafficSource {
  source: string;
  campaign: string | null;
  views: number;
  visitors: number;
  reachedPricing: number;
  reachedSignup: number;
  lastSeen: string;
}

export const loadTrafficSources: Query<TrafficSource[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_traffic_sources')
    .select('source, campaign, views, visitors, reached_pricing, reached_signup, last_seen')) as Array<Record<string, unknown>>;
  return rows.map((s) => ({
    source: String(s.source),
    campaign: (s.campaign as string | null) ?? null,
    views: Number(s.views ?? 0),
    visitors: Number(s.visitors ?? 0),
    reachedPricing: Number(s.reached_pricing ?? 0),
    reachedSignup: Number(s.reached_signup ?? 0),
    lastSeen: String(s.last_seen),
  }));
};

export interface FunnelDay {
  day: string;
  visitors: number;
  reachedTheForm: number;
  attempted: number;
  failed: number;
  accountsCreated: number;
  companiesCreated: number;
  subscribed: number;
}

export const loadFunnel: Query<FunnelDay[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_signup_funnel')
    .select('day, visitors, reached_the_form, attempted, failed, accounts_created, companies_created, subscribed')) as Array<Record<string, unknown>>;
  return rows.map((f) => ({
    day: String(f.day),
    visitors: Number(f.visitors ?? 0),
    reachedTheForm: Number(f.reached_the_form ?? 0),
    attempted: Number(f.attempted ?? 0),
    failed: Number(f.failed ?? 0),
    accountsCreated: Number(f.accounts_created ?? 0),
    companiesCreated: Number(f.companies_created ?? 0),
    subscribed: Number(f.subscribed ?? 0),
  }));
};

export interface FailedSignup {
  email: string;
  failure: string | null;
  utmSource: string | null;
  occurredAt: string;
  hasAnAccountNow: boolean;
}

export const loadFailedSignups: Query<FailedSignup[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_failed_signups')
    .select('email, failure, utm_source, occurred_at, has_an_account_now')) as Array<Record<string, unknown>>;
  return rows.map((f) => ({
    email: String(f.email),
    failure: (f.failure as string | null) ?? null,
    utmSource: (f.utm_source as string | null) ?? null,
    occurredAt: String(f.occurred_at),
    hasAnAccountNow: Boolean(f.has_an_account_now),
  }));
};

// ---------------------------------------------------------------------------
// Events that never landed
// ---------------------------------------------------------------------------
export interface StuckEvent {
  eventId: string;
  type: string;
  receivedAt: string;
  processingState: string;
  processingError: string | null;
  attempts: number;
  livemode: boolean;
  companyId: string | null;
  companyName: string | null;
  stripeCustomerId: string | null;
  lastAttempt: string | null;
  attemptsByHand: number;
  lastError: string | null;
}

export const loadStuckEvents: Query<StuckEvent[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_stuck_events')
    .select('event_id, type, received_at, processing_state, processing_error, attempts, livemode, company_id, company_name, stripe_customer_id, last_attempt, attempts_by_hand, last_error')) as Array<Record<string, unknown>>;
  return rows.map((e) => ({
    eventId: String(e.event_id),
    type: String(e.type),
    receivedAt: String(e.received_at),
    processingState: String(e.processing_state),
    processingError: (e.processing_error as string | null) ?? null,
    attempts: Number(e.attempts ?? 0),
    livemode: Boolean(e.livemode),
    companyId: (e.company_id as string | null) ?? null,
    companyName: (e.company_name as string | null) ?? null,
    stripeCustomerId: (e.stripe_customer_id as string | null) ?? null,
    lastAttempt: (e.last_attempt as string | null) ?? null,
    attemptsByHand: Number(e.attempts_by_hand ?? 0),
    lastError: (e.last_error as string | null) ?? null,
  }));
};

/**
 * Apply a stored event again.
 *
 * The browser sends an event id and a reason and nothing else. The payload is
 * read out of the database by the function, so nothing here can influence what
 * gets applied to a customer.
 */
export async function replayStripeEvent(eventId: string, reason: string): Promise<void> {
  await callFunction<{ replayed: boolean }>('replay-stripe-event', {
    eventId, reason: reason.trim(),
  });
}

// ---------------------------------------------------------------------------
// Suspending an account
//
// Read-only, never a lockout: a suspended company keeps reading and exporting
// everything it built and simply cannot add to it. Two texts, deliberately —
// the note for colleagues and the message the customer sees are not the same
// sentence, and writing one and displaying the other is how somebody sends a
// paying business a line they never meant to send.
// ---------------------------------------------------------------------------
export type SuspensionKind = 'nonpayment' | 'abuse' | 'legal_hold' | 'requested';

export interface Suspension {
  id: string;
  companyId: string;
  companyName: string;
  kind: SuspensionKind;
  reason: string;
  customerMessage: string;
  suspendedAt: string;
  liftedAt: string | null;
  liftReason: string | null;
  suspendedByEmail: string | null;
  live: boolean;
  seats: number;
}

export const loadSuspensions: Query<Suspension[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_suspensions')
    .select('id, company_id, company_name, kind, reason, customer_message, suspended_at, lifted_at, lift_reason, suspended_by_email, live, seats')) as Array<Record<string, unknown>>;
  return rows.map((s) => ({
    id: String(s.id),
    companyId: String(s.company_id),
    companyName: String(s.company_name),
    kind: s.kind as SuspensionKind,
    reason: String(s.reason),
    customerMessage: String(s.customer_message),
    suspendedAt: String(s.suspended_at),
    liftedAt: (s.lifted_at as string | null) ?? null,
    liftReason: (s.lift_reason as string | null) ?? null,
    suspendedByEmail: (s.suspended_by_email as string | null) ?? null,
    live: Boolean(s.live),
    seats: Number(s.seats ?? 0),
  }));
};

export async function suspendCompany(
  client: Rpc,
  input: { companyId: string; kind: SuspensionKind; reason: string; customerMessage: string },
): Promise<void> {
  const { error } = await client.rpc('suspend_company', {
    p_company: input.companyId,
    p_kind: input.kind,
    p_reason: input.reason.trim(),
    p_customer_message: input.customerMessage.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function restoreCompany(
  client: Rpc, companyId: string, reason: string,
): Promise<void> {
  const { error } = await client.rpc('restore_company', {
    p_company: companyId, p_reason: reason.trim(),
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Why they left
//
// The one number a subscription business cannot go back for. "Nobody was
// asked" is carried as its own row rather than folded into "other": how often
// it appears says how often the question is reaching anybody.
// ---------------------------------------------------------------------------
export interface ChurnReason {
  reasonKey: string;
  label: string;
  customers: number;
  monthlyCentsLost: number;
  seatsLost: number;
  averageMonths: number | null;
  wouldComeBack: number;
  competitors: string[];
}

export const loadChurnReasons: Query<ChurnReason[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_churn_reasons')
    .select('reason_key, label, customers, monthly_cents_lost, seats_lost, average_months, would_come_back, competitors')) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    reasonKey: String(r.reason_key),
    label: String(r.label),
    customers: Number(r.customers ?? 0),
    monthlyCentsLost: Number(r.monthly_cents_lost ?? 0),
    seatsLost: Number(r.seats_lost ?? 0),
    averageMonths: r.average_months == null ? null : Number(r.average_months),
    wouldComeBack: Number(r.would_come_back ?? 0),
    competitors: (r.competitors as string[]) ?? [],
  }));
};

export interface ChurnMonth {
  month: string;
  customersLost: number;
  monthlyCentsLost: number;
  gaveAReason: number;
  customersGained: number;
}

export const loadChurnByMonth: Query<ChurnMonth[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_churn_by_month')
    .select('month, customers_lost, monthly_cents_lost, gave_a_reason, customers_gained')) as Array<Record<string, unknown>>;
  return rows.map((m) => ({
    month: String(m.month),
    customersLost: Number(m.customers_lost ?? 0),
    monthlyCentsLost: Number(m.monthly_cents_lost ?? 0),
    gaveAReason: Number(m.gave_a_reason ?? 0),
    customersGained: Number(m.customers_gained ?? 0),
  }));
};

export interface Cancellation {
  id: string;
  companyId: string;
  companyName: string;
  reasonKey: string | null;
  reasonLabel: string | null;
  detail: string | null;
  competitor: string | null;
  wouldReturn: boolean | null;
  seatsAtCancellation: number | null;
  monthlyCentsAtCancellation: number | null;
  monthsAsACustomer: number | null;
  source: string;
  occurredAt: string;
  cameBack: boolean;
}

export const loadCancellations: Query<Cancellation[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_cancellations')
    .select('id, company_id, company_name, reason_key, reason_label, detail, competitor, would_return, seats_at_cancellation, monthly_cents_at_cancellation, months_as_a_customer, source, occurred_at, came_back')) as Array<Record<string, unknown>>;
  return rows.map((c) => ({
    id: String(c.id),
    companyId: String(c.company_id),
    companyName: String(c.company_name),
    reasonKey: (c.reason_key as string | null) ?? null,
    reasonLabel: (c.reason_label as string | null) ?? null,
    detail: (c.detail as string | null) ?? null,
    competitor: (c.competitor as string | null) ?? null,
    wouldReturn: (c.would_return as boolean | null) ?? null,
    seatsAtCancellation: c.seats_at_cancellation == null ? null : Number(c.seats_at_cancellation),
    monthlyCentsAtCancellation: c.monthly_cents_at_cancellation == null
      ? null : Number(c.monthly_cents_at_cancellation),
    monthsAsACustomer: c.months_as_a_customer == null ? null : Number(c.months_as_a_customer),
    source: String(c.source),
    occurredAt: String(c.occurred_at),
    cameBack: Boolean(c.came_back),
  }));
};

// ---------------------------------------------------------------------------
// Cards that are being refused
//
// Usually an expired card rather than a decision to leave, which is why the
// list is ordered by how long it has been failing rather than by what it is
// worth: the customer does not know anything is wrong.
// ---------------------------------------------------------------------------
export interface FailingPayment {
  companyId: string;
  companyName: string;
  stripeInvoiceId: string;
  attempts: number;
  amountCents: number;
  failureCode: string | null;
  failureMessage: string | null;
  firstFailedAt: string;
  lastFailedAt: string;
  nextAttemptAt: string | null;
  stripeGaveUp: boolean;
  hostedInvoiceUrl: string | null;
  subscriptionStatus: string | null;
  accessUntil: string | null;
  seats: number;
  ownerEmail: string | null;
  daysFailing: number;
}

export const loadFailingPayments: Query<FailingPayment[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_failing_payments')
    .select('company_id, company_name, stripe_invoice_id, attempts, amount_cents, failure_code, failure_message, first_failed_at, last_failed_at, next_attempt_at, stripe_gave_up, hosted_invoice_url, subscription_status, access_until, seats, owner_email, days_failing')) as Array<Record<string, unknown>>;
  return rows.map((p) => ({
    companyId: String(p.company_id),
    companyName: String(p.company_name),
    stripeInvoiceId: String(p.stripe_invoice_id),
    attempts: Number(p.attempts ?? 0),
    amountCents: Number(p.amount_cents ?? 0),
    failureCode: (p.failure_code as string | null) ?? null,
    failureMessage: (p.failure_message as string | null) ?? null,
    firstFailedAt: String(p.first_failed_at),
    lastFailedAt: String(p.last_failed_at),
    nextAttemptAt: (p.next_attempt_at as string | null) ?? null,
    stripeGaveUp: Boolean(p.stripe_gave_up),
    hostedInvoiceUrl: (p.hosted_invoice_url as string | null) ?? null,
    subscriptionStatus: (p.subscription_status as string | null) ?? null,
    accessUntil: (p.access_until as string | null) ?? null,
    seats: Number(p.seats ?? 0),
    ownerEmail: (p.owner_email as string | null) ?? null,
    daysFailing: Number(p.days_failing ?? 0),
  }));
};

// ---------------------------------------------------------------------------
// Money going back
//
// The decision lives here; the money lives in Stripe. `youMayDecide` is
// derived in the database rather than reassembled on the screen, because the
// segregation rule — the person who asked is not the person who releases it,
// unless they are the superadmin — is three separate facts and a screen that
// rebuilt it would eventually rebuild it wrong.
// ---------------------------------------------------------------------------
export type RefundKind = 'refund' | 'credit';
export type RefundState = 'requested' | 'approved' | 'rejected' | 'applied' | 'failed';

export interface RefundRequest {
  id: string;
  companyId: string;
  companyName: string;
  kind: RefundKind;
  amountCents: number;
  reason: string;
  stripeInvoiceId: string | null;
  state: RefundState;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  appliedAt: string | null;
  stripeRefundId: string | null;
  error: string | null;
  requestedByEmail: string | null;
  decidedByEmail: string | null;
  youMayDecide: boolean;
}

export const loadRefunds: Query<RefundRequest[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_refunds')
    .select('id, company_id, company_name, kind, amount_cents, reason, stripe_invoice_id, state, requested_at, decided_at, decision_note, applied_at, stripe_refund_id, error, requested_by_email, decided_by_email, you_may_decide')) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    companyId: String(r.company_id),
    companyName: String(r.company_name),
    kind: r.kind as RefundKind,
    amountCents: Number(r.amount_cents ?? 0),
    reason: String(r.reason),
    stripeInvoiceId: (r.stripe_invoice_id as string | null) ?? null,
    state: r.state as RefundState,
    requestedAt: String(r.requested_at),
    decidedAt: (r.decided_at as string | null) ?? null,
    decisionNote: (r.decision_note as string | null) ?? null,
    appliedAt: (r.applied_at as string | null) ?? null,
    stripeRefundId: (r.stripe_refund_id as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    requestedByEmail: (r.requested_by_email as string | null) ?? null,
    decidedByEmail: (r.decided_by_email as string | null) ?? null,
    youMayDecide: Boolean(r.you_may_decide),
  }));
};

export async function requestRefund(
  client: Rpc,
  input: { companyId: string; kind: RefundKind; amountCents: number;
           reason: string; stripeInvoiceId?: string | null },
): Promise<void> {
  const { error } = await client.rpc('request_refund', {
    p_company: input.companyId,
    p_kind: input.kind,
    p_amount_cents: input.amountCents,
    p_reason: input.reason.trim(),
    p_invoice: input.stripeInvoiceId ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function decideRefund(
  client: Rpc, refundId: string, approve: boolean, note: string | null,
): Promise<void> {
  const { error } = await client.rpc('decide_refund', {
    p_request: refundId, p_approve: approve, p_note: note?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

/** Send an approved one to Stripe. The amount comes from the row, not from here. */
export async function applyRefund(refundId: string): Promise<void> {
  await callFunction<{ applied: boolean }>('apply-refund', { refundId });
}

// ---------------------------------------------------------------------------
// What your staff did
//
// No new recording — the same rows a customer reads in their own history,
// joined down the operator axis instead of the tenant one.
// ---------------------------------------------------------------------------
export interface OperatorAction {
  id: string;
  occurredAt: string;
  operatorId: string;
  operatorEmail: string | null;
  operatorRole: string | null;
  operatorSinceRevoked: boolean;
  action: string;
  entityTable: string;
  entityId: string | null;
  reason: string | null;
  companyId: string | null;
  companyName: string | null;
  platformWide: boolean;
}

export const loadOperatorActivity: Query<OperatorAction[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_operator_activity')
    .select('id, occurred_at, operator_id, operator_email, operator_role, operator_since_revoked, action, entity_table, entity_id, reason, company_id, company_name, platform_wide')) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    occurredAt: String(r.occurred_at),
    operatorId: String(r.operator_id),
    operatorEmail: (r.operator_email as string | null) ?? null,
    operatorRole: (r.operator_role as string | null) ?? null,
    operatorSinceRevoked: Boolean(r.operator_since_revoked),
    action: String(r.action),
    entityTable: String(r.entity_table),
    entityId: (r.entity_id as string | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    companyId: (r.company_id as string | null) ?? null,
    companyName: (r.company_name as string | null) ?? null,
    platformWide: Boolean(r.platform_wide),
  }));
};

export interface OperatorSummary {
  operatorId: string;
  operatorEmail: string;
  operatorRole: string | null;
  accessWithdrawn: boolean;
  grantedAt: string;
  actions30Days: number;
  companiesTouched: number;
  refundActions: number;
  featureActions: number;
  accountsOpened: number;
  termsSet: number;
  lastSeen: string | null;
}

export const loadOperatorSummary: Query<OperatorSummary[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_operator_summary')
    .select('operator_id, operator_email, operator_role, access_withdrawn, granted_at, actions_30_days, companies_touched, refund_actions, feature_actions, accounts_opened, terms_set, last_seen')) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    operatorId: String(r.operator_id),
    operatorEmail: String(r.operator_email),
    operatorRole: (r.operator_role as string | null) ?? null,
    accessWithdrawn: Boolean(r.access_withdrawn),
    grantedAt: String(r.granted_at),
    actions30Days: Number(r.actions_30_days ?? 0),
    companiesTouched: Number(r.companies_touched ?? 0),
    refundActions: Number(r.refund_actions ?? 0),
    featureActions: Number(r.feature_actions ?? 0),
    accountsOpened: Number(r.accounts_opened ?? 0),
    termsSet: Number(r.terms_set ?? 0),
    lastSeen: (r.last_seen as string | null) ?? null,
  }));
};

/**
 * Record that data left the platform.
 *
 * An export removes rows from every protection this platform has, so the one
 * thing that keeps it answerable is the trace. Records what and how many —
 * never the rows themselves, because a ledger holding a copy of the export
 * would be a second copy of the thing worth worrying about.
 */
export async function recordExport(
  client: Rpc, what: string, rows: number, companyId?: string | null,
): Promise<void> {
  const { error } = await client.rpc('record_export', {
    p_what: what, p_rows: rows, p_company: companyId ?? null,
  });
  if (error) throw new Error(error.message);
}

export interface ExportRecord {
  occurredAt: string;
  operatorEmail: string | null;
  operatorRole: string | null;
  what: string;
  rows: number;
  companyName: string | null;
}

export const loadExports: Query<ExportRecord[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_exports')
    .select('occurred_at, operator_email, operator_role, what, rows, company_name')) as Array<Record<string, unknown>>;
  return rows.map((e) => ({
    occurredAt: String(e.occurred_at),
    operatorEmail: (e.operator_email as string | null) ?? null,
    operatorRole: (e.operator_role as string | null) ?? null,
    what: String(e.what),
    rows: Number(e.rows ?? 0),
    companyName: (e.company_name as string | null) ?? null,
  }));
};

// ---------------------------------------------------------------------------
// Telling everybody
// ---------------------------------------------------------------------------
export type AnnouncementKind = 'info' | 'maintenance' | 'warning';
export type AnnouncementAudience = 'everyone' | 'paying' | 'free';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  kind: AnnouncementKind;
  audience: AnnouncementAudience;
  startsAt: string;
  endsAt: string | null;
  retractedAt: string | null;
  retractReason: string | null;
  publishedByEmail: string | null;
  live: boolean;
  dismissals: number;
}

export const loadAnnouncements: Query<Announcement[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_announcements')
    .select('id, title, body, kind, audience, starts_at, ends_at, retracted_at, retract_reason, published_by_email, live, dismissals')) as Array<Record<string, unknown>>;
  return rows.map((a) => ({
    id: String(a.id),
    title: String(a.title),
    body: String(a.body),
    kind: a.kind as AnnouncementKind,
    audience: a.audience as AnnouncementAudience,
    startsAt: String(a.starts_at),
    endsAt: (a.ends_at as string | null) ?? null,
    retractedAt: (a.retracted_at as string | null) ?? null,
    retractReason: (a.retract_reason as string | null) ?? null,
    publishedByEmail: (a.published_by_email as string | null) ?? null,
    live: Boolean(a.live),
    dismissals: Number(a.dismissals ?? 0),
  }));
};

export async function publishAnnouncement(
  client: Rpc,
  input: { title: string; body: string; kind: AnnouncementKind;
           audience: AnnouncementAudience; startsAt?: string | null; endsAt?: string | null },
): Promise<void> {
  const { error } = await client.rpc('publish_announcement', {
    p_title: input.title.trim(),
    p_body: input.body.trim(),
    p_kind: input.kind,
    p_audience: input.audience,
    p_starts: input.startsAt ?? null,
    p_ends: input.endsAt ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function retractAnnouncement(
  client: Rpc, id: string, reason: string,
): Promise<void> {
  const { error } = await client.rpc('retract_announcement', {
    p_id: id, p_reason: reason.trim(),
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// The outbox
//
// Nothing on this platform sends mail inline: a webhook that blocks on a mail
// provider times out, and a timed-out Stripe webhook is retried — so the
// customer is charged once and emailed twice. Mail is queued beside the thing
// that caused it and drained afterwards, which makes the queue itself the thing
// worth watching.
// ---------------------------------------------------------------------------
export interface OutboxMessage {
  id: string;
  companyName: string | null;
  toEmail: string;
  subject: string;
  category: string;
  transactional: boolean;
  state: 'queued' | 'sent' | 'failed' | 'suppressed';
  suppressedReason: string | null;
  error: string | null;
  attempts: number;
  queuedAt: string;
  sentAt: string | null;
}

export const loadOutbox: Query<OutboxMessage[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_outbox')
    .select('id, company_name, to_email, subject, category, transactional, state, suppressed_reason, error, attempts, queued_at, sent_at')) as Array<Record<string, unknown>>;
  return rows.map((m) => ({
    id: String(m.id),
    companyName: (m.company_name as string | null) ?? null,
    toEmail: String(m.to_email),
    subject: String(m.subject),
    category: String(m.category),
    transactional: Boolean(m.transactional),
    state: m.state as OutboxMessage['state'],
    suppressedReason: (m.suppressed_reason as string | null) ?? null,
    error: (m.error as string | null) ?? null,
    attempts: Number(m.attempts ?? 0),
    queuedAt: String(m.queued_at),
    sentAt: (m.sent_at as string | null) ?? null,
  }));
};

export interface OutboxHealth {
  waiting: number;
  sent: number;
  failed: number;
  switchedOff: number;
  stuck: number;
  oldestWaiting: string | null;
}

export const loadOutboxHealth: Query<OutboxHealth | null> = async (client) => {
  const rows = unwrap(await client
    .from('admin_outbox_health')
    .select('*')) as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) return null;
  return {
    waiting: Number(r.waiting ?? 0),
    sent: Number(r.sent ?? 0),
    failed: Number(r.failed ?? 0),
    switchedOff: Number(r.switched_off ?? 0),
    stuck: Number(r.stuck ?? 0),
    oldestWaiting: (r.oldest_waiting as string | null) ?? null,
  };
};

/** Drain the queue now, rather than waiting for the schedule. */
export async function sendQueuedEmail(): Promise<{
  sent: number; waiting: number; configured: boolean; note?: string;
}> {
  return callFunction<{ sent: number; waiting: number; configured: boolean; note?: string }>(
    'send-email', {});
}
