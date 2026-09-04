/**
 * Refuse a client bundle that carries a server secret.
 *
 * The platform's rule is that the Stripe secret key, the Stripe webhook signing
 * secret, the Supabase service-role key and the AI provider key live only in
 * Edge Function environment secrets, and never in anything the browser
 * downloads. That rule has been true by construction — the browser code simply
 * does not read them — and until now nothing enforced it.
 *
 * A rule enforced by construction survives exactly as long as nobody adds a
 * convenient import. This scans what the build actually emitted.
 *
 * Two independent checks, because either alone can be defeated:
 *
 *   1. **By name.** A `VITE_` variable whose name matches a server secret is
 *      refused before it can ever be embedded — Vite inlines every `VITE_`
 *      variable into the bundle by design.
 *   2. **By shape.** The emitted files are searched for the literal shapes of
 *      the credentials themselves: `sk_live_`, `sk_test_`, `whsec_`, and a
 *      JWT whose payload names the service role. A key leaked under an
 *      innocent variable name is still a key.
 *
 * Run after `npm run build`, and in CI on every commit.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'apps/web/dist');

/** Environment variable names that must never be exposed to a browser. */
const SERVER_ONLY = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
];

/**
 * Credential shapes, so a key smuggled under a different name is still caught.
 *
 * The anon key is deliberately absent: it is public by design, it is what the
 * browser authenticates with, and row level security is what makes that safe.
 */
const SECRET_SHAPES = [
  { name: 'Stripe live secret key', pattern: /\bsk_live_[A-Za-z0-9]{10,}/ },
  { name: 'Stripe test secret key', pattern: /\bsk_test_[A-Za-z0-9]{10,}/ },
  { name: 'Stripe restricted key', pattern: /\brk_(live|test)_[A-Za-z0-9]{10,}/ },
  { name: 'Stripe webhook signing secret', pattern: /\bwhsec_[A-Za-z0-9]{10,}/ },
  { name: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9-]{10,}/ },
  // A Supabase service-role JWT carries "service_role" in its base64 payload,
  // which survives minification because it is inside a string literal.
  { name: 'Supabase service-role key', pattern: /"role"\s*:\s*"service_role"/ },
  ...serviceRoleEncodings(),
];

/**
 * Every base64 alignment of `service_role`.
 *
 * A JWT payload is base64 of JSON, and base64 encodes three bytes at a time, so
 * the encoding of a substring depends on its byte offset within the payload —
 * `service_role` has three possible representations depending on what precedes
 * it. A single hard-coded pattern catches one of them and misses two, which is
 * a check that looks like it works.
 *
 * Computed rather than written down, so the three are right by construction.
 */
function serviceRoleEncodings() {
  const target = 'service_role';
  const found = new Set();
  for (let pad = 0; pad < 3; pad++) {
    const encoded = Buffer.from('x'.repeat(pad) + target).toString('base64');
    // Drop the leading characters that encode the padding bytes, and the
    // trailing group that may be incomplete.
    const start = Math.ceil((pad * 4) / 3);
    const core = encoded.slice(start, encoded.length - 4).replace(/=+$/, '');
    if (core.length >= 8) found.add(core);
  }
  return [...found].map((core, i) => ({
    name: `Supabase service-role key (base64 alignment ${i + 1})`,
    pattern: new RegExp(core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  }));
}

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx|js|jsx|env|env\..*)$/.test(entry.name)) out.push(path);
  }
  return out;
}

const problems = [];

// -------------------------------------------------------------- by name
for (const file of sourceFiles(join(ROOT, 'apps/web'))) {
  if (file.includes('/dist/') || file.includes('/node_modules/')) continue;
  const text = readFileSync(file, 'utf8');
  for (const name of SERVER_ONLY) {
    // Vite inlines every VITE_-prefixed variable into the bundle by design, so
    // naming a server secret with that prefix publishes it.
    const exposed = new RegExp(`VITE_${name}|VITE_[A-Z_]*${name}`);
    if (exposed.test(text)) {
      problems.push(`${relative(ROOT, file)} references a VITE_ variable carrying ${name}. ` +
        'Every VITE_ variable is embedded in the browser bundle.');
    }
  }
}

// ------------------------------------------------------------- by shape
if (!existsSync(DIST)) {
  console.error('apps/web/dist does not exist. Run `npm run build` first.');
  process.exit(2);
}

function emitted(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) emitted(path, out);
    // Source maps are emitted beside the bundle and ship the original text.
    else if (statSync(path).size < 32_000_000) out.push(path);
  }
  return out;
}

const files = emitted(DIST);
if (files.length === 0) {
  console.error('apps/web/dist is empty. Run `npm run build` first.');
  process.exit(2);
}

for (const file of files) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  for (const { name, pattern } of SECRET_SHAPES) {
    const hit = text.match(pattern);
    if (hit) {
      problems.push(`${relative(ROOT, file)} contains what looks like a ${name} ` +
        `(matched ${JSON.stringify(hit[0].slice(0, 24))}…).`);
    }
  }
  for (const name of SERVER_ONLY) {
    if (text.includes(name)) {
      problems.push(`${relative(ROOT, file)} mentions ${name}. A server secret's name in the ` +
        'bundle means something reached for it.');
    }
  }
}

if (problems.length) {
  console.error('The client bundle carries something it must not:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nServer secrets belong in Supabase Edge Function secrets. Nothing the browser');
  console.error('downloads may contain them, and a success redirect grants no access on its own.');
  process.exit(1);
}

console.log(`Bundle checked: ${files.length} emitted files, no server secret by name or by shape.`);
