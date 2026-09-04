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
    // Both generators write docs/BUILD-SUMMARY.md, and this one's Documentation
    // row counts that file's own lines — so the test-count table has to be
    // written first or the pair needs a second pass to settle.
    const docs = pkg.scripts.docs!;
    expect(docs).toContain('npm run counts');
    expect(docs).toContain('npm run schema:counts');
    expect(docs.indexOf('npm run counts')).toBeLessThan(docs.indexOf('npm run schema:counts'));
  });

  it('agrees with the tree right now', () => {
    const summary = read('docs/BUILD-SUMMARY.md');
    const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'));
    expect(summary).toContain(`Database migrations (${migrations.length} files,`);
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
