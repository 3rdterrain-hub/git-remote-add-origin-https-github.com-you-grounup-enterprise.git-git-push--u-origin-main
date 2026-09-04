/**
 * The pipeline runs the same gate a developer runs.
 *
 * A continuous integration workflow drifts by subtraction: a suite is excluded
 * to make a red build green, a check is moved behind a condition, and the
 * pipeline slowly stops meaning what its name says. These tests hold the shape
 * of it — that CI runs `npm run verify` rather than a chosen subset, that
 * deployment cannot happen on a push, and that the bundle check runs after the
 * build on both paths.
 *
 * They assert the configuration, not a deployment. Nothing here has been
 * deployed and these tests do not claim otherwise.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const verifyYml = read('.github/workflows/verify.yml');
const deployYml = read('.github/workflows/deploy.yml');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

describe('continuous integration', () => {
  it('runs the whole gate, not a chosen subset', () => {
    // `npm run verify` is typecheck, three drift checks, every suite and the
    // production build. Running anything narrower here would make a green
    // pipeline mean less than a green local run.
    expect(verifyYml).toMatch(/run:\s*npm run verify\b/);
    expect(verifyYml).not.toMatch(/npm run test:(engine|db|web|functions)\b/);
  });

  it('checks the bundle after building it', () => {
    expect(verifyYml).toMatch(/npm run bundle:check/);
    expect(verifyYml.indexOf('npm run verify'))
      .toBeLessThan(verifyYml.indexOf('npm run bundle:check'));
  });

  it('runs on every branch and on pull requests', () => {
    expect(verifyYml).toMatch(/on:\s*\n\s*push:/);
    expect(verifyYml).toMatch(/pull_request:/);
  });

  it('needs no secrets to run its tests', () => {
    // The database tests run the migrations against PostgreSQL in WebAssembly,
    // so this pipeline works on a fork's pull request. A CI job that needs
    // credentials is one that cannot.
    expect(verifyYml).not.toMatch(/secrets\./);
  });

  it('asks for no more permission than reading the repository', () => {
    expect(verifyYml).toMatch(/permissions:\s*\n\s*contents:\s*read/);
  });
});

describe('deployment', () => {
  it('cannot be triggered by a push', () => {
    // Deployment is deliberate. A push to a branch must not reach a database.
    expect(deployYml).toMatch(/on:\s*\n\s*workflow_dispatch:/);
    expect(deployYml).not.toMatch(/^\s{2}push:/m);
    expect(deployYml).not.toMatch(/^\s{2}pull_request:/m);
  });

  it('runs behind a named GitHub environment', () => {
    // Whatever approval rules that environment carries apply before anything
    // reaches a real database.
    expect(deployYml).toMatch(/environment:\s*\$\{\{\s*inputs\.environment\s*\}\}/);
  });

  it('re-runs the full verification before deploying', () => {
    // A deployment that skips the gate to save eight minutes is how a broken
    // migration reaches production.
    expect(deployYml).toMatch(/run:\s*npm run verify\b/);
    expect(deployYml.indexOf('npm run verify')).toBeLessThan(deployYml.indexOf('supabase db push'));
  });

  it('lists pending migrations before applying them', () => {
    expect(deployYml.indexOf('supabase migration list'))
      .toBeLessThan(deployYml.indexOf('supabase db push'));
  });

  it('checks the environment build for secrets after building it', () => {
    const checks = deployYml.match(/npm run bundle:check/g) ?? [];
    // Once after the verification build, once after the environment build.
    expect(checks.length).toBeGreaterThanOrEqual(2);
  });

  it('never names a server secret it has no business holding', () => {
    // The Stripe key, the webhook signing secret, the service-role key and the
    // AI provider key are set once against the Supabase project. A deployment
    // pipeline that holds them is a second place they can leak from.
    for (const secret of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
                          'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY']) {
      expect(deployYml, secret).not.toMatch(new RegExp(`secrets\\.${secret}`));
    }
  });

  it('passes only the public variables to the browser build', () => {
    const buildStep = deployYml.slice(deployYml.indexOf('Build the web application'));
    const vars = [...buildStep.matchAll(/VITE_[A-Z_]+/g)].map((m) => m[0]);
    expect([...new Set(vars)].sort()).toEqual(['VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL']);
  });
});

describe('the documented test count comes from the runs', () => {
  /*
   * The suite table in docs/BUILD-SUMMARY.md was maintained by hand and
   * drifted — to 1,769 against a real 1,734, an arithmetic slip that then
   * propagated into three verification verdicts before anybody added it up.
   *
   * Counting `it(` in the source would have been the easy fix and a wrong one:
   * the engine and database suites generate cases with `it.each` and with
   * loops, so the source count is 1,610 against a real 1,734. A proxy that is
   * seven per cent low is worse than no check, because it looks like one.
   *
   * Each suite now writes a JSON report as it runs and the table is generated
   * from those reports.
   */
  it('runs the counts check inside the gate, after the tests', () => {
    const verify = pkg.scripts.verify;
    expect(verify).toContain('npm run counts:check');
    expect(verify.indexOf('npm run test')).toBeLessThan(verify.indexOf('npm run counts:check'));
  });

  it('checks the bundle inside the gate, after the build', () => {
    const verify = pkg.scripts.verify;
    expect(verify).toContain('npm run bundle:check');
    expect(verify.indexOf('npm run build')).toBeLessThan(verify.indexOf('npm run bundle:check'));
  });

  it('has every suite write a report the check can read', () => {
    for (const suite of ['engine', 'pdf', 'db', 'functions', 'governance', 'web']) {
      const script = pkg.scripts[`test:${suite}`]!;
      expect(script, suite).toContain('--reporter=json');
      expect(script, suite).toContain(`.test-results/${suite}.json`);
    }
  });

  it('climbs back to the root from a run with its own root', () => {
    // A workspace run's working directory is the package, and `--root apps/web`
    // resolves the output path against that root, so a bare relative path
    // writes the report where nothing looks for it. All three were found by
    // running them rather than by reasoning about them.
    for (const suite of ['engine', 'pdf', 'web']) {
      expect(pkg.scripts[`test:${suite}`], suite).toContain('../../.test-results/');
    }
  });

  it('writes labels a reader recognizes', () => {
    // Capitalizing the report name turns `pdf` into "Pdf" and `db` into "Db".
    const summary = read('docs/BUILD-SUMMARY.md');
    expect(summary).toMatch(/^PDF\s+\d/m);
    expect(summary).toMatch(/^Database\s+\d/m);
    expect(summary).not.toMatch(/^Pdf\s/m);
    expect(summary).not.toMatch(/^Db\s/m);
  });

  it('holds the same total everywhere it is stated, not only in the table', () => {
    // "1,740 tests" had already drifted into three verification verdicts and a
    // README, and from the verdicts into every row of two generated ledgers —
    // the exact propagation this generator exists to stop, escaping through the
    // one document it did not cover.
    const script = read('scripts/build-test-counts.mjs');
    expect(script).toContain('P20-verdicts.json');
    expect(script).toContain('P28-verdicts.json');
    expect(script).toContain('A claim that stops matching is a claim that stops being checked');
  });

  it('rebuilds the ledgers after rewriting the verdicts they are built from', () => {
    // `counts` edits verdict prose; the ledgers carry that prose in every row.
    const docs = pkg.scripts.docs!;
    expect(docs.indexOf('npm run counts')).toBeLessThan(docs.indexOf('npm run verification'));
  });

  it('refuses to record counts from a failing run', () => {
    const script = read('scripts/build-test-counts.mjs');
    expect(script).toContain('counts are not recorded from a red run');
  });

  it('says why it does not count the source instead', () => {
    const script = read('scripts/build-test-counts.mjs');
    // Matched short of the line wrap: the sentence continues on the next
    // line, and a substring that crosses it never matches.
    expect(script).toContain('A proxy that is 7% low');
  });
});

