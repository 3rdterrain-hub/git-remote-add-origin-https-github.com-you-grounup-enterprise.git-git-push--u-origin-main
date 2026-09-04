/**
 * Redaction.
 *
 * This is the load-bearing part of logging anything at all. A log line is the
 * easiest place in a platform to leak a credential: it is written in a hurry,
 * copied into a ticket, shipped to a third-party aggregator, and kept far
 * longer than anyone intends. One `console.log(req.headers)` is enough.
 *
 * Two independent defenses, because either alone fails:
 *
 *   * **By name.** An explicit list of field names that never carry anything
 *     worth reading. A deny list rather than a pattern, because a loose rule
 *     like "anything ending in _key" would redact `role_key` and
 *     `idempotency_key` and make the logs useless.
 *   * **By shape.** Values that look like credentials are redacted wherever
 *     they appear, whatever the field is called. This is the one that catches
 *     a token pasted into a `notes` field, which no name list ever will.
 */

export const REDACTED = '[redacted]';

/** Field names that never carry anything worth reading in a log. */
export const REDACTED_FIELDS: readonly string[] = [
  'authorization', 'api_key', 'apikey', 'x-api-key',
  'secret', 'client_secret', 'webhook_secret', 'signing_secret',
  'token', 'access_token', 'refresh_token', 'id_token', 'bearer',
  'password', 'passwd', 'pwd', 'passphrase',
  'credential', 'credentials', 'credential_ref',
  'cookie', 'set-cookie', 'session',
  'signature', 'stripe_signature', 'x-signature',
  'private_key', 'service_role_key', 'anon_key', 'key_hash',
  'cvc', 'cvv', 'card_number', 'pan', 'account_number', 'routing_number',
  'ssn', 'tax_id', 'national_id',
];

const FIELD_SET = new Set(REDACTED_FIELDS);

/**
 * Values shaped like a credential, redacted wherever they appear.
 *
 * The safety net for the case a name list cannot cover: a key pasted into a
 * free-text field by somebody trying to be helpful.
 */
export const SECRET_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'grounup api key', pattern: /\bgu_(?:live|test)_[A-Za-z0-9]{8,}\b/g },
  { name: 'stripe secret key', pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{8,}\b/g },
  { name: 'stripe restricted key', pattern: /\brk_(?:live|test)_[A-Za-z0-9]{8,}\b/g },
  { name: 'stripe webhook secret', pattern: /\bwhsec_[A-Za-z0-9]{8,}\b/g },
  { name: 'json web token', pattern: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g },
  { name: 'bearer credential', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi },
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
];

/** Longer than this and a field is truncated, so one record cannot be unbounded. */
export const MAX_VALUE_LENGTH = 2048;
/** Deeper than this and the structure is summarized rather than walked forever. */
export const MAX_DEPTH = 8;

export function isRedactedField(name: string): boolean {
  return FIELD_SET.has(name.trim().toLowerCase());
}

/** Redact anything credential-shaped inside a string. */
export function redactSecrets(value: string): string {
  let out = value;
  for (const { pattern } of SECRET_PATTERNS) {
    // A fresh regex each time: the shared ones carry /g and therefore lastIndex.
    out = out.replace(new RegExp(pattern.source, pattern.flags), REDACTED);
  }
  return out;
}

function truncate(value: string): string {
  if (value.length <= MAX_VALUE_LENGTH) return value;
  return `${value.slice(0, MAX_VALUE_LENGTH)}… [${value.length - MAX_VALUE_LENGTH} more characters]`;
}

/**
 * Redact a value of any shape.
 *
 * Never throws. A logger that can fail on a circular object is a logger that
 * takes the request down with it, which is worse than losing the line.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncate(redactSecrets(value));
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean' || typeof value === 'bigint') return value;
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncate(redactSecrets(value.message)),
      // A stack can carry a URL with a token in the query string.
      stack: value.stack ? truncate(redactSecrets(value.stack)) : undefined,
    };
  }

  if (depth >= MAX_DEPTH) return '[too deep]';

  if (typeof value === 'object') {
    if (seen.has(value as object)) return '[circular]';
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.slice(0, 100).map((v) => redact(v, depth + 1, seen));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isRedactedField(k) ? REDACTED : redact(v, depth + 1, seen);
    }
    return out;
  }
  return String(value);
}

/**
 * Whether a rendered record still contains anything credential-shaped.
 *
 * Used by the tests as an independent check on redaction, rather than trusting
 * that the walk visited every branch.
 */
export function containsSecret(rendered: string): string | null {
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (new RegExp(pattern.source, pattern.flags).test(rendered)) return name;
  }
  return null;
}
