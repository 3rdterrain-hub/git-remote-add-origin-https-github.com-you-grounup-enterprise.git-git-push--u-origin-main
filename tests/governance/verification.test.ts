/**
 * The P05 verification ledger, kept honest.
 *
 * Verification is a stronger claim than tracing, so it carries a stronger
 * burden: a verdict must name a test, that test must exist, and the acceptance
 * criterion must be satisfied in full rather than in part.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const G = join(ROOT, 'governance/traceability');

function readCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift()!;
  return rows.filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]!])));
}

const ledger = readCsv(join(G, 'verification/P05-ledger.csv'));
const verdicts = JSON.parse(readFileSync(join(G, 'verification/P05-verdicts.json'), 'utf8')) as {
  modules: Record<string, {
    exists: boolean;
    conditions: Record<string, string>;
    verified: Record<string, string>;
    not_verified: Record<string, string>;
  }>;
  acceptance_conditions: { conditions: string[] };
};
const matrix = readCsv(join(G, 'traceability-matrix.csv'));

const ASPECTS = ['canonical model', 'configurable rules', 'auditability',
                 'permissions', 'import/export', 'validation and testing'];

/** The acceptance suites this phase's verdicts are allowed to cite. */
const SUITES = [
  'packages/engine/tests/estimating-acceptance.test.ts',
  'tests/db/estimating-acceptance.test.ts',
  'packages/engine/tests/estimate.test.ts',
  'packages/engine/tests/quantity.test.ts',
  'packages/engine/tests/trucking.test.ts',
  'packages/engine/tests/confidence.test.ts',
  'packages/engine/tests/pricing.test.ts',
  'tests/db/semantic.test.ts',
  'tests/db/rls.test.ts',
  'tests/functions/connectors.test.ts',
  'tests/functions/api-gateway.test.ts',
  'tests/functions/plan-analysis.test.ts',
  'packages/pdf/tests/documents.test.ts',
  'apps/web/src/lib/theme.test.ts',
  'tests/governance/registry.test.ts',
];

describe('the P05 ledger covers the phase exactly', () => {
  it('holds one verdict for all 108 requirements', () => {
    expect(ledger).toHaveLength(108);
    expect(new Set(ledger.map((r) => r.requirement_id)).size).toBe(108);
  });

  it('covers all 18 modules across all 6 aspects', () => {
    const modules = new Set(ledger.map((r) => r.module));
    expect(modules.size).toBe(18);
    for (const m of modules) {
      const aspects = ledger.filter((r) => r.module === m).map((r) => r.aspect).sort();
      expect(aspects, m).toEqual([...ASPECTS].sort());
    }
  });

  it('gives every requirement a verdict either way', () => {
    for (const r of ledger) {
      expect(['verified', 'not_verified'], r.requirement_id).toContain(r.verification);
    }
  });
});

describe('a verified verdict carries real evidence', () => {
  it('cites evidence on every verified requirement', () => {
    for (const r of ledger.filter((x) => x.verification === 'verified')) {
      // A verdict with no evidence is an opinion.
      expect(r.evidence.length, r.requirement_id).toBeGreaterThan(120);
      expect(r.evidence, r.requirement_id).toContain('aspect:');
    }
  });

  it('names a real test suite in every module verdict', () => {
    for (const [name, m] of Object.entries(verdicts.modules)) {
      const text = [...Object.values(m.conditions), ...Object.values(m.verified)].join(' ');
      if (text.trim() === '') continue;
      const cited = SUITES.filter((s) => text.includes(s.split('/').pop()!.replace('.test.ts', '')));
      expect(cited.length, `${name} cites no known suite`).toBeGreaterThan(0);
    }
  });

  it('points every citable suite at a file that exists', () => {
    for (const s of SUITES) {
      expect(existsSync(join(ROOT, s)), s).toBe(true);
    }
  });

  it('satisfies all four acceptance conditions wherever it claims verified', () => {
    for (const r of ledger.filter((x) => x.verification === 'verified')) {
      // The criterion says demonstrate the aspect *with* all four. Partial is
      // not verified.
      expect(r.unmet_conditions, r.requirement_id).toBe('');
    }
  });

  it('states a gap on every requirement it does not verify', () => {
    for (const r of ledger.filter((x) => x.verification === 'not_verified')) {
      // Brevity is fine — "No takeoff to configure." is a complete answer.
      // What is not fine is a blank, or a restatement of the requirement.
      expect(r.gap.trim().length, r.requirement_id).toBeGreaterThan(14);
      expect(r.gap.trim().toLowerCase(), r.requirement_id)
        .not.toBe(`${r.module} ${r.aspect}`.toLowerCase());
    }
  });
});

