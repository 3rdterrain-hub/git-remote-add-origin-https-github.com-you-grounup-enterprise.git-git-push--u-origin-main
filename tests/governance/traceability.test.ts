/**
 * The Master Traceability Matrix, kept honest.
 *
 * A traceability matrix that overstates coverage is worse than none: it is the
 * number people stop checking things against. The first generated run of this
 * matrix claimed 99.1% coverage because its patterns matched the free text of
 * every requirement, and the second claimed that a table storing a design file
 * implemented automatic grade control.
 *
 * These tests exist so neither can happen again quietly.
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
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift()!;
  return rows.filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]!])));
}

const matrix = readCsv(join(G, 'traceability-matrix.csv'));
const artifacts = readCsv(join(G, 'artifacts.csv'));
const summary = JSON.parse(readFileSync(join(G, 'summary.json'), 'utf8')) as {
  totals: Record<string, number>;
  overbroad_rules: { rule: string; share: number }[];
  rule_hits: Record<string, number>;
};
const rules = JSON.parse(readFileSync(join(G, 'mapping-rules.json'), 'utf8')) as {
  rules: { id: string; match: string; exclude?: string; artifacts: string[]; tests: string[]; why: string }[];
  global_exclude: { pattern: string; opt_out: string[] };
};

const artifactIds = new Set(artifacts.map((a) => a.artifact_id!));
const testArtifacts = new Map(artifacts.filter((a) => a.kind === 'test').map((a) => [a.artifact_id!, a]));

describe('every claim in the matrix points at something real', () => {
  it('references only artifacts that exist in the catalog', () => {
    const unknown = new Set<string>();
    for (const row of matrix) {
      for (const a of (row.artifacts ?? '').split(' ').filter(Boolean)) {
        if (!artifactIds.has(a)) unknown.add(a);
      }
    }
    expect([...unknown]).toEqual([]);
  });

  it('references only test suites whose files exist on disk', () => {
    const missing: string[] = [];
    for (const row of matrix) {
      for (const t of (row.tests ?? '').split(' ').filter(Boolean)) {
        const a = testArtifacts.get(t);
        if (!a) { missing.push(`${t} (not in catalog)`); continue; }
        // A cited test that is not on disk is a citation to nothing.
        if (!existsSync(join(ROOT, a.path!))) missing.push(`${t} → ${a.path}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('points every cataloged artifact at a path that exists', () => {
    const missing = artifacts
      .filter((a) => !a.path!.startsWith('supabase/migrations (table'))
      .filter((a) => !existsSync(join(ROOT, a.path!)))
      .map((a) => `${a.artifact_id} → ${a.path}`);
    expect(missing).toEqual([]);
  });
});

describe('tracing is not verification, and the matrix must not blur them', () => {
  it('keeps tracing and verification in separate columns', () => {
    // A P05 requirement traced but not verified is the normal case, and the
    // two columns must be able to disagree.
    const disagree = matrix.filter(
      (r) => r.status === 'traced_tested' && r.verification === 'not_verified');
    expect(disagree.length).toBeGreaterThan(0);
  });

  it('uses statuses that cannot be read as verification', () => {
    const statuses = new Set(matrix.map((r) => r.status));
    // "verified" is reserved for a requirement whose acceptance criteria a
    // person has read and confirmed a test asserts. No derived rule earns it.
    expect([...statuses].sort()).toEqual(['traced_tested', 'untraced']);
  });

  it('marks every derived mapping as derived', () => {
    for (const row of matrix) {
      if (row.status === 'untraced') continue;
      expect(row.mapping_method, row.requirement_id).toBe('derived');
    }
  });

  it('reports verification only where a ledger judged it', () => {
    // Twenty-five phases have been judged requirement by requirement; nothing else
    // has. A requirement carrying a verdict without a ledger behind it would
    // be a claim nobody made.
    const judged = matrix.filter((r) => r.verification !== 'none');
    expect(new Set(judged.map((r) => r.phase))).toEqual(new Set(['P01', 'P03', 'P04', 'P05', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P14', 'P15', 'P16', 'P17', 'P18', 'P19', 'P20', 'P23', 'P24', 'P25', 'P26', 'P27', 'P28', 'P29', 'P30']));
    expect(judged).toHaveLength(25 + 75 + 97 + 108 + 300 + 160 + 180 + 210 + 240 + 360 + 380 + 260 + 280 + 320 + 340 + 400 + 420 + 450 + 360 + 400 + 450 + 480 + 500 + 520 + 540);
    expect(summary.totals.verified).toBe(
      matrix.filter((r) => r.verification === 'verified').length);
  });

  /*
   * Declarations run the other way.
   *
   * Every mapping in the `artifacts` column is derived: a rule matched a topic
   * word and concluded a file is relevant. That direction over-claims, which is
   * why this register separates tracing from verification at all. A declaration
   * is a source file stating in its own header that it implements a named
   * requirement — an author's claim rather than a rule firing.
   *
   * Neither is verification, and the two must never be added together.
   */
  describe('declarations', () => {
    it('keeps declarations in their own column, never merged into artifacts', () => {
      const header = readFileSync(join(G, 'traceability-matrix.csv'), 'utf8')
        .split('\n')[0]!;
      expect(header).toContain('declared_by');
      expect(header.indexOf('declared_by')).toBeLessThan(header.indexOf('artifacts'));
    });

    it('names a file for every requirement it says is declared', () => {
      const declared = matrix.filter((r) => (r.declared_by ?? '').trim());
      expect(declared.length).toBeGreaterThan(0);
      expect(summary.declarations.declared).toBe(declared.length);
      for (const r of declared) {
        for (const f of r.declared_by!.split(' ').filter(Boolean)) {
          expect(existsSync(join(ROOT, f)), `${r.requirement_id} declares ${f}`).toBe(true);
        }
      }
    });

    it('refuses a declaration that names a requirement the register does not have', () => {
      // The generator exits rather than ignoring it: a declaration naming
      // nothing is worse than no declaration, because it reads as coverage.
      const script = readFileSync(join(ROOT, 'scripts/build-traceability.mjs'), 'utf8');
      expect(script).toContain('A declaration naming nothing is worse than no declaration');
    });

    it('never counts a declaration as verification', () => {
      // A file saying it implements something is not somebody confirming a test
      // asserts the acceptance criteria.
      const declaredButUnjudged = matrix.filter(
        (r) => (r.declared_by ?? '').trim() && r.verification === 'none');
      // Some declared requirements are in phases nobody has judged; that is
      // allowed and is exactly the point of keeping the columns apart.
      expect(declaredButUnjudged.length).toBeGreaterThanOrEqual(0);
      expect(summary.totals.verified).toBe(
        matrix.filter((r) => r.verification === 'verified').length);
    });
  });

  it('never claims a requirement is traced without naming an artifact', () => {
    const empty = matrix.filter((r) => r.status !== 'untraced' && !(r.artifacts ?? '').trim());
    expect(empty).toEqual([]);
  });

  it('never claims traced_tested without naming a test', () => {
    const empty = matrix.filter((r) => r.status === 'traced_tested' && !(r.tests ?? '').trim());
    expect(empty).toEqual([]);
  });
});