/**
 * What the documentation claims about the build.
 *
 * The test-count table was generated after it drifted. Every other count in
 * the documentation was still typed, and by the time anything checked, all of
 * them had drifted too: the engine recorded as 25 files against a real 38, the
 * migrations as 39 against 41 and as ~11,300 lines against a real 10,269 —
 * overstated while files were being added — and README and BUILD-SUMMARY
 * disagreeing with each other about the number of views, neither of them
 * right.
 *
 * A number in prose that nothing computes is the defect this build has found
 * throughout the product. It is worse in documentation, because a reader has
 * no way to tell.
 */
describe('the documentation states what the tree contains', () => {
  it('runs the schema check inside the gate, before the tests', () => {
    // Before, not after: it is a file-tree comparison that costs nothing, and
    // failing it early saves a fifteen-minute run.
    const verify = pkg.scripts.verify;
    expect(verify).toContain('npm run schema:check');
    expect(verify.indexOf('npm run schema:check')).toBeLessThan(verify.indexOf('npm run test'));
  });

  it('exposes the generator and its check as scripts anybody can run', () => {
    expect(pkg.scripts['schema:counts']).toBe('node scripts/build-schema-counts.mjs');
    expect(pkg.scripts['schema:check']).toBe('node scripts/build-schema-counts.mjs --check');
    expect(existsSync(join(ROOT, 'scripts/build-schema-counts.mjs'))).toBe(true);
  });

  it('fails when a claim is reworded rather than silently covering nothing', () => {
    // The failure mode that makes a drift check worthless: the sentence it
    // matched is rewritten, the pattern stops matching, and the check passes
    // forever while covering nothing.
    const script = read('scripts/build-schema-counts.mjs');
    expect(script).toContain('A claim that stops matching is a claim that stops being checked');
  });

  it('refuses a table the registry has not classified', () => {
    // The five-category rule is enforced against the live schema by the
    // governance suite; this is the cheap version that runs in seconds and
    // names the omission before a fifteen-minute suite does.
    const script = read('scripts/build-schema-counts.mjs');
    expect(script).toContain('Every table belongs to one of the five categories');
  });

  it('counts views by name, because a redefinition is not a new view', () => {
    // `create or replace view` repeats a name whenever a later migration
    // redefines one. Counting statements would have reported nine views as
    // eleven.
    const script = read('scripts/build-schema-counts.mjs');
    expect(script).toMatch(/unique\(\/create or replace view/);
  });

  it('regenerates both documentation tables in an order that converges', () => {
    /*
     * Both generators write docs/BUILD-SUMMARY.md, and the schema one's
     * Documentation row counts that file's own lines — so it has to run *after*
     * the test-count table to measure a settled file.
     *
     * It also has to run *before* it. A stale migration count turns the
     * governance suite red, and `counts` refuses to record from a red run, so
     * the two would deadlock against each other: the numbers cannot be fixed
     * because the suite is failing, and the suite is failing because the
     * numbers are wrong. `schema:counts` needs no test reports, so leading with
     * it breaks the deadlock; ending with it keeps the pair converging in one
     * pass.
     */
    const docs = pkg.scripts.docs!;
    expect(docs).toContain('npm run counts');
    expect(docs.indexOf('npm run schema:counts')).toBeLessThan(docs.indexOf('npm run counts'));
    expect(docs.lastIndexOf('npm run schema:counts')).toBeGreaterThan(docs.indexOf('npm run counts'));
  });

  it('generates the artifact catalog size rather than restating it', () => {
    // It drifted three times by hand before it was made generated — the same
    // lesson every other count in this repository has already taught.
    const script = read('scripts/build-traceability.mjs');
    expect(script).toContain('cataloged artifacts');
    expect(script).toContain('a sentence that stops matching is');
  });

  it('agrees with the tree right now', () => {
    const summary = read('docs/BUILD-SUMMARY.md');
    const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'));
    expect(summary).toContain(`Database migrations (${migrations.length} files,`);
  });
});

/**
 * Nothing compiled sits beside the source it was compiled from.
 *
 * A mis-invoked `tsc` — one missing `--noEmit` — emits a `.js` next to every
 * `.ts` and `.tsx` in the tree. Vite and Vitest resolve `./projects` to
 * `projects.js` before `projects.tsx`, so from that moment every import silently
 * reads the stale compiled copy: the application builds from it, the tests run
 * against it, and both pass while the source is edited to no effect.
 *
 * That happened in this repository. It was caught only because a new test
 * asserted text that the stale file could not have contained — the suite would
 * otherwise have gone on passing against code nobody was editing.
 */
describe('no compiled output shadows a source file', () => {
  const roots = ['apps/web/src', 'packages/engine/src', 'packages/pdf/src',
                 'supabase/functions', 'tests'];

  function walk(dir: string, out: string[] = []): string[] {
    let entries;
    try { entries = readdirSync(join(ROOT, dir), { withFileTypes: true }); }
    catch { return out; }
    for (const e of entries) {
      const rel = join(dir, e.name);
      if (e.isDirectory()) {
        if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
        walk(rel, out);
      } else out.push(rel);
    }
    return out;
  }

  it('leaves no emitted javascript in any source tree', () => {
    const emitted: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        if (!/\.jsx?$/.test(file) || /\.config\.js$/.test(file)) continue;
        // A .js is only source where no .ts or .tsx of the same name exists.
        const base = file.replace(/\.jsx?$/, '');
        if (existsSync(join(ROOT, `${base}.ts`)) || existsSync(join(ROOT, `${base}.tsx`))) {
          emitted.push(file);
        } else {
          emitted.push(`${file} (no TypeScript source — unexpected in a source tree)`);
        }
      }
    }
    expect(emitted).toEqual([]);
  });

  it('typechecks with --noEmit, which is what stops it recurring', () => {
    // The one flag whose absence produced 95 shadow files in this repository.
    expect(pkg.scripts.typecheck).toContain('--noEmit');
  });
});

