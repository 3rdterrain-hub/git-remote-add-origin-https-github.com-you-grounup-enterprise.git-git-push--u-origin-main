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
  reason: string;
  grantedAt: string;
  revokedAt: string | null;
}

export const loadOperators: Query<Operator[]> = async (client) => {
  const rows = unwrap(await client
    .from('platform_admins')
    .select('id, user_id, role, reason, granted_at, revoked_at, user_profiles(email)')
    .order('granted_at', { ascending: false })) as Array<Record<string, unknown>>;
  return rows.map((o) => {
    const p = o.user_profiles as { email?: string } | Array<{ email?: string }> | null;
    const one = Array.isArray(p) ? p[0] : p;
    return {
      id: String(o.id), userId: String(o.user_id),
      email: one?.email ?? null,
      role: o.role as OperatorRole,
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
  currentTier: number | null;
  nextPlan: string | null;
  nextPlanName: string | null;
  memberCount: number;
  maxSeats: number | null;
  activeEstimates: number;
  maxActiveEstimates: number | null;
  entitlementSource: string | null;
  trialEnds: string | null;
  /** Why this customer is worth a call, derived rather than guessed. */
  signal: string | null;
  openProposals: number;
}

export const loadUpsellPotential: Query<UpsellPotential[]> = async (client) => {
  const rows = unwrap(await client
    .from('admin_upsell_potential')
    .select('company_id, name, current_plan, current_tier, next_plan, next_plan_name, member_count, max_seats, active_estimates, max_active_estimates, entitlement_source, trial_ends, signal, open_proposals')
    .order('name')) as Array<Record<string, unknown>>;
  return rows.map((u) => ({
    companyId: String(u.company_id), name: String(u.name),
    currentPlan: (u.current_plan as string | null) ?? null,
    currentTier: u.current_tier == null ? null : Number(u.current_tier),
    nextPlan: (u.next_plan as string | null) ?? null,
    nextPlanName: (u.next_plan_name as string | null) ?? null,
    memberCount: Number(u.member_count ?? 0),
    maxSeats: u.max_seats == null ? null : Number(u.max_seats),
    activeEstimates: Number(u.active_estimates ?? 0),
    maxActiveEstimates: u.max_active_estimates == null ? null : Number(u.max_active_estimates),
    entitlementSource: (u.entitlement_source as string | null) ?? null,
    trialEnds: (u.trial_ends as string | null) ?? null,
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
