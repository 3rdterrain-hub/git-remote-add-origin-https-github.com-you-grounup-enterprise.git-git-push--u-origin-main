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
