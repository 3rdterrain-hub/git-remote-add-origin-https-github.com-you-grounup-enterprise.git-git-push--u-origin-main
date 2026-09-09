/**
 * The code that runs is the code in the repository.
 *
 * `apps/web`'s typecheck script was
 * `tsc -b --noEmit false --emitDeclarationOnly false || tsc -p tsconfig.app.json --noEmit`.
 * The first half forces emit on, overriding `noEmit: true`, and it *fails* —
 * `allowImportingTsExtensions` requires `noEmit` — but not before writing 262
 * compiled files next to their own sources. The `||` then runs the real check,
 * so the command exits 0 and looks like it worked.
 *
 * What that costs is not disk. Vite resolves `.js` before `.tsx`, so from the
 * moment those files exist, every import of `./estimate-version` gets the
 * *compiled snapshot* rather than the file. The dev server serves it, the test
 * suite imports it, and both keep doing so while the source is edited. An hour
 * was spent on a guard clause that was in the file, passed review, and could
 * not be made to run — a deliberate syntax error added to the `.tsx` did not
 * even break the build, which is what finally gave it away.
 *
 * This is the worst failure mode in the repository: not a wrong answer, but a
 * *stale* one, from a file nobody is looking at, in a suite that reports green.
 * So it is a build failure now rather than an afternoon.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Every `src` directory in the repository, wherever it lives. */
const SOURCE_ROOTS = [
  'apps/web/src',
  'packages/engine/src',
  'packages/pdf/src',
];

/**
 * Declaration files that belong to a source tree rather than to a compiler.
 *
 * `vite-env.d.ts` is written by hand and checked in; it is ambient types for
 * the bundler, not output.
 */
const HAND_WRITTEN = new Set(['apps/web/src/vite-env.d.ts']);

const COMPILED = /\.(js|jsx|mjs|cjs|js\.map|d\.ts)$/;

function walk(dir: string): string[] {
  let entries: ReturnType<typeof readdirSync>;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...walk(path));
      continue;
    }
    out.push(path);
  }
  return out;
}

describe('no compiled output sits beside the source it came from', () => {
  it('has source trees to check, so a typo in a path is not a silent pass', () => {
    for (const root of SOURCE_ROOTS) {
      expect(statSync(join(ROOT, root)).isDirectory()).toBe(true);
      // A mistyped path walks to nothing and would pass the check below in
      // silence, which is the same class of defect this file exists for.
      expect(walk(join(ROOT, root)).length).toBeGreaterThan(3);
    }
  });

  it('finds no emitted JavaScript or declaration file in any source tree', () => {
    const found: string[] = [];
    for (const root of SOURCE_ROOTS) {
      for (const file of walk(join(ROOT, root))) {
        const rel = relative(ROOT, file);
        if (!COMPILED.test(rel)) continue;
        if (HAND_WRITTEN.has(rel)) continue;
        found.push(rel);
      }
    }
    /*
     * If this fails: something ran `tsc` with emit on. Delete them —
     * `git clean -n` first, they are untracked — and find the command that
     * wrote them, because it will write them again. The repository's own
     * typecheck is `npm run typecheck` from the root.
     */
    expect(found).toEqual([]);
  });
});
