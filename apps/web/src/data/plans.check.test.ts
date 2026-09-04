/**
 * The pricing page must not promise what the platform does not grant.
 *
 * Two independent ways this goes wrong, and both had happened:
 *
 *   * **A claim with nothing behind it.** Enterprise advertised "SSO, advanced
 *     security and data residency options". There is no SAML, no OIDC and no
 *     region selection anywhere in the codebase. That is the settings-toggle
 *     defect on the page where somebody decides to pay.
 *   * **Drift.** The comparison table's booleans were written by hand and had
 *     no link to `plans.features`, so moving a feature between plans in the
 *     catalog left the pricing page selling the old arrangement.
 *
 * These tests read the seeded catalog — the same rows the Edge Functions
 * validate against — and hold the page to it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPARISON, PLANS } from './plans';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SEED = readFileSync(join(ROOT, 'supabase/seed/0002_plan_catalog.sql'), 'utf8');

/** The plan ids the comparison columns stand for, in column order. */
const COLUMNS = ['starter', 'professional', 'business', 'enterprise'] as const;

/**
 * Pull each plan's granted features out of the seed.
 *
 * Parsed rather than imported because the catalog is SQL: it is the authority
 * the Edge Functions read, and a TypeScript copy of it would be one more thing
 * to drift.
 */
function seededFeatures(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  // ('plan_id', 'Name', ... array['a','b'], trial, sort),
  const blocks = SEED.split(/\n\n/).filter((b) => /^\s*\('[a-z_]+',/m.test(b));
  for (const block of blocks) {
    const id = block.match(/\('([a-z_]+)',/)?.[1];
    const features = block.match(/array\[([^\]]*)\]/s)?.[1];
    if (!id || features === undefined) continue;
    out[id] = features.split(',').map((f) => f.trim().replace(/^'|'$/g, '')).filter(Boolean);
  }
  return out;
}

const FEATURES = seededFeatures();
const grants = (planId: string, feature: string) => {
  const list = FEATURES[planId];
  if (!list) throw new Error(`Plan ${planId} is not in the seeded catalog`);
  return list.includes('*') || list.includes(feature);
};

describe('the seed is readable and complete', () => {
  it('finds every plan the pricing page has a column for', () => {
    for (const id of COLUMNS) expect(FEATURES[id], id).toBeDefined();
  });

  it('finds the feature lists, not empty arrays', () => {
    expect(FEATURES.starter!.length).toBeGreaterThan(3);
    expect(FEATURES.enterprise).toEqual(['*']);
  });
});

describe('every entitlement-backed claim matches the catalog', () => {
  const keyed = COMPARISON.flatMap((g) => g.rows.filter((r) => r.feature));

  it('has rows to check', () => {
    expect(keyed.length).toBeGreaterThanOrEqual(10);
  });

  it('shows a feature as included exactly where the plan grants it', () => {
    for (const row of keyed) {
      COLUMNS.forEach((planId, i) => {
        expect(row.values[i], `${row.label} / ${planId} (${row.feature})`)
          .toBe(grants(planId, row.feature!));
      });
    }
  });

  it('names only features the catalog actually defines', () => {
    // A row keyed to a feature nobody grants would pass the check above by
    // reading false everywhere, and would still be a promise about nothing.
    const defined = new Set(Object.values(FEATURES).flat().filter((f) => f !== '*'));
    for (const row of keyed) {
      expect(defined.has(row.feature!), `${row.label} → ${row.feature}`).toBe(true);
    }
  });
});

describe('claims with nothing behind them', () => {
  const marketingText = [
    ...PLANS.flatMap((p) => [p.tagline, ...p.headline, ...Object.values(p.limits)]),
    ...COMPARISON.flatMap((g) => [g.group, ...g.rows.map((r) => r.label)]),
  ].join(' | ').toLowerCase();

  it('does not sell single sign-on, which is not implemented', () => {
    // apps/web/src/pages/app/settings.tsx lists SSO under "Not yet available".
    // The pricing page cannot say otherwise.
    expect(marketingText).not.toMatch(/\bsso\b|single sign-on|saml|oidc/);
  });

  it('does not sell data residency or region selection', () => {
    expect(marketingText).not.toMatch(/data residency|region selection|regional hosting/);
  });

  it('does not sell multi-factor authentication', () => {
    expect(marketingText).not.toMatch(/multi-factor|two-factor|\bmfa\b|\b2fa\b/);
  });
});

describe('the limits shown match the limits sold', () => {
  it('quotes the AI credit allowance the catalog grants', () => {
    // The seed sets 250 / 2,000 / 10,000 / unlimited.
    const credits = COMPARISON.flatMap((g) => g.rows).find((r) => r.label === 'AI credits per month');
    expect(credits).toBeDefined();
    expect(credits!.values).toEqual(['250', '2,000', '10,000', 'Unlimited']);
    for (const planId of ['starter', 'professional', 'business']) {
      const seeded = SEED.match(new RegExp(`\\('${planId}',[\\s\\S]*?\\n\\s+([\\d, null]+),\\n`))?.[1];
      expect(seeded, planId).toBeTruthy();
    }
  });

  it('gives every plan a trial length the catalog agrees with', () => {
    for (const plan of PLANS) {
      const block = SEED.match(new RegExp(`\\('${plan.id}',[\\s\\S]*?\\n\\s+(\\d+), \\d+\\),`));
      expect(block, plan.id).toBeTruthy();
      expect(Number(block![1]), `${plan.id} trial days`).toBe(plan.trialDays);
    }
  });
});
