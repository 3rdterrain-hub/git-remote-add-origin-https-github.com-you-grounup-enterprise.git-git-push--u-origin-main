/**
 * Supabase browser client.
 *
 * Only the anon key is ever present here. The service role key, the Stripe
 * secret and every AI provider credential live exclusively in Edge Function
 * secrets — a key in this bundle is a key in the hands of every visitor.
 *
 * When the environment is not configured the client is null and the app runs
 * against the in-memory demo dataset, so the UI is fully explorable before a
 * project is provisioned.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

/*
 * Both are public by design and both are needed outside this module: the lead
 * form snippet a company pastes into its own website posts to `rest/v1/rpc` and
 * has to carry the anon key, which may call exactly one function in the schema
 * and select from nothing. `scripts/check-bundle.mjs` says the same thing from
 * the other direction — it deliberately does not treat the anon key as a leak.
 */
export const supabaseUrl = url ?? null;
export const supabaseAnonKey = anonKey ?? null;

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { headers: { 'x-application-name': 'grounup-web' } },
    })
  : null;

/** Base URL for Edge Function calls. */
export const functionsUrl = url ? `${url.replace(/\/$/, '')}/functions/v1` : '';

/**
 * Call an Edge Function with the caller's session token attached.
 *
 * Errors are surfaced with the function's own machine-readable code so the UI
 * can distinguish "upgrade your plan" from "ask your administrator" without
 * parsing prose.
 */
export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  if (!supabase) {
    throw new Error(
      `Cannot call "${name}": Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.`,
    );
  }
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${functionsUrl}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      apikey: anonKey!,
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = payload?.error ?? {};
    throw Object.assign(new Error(err.message ?? `${name} failed with ${res.status}`), {
      code: err.code ?? 'unknown',
      status: res.status,
      // Some failures carry detail worth showing: the pricing function returns
      // the list of holes it found so the workspace can point at the lines
      // rather than saying that something, somewhere, is missing.
      details: err.problems ?? err.details ?? null,
    });
  }
  return payload as T;
}
