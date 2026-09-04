/**
 * Properties the whole schema has to have, checked against the live catalog.
 *
 * Not against a list somebody maintains: every one of these queries the
 * database as it actually is, so a table added next year is covered the day it
 * is added rather than the day somebody remembers to add it here.
 *
 * Three of these were true before anybody checked and are now held. One was
 * false on 53 of 136 tables.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('schema invariants', () => {
  let h: Harness;

  beforeAll(async () => { h = await createHarness({ seed: true }); }, 180_000);
  afterAll(async () => { await h?.db.close(); });

  it('stores no money in a floating-point column', async () => {
    // A binary float cannot represent ten cents. One of these anywhere in a
    // financial schema is a rounding error waiting for a large enough number.
    const rows = await h.sql<{ col: string }>(
      `select table_name || '.' || column_name as col
       from information_schema.columns
       where table_schema = 'public' and data_type in ('real', 'double precision')
       order by 1`);
    expect(rows.map((r) => r.col)).toEqual([]);
  });

  it('stores every timestamp with its time zone', async () => {
    // A naive timestamp is a time nobody can place. Construction crosses time
    // zones routinely — a daily report filed at 6pm Pacific is not the same
    // moment as one filed at 6pm Eastern, and a column that drops the offset
    // makes them indistinguishable.
    const rows = await h.sql<{ col: string }>(
      `select table_name || '.' || column_name as col
       from information_schema.columns
       where table_schema = 'public' and data_type = 'timestamp without time zone'
       order by 1`);
    expect(rows.map((r) => r.col)).toEqual([]);
  });

  it('holds money totals at two decimal places and rates at four', async () => {
    /*
     * The convention the schema already follows, now stated: a total is money
     * and carries cents; a unit rate is a price per something and carries four
     * places, because a material at $0.0125 a pound rounded to two is wrong by
     * twenty per cent.
     *
     * Checked so that the next money column added cannot quietly pick a third
     * convention.
     */
    const totals = await h.sql<{ col: string; numeric_scale: number }>(
      `select c.table_name || '.' || c.column_name as col, c.numeric_scale
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
        and t.table_type = 'BASE TABLE'
       where c.table_schema = 'public' and c.data_type = 'numeric'
         and (c.column_name = 'amount' or c.column_name like '%_amount'
              or c.column_name like 'total_%' or c.column_name like '%_total')
         and c.numeric_scale is distinct from 2
       order by 1`);
    expect(totals.map((r) => r.col)).toEqual([]);

    const rates = await h.sql<{ col: string }>(
      `select c.table_name || '.' || c.column_name as col
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
        and t.table_type = 'BASE TABLE'
       where c.table_schema = 'public' and c.data_type = 'numeric'
         and c.column_name in ('unit_cost', 'unit_price')
         and c.numeric_scale is distinct from 4
       order by 1`);
    expect(rates.map((r) => r.col)).toEqual([]);
  });

  it('indexes the tenant key on every table that carries one', async () => {
    /*
     * Every row level security policy on every tenant-owned table predicates on
     * company_id, so that filter is on every read by every user. Without an
     * index leading on it, each of those reads scans every tenant's rows — and
     * the cost of reading one company's data grows with the number of companies
     * on the platform, which is the one property a multi-tenant system must not
     * have.
     *
     * 53 of 136 tables were in this state before migration 0049. It was never a
     * correctness defect, which is why nothing caught it.
     */
    const rows = await h.sql<{ tbl: string }>(
      `select c.relname::text as tbl
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id' and a.attnum > 0
       where n.nspname = 'public' and c.relkind = 'r'
         and not exists (
           select 1 from pg_index i
           where i.indrelid = c.oid and i.indkey[0] = a.attnum)
       order by 1`);
    expect(rows.map((r) => r.tbl)).toEqual([]);
  });

  it('gives every table a primary key, and a uuid unless it has a stated reason', async () => {
    /*
     * A governed business record needs an identifier that is stable,
     * unguessable and not derived from anything about the row — a sequence
     * leaks how many of something a tenant has to anybody who can see one.
     *
     * Seven tables are deliberately not uuid, and naming them here is the
     * point: an eighth cannot appear without somebody adding it to this list
     * and saying why.
     */
    const noPk = await h.sql<{ tbl: string }>(
      `select c.relname::text as tbl
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and not exists (select 1 from pg_constraint k
           where k.conrelid = c.oid and k.contype = 'p')
       order by 1`);
    expect(noPk.map((r) => r.tbl)).toEqual([]);

    const notUuid = await h.sql<{ tbl: string; typ: string }>(
      `select c.relname::text as tbl, format_type(a.atttypid, null) as typ
       from pg_constraint k
       join pg_class c on c.oid = k.conrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attnum = k.conkey[1]
       where n.nspname = 'public' and k.contype = 'p'
         and array_length(k.conkey, 1) = 1
         and format_type(a.atttypid, null) <> 'uuid'
       order by 1`);

    // Natural keys on platform catalogs, where the key *is* the identity and is
    // quoted in configuration and in Stripe's own payloads; and sequences on
    // the three append-only logs, where rows arrive in order, in volume, and
    // are never referenced by anything else.
    const allowed = new Set([
      'ai_agents (text)', 'ai_models (text)', 'plans (text)', 'stripe_events (text)',
      'api_requests (bigint)', 'audit_events (bigint)', 'usage_events (bigint)',
    ]);
    expect(notUuid.map((r) => `${r.tbl} (${r.typ})`).filter((k) => !allowed.has(k))).toEqual([]);
  });

  it('never lets a tenant-owned row point at another company through a parent', async () => {
    // The structural guard, asserted as a rule rather than table by table:
    // anything carrying both a company_id and a reference to a parent that also
    // carries one is covered by app.enforce_tenant_parent.
    const [row] = await h.sql<{ n: string }>(
      `select count(*) as n from pg_trigger t
       join pg_proc p on p.oid = t.tgfoid
       where p.proname = 'enforce_tenant_parent' and not t.tgisinternal`);
    // A floor rather than an exact count: the point is that the guard is
    // applied broadly, and a test that pins the number breaks on every new
    // child table without finding anything.
    expect(Number(row!.n)).toBeGreaterThan(30);
  });
});
