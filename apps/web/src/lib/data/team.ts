/**
 * Who is in the company, and what each of them may do. ENTITY.
 *
 * `roles`, `company_memberships` and `company_invitations` have been in the
 * schema since migration 0002 and were read by nothing until 0211. The screen
 * above this module showed eleven roles typed into the JSX with invented user
 * counts beside them — on the tab an owner opens to find out who can do what.
 *
 * Three rules this module carries from the database rather than enforcing here,
 * because a check in the browser is a suggestion:
 *
 *   * **A permission you do not hold, you cannot grant.** Otherwise anybody
 *     with `users.manage` could write themselves a role carrying everything.
 *   * **You cannot change your own role or suspend your own access.** The
 *     mistake is not recoverable by the person who makes it.
 *   * **A company keeps one active owner.** Since migration 0002.
 *
 * An invitation's token comes back exactly once, from the call that creates it.
 * It is never stored and cannot be read again — the same arrangement as an API
 * key, for the same reason.
 */
import { unwrap, type Query } from './query';
import { supabase } from '@/lib/supabase';

export interface CompanyRole {
  id: string;
  key: string;
  name: string;
  description: string | null;
  permissions: string[];
  approvalTier: number;
  isSystem: boolean;
  /** A shipped role is shared by every tenant and is not editable. */
  isEditable: boolean;
  memberCount: number;
}

export interface CompanyMember {
  id: string;
  userId: string;
  fullName: string | null;
  email: string | null;
  jobTitle: string | null;
  lastSeenAt: string | null;
  roleId: string;
  roleKey: string;
  roleName: string;
  approvalTier: number;
  status: 'invited' | 'active' | 'suspended' | 'removed';
  isOwner: boolean;
  isMe: boolean;
  invitedAt: string | null;
  joinedAt: string | null;
}

export interface CompanyInvitation {
  id: string;
  email: string;
  roleId: string;
  roleName: string;
  invitedByName: string | null;
  expiresAt: string;
  createdAt: string;
  state: 'pending' | 'accepted' | 'revoked' | 'expired';
}

export const loadCompanyRoles: Query<CompanyRole[]> = async (client) => {
  const rows = unwrap<Record<string, unknown>[]>(
    await client.from('my_company_roles')
      .select('id, key, name, description, permissions, approval_tier, is_system, is_editable, member_count')
      .order('approval_tier', { ascending: false })
      .order('name'),
  );
  return rows.map((r) => ({
    id: String(r.id),
    key: String(r.key),
    name: String(r.name),
    description: (r.description as string | null) ?? null,
    permissions: (r.permissions as string[] | null) ?? [],
    approvalTier: Number(r.approval_tier ?? 0),
    isSystem: Boolean(r.is_system),
    isEditable: Boolean(r.is_editable),
    memberCount: Number(r.member_count ?? 0),
  }));
};

export const loadCompanyMembers: Query<CompanyMember[]> = async (client) => {
  const rows = unwrap<Record<string, unknown>[]>(
    await client.from('my_company_members')
      .select('id, user_id, full_name, email, job_title, last_seen_at, role_id, role_key, role_name, approval_tier, status, is_owner, is_me, invited_at, joined_at')
      .order('status')
      .order('full_name'),
  );
  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    fullName: (r.full_name as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    jobTitle: (r.job_title as string | null) ?? null,
    lastSeenAt: (r.last_seen_at as string | null) ?? null,
    roleId: String(r.role_id),
    roleKey: String(r.role_key),
    roleName: String(r.role_name),
    approvalTier: Number(r.approval_tier ?? 0),
    status: String(r.status) as CompanyMember['status'],
    isOwner: Boolean(r.is_owner),
    isMe: Boolean(r.is_me),
    invitedAt: (r.invited_at as string | null) ?? null,
    joinedAt: (r.joined_at as string | null) ?? null,
  }));
};

export const loadCompanyInvitations: Query<CompanyInvitation[]> = async (client) => {
  const rows = unwrap<Record<string, unknown>[]>(
    await client.from('my_company_invitations')
      .select('id, email, role_id, role_name, invited_by_name, expires_at, created_at, state')
      .order('created_at', { ascending: false }),
  );
  return rows.map((r) => ({
    id: String(r.id),
    email: String(r.email),
    roleId: String(r.role_id),
    roleName: String(r.role_name),
    invitedByName: (r.invited_by_name as string | null) ?? null,
    expiresAt: String(r.expires_at),
    createdAt: String(r.created_at),
    state: String(r.state) as CompanyInvitation['state'],
  }));
};

