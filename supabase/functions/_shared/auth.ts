/**
 * Authentication and authorization for GrounUp Edge Functions.
 *
 * Two Supabase clients are used deliberately:
 *
 *   - the *user* client carries the caller's JWT, so every query it runs is
 *     subject to RLS exactly as the browser would be. Permission checks run
 *     through it, which means a function cannot accidentally authorize
 *     something the database itself would refuse.
 *   - the *admin* client uses the service role and bypasses RLS. It is used
 *     only to write billing state from verified Stripe webhooks.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface Caller {
  userId: string;
  email: string | null;
  client: SupabaseClient;
}

export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Resolve the authenticated caller, or null when the request is unauthenticated. */
export async function getCaller(req: Request): Promise<Caller | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be configured');

  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { userId: data.user.id, email: data.user.email ?? null, client };
}

/**
 * Confirm the caller holds a permission in a company.
 *
 * This asks the database rather than reasoning about roles in TypeScript, so
 * the answer is always the same one RLS will give.
 */
export async function requirePermission(
  caller: Caller,
  companyId: string,
  permission: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await caller.client.rpc('has_permission', {
    p_company: companyId,
    p_permission: permission,
  });
  if (error) return { ok: false, reason: `Permission check failed: ${error.message}` };
  if (data !== true) return { ok: false, reason: `Missing permission "${permission}" in this company.` };
  return { ok: true };
}

/** Validate a value is a UUID before it reaches a query. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
