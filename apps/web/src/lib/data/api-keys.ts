/**
 * Entity — the keys that reach this company's data through the API.
 *
 * `api_keys` has carried a hash-only design, a prefix for logs, scopes, a rate
 * limit, an expiry and a revocation-with-reason since migration 0023, with row
 * level security and a rewrite guard on top. Nothing anywhere could create one,
 * so the authenticated, rate-limited, scoped gateway this platform sells had
 * never been usable by anybody — and this page listed five invented keys.
 *
 * **The secret exists once.** `create_api_key` returns it and nothing stores it;
 * every later read is the prefix, which identifies a key in a log and
 * authenticates nothing. That is why there is no "show key again" anywhere here:
 * it is not that the product declines to, it is that nobody can.
 */
import { unwrap, type Query } from './query';
import { supabase } from '@/lib/supabase';

/** What the gateway knows. An unknown scope is refused, never ignored. */
export const API_SCOPES = [
  { value: 'projects:read', label: 'Projects — read' },
  { value: 'projects:write', label: 'Projects — write' },
  { value: 'estimates:read', label: 'Estimates — read' },
  { value: 'finance:read', label: 'Finance — read' },
  { value: 'finance:write', label: 'Finance — write' },
  { value: 'fleet:read', label: 'Fleet — read' },
  { value: 'fleet:write', label: 'Fleet — write' },
  { value: 'workforce:read', label: 'Workforce — read' },
  { value: 'workforce:write', label: 'Workforce — write' },
  { value: 'metrics:read', label: 'Metrics — read' },
] as const;

export interface ApiKeyRow {
  id: string;
  name: string;
  /** The only part of a key ever shown again. It authenticates nothing. */
  keyPrefix: string;
  scopes: string[];
  rateLimitPerMinute: number;
  expiresAt: string | null;
  lastUsedAt: string | null;
  requestCount: number;
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
  createdBy: string | null;
  isRevoked: boolean;
  isExpired: boolean;
  requests30Days: number;
  errors30Days: number;
}

export const loadApiKeys: Query<ApiKeyRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_api_keys')
    .select('id, name, key_prefix, scopes, rate_limit_per_minute, expires_at, '
      + 'last_used_at, request_count, revoked_at, revoke_reason, created_at, '
      + 'created_by, is_revoked, is_expired, requests_30_days, errors_30_days')
    .order('created_at', { ascending: false })) as unknown as Array<Record<string, unknown>>;
  return rows.map((k) => ({
    id: String(k.id),
    name: String(k.name),
    keyPrefix: String(k.key_prefix),
    scopes: (k.scopes as string[] | null) ?? [],
    rateLimitPerMinute: Number(k.rate_limit_per_minute ?? 0),
    expiresAt: (k.expires_at as string | null) ?? null,
    lastUsedAt: (k.last_used_at as string | null) ?? null,
    requestCount: Number(k.request_count ?? 0),
    revokedAt: (k.revoked_at as string | null) ?? null,
    revokeReason: (k.revoke_reason as string | null) ?? null,
    createdAt: String(k.created_at),
    createdBy: (k.created_by as string | null) ?? null,
    isRevoked: k.is_revoked === true,
    isExpired: k.is_expired === true,
    requests30Days: Number(k.requests_30_days ?? 0),
    errors30Days: Number(k.errors_30_days ?? 0),
  }));
};

export interface IssuedKey { id: string; key: string; keyPrefix: string }

/**
 * Issue a key. The secret comes back once and is never stored.
 *
 * Returned rather than shown by the database anywhere afterwards, because the
 * only copy that ever exists is this one — which is the whole reason the screen
 * has to press it on the person before they navigate away.
 */
export async function createApiKey(companyId: string, input: {
  name: string; scopes: string[]; rateLimitPerMinute?: number;
  expiresAt?: string | null; environment?: 'live' | 'test';
}): Promise<IssuedKey> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { data, error } = await supabase.rpc('create_api_key', {
    p_company: companyId,
    p_name: input.name.trim(),
    p_scopes: input.scopes,
    p_rate_limit: input.rateLimitPerMinute ?? 120,
    p_expires_at: input.expiresAt || null,
    p_environment: input.environment ?? 'live',
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
  return {
    id: String(row.id),
    key: String(row.key),
    keyPrefix: String(row.key_prefix),
  };
}

/** Revoke a key, with the reason the schema requires. Never deletes it. */
export async function revokeApiKey(keyId: string, reason: string): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('revoke_api_key', {
    p_key: keyId, p_reason: reason.trim(),
  });
  if (error) throw new Error(error.message);
}
