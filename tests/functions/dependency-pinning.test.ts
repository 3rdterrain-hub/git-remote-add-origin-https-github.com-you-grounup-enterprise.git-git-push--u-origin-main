/**
 * What the privileged boundary is built from.
 *
 * The Edge Functions hold the Stripe secret key, the webhook signing secret,
 * the Supabase service-role key and the AI provider key. They are the one place
 * in the platform where a dependency runs with those in reach.
 *
 * They resolved `jsr:@supabase/supabase-js@2` and `npm:stripe@17` — floating
 * majors — with `"lock": false` in the Deno config and no `deno.lock` anywhere,
 * and the source files imported those specifiers directly rather than through
 * the import map, so the map was not even a single point of control. The same
 * commit deployed twice could ship different code into the privileged boundary.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FUNCTIONS = join(ROOT, 'supabase/functions');

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) sources(path, out);
    else if (e.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

const config = JSON.parse(readFileSync(join(FUNCTIONS, 'deno.json'), 'utf8')) as
  { imports: Record<string, string>; lock?: boolean };

describe('the privileged boundary is built from pinned dependencies', () => {
  it('routes every remote dependency through the import map', () => {
    // One place to pin, rather than a specifier repeated across four files
    // where three could be updated and the fourth forgotten.
    const raw: string[] = [];
    for (const file of sources(FUNCTIONS)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/from '(jsr:|npm:|https?:)[^']*'/g)) {
        raw.push(`${file.replace(ROOT + '/', '')}: ${m[0]}`);
      }
    }
    expect(raw).toEqual([]);
  });

  it('pins every mapped dependency to an exact version', () => {
    /*
     * A floating major in the one place that holds the platform's secrets means
     * the same commit can deploy different code. Anything not pinned belongs in
     * the exception below with a reason, so an unpinned dependency is a
     * decision somebody made rather than one nobody noticed.
     */
    // Empty, and it should stay that way. Stripe used to sit here — the exact
    // version had to come from the registry, which needed network access this
    // repository did not have when the exception was written. It has one now,
    // stripe is pinned to 19.3.0, and the exception is gone rather than
    // grandfathered.
    const exceptions = new Map<string, string>();

    const unpinned = Object.entries(config.imports)
      .filter(([, spec]) => !/@\d+\.\d+\.\d+$/.test(spec))
      .map(([name]) => name);

    expect(unpinned.filter((n) => !exceptions.has(n))).toEqual([]);
  });

  it('names the supabase client version the browser also runs', () => {
    // Both halves of the platform on one version of one library, checked
    // rather than assumed.
    const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as
      { packages: Record<string, { version?: string }> };
    const browser = lock.packages['node_modules/@supabase/supabase-js']?.version;
    expect(browser).toBeTruthy();
    expect(config.imports['@supabase/supabase-js']).toBe(`jsr:@supabase/supabase-js@${browser}`);
  });

  it('installs from the lockfile in every workflow', () => {
    // `npm install` would resolve afresh; `npm ci` installs exactly what is
    // committed and fails if the lockfile and the manifest disagree.
    for (const wf of ['verify.yml', 'deploy.yml']) {
      const text = readFileSync(join(ROOT, '.github/workflows', wf), 'utf8');
      expect(text, wf).toContain('npm ci');
      expect(text, wf).not.toMatch(/run:\s*npm install/);
    }
  });
});

/**
 * The versions that are typechecked are the versions that deploy.
 *
 * `supabase/functions/tsconfig.json` checks this code against the SDK type
 * declarations installed in `node_modules`, while Deno resolves the specifiers
 * in `deno.json` at deploy time. If those drift apart, the build proves a
 * property of code that never runs — which is worse than not checking at all,
 * because it reads as a guarantee.
 *
 * Turning the check on is what found the drift in the first place: the
 * functions were calling an Anthropic thinking mode and a Stripe API version
 * that neither pinned SDK had ever heard of.
 */
describe('the typechecked SDK is the deployed SDK', () => {
  const devDeps = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as
    { devDependencies?: Record<string, string> }).devDependencies ?? {};

  for (const [name, spec] of Object.entries(config.imports)) {
    const version = spec.match(/@(\d+\.\d+\.\d+)$/)?.[1];
    if (!version) continue;
    // supabase-js resolves from JSR, which has no npm package to install
    // beside it; the browser client pins its own copy separately.
    if (name === '@supabase/supabase-js') continue;

    it(`installs ${name}@${version} locally, matching the deploy pin`, () => {
      const installed = (JSON.parse(
        readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8')) as
        { version: string }).version;
      expect(installed).toBe(version);
      expect(devDeps[name]).toBeDefined();
    });
  }
});