describe('the ledger refuses to flatter the platform', () => {
  it('verifies nothing in a module that is not built', () => {
    const notBuilt = Object.entries(verdicts.modules)
      .filter(([, m]) => !m.exists).map(([n]) => n);
    expect(notBuilt.length).toBeGreaterThan(0);
    for (const m of notBuilt) {
      const verified = ledger.filter((r) => r.module === m && r.verification === 'verified');
      expect(verified.map((r) => r.aspect), m).toEqual([]);
    }
  });

  it('verifies import/export only where a tested path exists', () => {
    // Estimate Core has exportEstimate/importEstimate with a round-trip test.
    // Nothing else does, and listing them by name means a new one cannot slip
    // in without someone changing this test on purpose.
    const io = ledger
      .filter((r) => r.aspect === 'import/export' && r.verification === 'verified')
      .map((r) => r.module);
    expect(io).toEqual(['Estimate Core']);
  });

  it('holds verification well below tracing for the same phase', () => {
    const p05 = matrix.filter((r) => r.phase === 'P05');
    const traced = p05.filter((r) => r.status !== 'untraced').length;
    const verified = p05.filter((r) => r.verification === 'verified').length;
    // Derived tracing over-claims. Measuring by how much on a phase we checked
    // is the calibration that stops anyone quoting the traced number as
    // coverage.
    expect(verified).toBeLessThan(traced);
    expect(verified / traced).toBeLessThan(0.75);
  });

  it('agrees with the matrix on every P05 verdict', () => {
    const byId = new Map(matrix.map((r) => [r.requirement_id, r.verification]));
    for (const r of ledger) {
      expect(byId.get(r.requirement_id), r.requirement_id).toBe(r.verification);
    }
  });

  it('leaves every unjudged phase reporting none', () => {
    const judged = new Set(['P01', 'P03', 'P05', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P14', 'P15', 'P16', 'P17', 'P18', 'P19', 'P20', 'P23', 'P24', 'P25', 'P26', 'P27', 'P28', 'P29', 'P30']);
    const other = matrix.filter((r) => !judged.has(r.phase!));
    expect(other.every((r) => r.verification === 'none')).toBe(true);
  });
});

// ---------------------------------------------------------------------- P26
const p26Ledger = readCsv(join(G, 'verification/P26-ledger.csv'));
const p26 = JSON.parse(readFileSync(join(G, 'verification/P26-verdicts.json'), 'utf8')) as {
  acceptance_conditions: { conditions: string[] };
  platform_conditions: Record<string, { status: string; evidence?: string; gap?: string }>;
  domain_status: { built: string[]; partial: Record<string, string>; not_built: Record<string, string> };
};

describe('P26 is judged against all ten of its conditions', () => {
  it('holds one verdict for all 450 requirements', () => {
    expect(p26Ledger).toHaveLength(450);
    expect(new Set(p26Ledger.map((r) => r.requirement_id)).size).toBe(450);
  });

  it('accounts for all 49 domains exactly once', () => {
    const { built, partial, not_built: notBuilt } = p26.domain_status;
    const all = [...built, ...Object.keys(partial), ...Object.keys(notBuilt)];
    expect(all).toHaveLength(49);
    expect(new Set(all).size).toBe(49);
    expect(new Set(p26Ledger.map((r) => r.domain))).toEqual(new Set(all));
  });

  it('assesses every one of the ten conditions', () => {
    expect(p26.acceptance_conditions.conditions).toHaveLength(10);
    for (const c of p26.acceptance_conditions.conditions) {
      expect(p26.platform_conditions[c], c).toBeDefined();
    }
  });

  it('gives every met condition evidence and every unmet one a gap', () => {
    for (const [name, c] of Object.entries(p26.platform_conditions)) {
      if (c.status === 'met') expect(c.evidence!.length, name).toBeGreaterThan(60);
      else expect(c.gap!.length, name).toBeGreaterThan(80);
    }
  });

  it('meets all ten conditions platform-wide', () => {
    // Verification originally reported 0 of 450, blocked by three conditions.
    // All three were then built: library snapshots, scenario pricing and a
    // general override record.
    const blocking = Object.entries(p26.platform_conditions)
      .filter(([, v]) => v.status !== 'met').map(([k]) => k);
    expect(blocking).toEqual([]);
  });

  it('names the three conditions this verification caused to be built', () => {
    for (const c of ['library snapshot/version', 'scenario behavior', 'overrides']) {
      expect(p26.platform_conditions[c]!.status, c).toBe('met');
      expect(p26.platform_conditions[c]!.evidence!.length, c).toBeGreaterThan(200);
    }
    expect(p26.domain_status.built).toContain('Snapshot Reproducibility');
    expect(p26.domain_status.built).toContain('Scenario Comparison');
  });

  it('verifies exactly the domains that are built, and no others', () => {
    for (const r of p26Ledger) {
      // With every condition met, the verdict turns entirely on whether the
      // domain itself exists. A partial domain must not verify.
      expect(r.verification === 'verified', `${r.domain} (${r.domain_status})`)
        .toBe(r.domain_status === 'built');
    }
  });

  it('states a gap on every domain it does not verify', () => {
    for (const r of p26Ledger.filter((x) => x.verification === 'not_verified')) {
      expect(r.gap.trim().length, r.requirement_id).toBeGreaterThan(40);
    }
  });

  it('leaves the genuinely absent capabilities unverified', () => {
    const unverified = new Set(
      p26Ledger.filter((r) => r.verification === 'not_verified').map((r) => r.domain));
    // Named explicitly so one cannot start passing without somebody changing
    // this test on purpose.
    for (const d of ['Estimate Templates', 'Quantity Takeoff Intake', 'AI Estimate Assist',
                     'Crew Size Recommendation', 'Service Catalog Writeback']) {
      expect(unverified, d).toContain(d);
    }
  });

  it('agrees with the matrix on every P26 verdict', () => {
    const byId = new Map(matrix.map((r) => [r.requirement_id, r.verification]));
    for (const r of p26Ledger) {
      expect(byId.get(r.requirement_id), r.requirement_id).toBe(r.verification);
    }
  });
});

// ---------------------------------------------------------------------- P25
const p25Ledger = readCsv(join(G, 'verification/P25-ledger.csv'));
const p25 = JSON.parse(readFileSync(join(G, 'verification/P25-verdicts.json'), 'utf8')) as {
  acceptance_conditions: { conditions: string[] };
  platform_conditions: Record<string, { status: string; evidence?: string; gap?: string }>;
  domain_status: { built: string[]; partial: Record<string, string>; not_built: Record<string, string> };
  exemplar: { table: string; note: string };
};

describe('P25 is judged against all eight of its conditions', () => {
  it('holds one verdict for all 400 requirements', () => {
    expect(p25Ledger).toHaveLength(400);
    expect(new Set(p25Ledger.map((r) => r.requirement_id)).size).toBe(400);
  });

  it('accounts for all 32 domains exactly once', () => {
    const { built, partial, not_built: notBuilt } = p25.domain_status;
    const all = [...built, ...Object.keys(partial), ...Object.keys(notBuilt)];
    expect(all).toHaveLength(32);
    expect(new Set(all).size).toBe(32);
    expect(new Set(p25Ledger.map((r) => r.domain))).toEqual(new Set(all));
  });

  it('assesses every one of the eight conditions', () => {
    expect(p25.acceptance_conditions.conditions).toHaveLength(8);
    for (const c of p25.acceptance_conditions.conditions) {
      expect(p25.platform_conditions[c], c).toBeDefined();
    }
  });

  it('gives every met condition evidence and every unmet one a gap', () => {
    for (const [name, c] of Object.entries(p25.platform_conditions)) {
      if (c.status === 'met') expect(c.evidence!.length, name).toBeGreaterThan(80);
      else expect(c.gap!.length, name).toBeGreaterThan(100);
    }
  });

  it('meets all eight conditions across the libraries', () => {
    // Verification originally reported 0 of 400, blocked by four conditions
    // that existed on `services` and nowhere else. Migration 0028 carried the
    // shape to the other eleven and added the history none of them had.
    const blocking = Object.entries(p25.platform_conditions)
      .filter(([, v]) => v.status !== 'met').map(([k]) => k);
    expect(blocking).toEqual([]);
  });

  it('names the four conditions this verification caused to be built', () => {
    for (const c of ['approval state', 'effective dates', 'source/provenance', 'version behavior']) {
      expect(p25.platform_conditions[c]!.status, c).toBe('met');
      expect(p25.platform_conditions[c]!.evidence!.length, c).toBeGreaterThan(150);
    }
    expect(p25.exemplar.table).toBe('services');
  });

  it('verifies exactly the domains that are built, and no others', () => {
    for (const r of p25Ledger) {
      expect(r.verification === 'verified', `${r.domain} (${r.domain_status})`)
        .toBe(r.domain_status === 'built');
    }
  });

  it('records the seeded-provenance limitation rather than claiming it closed', () => {
    const lims = (p25 as unknown as { known_limitations?: { id: string }[] }).known_limitations ?? [];
    expect(lims.map((l) => l.id)).toContain('LIM-P25-001');
  });

  it('still records that most domains are built, so the gap is not read as absence', () => {
    const built = p25Ledger.filter((r) => r.domain_status === 'built').length;
    expect(built).toBeGreaterThan(p25Ledger.length / 2);
  });

  it('agrees with the matrix on every P25 verdict', () => {
    const byId = new Map(matrix.map((r) => [r.requirement_id, r.verification]));
    for (const r of p25Ledger) {
      expect(byId.get(r.requirement_id), r.requirement_id).toBe(r.verification);
    }
  });
});

// ---------------------------------------------------------------------- P24
const p24Ledger = readCsv(join(G, 'verification/P24-ledger.csv'));
const p24 = JSON.parse(readFileSync(join(G, 'verification/P24-verdicts.json'), 'utf8')) as {
  acceptance_conditions: { conditions: string[] };
  platform_conditions: Record<string, { status: string; evidence?: string; gap?: string }>;
  domain_status: { built: string[]; partial: Record<string, string>; not_built: Record<string, string> };
};

describe('P24 is judged against all five of its conditions', () => {
  it('holds one verdict for all 360 requirements', () => {
    expect(p24Ledger).toHaveLength(360);
    expect(new Set(p24Ledger.map((r) => r.requirement_id)).size).toBe(360);
  });

  it('accounts for all 25 domains exactly once', () => {
    const { built, partial, not_built: notBuilt } = p24.domain_status;
    const all = [...built, ...Object.keys(partial), ...Object.keys(notBuilt)];
    expect(all).toHaveLength(25);
    expect(new Set(all).size).toBe(25);
    expect(new Set(p24Ledger.map((r) => r.domain))).toEqual(new Set(all));
  });

  it('assesses every one of the five conditions', () => {
    expect(p24.acceptance_conditions.conditions).toHaveLength(5);
    for (const c of p24.acceptance_conditions.conditions) {
      expect(p24.platform_conditions[c], c).toBeDefined();
    }
  });

  it('gives every met condition evidence and every unmet one a gap', () => {
    for (const [name, c] of Object.entries(p24.platform_conditions)) {
      if (c.status === 'met') expect(c.evidence!.length, name).toBeGreaterThan(120);
      else expect(c.gap!.length, name).toBeGreaterThan(120);
    }
  });

  it('meets all five conditions', () => {
    // Verification originally reported 0 of 360, blocked by one condition
    // alone: the audit half was the platform's strongest evidence and the
    // observability half did not exist. Building it moved 332 requirements.
    const blocking = Object.entries(p24.platform_conditions)
      .filter(([, v]) => v.status !== 'met').map(([k]) => k);
    expect(blocking).toEqual([]);
  });

  it('names observability as built alongside the audit evidence', () => {
    const c = p24.platform_conditions['audit/observability evidence']!;
    expect(c.status).toBe('met');
    expect(c.evidence!).toContain('correlation id');
    expect(c.evidence!).toContain('redacted');
    expect(p24.domain_status.built).toContain('Observability');
    expect(p24.domain_status.built).toContain('Health & Readiness');
  });

  it('leaves the two capabilities that genuinely do not exist unverified', () => {
    expect(Object.keys(p24.domain_status.not_built).sort()).toEqual(
      ['Domain Events', 'Feature Flags']);
    const unverified = new Set(
      p24Ledger.filter((r) => r.verification === 'not_verified').map((r) => r.domain));
    expect(unverified).toEqual(new Set(['Domain Events', 'Feature Flags']));
  });

  it('verifies exactly the domains that are built, and no others', () => {
    for (const r of p24Ledger) {
      expect(r.verification === 'verified', `${r.domain} (${r.domain_status})`)
        .toBe(r.domain_status === 'built');
    }
  });

  it('still records that most domains are built, so the gap is not read as absence', () => {
    const built = p24Ledger.filter((r) => r.domain_status === 'built').length;
    expect(built).toBeGreaterThan(p24Ledger.length * 0.75);
  });

  it('agrees with the matrix on every P24 verdict', () => {
    const byId = new Map(matrix.map((r) => [r.requirement_id, r.verification]));
    for (const r of p24Ledger) {
      expect(byId.get(r.requirement_id), r.requirement_id).toBe(r.verification);
    }
  });
});

// ---------------------------------------------------------------------- P28
const p28Ledger = readCsv(join(G, 'verification/P28-ledger.csv'));
const p28 = JSON.parse(readFileSync(join(G, 'verification/P28-verdicts.json'), 'utf8')) as {
  acceptance_conditions: { conditions: string[] };
  platform_conditions: Record<string, { status: string; evidence?: string; gap?: string }>;
  domain_status: { built: string[]; partial: Record<string, string>; not_built: Record<string, string> };
  notable_finding: { subject: string; finding: string; why_it_matters: string; disposition: string };
};

describe('P28 is judged against all eight of its conditions', () => {
  it('holds one verdict for all 500 requirements', () => {
    expect(p28Ledger).toHaveLength(500);
    expect(new Set(p28Ledger.map((r) => r.requirement_id)).size).toBe(500);
  });

  it('accounts for all 59 domains exactly once', () => {
    const { built, partial, not_built: notBuilt } = p28.domain_status;
    const all = [...built, ...Object.keys(partial), ...Object.keys(notBuilt)];
    expect(all).toHaveLength(59);
    expect(new Set(all).size).toBe(59);
    expect(new Set(p28Ledger.map((r) => r.domain))).toEqual(new Set(all));
  });

  it('assesses every one of the eight conditions', () => {
    expect(p28.acceptance_conditions.conditions).toHaveLength(8);
    for (const c of p28.acceptance_conditions.conditions) {
      expect(p28.platform_conditions[c], c).toBeDefined();
    }
  });

  it('gives every met condition evidence and every unmet one a gap', () => {
    for (const [name, c] of Object.entries(p28.platform_conditions)) {
      if (c.status === 'met') expect(c.evidence!.length, name).toBeGreaterThan(150);
      else expect(c.gap!.length, name).toBeGreaterThan(150);
    }
  });

  it('verifies nothing, blocked by three conditions', () => {
    expect(p28Ledger.every((r) => r.verification === 'not_verified')).toBe(true);
    const blocking = Object.entries(p28.platform_conditions)
      .filter(([, v]) => v.status !== 'met').map(([k]) => k).sort();
    expect(blocking).toEqual(['key/secret lifecycle', 'monitoring', 'threat/failure handling']);
  });

  it('credits the five conditions that are genuinely strong', () => {
    for (const c of ['allow/deny behavior', 'tenant isolation', 'least privilege',
                     'audit evidence', 'mapped security tests']) {
      expect(p28.platform_conditions[c]!.status, c).toBe('met');
    }
  });

  it('separates holding a secret well from managing its lifecycle', () => {
    const gap = p28.platform_conditions['key/secret lifecycle']!.gap!;
    // Secrets are held correctly. Nothing rotates them, which is a different
    // failure and must not be hidden by the first being true.
    expect(gap).toContain('The holding is sound');
    expect(gap).toContain('lifecycle is absent');
  });

  it('records that signals are produced but nothing listens', () => {
    expect(p28.platform_conditions.monitoring!.gap!)
      .toContain('being produced and nobody is listening');
  });

  it('records the MFA toggle finding as resolved, with what was done', () => {
    // The one place the interface claimed a security property the code did not
    // have. Four toggles had the problem, not one.
    const f = p28.notable_finding as typeof p28.notable_finding & {
      status?: string; resolution?: string;
    };
    expect(f.subject).toContain('MFA');
    expect(f.why_it_matters).toContain('false assurance');
    expect(f.status).toBe('resolved');
    expect(f.resolution!).toContain('All four toggles removed');
  });

  it('still counts MFA itself as absent, because removing a toggle is not building one', () => {
    expect(p28.domain_status.not_built.MFA).toContain('Not implemented');
    const mfa = p28Ledger.filter((r) => r.domain === 'MFA');
    expect(mfa.length).toBeGreaterThan(0);
    expect(mfa.every((r) => r.verification === 'not_verified')).toBe(true);
  });

  it('agrees with the matrix on every P28 verdict', () => {
    const byId = new Map(matrix.map((r) => [r.requirement_id, r.verification]));
    for (const r of p28Ledger) {
      expect(byId.get(r.requirement_id), r.requirement_id).toBe(r.verification);
    }
  });
});

// ---------------------------------------------------------------------- P18
const p18Ledger = readCsv(join(G, 'verification/P18-ledger.csv'));
const p18 = JSON.parse(readFileSync(join(G, 'verification/P18-verdicts.json'), 'utf8')) as {
  acceptance_conditions: { conditions: string[] };
  platform_conditions: Record<string, { status: string; evidence?: string; gap?: string }>;
  domain_status: { built: string[]; partial: Record<string, string>; not_built: Record<string, string> };
  finding: { status?: string; resolution?: string; detail: string; why_it_matters: string };
};

describe('P18 — scheduling, judged by domain', () => {
  it('covers all 400 requirements exactly once', () => {
    expect(p18Ledger).toHaveLength(400);
    expect(new Set(p18Ledger.map((r) => r.requirement_id)).size).toBe(400);
  });

  it('judges every domain in the register', () => {
    const declared = new Set([
      ...p18.domain_status.built,
      ...Object.keys(p18.domain_status.partial),
      ...Object.keys(p18.domain_status.not_built),
    ]);
    const inRegister = new Set(p18Ledger.map((r) => r.domain!));
    expect([...inRegister].filter((d) => !declared.has(d))).toEqual([]);
    expect(declared.size).toBe(29);
  });

  it('gives every met condition evidence and every unmet one a gap', () => {
    for (const [name, c] of Object.entries(p18.platform_conditions)) {
      if (c.status === 'met') expect(c.evidence!.length, name).toBeGreaterThan(150);
      else expect(c.gap!.length, name).toBeGreaterThan(150);
    }
  });

  it('has no platform condition blocking the phase any more', () => {
    // Before the build all six failed and all 400 were not verified. What is
    // left is domain work, which is the point of judging by domain.
    const blocking = Object.entries(p18.platform_conditions)
      .filter(([, v]) => v.status !== 'met').map(([k]) => k);
    expect(blocking).toEqual([]);
    expect(p18.acceptance_conditions.conditions).toHaveLength(6);
  });

  it('verifies exactly the requirements whose domain is built', () => {
    const built = new Set(p18.domain_status.built);
    for (const r of p18Ledger) {
      expect(r.verification, `${r.requirement_id} ${r.domain}`)
        .toBe(built.has(r.domain!) ? 'verified' : 'not_verified');
    }
    expect(p18Ledger.filter((r) => r.verification === 'verified')).toHaveLength(98);
  });

  it('records the float finding as resolved, with what was built', () => {
    // The platform stored total_float_days and is_critical and computed
    // neither, and the screen displayed them as though it had.
    expect(p18.finding.detail).toContain('nothing anywhere traversed the graph');
    expect(p18.finding.why_it_matters).toContain('same defect class as a settings toggle');
    expect(p18.finding.status).toBe('resolved');
    expect(p18.finding.resolution!).toContain('cannot be written without naming');
  });

  it('names a specific absence for every domain that is not built', () => {
    // "Partial" with no statement of what is missing is the verdict that
    // lets a phase sit at partial forever.
    for (const [domain, gap] of Object.entries(p18.domain_status.partial)) {
      expect(gap.length, domain).toBeGreaterThan(80);
    }
    for (const [domain, gap] of Object.entries(p18.domain_status.not_built)) {
      expect(gap.length, domain).toBeGreaterThan(40);
    }
  });

  it('does not credit bid leveling as resource leveling', () => {
    // Two different things that share a word. Procurement levels quotes;
    // nothing levels resource demand within float.
    expect(p18.domain_status.not_built['Resource Leveling']).toContain('Bid leveling');
    expect(p18.domain_status.built).not.toContain('Resource Leveling');
  });

  it('counts the look-ahead button as not built', () => {
    // There is a button on the schedule screen and nothing behind it. A
    // control that does nothing is not a capability.
    expect(p18.domain_status.not_built['Look-Ahead Planning']).toContain('nothing behind it');
  });

  it('agrees with the matrix on every P18 verdict', () => {
    const byId = new Map(matrix.map((r) => [r.requirement_id, r.verification]));
    for (const r of p18Ledger) {
      expect(byId.get(r.requirement_id), r.requirement_id).toBe(r.verification);
    }
  });
});

// ---------------------------------------------------------------------- P30
const p30Ledger = readCsv(join(G, 'verification/P30-ledger.csv'));
const p30 = JSON.parse(readFileSync(join(G, 'verification/P30-verdicts.json'), 'utf8')) as {
  acceptance_conditions: { conditions: string[] };
  platform_conditions: Record<string, { status: string; evidence?: string; gap?: string }>;
  domain_status: { built: string[]; partial: Record<string, string>; not_built: Record<string, string> };
  findings: { id: string; title: string; detail: string; why_it_matters: string;
              status?: string; resolution?: string; correction?: string }[];
};

describe('P30 — commercialization, judged by domain', () => {
  it('covers all 540 requirements exactly once', () => {
    expect(p30Ledger).toHaveLength(540);
    expect(new Set(p30Ledger.map((r) => r.requirement_id)).size).toBe(540);
  });

  it('judges every domain in the register', () => {
    const declared = new Set([
      ...p30.domain_status.built,
      ...Object.keys(p30.domain_status.partial),
      ...Object.keys(p30.domain_status.not_built),
    ]);
    const inRegister = new Set(p30Ledger.map((r) => r.domain!));
    expect([...inRegister].filter((d) => !declared.has(d))).toEqual([]);
    expect(declared.size).toBe(63);
  });

  it('assesses all eight conditions and blocks on none', () => {
    expect(p30.acceptance_conditions.conditions).toHaveLength(8);
    const blocking = Object.entries(p30.platform_conditions)
      .filter(([, v]) => v.status !== 'met').map(([k]) => k);
    expect(blocking).toEqual([]);
  });

  it('gives every met condition evidence', () => {
    for (const [name, c] of Object.entries(p30.platform_conditions)) {
      if (c.status === 'met') expect(c.evidence!.length, name).toBeGreaterThan(150);
      else expect(c.gap!.length, name).toBeGreaterThan(150);
    }
  });

  it('verifies exactly the requirements whose domain is built', () => {
    const built = new Set(p30.domain_status.built);
    for (const r of p30Ledger) {
      expect(r.verification, `${r.requirement_id} ${r.domain}`)
        .toBe(built.has(r.domain!) ? 'verified' : 'not_verified');
    }
    expect(p30Ledger.filter((r) => r.verification === 'verified')).toHaveLength(174);
  });

  it('records five findings, four resolved and one open with its reason', () => {
    expect(p30.findings).toHaveLength(5);
    for (const f of p30.findings) {
      expect(f.why_it_matters.length, f.id).toBeGreaterThan(80);
      if (f.status === 'resolved') {
        expect(f.resolution!.length, f.id).toBeGreaterThan(150);
      } else {
        // An open finding has to say why it is open, or "open" is just a
        // place to put work somebody did not want to do.
        expect(f.status, f.id).toBe('open');
        expect((f as { why_not_resolved?: string }).why_not_resolved!.length, f.id)
          .toBeGreaterThan(150);
      }
    }
    expect(p30.findings.filter((f) => f.status === 'resolved')).toHaveLength(4);
  });

  it('records that feature entitlement is computed and almost never consulted', () => {
    // The defect that survived the other four: has_entitlement is called from
    // exactly one place in the platform.
    const f = p30.findings.find((x) => x.id === 'P30-F5')!;
    expect(f.detail).toContain('exactly one place');
    expect(f.status).toBe('open');
  });

  it('records that the pricing page sold a capability that does not exist', () => {
    // The settings-toggle defect, on the page where somebody decides to pay.
    const f = p30.findings.find((x) => x.id === 'P30-F2')!;
    expect(f.detail).toContain('SSO');
    expect(f.detail).toContain('data residency');
    expect(f.why_it_matters).toContain('takes money for it');
  });

  it('records that plan limits were decorative', () => {
    const f = p30.findings.find((x) => x.id === 'P30-F3')!;
    expect(f.detail).toContain('Nothing anywhere refused the 26th estimate');
    expect(f.resolution).toContain('never becomes a data outage');
  });

  it('does not claim a limit it deliberately left unenforced', () => {
    // Storage and AI credits are published and not enforced, because nothing
    // measures either. Enforcing against a number nobody computes would be
    // the same defect one layer down.
    expect(p30.domain_status.built).not.toContain('Storage Entitlements');
    expect(p30.domain_status.partial['Storage Entitlements']).toContain('nothing to enforce it against');
    // Corrected while verifying P27: AI usage was always metered, so the
    // original "nothing meters it" reasoning was wrong for this half and the
    // finding says so rather than quietly changing.
    expect(p30.domain_status.partial['AI Usage Entitlements']).toContain('since migration 0039 enforced');
    expect(p30.findings.find((x) => x.id === 'P30-F3')!.correction)
      .toContain('That was wrong.');
  });

  it('keeps SSO out of the built list, having removed the claim rather than the gap', () => {
    // Removing a false claim is not building the capability.
    const all = [...p30.domain_status.built, ...Object.keys(p30.domain_status.partial),
                 ...Object.keys(p30.domain_status.not_built)];
    expect(all.some((d) => /sso|sign-on/i.test(d))).toBe(false);
    expect(p30.findings.find((x) => x.id === 'P30-F2')!.resolution)
      .toContain('removed from the pricing page');
  });

  it('agrees with the matrix on every P30 verdict', () => {
    const byId = new Map(matrix.map((r) => [r.requirement_id, r.verification]));
    for (const r of p30Ledger) {
      expect(byId.get(r.requirement_id), r.requirement_id).toBe(r.verification);
    }
  });
});

// ---------------------------------------------------------------------- P19
const p19Ledger = readCsv(join(G, 'verification/P19-ledger.csv'));
const p19 = JSON.parse(readFileSync(join(G, 'verification/P19-verdicts.json'), 'utf8')) as {
  acceptance_conditions: { conditions: string[] };
  platform_conditions: Record<string, { status: string; evidence?: string; gap?: string }>;
  domain_status: { built: string[]; partial: Record<string, string>; not_built: Record<string, string> };
  findings: { id: string; detail: string; why_it_matters: string; status?: string; resolution?: string }[];
};

describe('P19 — contracts, changes and claims, judged by domain', () => {
  it('covers all 420 requirements exactly once', () => {
    expect(p19Ledger).toHaveLength(420);
    expect(new Set(p19Ledger.map((r) => r.requirement_id)).size).toBe(420);
  });

  it('judges every domain in the register', () => {
    const declared = new Set([
      ...p19.domain_status.built,
      ...Object.keys(p19.domain_status.partial),
      ...Object.keys(p19.domain_status.not_built),
    ]);
    expect([...new Set(p19Ledger.map((r) => r.domain!))].filter((d) => !declared.has(d))).toEqual([]);
    expect(declared.size).toBe(29);
  });

  it('assesses all five conditions and blocks on none', () => {
    expect(p19.acceptance_conditions.conditions).toHaveLength(5);
    expect(Object.entries(p19.platform_conditions)
      .filter(([, v]) => v.status !== 'met').map(([k]) => k)).toEqual([]);
  });

  it('gives every met condition evidence', () => {
    for (const [name, c] of Object.entries(p19.platform_conditions)) {
      if (c.status === 'met') expect(c.evidence!.length, name).toBeGreaterThan(150);
      else expect(c.gap!.length, name).toBeGreaterThan(150);
    }
  });

  it('verifies exactly the requirements whose domain is built', () => {
    const built = new Set(p19.domain_status.built);
    for (const r of p19Ledger) {
      expect(r.verification, `${r.requirement_id} ${r.domain}`)
        .toBe(built.has(r.domain!) ? 'verified' : 'not_verified');
    }
    expect(p19Ledger.filter((r) => r.verification === 'verified')).toHaveLength(135);
  });

  it('records five findings, all resolved', () => {
    expect(p19.findings).toHaveLength(5);
    for (const f of p19.findings) {
      expect(f.status, f.id).toBe('resolved');
      expect(f.resolution!.length, f.id).toBeGreaterThan(150);
    }
  });

  it('records that an obligation was less protected than an offer', () => {
    // RULE-009 froze the issued estimate. Nothing froze the contract.
    const f = p19.findings.find((x) => x.id === 'P19-F1')!;
    expect(f.why_it_matters).toContain('An issued estimate is an offer; a contract is an obligation');
  });

  it('names the deadline defect as the fourth of its kind', () => {
    const f = p19.findings.find((x) => x.id === 'P19-F2')!;
    expect(f.why_it_matters).toContain('fourth appearance of one pattern');
    expect(f.resolution).toContain('a test caught');
  });

  it('records that these tables had no tests at all', () => {
    // The clearest single illustration of why derived tracing is an upper
    // bound: three tables counted as tested with zero tests.
    const f = p19.findings.find((x) => x.id === 'P19-F5')!;
    expect(f.detail).toContain('none at all');
    expect(f.why_it_matters).toContain('upper bound');
  });

  it('agrees with the matrix on every P19 verdict', () => {
    const byId = new Map(matrix.map((r) => [r.requirement_id, r.verification]));
    for (const r of p19Ledger) {
      expect(byId.get(r.requirement_id), r.requirement_id).toBe(r.verification);
    }
  });
});

// ---------------------------------------------------------------------- P10
const p10Ledger = readCsv(join(G, 'verification/P10-ledger.csv'));
const p10 = JSON.parse(readFileSync(join(G, 'verification/P10-verdicts.json'), 'utf8')) as {
  method: string;
  aspects: { id: string; match: string; name: string; status: string; evidence?: string; gap?: string }[];
  subjects: Record<string, { exists: string; note: string }>;
  subject_exceptions: Record<string, Record<string, string>>;
  findings: { id: string; detail: string; why_it_matters: string;
              status?: string; resolution?: string; why_not_resolved?: string }[];
};

describe('P10 — financial management, judged aspect by aspect', () => {
  it('covers all 240 requirements exactly once', () => {
    expect(p10Ledger).toHaveLength(240);
    expect(new Set(p10Ledger.map((r) => r.requirement_id)).size).toBe(240);
  });

  it('factors into 16 subjects by 15 aspects, with none left over', () => {
    expect(p10.aspects).toHaveLength(15);
    expect(Object.keys(p10.subjects)).toHaveLength(16);
    for (const aspect of p10.aspects) {
      expect(p10Ledger.filter((r) => r.aspect === aspect.name), aspect.name).toHaveLength(16);
    }
  });

  it('says plainly that it judged against the statement, not a criterion', () => {
    // 797 requirements across five phases have no acceptance criteria. The
    // method has to say what it used instead, or the verdict overstates its
    // own basis.
    expect(p10.method).toContain('carries no acceptance criteria at all');
    expect(p10.method).toContain('judged against its own statement');
  });

  it('gives every met aspect evidence and every unmet one a gap', () => {
    for (const a of p10.aspects) {
      if (a.status === 'met') expect(a.evidence!.length, a.id).toBeGreaterThan(150);
      else expect(a.gap!.length, a.id).toBeGreaterThan(120);
    }
  });

  it('verifies only where the aspect holds and the subject exists', () => {
    for (const r of p10Ledger) {
      const subject = p10.subjects[r.domain!]!;
      const exception = p10.subject_exceptions[r.domain!]?.[
        p10.aspects.find((a) => a.name === r.aspect)!.id];
      const aspectStatus = exception ? exception.split(' ')[0]
        : p10.aspects.find((a) => a.name === r.aspect)!.status;
      const expected = aspectStatus === 'met' && subject.exists === 'yes' ? 'verified' : 'not_verified';
      expect(r.verification, `${r.requirement_id} ${r.domain} / ${r.aspect}`).toBe(expected);
    }
    expect(p10Ledger.filter((r) => r.verification === 'verified')).toHaveLength(16);
  });

  it('states that there is no general ledger rather than implying one', () => {
    // Six of sixteen subjects have nothing to judge. Saying so is more useful
    // than a partial verdict that suggests something is there.
    expect(p10.subjects['General Ledger']!.exists).toBe('no');
    const f = p10.findings.find((x) => x.id === 'P10-F3')!;
    expect(f.status).toBe('open');
    expect(f.why_not_resolved).toContain('building a half-ledger would be worse than having none');
  });

  it('records the missing acceptance criteria as a register defect, left open', () => {
    const f = p10.findings.find((x) => x.id === 'P10-F1')!;
    expect(f.detail).toContain('797');
    expect(f.status).toBe('open');
    // Writing the criteria and then judging against them is the one thing the
    // whole traceability system exists to prevent.
    expect(f.why_not_resolved).toContain('marking my own homework');
  });

  it('does not credit a period control where nothing is posting-dated', () => {
    for (const subject of ['Integrations & Data Exchange', 'Security, Audit & Compliance']) {
      expect(p10.subject_exceptions[subject]!.A14).toContain('not_met');
      const rows = p10Ledger.filter(
        (r) => r.domain === subject && r.aspect!.includes('period controls'));
      expect(rows, subject).toHaveLength(1);
      expect(rows[0]!.verification, subject).toBe('not_verified');
    }
  });

  it('agrees with the matrix on every P10 verdict', () => {
    const byId = new Map(matrix.map((r) => [r.requirement_id, r.verification]));
    for (const r of p10Ledger) {
      expect(byId.get(r.requirement_id), r.requirement_id).toBe(r.verification);
    }
  });
});

// ---------------------------------------------------------------------- P14
const p14Ledger = readCsv(join(G, 'verification/P14-ledger.csv'));
const p14 = JSON.parse(readFileSync(join(G, 'verification/P14-verdicts.json'), 'utf8')) as {
  acceptance_conditions: { conditions: string[] };
  platform_conditions: Record<string, { status: string; evidence?: string; gap?: string }>;
  domain_status: { built: string[]; partial: Record<string, string>; not_built: Record<string, string> };
  findings: { id: string; detail: string; why_it_matters: string; status?: string; resolution?: string }[];
};

describe('P14 — safety and quality, judged by domain', () => {
  it('covers all 320 requirements exactly once', () => {
    expect(p14Ledger).toHaveLength(320);
    expect(new Set(p14Ledger.map((r) => r.requirement_id)).size).toBe(320);
  });

  it('judges every domain in the register', () => {
    const declared = new Set([
      ...p14.domain_status.built,
      ...Object.keys(p14.domain_status.partial),
      ...Object.keys(p14.domain_status.not_built),
    ]);
    expect([...new Set(p14Ledger.map((r) => r.domain!))].filter((d) => !declared.has(d))).toEqual([]);
    expect(declared.size).toBe(18);
  });

  it('assesses all six conditions and blocks on none', () => {
    expect(p14.acceptance_conditions.conditions).toHaveLength(6);
    expect(Object.entries(p14.platform_conditions)
      .filter(([, v]) => v.status !== 'met').map(([k]) => k)).toEqual([]);
  });

  it('gives every met condition evidence', () => {
    for (const [name, c] of Object.entries(p14.platform_conditions)) {
      if (c.status === 'met') expect(c.evidence!.length, name).toBeGreaterThan(150);
      else expect(c.gap!.length, name).toBeGreaterThan(150);
    }
  });

  it('verifies exactly the requirements whose domain is built', () => {
    const built = new Set(p14.domain_status.built);
    for (const r of p14Ledger) {
      expect(r.verification, `${r.requirement_id} ${r.domain}`)
        .toBe(built.has(r.domain!) ? 'verified' : 'not_verified');
    }
    expect(p14Ledger.filter((r) => r.verification === 'verified')).toHaveLength(54);
  });

  it('records that the safety system recorded everything and prevented nothing', () => {
    const f = p14.findings.find((x) => x.id === 'P14-F1')!;
    // The field the fix needed was already in the schema, unread.
    expect(f.detail).toContain('nothing anywhere read it');
    expect(f.why_it_matters).toContain('filing cabinet');
    expect(f.status).toBe('resolved');
  });

  it('records that the notification table had no producer at all', () => {
    const f = p14.findings.find((x) => x.id === 'P14-F2')!;
    expect(f.detail).toContain('nothing inserts into it');
    expect(f.resolution).toContain('only on becoming recordable');
  });

  it('states the deliberate limits of the blocking control', () => {
    // A control that blocks on everything gets switched off, and a control
    // whose limits are unstated is one nobody can rely on.
    const c = p14.platform_conditions['blocking controls where applicable']!;
    expect(c.evidence).toContain('mandatory requirements block, recommended ones do not');
    expect(c.evidence).toContain('is not running a policy the platform will invent for it');
  });

  it('does not claim notification delivery it does not have', () => {
    // emailed_at exists and nothing sets it, because nothing sends email.
    expect(p14.platform_conditions.notifications!.evidence)
      .toContain('the platform sends no email at all');
  });

  it('agrees with the matrix on every P14 verdict', () => {
    const byId = new Map(matrix.map((r) => [r.requirement_id, r.verification]));
    for (const r of p14Ledger) {
      expect(byId.get(r.requirement_id), r.requirement_id).toBe(r.verification);
    }
  });
});

// ---------------------------------------------------------------------- P15
const p15Ledger = readCsv(join(G, 'verification/P15-ledger.csv'));
const p15 = JSON.parse(readFileSync(join(G, 'verification/P15-verdicts.json'), 'utf8')) as {
  acceptance_conditions: { conditions: string[] };
  platform_conditions: Record<string, { status: string; evidence?: string; gap?: string }>;
  domain_status: { built: string[]; partial: Record<string, string>; not_built: Record<string, string> };
  findings: { id: string; detail: string; why_it_matters: string; status?: string; resolution?: string }[];
};

describe('P15 — documents, judged by domain', () => {
  it('covers all 340 requirements exactly once', () => {
    expect(p15Ledger).toHaveLength(340);
    expect(new Set(p15Ledger.map((r) => r.requirement_id)).size).toBe(340);
  });

  it('judges every domain in the register', () => {
    const declared = new Set([
      ...p15.domain_status.built,
      ...Object.keys(p15.domain_status.partial),
      ...Object.keys(p15.domain_status.not_built),
    ]);
    expect([...new Set(p15Ledger.map((r) => r.domain!))].filter((d) => !declared.has(d))).toEqual([]);
    expect(declared.size).toBe(18);
  });

  it('assesses all six conditions and blocks on none', () => {
    expect(p15.acceptance_conditions.conditions).toHaveLength(6);
    expect(Object.entries(p15.platform_conditions)
      .filter(([, v]) => v.status !== 'met').map(([k]) => k)).toEqual([]);
  });

  it('gives every met condition evidence', () => {
    for (const [name, c] of Object.entries(p15.platform_conditions)) {
      if (c.status === 'met') expect(c.evidence!.length, name).toBeGreaterThan(150);
      else expect(c.gap!.length, name).toBeGreaterThan(150);
    }
  });

  it('verifies exactly the requirements whose domain is built', () => {
    const built = new Set(p15.domain_status.built);
    for (const r of p15Ledger) {
      expect(r.verification, `${r.requirement_id} ${r.domain}`)
        .toBe(built.has(r.domain!) ? 'verified' : 'not_verified');
    }
    expect(p15Ledger.filter((r) => r.verification === 'verified')).toHaveLength(133);
  });

  it('records the current version as the fifth of one pattern', () => {
    const f = p15.findings.find((x) => x.id === 'P15-F1')!;
    expect(f.why_it_matters).toContain('fifth appearance in this build of one pattern');
    expect(f.status).toBe('resolved');
  });

  it('records the column whose own comment named a purpose nothing fulfilled', () => {
    const f = p15.findings.find((x) => x.id === 'P15-F2')!;
    expect(f.detail).toContain('permission-filtered search across the plan set');
    expect(f.why_it_matters).toContain('stated its own purpose and nothing fulfilled it');
  });

  it('records the cross-tenant hole the tests found, and that the build made it reachable', () => {
    // Honest about sequence: the first half of the migration made the defect
    // matter more, and the tests written for it are what surfaced it.
    const f = p15.findings.find((x) => x.id === 'P15-F4')!;
    expect(f.why_it_matters).toContain('the first half of this migration made it reachable');
    expect(f.detail).toContain('would still have felt it');
  });

  it('records that document control had no tests', () => {
    const f = p15.findings.find((x) => x.id === 'P15-F5')!;
    expect(f.why_it_matters).toContain('no amount of reading the schema had surfaced');
  });

  it('does not claim an OCR engine it does not have', () => {
    expect(p15.domain_status.partial['OCR & Content Extraction'])
      .toContain('There is no OCR engine in the platform');
  });

  it('agrees with the matrix on every P15 verdict', () => {
    const byId = new Map(matrix.map((r) => [r.requirement_id, r.verification]));
    for (const r of p15Ledger) {
      expect(byId.get(r.requirement_id), r.requirement_id).toBe(r.verification);
    }
  });
});

// ---------------------------------------------------------------------- P11
const p11Ledger = readCsv(join(G, 'verification/P11-ledger.csv'));
const p11 = JSON.parse(readFileSync(join(G, 'verification/P11-verdicts.json'), 'utf8')) as {
  acceptance_conditions: { conditions: string[] };
  platform_conditions: Record<string, { status: string; evidence?: string; gap?: string }>;
  domain_status: { built: string[]; partial: Record<string, string>; not_built: Record<string, string> };
  judged_before_and_after: string;
  findings: { id: string; detail: string; why_it_matters: string;
              status?: string; resolution?: string; why_not_resolved?: string }[];
};

describe('P11 — procurement, judged by domain', () => {
  it('covers all 260 requirements exactly once', () => {
    expect(p11Ledger).toHaveLength(260);
    expect(new Set(p11Ledger.map((r) => r.requirement_id)).size).toBe(260);
  });

  it('judges every domain in the register', () => {
    const declared = new Set([
      ...p11.domain_status.built,
      ...Object.keys(p11.domain_status.partial),
      ...Object.keys(p11.domain_status.not_built),
    ]);
    expect([...new Set(p11Ledger.map((r) => r.domain!))].filter((d) => !declared.has(d))).toEqual([]);
    expect(declared.size).toBe(16);
  });

  it('assesses all four conditions and blocks on none', () => {
    expect(p11.acceptance_conditions.conditions).toHaveLength(4);
    expect(Object.entries(p11.platform_conditions)
      .filter(([, v]) => v.status !== 'met').map(([k]) => k)).toEqual([]);
  });

  it('verifies exactly the requirements whose domain is built', () => {
    const built = new Set(p11.domain_status.built);
    for (const r of p11Ledger) {
      expect(r.verification, `${r.requirement_id} ${r.domain}`)
        .toBe(built.has(r.domain!) ? 'verified' : 'not_verified');
    }
    expect(p11Ledger.filter((r) => r.verification === 'verified')).toHaveLength(80);
  });

  it('records that every other procurement control was downstream of the commitment', () => {
    const f = p11.findings.find((x) => x.id === 'P11-F1')!;
    expect(f.why_it_matters).toContain('All of them are strong and all of them are downstream');
    expect(f.status).toBe('resolved');
  });

  it('leaves the requisition open with a reason rather than half-building it', () => {
    // A requisition is a workflow with approval routing, and the platform has
    // no configurable routing to build it on.
    const f = p11.findings.find((x) => x.id === 'P11-F2')!;
    expect(f.status).toBe('open');
    expect(f.why_not_resolved).toContain('satisfy the word and not the need');
  });

  it('credits procurement as the best-tested area examined', () => {
    // Worth stating: this is the first phase where the implementation was
    // already close, and the verdict should say so rather than manufacture
    // a deficit.
    expect(p11.judged_before_and_after as unknown as string)
      .toContain('the best-tested area the build has examined');
  });

  it('agrees with the matrix on every P11 verdict', () => {
    const byId = new Map(matrix.map((r) => [r.requirement_id, r.verification]));
    for (const r of p11Ledger) {
      expect(byId.get(r.requirement_id), r.requirement_id).toBe(r.verification);
    }
  });
});

// ---------------------------------------------------------------------- P12
const p12Ledger = readCsv(join(G, 'verification/P12-ledger.csv'));
const p12 = JSON.parse(readFileSync(join(G, 'verification/P12-verdicts.json'), 'utf8')) as {
  acceptance_conditions: { conditions: string[] };
  platform_conditions: Record<string, { status: string; evidence?: string; gap?: string }>;
  domain_status: { built: string[]; partial: Record<string, string>; not_built: Record<string, string> };
  findings: { id: string; detail: string; why_it_matters: string; status?: string; resolution?: string }[];
};

describe('P12 — fleet, judged by domain', () => {
  it('covers all 280 requirements exactly once', () => {
    expect(p12Ledger).toHaveLength(280);
    expect(new Set(p12Ledger.map((r) => r.requirement_id)).size).toBe(280);
  });

  it('judges every domain in the register', () => {
    const declared = new Set([
      ...p12.domain_status.built,
      ...Object.keys(p12.domain_status.partial),
      ...Object.keys(p12.domain_status.not_built),
    ]);
    expect([...new Set(p12Ledger.map((r) => r.domain!))].filter((d) => !declared.has(d))).toEqual([]);
    expect(declared.size).toBe(24);
  });

  it('assesses all five conditions and blocks on none', () => {
    expect(p12.acceptance_conditions.conditions).toHaveLength(5);
    expect(Object.entries(p12.platform_conditions)
      .filter(([, v]) => v.status !== 'met').map(([k]) => k)).toEqual([]);
  });

  it('verifies exactly the requirements whose domain is built', () => {
    const built = new Set(p12.domain_status.built);
    for (const r of p12Ledger) {
      expect(r.verification, `${r.requirement_id} ${r.domain}`)
        .toBe(built.has(r.domain!) ? 'verified' : 'not_verified');
    }
    expect(p12Ledger.filter((r) => r.verification === 'verified')).toHaveLength(72);
  });

  it('records that both sides of the fuel posting were designed and neither wrote it', () => {
    const f = p12.findings.find((x) => x.id === 'P12-F1')!;
    expect(f.detail).toContain('Both sides were shaped for exactly this posting, and nothing wrote it');
    expect(f.resolution).toContain('cannot route around the accounting control');
  });

  it('records a deliberate non-posting as a decision, not a gap', () => {
    // Maintenance belongs to the equipment rate. Posting it to a job would
    // double-count and put a worn undercarriage on the last project to use
    // the machine.
    const f = p12.findings.find((x) => x.id === 'P12-F3')!;
    expect(f.why_it_matters).toContain('the reason equipment rates exist');
    expect(f.resolution).toContain('confirms no equipment cost row appears');
  });

  it('does not credit a tire register that does not exist', () => {
    expect(p12.domain_status.not_built['Tires & Undercarriage'])
      .toContain('no representation at all');
  });

  it('agrees with the matrix on every P12 verdict', () => {
    const byId = new Map(matrix.map((r) => [r.requirement_id, r.verification]));
    for (const r of p12Ledger) {
      expect(byId.get(r.requirement_id), r.requirement_id).toBe(r.verification);
    }
  });
});

// ---------------------------------------------------------------------- P20
const p20Ledger = readCsv(join(G, 'verification/P20-ledger.csv'));
const p20 = JSON.parse(readFileSync(join(G, 'verification/P20-verdicts.json'), 'utf8')) as {
  platform_conditions: Record<string, { status: string; evidence?: string; gap?: string }>;
  domain_status: { built: string[]; partial: Record<string, string>; not_built: Record<string, string> };
  findings: { id: string; detail: string; why_it_matters: string;
              status?: string; resolution?: string; why_not_resolved?: string; note?: string }[];
};

describe('P20 — deployment and readiness, judged at zero on purpose', () => {
  it('covers all 450 requirements exactly once', () => {
    expect(p20Ledger).toHaveLength(450);
    expect(new Set(p20Ledger.map((r) => r.requirement_id)).size).toBe(450);
  });

  it('verifies nothing, blocked by two conditions', () => {
    expect(p20Ledger.every((r) => r.verification === 'not_verified')).toBe(true);
    const blocking = Object.entries(p20.platform_conditions)
      .filter(([, v]) => v.status !== 'met').map(([k]) => k).sort();
    expect(blocking).toEqual([
      'controlled integration/deployment/test/operations evidence',
      'failure/recovery scenarios',
    ]);
  });

  it('claims no domain as built, having built only configuration', () => {
    // Ten domains moved to partial. None moved to built, because a workflow
    // file is not a pipeline.
    expect(p20.domain_status.built).toEqual([]);
    expect(Object.keys(p20.domain_status.partial).length).toBe(10);
  });

  it('refuses to count committed YAML as a running pipeline', () => {
    // The largest available instance of the defect this build has spent
    // thirteen phases finding. Naming it is the point.
    const f = p20.findings.find((x) => x.id === 'P20-F1')!;
    expect(f.status).toBe('open');
    expect(f.detail).toContain('No pipeline has run, no environment exists, and nothing has been deployed');
    expect(f.why_it_matters).toContain('a settings toggle that switches nothing');
    expect(f.why_not_resolved).toContain('It cannot be resolved from here');
  });

  it('says plainly that the test and traceability conditions are met', () => {
    // Being strict about deployment does not mean being falsely modest about
    // what genuinely exists.
    for (const c of ['security and tenant boundaries', 'traceability', 'mapped acceptance tests']) {
      expect(p20.platform_conditions[c]!.status, c).toBe('met');
    }
  });

  it('records the secret boundary as enforced, and the bug found enforcing it', () => {
    const f = p20.findings.find((x) => x.id === 'P20-F2')!;
    expect(f.status).toBe('resolved');
    expect(f.note).toContain('hard-coded one base64 encoding');
    expect(f.note).toContain('watching the check pass when it should have failed');
  });

  it('agrees with the matrix on every P20 verdict', () => {
    const byId = new Map(matrix.map((r) => [r.requirement_id, r.verification]));
    for (const r of p20Ledger) {
      expect(byId.get(r.requirement_id), r.requirement_id).toBe(r.verification);
    }
  });
});

// ---------------------------------------------------------------------- P27
const p27Ledger = readCsv(join(G, 'verification/P27-ledger.csv'));
const p27 = JSON.parse(readFileSync(join(G, 'verification/P27-verdicts.json'), 'utf8')) as {
  platform_conditions: Record<string, { status: string; evidence?: string; gap?: string }>;
  domain_status: { built: string[]; partial: Record<string, string>; not_built: Record<string, string> };
  findings: { id: string; detail: string; why_it_matters: string;
              status?: string; resolution?: string; why_not_resolved?: string }[];
};

describe('P27 — AI platform, judged by domain', () => {
  it('covers all 480 requirements exactly once', () => {
    expect(p27Ledger).toHaveLength(480);
    expect(new Set(p27Ledger.map((r) => r.requirement_id)).size).toBe(480);
  });

  it('judges every one of the 51 domains', () => {
    const declared = new Set([
      ...p27.domain_status.built,
      ...Object.keys(p27.domain_status.partial),
      ...Object.keys(p27.domain_status.not_built),
    ]);
    expect([...new Set(p27Ledger.map((r) => r.domain!))].filter((d) => !declared.has(d))).toEqual([]);
    expect(declared.size).toBe(51);
  });

  it('verifies nothing, blocked by two conditions', () => {
    expect(p27Ledger.every((r) => r.verification === 'not_verified')).toBe(true);
    const blocking = Object.entries(p27.platform_conditions)
      .filter(([, v]) => v.status !== 'met').map(([k]) => k).sort();
    expect(blocking).toEqual(['evaluation results', 'tool permissions']);
  });

  it('credits the six conditions that genuinely hold', () => {
    // Being strict about what is missing does not license being modest about
    // what is there. The owner's two AI constraints both hold structurally.
    for (const c of ['source evidence', 'deterministic handoff behavior', 'human-review state',
                     'confidence/uncertainty handling', 'tenant isolation', 'mapped tests']) {
      expect(p27.platform_conditions[c]!.status, c).toBe('met');
    }
  });

  it('records that a prompt is a request and a validator is a control', () => {
    const c = p27.platform_conditions['deterministic handoff behavior']!;
    expect(c.evidence).toContain('a prompt is a request and a validator is a control');
    expect(c.evidence).toContain('unconfigurable');
  });

  it('distinguishes an absent capability from an ungoverned one', () => {
    // No tool surface means nothing to permission. That is not the same as a
    // tool surface nobody guards, and the verdict says which it is.
    const c = p27.platform_conditions['tool permissions']!;
    expect(c.gap).toContain('nothing to verify rather than because something is ungoverned');
  });

  it('refuses to approximate an evaluation it cannot honestly build', () => {
    const f = p27.findings.find((x) => x.id === 'P27-F2')!;
    expect(f.status).toBe('open');
    expect(f.why_not_resolved).toContain('measure nothing except agreement with itself');
  });

  it('records that a prior verdict of its own was wrong, and corrects it', () => {
    // A verdict that overstates an obstacle protects the gap it describes.
    const f = p27.findings.find((x) => x.id === 'P27-F3')!;
    expect(f.why_it_matters).toContain('the verification itself carried the error');
    expect(f.resolution).toContain('corrected in place with the correction recorded');
  });

  it('counts the never-autonomous constraint as a promise kept, not a gap', () => {
    expect(p27.domain_status.not_built['Autonomous Background Tasks'])
      .toContain('the platform keeping a promise rather than a gap');
  });

  it('agrees with the matrix on every P27 verdict', () => {
    const byId = new Map(matrix.map((r) => [r.requirement_id, r.verification]));
    for (const r of p27Ledger) {
      expect(byId.get(r.requirement_id), r.requirement_id).toBe(r.verification);
    }
  });
});
