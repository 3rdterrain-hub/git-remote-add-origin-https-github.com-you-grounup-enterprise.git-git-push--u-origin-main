/**
 * Shared HTTP helpers for GrounUp Edge Functions.
 *
 * CORS is allow-listed rather than `*`: these endpoints act on an authenticated
 * session and start payments, so any origin being able to call them from a
 * user's browser is exactly the exposure to avoid.
 */

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) ? origin : ALLOWED_ORIGINS[0] ?? '';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

/**
 * Error responses carry a stable machine-readable `code` and a message that is
 * safe to show a user. Internal detail goes to the log, never to the client —
 * a billing endpoint should not tell an attacker why their request failed.
 */
export function fail(
  code: string,
  message: string,
  status: number,
  origin: string | null,
  internal?: unknown,
): Response {
  if (internal) console.error(`[${code}]`, internal);
  return json({ error: { code, message } }, status, origin);
}

export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
  }
  return null;
}
