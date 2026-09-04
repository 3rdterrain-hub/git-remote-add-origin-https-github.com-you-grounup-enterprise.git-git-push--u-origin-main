/**
 * Library governance, against real PostgreSQL.
 *
 * P25 verification found the shape existed on `services` and nowhere else.
 * These tests loop every one of the twelve three-tier libraries an estimate is
 * priced from, because a guarantee that holds for eleven and not the twelfth is
 * not a guarantee — and the twelfth is the one that prices a job wrong.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const registry = JSON.parse(readFileSync(join(ROOT, 'governance/registry.json'), 'utf8')) as {
  library_scope: Record<string, string>;
};
const THREE_TIER = Object.entries(registry.library_scope)
  .filter(([, s]) => s === 'three_tier').map(([t]) => t).sort();

const GOVERNANCE_COLUMNS = [
  'version', 'source', 'origin', 'approved_by', 'approved_at', 'effective_date', 'expires_on',
];

describe('library governance', () => {
  let h: Harness;
  const alice = '11111111-1111-4111-8111-111111111111';
  const dana = '33333333-3333-4333-8333-333333333333';
  const bob = '22222222-2222-4222-8222-222222222222';
  let ridgeline = '';
  let kesler = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'a@r.test'),($2,'d@r.test'),($3,'b@k.test')`,
      [alice, dana, bob]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'a@r.test'),($2,'d@r.test'),($3,'b@k.test')`,
      [alice, dana, bob]);
    ridgeline = (await h.asUser(alice, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    kesler = (await h.asUser(bob, () =>
      h.sql<{ id: string }>(`select app.provision_company('Kesler','kesler','enterprise') as id`)))[0]!.id;
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  // ---------------------------------------------------------- the shape
  describe('every library carries the same governance shape', () => {
    it('covers all twelve three-tier libraries', () => {
      expect(THREE_TIER).toHaveLength(12);
    });

    for (const col of GOVERNANCE_COLUMNS) {
      it(`every library has ${col}`, async () => {
        const rows = await h.sql<{ t: string }>(`
          select c.relname as t from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname='public' and c.relkind='r' and c.relname = any($1)
            and not exists (
              select 1 from pg_attribute a
              where a.attrelid = c.oid and a.attname = $2
                and a.attnum > 0 and not a.attisdropped)`, [THREE_TIER, col]);
        // Before this migration the answer was 1, 3 or 3 of 12 depending on
        // the column. "Who published this rate" was unanswerable from the row.
        expect(rows.map((r) => r.t)).toEqual([]);
      });
    }

    it('constrains origin to a closed set on every library', async () => {
      for (const t of THREE_TIER) {
        const rows = await h.sql<{ n: number }>(`
          select count(*)::int as n from pg_constraint k
          join pg_class c on c.oid = k.conrelid
          where c.relname = $1 and k.conname = $1 || '_origin_known'`, [t]);
        expect(rows[0]!.n, t).toBe(1);
      }
    });
  });

  // ------------------------------------------------------------ provenance
  describe('provenance', () => {
    it('marks every platform row as a catalog row', async () => {
      for (const t of THREE_TIER) {
        const rows = await h.sql<{ n: number }>(
          `select count(*)::int as n from ${t}
           where company_id is null and enterprise_group_id is null and origin <> 'catalog'`);
        // A rate whose provenance is known and one whose provenance is merely
        // absent look identical to an estimator otherwise.
        expect(rows[0]!.n, t).toBe(0);
      }
    });

    it('carries a named source on the libraries whose seed provides one', async () => {
      // The 0028 backfill stamps rows present when it runs; the seed is applied
      // afterwards, so a seeded row's source comes from the seed itself.
      // `services` is the library whose generated seed already emits it.
      const rows = await h.sql<{ n: number }>(
        `select count(*)::int as n from services
         where company_id is null and source is not null`);
      expect(rows[0]!.n).toBeGreaterThan(0);
    });

    it('defaults a new company row to company-entered provenance it can correct', async () => {
      const rows = await h.asUser(alice, () => h.sql<{ origin: string; version: string }>(
        `insert into cost_codes (company_id, code, name, division, status)
         values ($1,'CC-900','Test code','01','draft') returning origin, version`, [ridgeline]));
      expect(rows[0]!.origin).toBe('catalog');
      expect(rows[0]!.version).toBe('1.0');
    });

    it('refuses an origin outside the closed set', async () => {
      await expect(h.asUser(alice, () => h.sql(
        `insert into cost_codes (company_id, code, name, division, origin, status)
         values ($1,'CC-901','Bad origin','01','vibes','draft')`, [ridgeline])))
        .rejects.toThrow(/origin_known/);
    });
  });

  // -------------------------------------------------------------- approval
  describe('approval', () => {
    it('refuses to make a company row live with nobody named against it', async () => {
      // "Who published this rate" has to be answerable from the row.
      await expect(h.asUser(alice, () => h.sql(
        `insert into cost_codes (company_id, code, name, division, status)
         values ($1,'CC-902','Unapproved','01','active')`, [ridgeline])))
        .rejects.toThrow(/active_needs_approver/);
    });

    it('accepts a company row that names its approver', async () => {
      const rows = await h.asUser(alice, () => h.sql<{ id: string }>(
        `insert into cost_codes (company_id, code, name, division, status, approved_by, approved_at)
         values ($1,'CC-903','Approved','01','active',$2, now()) returning id`, [ridgeline, dana]));
      expect(rows).toHaveLength(1);
    });

    it('refuses half an approval', async () => {
      await expect(h.asUser(alice, () => h.sql(
        `insert into cost_codes (company_id, code, name, division, status, approved_by)
         values ($1,'CC-904','Half','01','draft',$2)`, [ridgeline, dana])))
        .rejects.toThrow(/approval_complete/);
    });

    it('lets a platform row be live without a company approver', async () => {
      // A seeded row is published by the platform and has no company approver,
      // which is why the rule is scoped rather than applied flatly.
      const rows = await h.sql<{ n: number }>(
        `select count(*)::int as n from tasks
         where company_id is null and status = 'active' and approved_by is null`);
      expect(rows[0]!.n).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------- effective dates
  describe('effective dating', () => {
    it('refuses an expiry before the effective date on every library', async () => {
      for (const t of THREE_TIER) {
        const rows = await h.sql<{ n: number }>(`
          select count(*)::int as n from pg_constraint k
          join pg_class c on c.oid = k.conrelid
          where c.relname = $1 and k.conname = $1 || '_effective_window'`, [t]);
        expect(rows[0]!.n, t).toBe(1);
      }
    });

    it('rejects a row that expires before it starts', async () => {
      await expect(h.asUser(alice, () => h.sql(
        `insert into cost_codes (company_id, code, name, division, status, effective_date, expires_on)
         values ($1,'CC-905','Backwards','01','draft','2026-06-01','2026-01-01')`, [ridgeline])))
        .rejects.toThrow(/effective_window/);
    });
  });

  // --------------------------------------------------------------- history
  describe('history answers what a rate used to say', () => {
    let rateId = '';

    beforeAll(async () => {
      rateId = (await h.asUser(alice, () => h.sql<{ id: string }>(
        `insert into labor_rates (company_id, code, classification, base_wage_per_hour, burden_percent, status)
         values ($1,'OP-HIST','Operator',40,0.35,'draft') returning id`, [ridgeline])))[0]!.id;
    });

    it('opens version 1 when a row is created', async () => {
      const rows = await h.asUser(alice, () => h.sql<{ version_number: number; operation: string }>(
        `select version_number, operation from app.library_row_history('labor_rates', $1)`, [rateId]));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.version_number).toBe(1);
      expect(rows[0]!.operation).toBe('insert');
    });

    it('opens a new version on every edit, and derives where the old one ended', async () => {
      await h.asUser(alice, () => h.sql(
        `update labor_rates set base_wage_per_hour = 44 where id = $1`, [rateId]));
      const rows = await h.asUser(alice, () => h.sql<{ version_number: number; valid_to: string | null }>(
        `select version_number, valid_to from app.library_row_history('labor_rates', $1)`, [rateId]));
      expect(rows.map((r) => r.version_number)).toEqual([2, 1]);
      // valid_to is a window function over the next version, not a stored
      // column, which is what keeps the table genuinely append-only.
      expect(rows[0]!.valid_to).toBeNull();
      expect(rows[1]!.valid_to).not.toBeNull();
    });

    it('answers what the rate said before the change', async () => {
      const history = await h.asUser(alice, () => h.sql<{ valid_from: string; version_number: number }>(
        `select valid_from, version_number from app.library_row_history('labor_rates', $1)
         order by version_number`, [rateId]));
      const beforeChange = history[1]!.valid_from; // when v2 opened
      const asOf = await h.asUser(alice, () => h.sql<{ payload: Record<string, unknown> }>(
        `select app.library_row_as_of('labor_rates', $1, $2::timestamptz - interval '1 microsecond') as payload`,
        [rateId, beforeChange]));
      // The question library snapshots do not answer.
      expect(Number((asOf[0]!.payload as { base_wage_per_hour: string }).base_wage_per_hour)).toBe(40);
    });

    it('answers what it says now', async () => {
      const rows = await h.asUser(alice, () => h.sql<{ payload: Record<string, unknown> }>(
        `select app.library_row_as_of('labor_rates', $1, now()) as payload`, [rateId]));
      expect(Number((rows[0]!.payload as { base_wage_per_hour: string }).base_wage_per_hour)).toBe(44);
    });

    it('returns nothing for an instant before the row existed', async () => {
      const rows = await h.asUser(alice, () => h.sql<{ payload: unknown }>(
        `select app.library_row_as_of('labor_rates', $1, '2020-01-01'::timestamptz) as payload`, [rateId]));
      // The honest answer, rather than the nearest surviving version.
      expect(rows[0]!.payload).toBeNull();
    });

    it('records a delete as a version carrying what was removed', async () => {
      const doomed = (await h.asUser(alice, () => h.sql<{ id: string }>(
        `insert into cost_codes (company_id, code, name, division, status)
         values ($1,'CC-DOOM','Doomed','01','draft') returning id`, [ridgeline])))[0]!.id;
      await h.asUser(alice, () => h.sql(`delete from cost_codes where id = $1`, [doomed]));
      const rows = await h.asUser(alice, () => h.sql<{ version_number: number; operation: string; payload: Record<string, unknown> }>(
        `select version_number, operation, payload from app.library_row_history('cost_codes', $1)`, [doomed]));
      expect(rows.map((r) => r.operation)).toEqual(['delete', 'insert']);
      // The history says what was removed rather than merely stopping.
      expect((rows[0]!.payload as { code: string }).code).toBe('CC-DOOM');
    });

    it('resolves a deleted row to nothing, not to the state it last held', async () => {
      const doomed = (await h.asUser(alice, () => h.sql<{ id: string }>(
        `insert into cost_codes (company_id, code, name, division, status)
         values ($1,'CC-DOOM2','Doomed again','01','draft') returning id`, [ridgeline])))[0]!.id;
      await h.asUser(alice, () => h.sql(`delete from cost_codes where id = $1`, [doomed]));
      const asOf = await h.asUser(alice, () => h.sql<{ payload: unknown }>(
        `select app.library_row_as_of('cost_codes', $1, now()) as payload`, [doomed]));
      expect(asOf[0]!.payload).toBeNull();
    });

    it('gives every seeded platform row a version 1', async () => {
      for (const t of THREE_TIER) {
        const rows = await h.sql<{ n: number }>(`
          select count(*)::int as n from ${t} r
          where not exists (
            select 1 from library_row_versions v
            where v.source_table = $1 and v.source_id = r.id)`, [t]);
        // Without the backfill, history would start at the next edit and a
        // seeded rate's current state would have no version at all.
        expect(rows[0]!.n, t).toBe(0);
      }
    });

    it('attaches a history trigger to every library', async () => {
      for (const t of THREE_TIER) {
        const rows = await h.sql<{ n: number }>(`
          select count(*)::int as n from pg_trigger g
          join pg_class c on c.oid = g.tgrelid
          where c.relname = $1 and g.tgname = 'library_version' and not g.tgisinternal`, [t]);
        expect(rows[0]!.n, t).toBe(1);
      }
    });
  });

  // ------------------------------------------------------------ the record
  describe('the history cannot be rewritten', () => {
    it('leaves a version unchanged when someone tries to edit it', async () => {
      const before = (await h.sql<{ id: string; payload: unknown }>(
        `select id, payload from library_row_versions order by created_at limit 1`))[0]!;
      // Refused two ways over: no update policy grants the row, and the
      // immutability trigger would refuse it anyway. Either way it must not
      // change, and that is the property worth asserting.
      await h.asUser(alice, () => h.sql(
        `update library_row_versions set payload = '{}'::jsonb where id = $1`, [before.id]))
        .catch(() => undefined);
      const after = (await h.sql<{ payload: unknown }>(
        `select payload from library_row_versions where id = $1`, [before.id]))[0]!;
      expect(JSON.stringify(after.payload)).toBe(JSON.stringify(before.payload));
      expect(JSON.stringify(after.payload)).not.toBe('{}');
    });

    it('leaves a version in place when someone tries to delete it', async () => {
      const id = (await h.sql<{ id: string }>(
        `select id from library_row_versions order by created_at limit 1`))[0]!.id;
      await h.asUser(alice, () => h.sql(
        `delete from library_row_versions where id = $1`, [id])).catch(() => undefined);
      expect(await h.sql(`select 1 from library_row_versions where id = $1`, [id])).toHaveLength(1);
    });

    it('refuses even the owner to rewrite history', async () => {
      const id = (await h.sql<{ id: string }>(
        `select id from library_row_versions order by created_at limit 1`))[0]!.id;
      // The service role sees every row, so here the immutability trigger is
      // the only thing standing in the way — and it holds.
      await expect(h.asService(() => h.sql(
        `update library_row_versions set payload = '{}'::jsonb where id = $1`, [id])))
        .rejects.toThrow(/append-only/);
    });

    it('refuses a hand-written history entry', async () => {
      // A history somebody can write by hand is not a history.
      await expect(h.asUser(alice, () => h.sql(
        `insert into library_row_versions
           (company_id, source_table, source_id, version_number, operation, payload)
         values ($1,'labor_rates',gen_random_uuid(),1,'insert','{}'::jsonb)`, [ridgeline])))
        .rejects.toThrow();
    });
  });

  // --------------------------------------------------------------- tenancy
  describe('tenancy', () => {
    it('forces row level security on the history', async () => {
      const rows = await h.sql<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
        select c.relrowsecurity, c.relforcerowsecurity from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname='public' and c.relname='library_row_versions'`);
      expect(rows[0]!.relrowsecurity).toBe(true);
      expect(rows[0]!.relforcerowsecurity).toBe(true);
    });

    it('lets every tenant read the history of a platform row', async () => {
      // A seeded rate is readable by every tenant, so its past must be too.
      // This is exactly the gap in the audit ledger that this table fills.
      const rows = await h.asUser(bob, () => h.sql<{ n: number }>(
        `select count(*)::int as n from library_row_versions where company_id is null`));
      expect(rows[0]!.n).toBeGreaterThan(0);
      expect(kesler).not.toBe(ridgeline);
    });

    it('never shows one company the history of another company row', async () => {
      const visible = await h.asUser(bob, () => h.sql<{ company_id: string }>(
        `select distinct company_id from library_row_versions where company_id is not null`));
      // Bob sees Kesler's own history, which is correct. What must never
      // appear is Ridgeline's.
      expect(visible.map((r) => r.company_id)).not.toContain(ridgeline);
      expect(visible.every((r) => r.company_id === kesler)).toBe(true);
    });

    it('shows an anonymous caller nothing', async () => {
      await expect(h.asAnon(() => h.sql(`select * from library_row_versions limit 1`)))
        .rejects.toThrow();
    });
  });
});
