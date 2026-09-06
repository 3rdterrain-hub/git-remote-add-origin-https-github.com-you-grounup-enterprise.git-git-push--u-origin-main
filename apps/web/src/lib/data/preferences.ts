/**
 * What a person has arranged for themselves.
 *
 * `user_profiles.preferences` has been a column since migration 0002 and
 * nothing wrote to it, so every person got the same eighteen navigation items
 * in the same order down the left — the same for a chief estimator who lives
 * in the estimator and a fleet manager who never opens it.
 *
 * Saved one key at a time through `app.set_my_preference`, which merges. Two
 * tabs each writing the whole object would overwrite each other silently, and
 * a lost preference looks exactly like one that was never saved.
 */
import { unwrap, type Query } from './query';
import { DEFAULT_DASHBOARD, type DashboardPreference } from '@/lib/dashboard-panels';

/** Where the navigation lives. */
export type NavPlacement = 'side' | 'top';

export interface NavPreference {
  placement: NavPlacement;
  /** Item keys in the order they should appear. Unknown keys are ignored. */
  order: string[];
  /** Item keys the person has put away. */
  hidden: string[];
}

export const DEFAULT_NAV: NavPreference = { placement: 'side', order: [], hidden: [] };

type RpcCapable = {
  rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/**
 * Read a preference, and be forgiving about what comes back.
 *
 * A preference is written by a version of the application that may not be the
 * one reading it. A shape that no longer makes sense falls back to the default
 * rather than throwing — nobody should be locked out of their workspace by a
 * stale setting, and the worst case of ignoring one is a sidebar in the
 * original order.
 */
export const loadNavPreference: Query<NavPreference> = async (client) => {
  const rows = unwrap(await client
    .from('my_preferences')
    .select('preferences')
    .limit(1)) as Array<{ preferences: Record<string, unknown> | null }>;

  const raw = rows[0]?.preferences?.navigation;
  if (!raw || typeof raw !== 'object') return DEFAULT_NAV;
  const nav = raw as Record<string, unknown>;
  return {
    placement: nav.placement === 'top' ? 'top' : 'side',
    order: Array.isArray(nav.order) ? nav.order.filter((v): v is string => typeof v === 'string') : [],
    hidden: Array.isArray(nav.hidden) ? nav.hidden.filter((v): v is string => typeof v === 'string') : [],
  };
};

export async function saveNavPreference(
  client: RpcCapable, value: NavPreference,
): Promise<void> {
  const { error } = await client.rpc('set_my_preference', {
    p_key: 'navigation', p_value: value,
  });
  if (error) throw new Error(error.message);
}

/**
 * Put a list of items into a person's order.
 *
 * Anything they have arranged comes first, in their order; anything the
 * application has added since comes after, in its own order. A new screen
 * appearing at the bottom is the right behavior — appearing nowhere would hide
 * a feature somebody is paying for, and reshuffling their arrangement to make
 * room would undo work they did on purpose.
 */
export function applyNavOrder<T extends { key: string }>(
  items: readonly T[], pref: NavPreference,
): T[] {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const arranged: T[] = [];
  for (const key of pref.order) {
    const item = byKey.get(key);
    if (item) { arranged.push(item); byKey.delete(key); }
  }
  for (const item of items) if (byKey.has(item.key)) arranged.push(item);
  return arranged.filter((i) => !pref.hidden.includes(i.key));
}

// ---------------------------------------------------------------------------
// The dashboard a person has arranged
// ---------------------------------------------------------------------------

/**
 * Read a dashboard arrangement, forgiving whatever shape it turns out to be.
 *
 * Same reasoning as the navigation above: a preference is written by a version
 * of the application that may not be the one reading it, and nobody should meet
 * a broken dashboard because of a setting they saved last year. An unreadable
 * arrangement falls back to the shipped one.
 */
export const loadDashboardPreference: Query<DashboardPreference> = async (client) => {
  const rows = unwrap(await client
    .from('my_preferences')
    .select('preferences')
    .limit(1)) as Array<{ preferences: Record<string, unknown> | null }>;

  const raw = rows[0]?.preferences?.dashboard;
  if (!raw || typeof raw !== 'object') return DEFAULT_DASHBOARD;
  const d = raw as Record<string, unknown>;
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return {
    order: strings(d.order),
    hidden: strings(d.hidden),
    layout: d.layout === 'single' ? 'single' : 'tabs',
  };
};

export async function saveDashboardPreference(
  client: RpcCapable, value: DashboardPreference,
): Promise<void> {
  const { error } = await client.rpc('set_my_preference', {
    p_key: 'dashboard', p_value: value,
  });
  if (error) throw new Error(error.message);
}
