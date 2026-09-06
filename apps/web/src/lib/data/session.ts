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

/**
 * The company's own outstanding payment, if there is one.
 *
 * Read so the application can say so before access is affected. A failed
 * payment is usually an expired card; the customer does not know, and every
 * day nobody tells them is a day closer to a cancellation that did not have
 * to happen.
 */
export interface MyPaymentProblem {
  companyId: string;
  amountCents: number;
  attempts: number;
  nextAttemptAt: string | null;
  stripeGaveUp: boolean;
  hostedInvoiceUrl: string | null;
  whatHappened: string;
}

export const loadMyPaymentProblem: Query<MyPaymentProblem | null> = async (client) => {
  const rows = unwrap(await client
    .from('my_payment_problem')
    .select('company_id, amount_cents, attempts, next_attempt_at, stripe_gave_up, hosted_invoice_url, what_happened')
    .limit(1)) as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) return null;
  return {
    companyId: String(r.company_id),
    amountCents: Number(r.amount_cents ?? 0),
    attempts: Number(r.attempts ?? 0),
    nextAttemptAt: (r.next_attempt_at as string | null) ?? null,
    stripeGaveUp: Boolean(r.stripe_gave_up),
    hostedInvoiceUrl: (r.hosted_invoice_url as string | null) ?? null,
    whatHappened: String(r.what_happened),
  };
};

/** What this person should be shown right now, and clearing one. */
export interface MyAnnouncement {
  id: string;
  title: string;
  body: string;
  kind: 'info' | 'maintenance' | 'warning';
  startsAt: string;
  endsAt: string | null;
}

export const loadMyAnnouncements: Query<MyAnnouncement[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_announcements')
    .select('id, title, body, kind, starts_at, ends_at')) as Array<Record<string, unknown>>;
  return rows.map((a) => ({
    id: String(a.id),
    title: String(a.title),
    body: String(a.body),
    kind: a.kind as 'info' | 'maintenance' | 'warning',
    startsAt: String(a.starts_at),
    endsAt: (a.ends_at as string | null) ?? null,
  }));
};

/**
 * Clear one, for me.
 *
 * Deliberately per person rather than per company: an estimator clearing a
 * banner must not clear it for the owner who has not read it.
 */
export async function dismissAnnouncement(
  client: {
    rpc: (fn: string, args: Record<string, unknown>) =>
      PromiseLike<{ data: unknown; error: { message: string } | null }>;
  },
  id: string,
): Promise<void> {
  const { error } = await client.rpc('dismiss_announcement', { p_id: id });
  if (error) throw new Error(error.message);
}

/**
 * What I am set to receive.
 *
 * Every category with my choice folded in, including the ones I cannot change:
 * a list that quietly omitted those would read as a shorter list rather than
 * an honest one.
 */
export interface NotificationSetting {
  companyId: string;
  category: string;
  label: string;
  description: string;
  optional: boolean;
  inApp: boolean;
  email: boolean;
}

export const loadNotificationSettings: Query<NotificationSetting[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_notification_settings')
    .select('company_id, category, label, description, optional, in_app, email')) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    companyId: String(r.company_id),
    category: String(r.category),
    label: String(r.label),
    description: String(r.description),
    optional: Boolean(r.optional),
    inApp: Boolean(r.in_app),
    email: Boolean(r.email),
  }));
};

export async function setNotificationPreference(
  client: {
    rpc: (fn: string, args: Record<string, unknown>) =>
      PromiseLike<{ data: unknown; error: { message: string } | null }>;
  },
  input: { companyId: string; category: string; inApp: boolean; email: boolean },
): Promise<void> {
  const { error } = await client.rpc('set_notification_preference', {
    p_company: input.companyId, p_category: input.category,
    p_in_app: input.inApp, p_email: input.email,
  });
  if (error) throw new Error(error.message);
}


/**
 * The caller's own notifications.
 *
 * The bell has read a fixture since it was built — "3 unread" in every
 * signed-in person's header, and five sample notices behind it, regardless of
 * whose workspace it was. That is the platform asserting something about their
 * data that came from a file, which is the one thing this data layer exists to
 * prevent, and it was doing it in the chrome on every screen.
 *
 * A null `user_id` is a company-wide notice every member sees; row level
 * security returns the caller's own and their company's, so no filter for that
 * is written here.
 */
export interface NotificationRow {
  id: string;
  category: string;
  severity: 'info' | 'success' | 'warning' | 'critical';
  title: string;
  body: string | null;
  actionPath: string | null;
  actionLabel: string | null;
  readAt: string | null;
  createdAt: string;
}

export const loadMyNotifications: Query<NotificationRow[]> = async (client) => {
  /*
   * Read through `my_notifications`, which writes the join once. Migration 0054
   * moved read state off the notification and into a per-person receipt —
   * because a company-wide notice is one row every member sees, and a `read_at`
   * on it would have let the first reader mark it read for the whole company.
   * A screen doing that join itself would get the company-wide case wrong,
   * which is the case that matters.
   */
  const rows = unwrap(await client
    .from('my_notifications')
    .select('id, category, severity, title, body, action_path, action_label, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50)) as Array<Record<string, unknown>>;

  return rows.map((n) => ({
    id: String(n.id),
    category: String(n.category),
    severity: n.severity as NotificationRow['severity'],
    title: String(n.title),
    body: (n.body as string | null) ?? null,
    actionPath: (n.action_path as string | null) ?? null,
    actionLabel: (n.action_label as string | null) ?? null,
    readAt: (n.read_at as string | null) ?? null,
    createdAt: String(n.created_at),
  }));
};

/**
 * Mark one as read.
 *
 * Through a function rather than an insert, because a receipt needs the
 * caller's user id and the notification's company — two facts a browser should
 * not have to carry to say "I have seen this". Idempotent, so opening a notice
 * twice does not move the timestamp.
 */
export async function markNotificationRead(
  client: { rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ error: { message: string } | null }> },
  id: string,
): Promise<void> {
  const { error } = await client.rpc('mark_notification_read', { p_notification: id });
  if (error) throw new Error(error.message);
}

/** Put one away. The notice survives; it just leaves this person's inbox. */
export async function dismissNotification(
  client: { rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ error: { message: string } | null }> },
  id: string,
): Promise<void> {
  const { error } = await client.rpc('dismiss_notification', { p_notification: id });
  if (error) throw new Error(error.message);
}