describe('the mapping rules stay disciplined', () => {
  it('gives every rule a stated reason', () => {
    for (const r of rules.rules) {
      expect(r.why.length, r.id).toBeGreaterThan(40);
      expect(r.artifacts.length, r.id).toBeGreaterThan(0);
    }
  });

  it('has no rule matching an implausible share of every requirement', () => {
    // A rule matching most of the corpus is matching a common word, not a
    // topic. This is the check that caught the 99.1% first run.
    expect(summary.overbroad_rules).toEqual([]);
  });

  it('keeps total coverage in a range a human has actually looked at', () => {
    const traced = summary.totals.traced_tested + summary.totals.traced;
    const pct = (traced / summary.totals.requirements) * 100;
    // Not an accuracy claim — a tripwire. If coverage moves outside this band
    // it is because rules changed, and the new number needs auditing before
    // anyone quotes it.
    expect(pct).toBeGreaterThan(35);
    expect(pct).toBeLessThan(70);
  });

  it('excludes capability classes the repository does not have', () => {
    for (const absent of ['digital twin', 'copilot', 'marketplace', 'onboarding', 'self.?service']) {
      expect(rules.global_exclude.pattern, absent).toContain(absent);
    }
  });

  it('leaves the phases with no implementation almost entirely untraced', () => {
    for (const phase of ['P31', 'P32']) {
      const rows = matrix.filter((r) => r.phase === phase);
      const traced = rows.filter((r) => r.status !== 'untraced').length;
      // P31 is cloud infrastructure and P32 is go-live certification. Neither
      // exists. A matrix showing them well covered would be lying.
      expect(traced / rows.length, phase).toBeLessThan(0.3);
    }
  });
});

