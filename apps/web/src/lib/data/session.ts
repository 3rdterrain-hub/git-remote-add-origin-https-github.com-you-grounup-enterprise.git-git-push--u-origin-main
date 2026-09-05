/**
 * Who the caller is, and what they may do.
 *
 * Three screens gated real actions on `USER.permissions` — a field in the
 * demonstration dataset. In a build with no workspace that is harmless. In a
 * build with one it is fixture data deciding whether a live button appears:
 * a person whose actual role permits approving time would be shown no button
 * because a sample user does not have the permission, and the reverse is worse.
 *
 * Permissions come from the caller's own membership now, through the same
 * policy the database enforces. Row level security returns only the caller's
 * own membership rows, so this cannot report somebody else's.
 *
 * When no workspace is configured it falls back to the demonstration user,
 * because that is the whole point of that mode — and the page says which mode
 * it is in regardless.
 */
import { unwrap, type Query } from './query';
import { useQuery } from './query';
import { USER } from '@/data/demo';

export interface Session {
  permissions: string[];
  approvalTier: number;
  roleName: string | null;
}

export const loadSession: Query<Session> = async (client) => {
  const rows = unwrap(await client
    .from('company_memberships')
    .select('is_owner, roles(name, permissions, approval_tier)')
    .eq('status', 'active')) as Array<Record<string, unknown>>;

  const role = rows
    .map((r) => {
      const embedded = r.roles as
        { name?: string; permissions?: string[]; approval_tier?: number }
        | Array<{ name?: string; permissions?: string[]; approval_tier?: number }> | null;
      const one = Array.isArray(embedded) ? embedded[0] : embedded;
      return {
        name: one?.name ?? null,
        permissions: one?.permissions ?? [],
        tier: Number(one?.approval_tier ?? 0),
        isOwner: Boolean(r.is_owner),
      };
    })
    // A person may belong to more than one company. Until the application has a
    // company switcher, the widest membership is the honest answer — narrowing
    // it arbitrarily would hide actions the database would in fact permit.
    .sort((a, b) => b.permissions.length - a.permissions.length)[0];

  return {
    permissions: role?.permissions ?? [],
    approvalTier: role?.tier ?? 0,
    roleName: role?.name ?? null,
  };
};

/**
 * The caller's permissions, whichever mode the build is in.
 *
 * A live read that has not answered yet reports no permissions rather than
 * assuming any: a button that appears and then disappears is worse than one
 * that appears a moment late, and assuming permission is the wrong way to be
 * wrong.
 */
export function usePermissions(): { can: (permission: string) => boolean; loading: boolean } {
  const session = useQuery(loadSession, []);
  if (session.status === 'demonstration') {
    return { can: (p) => USER.permissions.includes(p), loading: false };
  }
  if (session.status !== 'ready') {
    return { can: () => false, loading: session.status === 'loading' };
  }
  const held = session.data.permissions;
  // A wildcard is honored only as the whole grant, matching app.has_permission
  // in the database — `estimates.*` does not mean `estimates.approve`.
  return { can: (p) => held.includes('*') || held.includes(p), loading: false };
}

// ---------------------------------------------------------------------------
// Where the caller belongs
// ---------------------------------------------------------------------------
export interface Membership {
  companyId: string;
  name: string;
  slug: string;
  isOwner: boolean;
  roleKey: string;
  roleName: string;
  planId: string | null;
  entitlementActive: boolean;
  entitlementValidUntil: string | null;
  entitlementSource: string | null;
}

/**
 * The companies the signed-in person belongs to.
 *
 * Read from the `my_companies` view rather than joined here, so the answer the
 * onboarding screen gets and the answer the application shell gets are the same
 * answer. An empty array is the fact that matters: it means this person has
 * signed up and has no tenant, which before migration 0059 was every person who
 * ever signed up.
 */
export const loadMemberships: Query<Membership[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_companies')
    .select('company_id, name, slug, is_owner, role_key, role_name, plan_id, entitlement_active, entitlement_valid_until, entitlement_source')
    .order('created_at', { ascending: true })) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    companyId: String(r.company_id),
    name: String(r.name),
    slug: String(r.slug),
    isOwner: Boolean(r.is_owner),
    roleKey: String(r.role_key),
    roleName: String(r.role_name),
    planId: (r.plan_id as string | null) ?? null,
    entitlementActive: Boolean(r.entitlement_active),
    entitlementValidUntil: (r.entitlement_valid_until as string | null) ?? null,
    entitlementSource: (r.entitlement_source as string | null) ?? null,
  }));
};

/**
 * Create the caller's company.
 *
 * One round trip. The slug, the owner membership, the default pricing profile
 * with its markup components and the bounded trial are all settled inside the
 * one transaction, because a half-provisioned tenant is worse than none.
 */
export async function createCompany(
  // PromiseLike rather than Promise: supabase-js returns a builder that is
  // thenable but carries no `catch` or `finally`, and demanding a full Promise
  // here rejects the real client.
  client: { rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }> },
  name: string,
  planId = 'starter',
): Promise<string> {
  const { data, error } = await client.rpc('create_my_company', {
    p_name: name, p_plan_id: planId,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

/**
 * Whether this company is in read-only, and what it was told.
 *
 * Read here rather than discovered on a refusal: somebody who saves a day's
 * work and then learns their account is suspended has lost the day, and the
 * message is written for them precisely so they can be told before that.
 */
export interface MySuspension {
  companyId: string;
  kind: string;
  customerMessage: string;
  suspendedAt: string;
}

export const loadMySuspension: Query<MySuspension | null> = async (client) => {
  const rows = unwrap(await client
    .from('my_suspension')
    .select('company_id, kind, customer_message, suspended_at')
    .limit(1)) as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) return null;
  return {
    companyId: String(r.company_id),
    kind: String(r.kind),
    customerMessage: String(r.customer_message),
    suspendedAt: String(r.suspended_at),
  };
};

/** The reasons offered on the cancel screen. A library, not free text. */
export interface CancellationReason {
  key: string;
  label: string;
  description: string;
  needsDetail: boolean;
}

export const loadCancellationReasons: Query<CancellationReason[]> = async (client) => {
  const rows = unwrap(await client
    .from('cancellation_reasons')
    .select('key, label, description, needs_detail')
    .order('sort_order')) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    key: String(r.key),
    label: String(r.label),
    description: String(r.description),
    needsDetail: Boolean(r.needs_detail),
  }));
};
