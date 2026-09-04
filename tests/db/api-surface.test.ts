import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness, type Harness } from './harness.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Every `.rpc()` the platform makes has to reach something.
 *
 * PostgREST publishes `public` and `graphql_public`. `app` is deliberately not
 * published, and `config.toml` says the governance functions are reached
 * "through SECURITY DEFINER helpers the API schema exposes" — which was true of
 * the intent and false of the schema until migration 0060. Seven call sites
 * across the browser client and the Edge Functions named functions that did not
 * exist in any published schema.
 *
 * Most failed closed. `ai_request_allowed` did not: the caller refuses only on
 * an explicit `false`, and a missing function answers `undefined`, so the AI
 * credit allowance on every plan was never checked.
 *
 * This test walks the actual call sites rather than a list somebody maintains,
 * so a new `.rpc()` that names nothing fails the build on the commit that adds
 * it.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'engine') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Every `.rpc('name', { p_x: ..., p_y: ... })` in the repository. */
function rpcCallSites() {
  const found: { file: string; fn: string; args: string[] }[] = [];
  for (const dir of ['apps/web/src', 'supabase/functions']) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\.rpc\(\s*'([a-z_]+)'\s*(?:,\s*\{([^}]*)\})?/g)) {
        const args = [...(m[2] ?? '').matchAll(/\b(p_[a-z_]+)\s*:/g)].map((a) => a[1]!);
        found.push({ file: file.replace(`${ROOT}/`, ''), fn: m[1]!, args });
      }
    }
  }
  return found;
}

describe('the API surface the client actually calls', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness({ seed: false }); });
  afterAll(async () => { await h?.db.close(); });

  const sites = rpcCallSites();

  it('finds the call sites at all, so an empty pass means nothing', () => {
    // A regex that silently matches nothing would make every assertion below
    // vacuously true. This is the guard on the guard.
    expect(sites.length).toBeGreaterThanOrEqual(5);
  });

  it('exposes every function the platform calls over PostgREST', async () => {
    const exposed = new Set((await h.sql<{ name: string }>(
      `select p.proname as name
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'`)).map((r) => r.name));

    const missing = [...new Set(sites.map((s) => s.fn))]
      .filter((fn) => !exposed.has(fn))
      .sort();
    expect(missing).toEqual([]);
  });

  it('accepts the argument names each call site sends', async () => {
    /*
     * PostgREST matches an RPC by named argument, so a wrapper with the right
     * name and the wrong parameter names is as broken as no wrapper at all —
     * and fails at runtime rather than at deploy.
     */
    const wrong: string[] = [];
    for (const site of sites) {
      if (site.args.length === 0) continue;
      const [row] = await h.sql<{ names: string[] | null }>(
        `select p.proargnames as names
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1 limit 1`, [site.fn]);
      const declared = new Set(row?.names ?? []);
      for (const a of site.args) {
        if (!declared.has(a)) wrong.push(`${site.file}: ${site.fn}(${a})`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('does not publish the app schema itself', async () => {
    /*
     * The wrappers exist so `app` can stay unpublished. If somebody publishes it
     * to make a call work, the wrappers become decoration and every governance
     * function becomes directly callable over HTTP.
     */
    const config = readFileSync(join(ROOT, 'supabase/config.toml'), 'utf8');
    const schemas = config.match(/^schemas\s*=\s*\[([^\]]*)\]/m)?.[1] ?? '';
    expect(schemas).not.toMatch(/"app"|'app'/);
  });

  it('grants the wrappers to signed-in callers and not to anonymous ones', async () => {
    for (const fn of ['has_permission', 'has_entitlement', 'current_usage',
                      'ai_request_allowed', 'search', 'create_my_company', 'can_use']) {
      const [r] = await h.sql<{ auth: boolean; anon: boolean }>(
        `select has_function_privilege('authenticated', p.oid, 'execute') as auth,
                has_function_privilege('anon', p.oid, 'execute') as anon
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1 limit 1`, [fn]);
      expect(r, `public.${fn} is missing`).toBeDefined();
      expect(r!.auth, `public.${fn} is not callable by a signed-in user`).toBe(true);
      expect(r!.anon, `public.${fn} is callable anonymously`).toBe(false);
    }
  });
});
