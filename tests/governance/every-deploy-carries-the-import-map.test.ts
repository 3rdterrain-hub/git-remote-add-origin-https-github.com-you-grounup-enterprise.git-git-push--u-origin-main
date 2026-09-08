/**
 * Every documented deploy command carries the import map.
 *
 * Every Edge Function imports `@supabase/supabase-js` by bare specifier, and
 * `supabase/functions/deno.json` is the only thing that resolves it. Without
 * `--import-map` the bundler refuses all fourteen functions with "Relative
 * import path not prefixed with ./".
 *
 * That is a good failure — nothing is replaced, and every function stays ACTIVE
 * on the version it was already running — but it is silent in the way that
 * matters: the command exits, the deploy did nothing, and the fix that was
 * supposed to go live did not.
 *
 * It happened. The flag was documented correctly on six lines of
 * `docs/DEPLOYMENT.md` and missing from four, and a command typed from memory
 * left it off entirely. A command that works on six lines of a file and fails
 * on the seventh teaches nobody the rule, so this holds every occurrence to it
 * — in the docs, in the workflow, and in the npm script that exists so the flag
 * does not have to be remembered at all.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Files that could plausibly tell somebody how to deploy a function. */
function candidates(): string[] {
  const out: string[] = [];
  for (const dir of ['docs', '.github/workflows']) {
    const full = join(ROOT, dir);
    if (!existsSync(full)) continue;
    for (const f of readdirSync(full)) {
      if (/\.(md|ya?ml)$/.test(f)) out.push(join(dir, f));
    }
  }
  out.push('README.md', 'package.json');
  return out.filter((f) => existsSync(join(ROOT, f)));
}

/**
 * Every `supabase functions deploy ...` invocation, joined across the line
 * continuations a shell script uses, so a flag on the next line still counts.
 */
function deployCommands(text: string): string[] {
  const joined = text.replace(/\\\s*\n\s*/g, ' ');
  return [...joined.matchAll(/supabase functions deploy[^\n]*/g)].map((m) => m[0]);
}

describe('deploying the edge functions', () => {
  const found = candidates().flatMap((file) =>
    deployCommands(readFileSync(join(ROOT, file), 'utf8')).map((command) => ({ file, command })));

  it('finds the commands at all, so an empty pass means nothing', () => {
    expect(found.length).toBeGreaterThanOrEqual(5);
  });

  it('carries the import map on every one of them', () => {
    const bare = found
      .filter(({ command }) => !command.includes('--import-map'))
      .map(({ file, command }) => `${file}: ${command.trim()}`);
    expect(bare).toEqual([]);
  });

  it('points them all at the one file that declares the versions', () => {
    const wrong = found
      .filter(({ command }) => !command.includes('supabase/functions/deno.json'))
      .map(({ file, command }) => `${file}: ${command.trim()}`);
    expect(wrong).toEqual([]);
  });

  it('offers the command as a script, so the flag need not be remembered', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as
      { scripts: Record<string, string> };
    expect(pkg.scripts['functions:deploy']).toContain('--import-map');
  });

  it('still has the import map the flag points at, with the versions in it', () => {
    const map = JSON.parse(
      readFileSync(join(ROOT, 'supabase/functions/deno.json'), 'utf8')) as
      { imports: Record<string, string> };
    expect(Object.keys(map.imports)).toContain('@supabase/supabase-js');
    // Pinned, not floating: a deploy six months from now bundles what was tested.
    for (const [name, target] of Object.entries(map.imports)) {
      expect(target, `${name} is not pinned to a version`).toMatch(/@\d+\.\d+\.\d+$/);
    }
  });
});