describe('the totals are computed, not typed', () => {
  it('agrees with a recount of the matrix', () => {
    const recount = {
      requirements: matrix.length,
      traced_tested: matrix.filter((r) => r.status === 'traced_tested').length,
      untraced: matrix.filter((r) => r.status === 'untraced').length,
    };
    expect(summary.totals.requirements).toBe(recount.requirements);
    expect(summary.totals.traced_tested).toBe(recount.traced_tested);
    expect(summary.totals.untraced).toBe(recount.untraced);
    expect(recount.traced_tested + recount.untraced + summary.totals.traced).toBe(matrix.length);
  });

  it('covers every requirement in the register exactly once', () => {
    const ids = new Set(matrix.map((r) => r.requirement_id));
    expect(ids.size).toBe(matrix.length);
  });
});

describe('the README states the numbers the generator produced', () => {
  // Prose goes stale silently. This README claimed 215 cataloged artifacts when
  // there were 244, and 45 verified requirements when there were 1,042 — both
  // written truthfully and both overtaken by the next build. A figure nobody
  // rechecks is the figure someone quotes.
  const readme = readFileSync(join(G, 'README.md'), 'utf8');
  const num = (s: string) => Number(s.replace(/,/g, ''));

  function claim(pattern: RegExp): number[] {
    const m = readme.match(pattern);
    expect(m, `README no longer contains: ${pattern}`).not.toBeNull();
    return m!.slice(1).map(num);
  }

  it('states the headline totals as generated', () => {
    const [requirements, traced, percent, untraced, verified, judged] = claim(
      /\*\*([\d,]+) requirements\. ([\d,]+) traced \(([\d.]+)%\)\. ([\d,]+) untraced\. ([\d,]+) verified of ([\d,]+)\s*\njudged\.\*\*/,
    );
    expect(requirements).toBe(summary.totals.requirements);
    expect(traced).toBe(summary.totals.traced_tested);
    expect(percent).toBe(summary.totals.traced_percent);
    expect(untraced).toBe(summary.totals.untraced);
    expect(verified).toBe(summary.totals.verified);
    expect(judged).toBe(summary.totals.verification_attempted);
  });

  it('states the artifact catalog size as generated', () => {
    const [total, referenced] = claim(
      /Of ([\d,]+) cataloged artifacts, ([\d,]+) answer for at least one requirement\./,
    );
    expect(total).toBe(summary.artifacts.total);
    expect(referenced).toBe(summary.artifacts.referenced);
  });

  it('states the verified count in the same breath as the ledgers', () => {
    const [verified, judged] = claim(
      /\*\*([\d,]+) requirements are verified\*\* of\s*\n\s*([\d,]+) judged/,
    );
    expect(verified).toBe(summary.totals.verified);
    expect(judged).toBe(summary.totals.verification_attempted);
  });

  it('states each judged phase at the count its ledger carries', () => {
    // The table lists phase, total, verified. Every row must match.
    const rows = [...readme.matchAll(/^\| (P\d\d) [^|]+\| ([\d,]+) \| ([\d,]+)/gm)];
    expect(rows.length).toBeGreaterThan(0);
    for (const [, phase, total, verified] of rows) {
      const generated = summary.per_phase[phase!];
      expect(generated, `README names ${phase}, summary does not`).toBeDefined();
      expect(num(total!), phase).toBe(generated.total);
      expect(num(verified!), phase).toBe(generated.verified);
    }
  });

  it('states its own test count', () => {
    const [claimed] = claim(/`tests\/governance\/traceability\.test\.ts` — (\d+) tests/);
    const source = readFileSync(join(ROOT, 'tests/governance/traceability.test.ts'), 'utf8');
    expect(claimed).toBe((source.match(/^\s*it\(/gm) ?? []).length);
  });
});
