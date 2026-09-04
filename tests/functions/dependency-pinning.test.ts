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
    const exceptions = new Map([
      ['stripe', 'Cannot be pinned from this repository: the exact 17.x version has to come from the registry, and determining it needs a network-connected `deno cache`. Recorded in the P31 verdict alongside the missing deno.lock, which is the same fix.'],
    ]);

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