describe('the secret boundary is enforced, not just documented', () => {
  it('exposes the bundle check as a script anybody can run', () => {
    expect(pkg.scripts['bundle:check']).toBe('node scripts/check-bundle.mjs');
    expect(existsSync(join(ROOT, 'scripts/check-bundle.mjs'))).toBe(true);
  });

  it('checks by shape as well as by name', () => {
    // A key smuggled under an innocent variable name is still a key.
    const script = read('scripts/check-bundle.mjs');
    expect(script).toMatch(/sk_live_/);
    expect(script).toMatch(/whsec_/);
    expect(script).toMatch(/serviceRoleEncodings/);
  });

  it('computes every base64 alignment rather than hard-coding one', () => {
    // The first version of this check hard-coded a single encoding of
    // "service_role" and silently missed a real JWT, because base64 encodes
    // three bytes at a time and the alignment depends on what precedes it.
    const script = read('scripts/check-bundle.mjs');
    expect(script).toMatch(/for \(let pad = 0; pad < 3; pad\+\+\)/);
    expect(script).toContain('catches one of them and misses two');
  });

  it('leaves the anon key alone, because it is public by design', () => {
    const script = read('scripts/check-bundle.mjs');
    expect(script).toContain('The anon key is deliberately absent');
  });
});

describe('the Supabase project configuration', () => {
  const config = read('supabase/config.toml');

  it('carries no secret', () => {
    for (const shape of [/sk_live_/, /sk_test_/, /whsec_/, /service_role/, /eyJ[A-Za-z0-9_-]{20,}/]) {
      expect(config, String(shape)).not.toMatch(shape);
    }
  });

  it('leaves JWT verification on for every function but the two that cannot use it', () => {
    // Stripe cannot send a Supabase JWT, and its authentication is the
    // signature over the raw body. Liveness has to answer before anything is
    // authenticated.
    const off = [...config.matchAll(/\[functions\.([a-z-]+)\]\s*\n(?:[^[]*?)verify_jwt\s*=\s*false/g)]
      .map((m) => m[1]);
    expect(off.sort()).toEqual(['health', 'stripe-webhook']);
  });

  it('does not publish the governance schema over the API', () => {
    // app.* is reached through SECURITY DEFINER helpers, never directly.
    expect(config).toMatch(/schemas\s*=\s*\["public", "graphql_public"\]/);
  });
});
