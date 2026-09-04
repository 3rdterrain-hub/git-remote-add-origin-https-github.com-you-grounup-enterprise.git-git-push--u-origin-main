/**
 * Metered usage against the plan allowance, against real PostgreSQL.
 *
 * The P30 verdict recorded that AI credits were "deliberately left unenforced,
 * because both need a measured quantity nothing yet meters". That was wrong.
 * The document analyst has always written a `usage_events` row with metric
 * `ai.request` on every run, and `app.current_usage` has always aggregated it
 * over the paid period. Both halves existed; nothing put them together.
 *
 * These tests hold the join, and hold its deliberate permissiveness: a null
 * allowance is unlimited, and so is having no entitlement at all, because a
 * billing gap must not become an outage.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('usage against allowance', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  let starter = '';
  let enterprise = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test'), ($2,'e@r.test')`,
      [owner, other]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test'), ($2,'e@r.test') on conflict (id) do nothing`,
      [owner, other]);
    // Starter publishes 250 AI credits a month; enterprise publishes null.
    starter = (await h.asUser(owner, () =>
      h.sql<{ id: string }>(`select app.provision_company('Small','small','starter') as id`)))[0]!.id;
    enterprise = (await h.asUser(other, () =>
      h.sql<{ id: string }>(`select app.provision_company('Big','big','enterprise') as id`)))[0]!.id;
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  const use = (company: string, n: number, user = owner) =>
    h.asUser(user, () => h.sql(
      `insert into usage_events (company_id, user_id, metric, quantity)
       select $1, $2, 'ai.request', 1 from generate_series(1, $3)`, [company, user, n]));

  const allowance = (company: string, user = owner) =>
    h.asUser(user, () => h.sql<{ used: string; allowed: number | null;
                                remaining: string | null; within_allowance: boolean }>(
      `select used, allowed, remaining, within_allowance
       from app.usage_allowance($1,'ai.request','ai_credits_per_month')`, [company]));

  describe('the join the platform was missing', () => {
    it('reads the allowance from the plan version the company holds', async () => {
      const [row] = await allowance(starter);
      expect(Number(row!.allowed)).toBe(250);
      expect(Number(row!.used)).toBe(0);
      expect(row!.within_allowance).toBe(true);
    });

    it('counts what has actually been used', async () => {
      await use(starter, 10);
      const [row] = await allowance(starter);
      expect(Number(row!.used)).toBe(10);
      expect(Number(row!.remaining)).toBe(240);
      expect(row!.within_allowance).toBe(true);
    });

    it('refuses once the allowance is spent', async () => {
      await use(starter, 240);
      const [row] = await allowance(starter);
      expect(Number(row!.used)).toBe(250);
      expect(Number(row!.remaining)).toBe(0);
      expect(row!.within_allowance).toBe(false);
    });

    it('answers the same question through the named helper', async () => {
      // The call site should read as the question, not as arithmetic.
      const [row] = await h.asUser(owner, () => h.sql<{ allowed: boolean }>(
        `select app.ai_request_allowed($1) as allowed`, [starter]));
      expect(row!.allowed).toBe(false);
    });

    it('never reports negative remaining', async () => {
      await use(starter, 20);
      const [row] = await allowance(starter);
      expect(Number(row!.remaining)).toBe(0);
    });
  });

  describe('what is deliberately unlimited', () => {
    it('treats a null allowance as unlimited', async () => {
      await use(enterprise, 5000, other);
      const [row] = await allowance(enterprise, other);
      expect(row!.allowed).toBeNull();
      expect(row!.remaining).toBeNull();
      expect(row!.within_allowance).toBe(true);
    });

    it('treats a company with no entitlement as unlimited', async () => {
      // A billing gap must not become an outage.
      await h.sql(`delete from entitlements where company_id=$1`, [starter]);
      const [row] = await allowance(starter);
      expect(row!.allowed).toBeNull();
      expect(row!.within_allowance).toBe(true);
    });
  });

  describe('the reporting view', () => {
    it('runs as the caller', async () => {
      const [row] = await h.sql<{ options: string[] | null }>(`
        select c.reloptions as options from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname='public' and c.relname='reporting_usage_allowance'`);
      expect(row!.options).toContain('security_invoker=true');
    });

    it('shows a company its own usage and nobody else', async () => {
      const rows = await h.asUser(other, () => h.sql<{ company_id: string }>(
        `select company_id from reporting_usage_allowance`));
      expect(rows.map((r) => r.company_id)).toEqual([enterprise]);
    });
  });
});