export interface AuditSummary {
  eventCount: number;
  eventsLast90Days: number;
  eventsLast30Days: number;
  actorCount: number;
  tablesTouched: number;
  firstEventAt: string | null;
  lastEventAt: string | null;
}

export const loadAuditSummary: Query<AuditSummary | null> = async (client) => {
  const rows = unwrap<Record<string, unknown>[]>(
    await client.from('my_audit_summary')
      .select('event_count, events_last_90_days, events_last_30_days, actor_count, tables_touched, first_event_at, last_event_at')
      .limit(1),
  );
  const r = rows[0];
  if (!r) return null;
  return {
    eventCount: Number(r.event_count ?? 0),
    eventsLast90Days: Number(r.events_last_90_days ?? 0),
    eventsLast30Days: Number(r.events_last_30_days ?? 0),
    actorCount: Number(r.actor_count ?? 0),
    tablesTouched: Number(r.tables_touched ?? 0),
    firstEventAt: (r.first_event_at as string | null) ?? null,
    lastEventAt: (r.last_event_at as string | null) ?? null,
  };
};

export interface AuditEvent {
  id: string;
  occurredAt: string;
  action: string;
  entityTable: string;
  entityId: string | null;
  reason: string | null;
  actor: string;
  byThePlatform: boolean;
}

/** The most recent entries. A count that cannot be opened proves nothing. */
export const loadAuditEvents = (limit = 50): Query<AuditEvent[]> => async (client) => {
  const rows = unwrap<Record<string, unknown>[]>(
    await client.from('my_audit_events')
      .select('id, occurred_at, action, entity_table, entity_id, reason, actor, by_the_platform')
      .order('occurred_at', { ascending: false })
      .limit(limit),
  );
  return rows.map((r) => ({
    id: String(r.id),
    occurredAt: String(r.occurred_at),
    action: String(r.action),
    entityTable: String(r.entity_table),
    entityId: (r.entity_id as string | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    actor: String(r.actor),
    byThePlatform: Boolean(r.by_the_platform),
  }));
};

function client() {
  if (!supabase) throw new Error('Not connected to a workspace.');
  return supabase;
}

function done(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

export async function createCompanyRole(companyId: string, role: {
  key?: string | null;
  name: string;
  permissions: string[];
  description?: string | null;
  approvalTier?: number;
}): Promise<string> {
  const { data, error } = await client().rpc('create_company_role', {
    p_company: companyId,
    p_key: role.key ?? null,
    p_name: role.name,
    p_permissions: role.permissions,
    p_description: role.description ?? null,
    p_approval_tier: role.approvalTier ?? 0,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function setCompanyRole(roleId: string, changes: {
  name?: string | null;
  permissions?: string[] | null;
  description?: string | null;
  approvalTier?: number | null;
}): Promise<void> {
  done(await client().rpc('set_company_role', {
    p_role: roleId,
    p_name: changes.name ?? null,
    p_permissions: changes.permissions ?? null,
    p_description: changes.description ?? null,
    p_approval_tier: changes.approvalTier ?? null,
  }));
}

/** Returns how many people were moved into `moveToId`. */
export async function deleteCompanyRole(roleId: string, moveToId: string): Promise<number> {
  const { data, error } = await client().rpc('delete_company_role', {
    p_role: roleId, p_move_to: moveToId,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export async function setMemberRole(membershipId: string, roleId: string): Promise<void> {
  done(await client().rpc('set_member_role', {
    p_membership: membershipId, p_role: roleId,
  }));
}

export async function setMemberStatus(
  membershipId: string, status: 'active' | 'suspended' | 'removed',
): Promise<void> {
  done(await client().rpc('set_member_status', {
    p_membership: membershipId, p_status: status,
  }));
}

/**
 * Invite somebody. The token comes back once and is never recoverable.
 *
 * Nothing is emailed from here: the caller is handed the link to pass on, which
 * keeps this honest about what happened. A screen that said "invitation sent"
 * while nothing left the building would be the same defect as a button that
 * takes a click and changes nothing.
 */
export async function inviteMember(companyId: string, invite: {
  email: string;
  roleId: string;
  days?: number;
}): Promise<{ id: string; token: string; expiresAt: string }> {
  const { data, error } = await client().rpc('invite_member', {
    p_company: companyId,
    p_email: invite.email,
    p_role: invite.roleId,
    p_days: invite.days ?? 14,
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) throw new Error('The invitation was not created.');
  return {
    id: String(row.id),
    token: String(row.token),
    expiresAt: String(row.expires_at),
  };
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  done(await client().rpc('revoke_invitation', { p_invitation: invitationId }));
}
