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
