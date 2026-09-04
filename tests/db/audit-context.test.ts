/**
 * What the audit ledger can answer, against real PostgreSQL.
 *
 * `audit_events` has always carried `correlation_id`, `ip_address`,
 * `user_agent` and `actor_email` beside the actor, the action and the full
 * prior and new state. The state half is what makes the ledger worth having.
 * The other four were written by nothing — not by the row trigger on every
 * governed table, not by any of the three other writers in the schema — so
 * every audit row in the platform had them null.
 *
 * The record that answers "who changed this, when, from what, to what" could
 * not answer from where, under which request, or — for a change made through
 * the public API, which runs as the service role — by whom at all.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('the audit ledger records who asked and from where', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let n = 0;

  const setHeaders = (headers: Record<string, string> | null) =>
    h.sql(`select set_config('request.headers', $1, false)`,
      [headers === null ? '' : JSON.stringify(headers)]);

  /** Create a project and return the audit row it produced. */
  const auditOfNewProject = async () =>
    h.asUser(owner, async () => {
      await h.sql(
        `insert into projects (company_id, number, name, status)
         values ($1,$2,'Audited','active')`, [company, `PRJ-A${++n}`]);
      const [row] = await h.sql<{
        correlation_id: string | null; ip_address: string | null;
        user_agent: string | null; actor_email: string | null; actor_id: string | null }>(
        `select correlation_id, host(ip_address) as ip_address, user_agent, actor_email, actor_id
         from audit_events where entity_table='public.projects'
         order by occurred_at desc, id desc limit 1`);
      return row!;
    });

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'dana@ridgeline.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'dana@ridgeline.test')`, [owner]);
    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('with a request behind it', () => {
    beforeAll(async () => {
      await setHeaders({
        'x-grounup-correlation': '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        'x-forwarded-for': '203.0.113.7, 70.41.3.18',
        'user-agent': 'GrounUp/1.0 (macOS)',
      });
    });

    it('records the correlation id the caller supplied', async () => {
      const row = await auditOfNewProject();
      expect(row.correlation_id).toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    });

    it('records the client address, not the proxy behind it', async () => {
      // x-forwarded-for is a list and the client is the first entry; the rest
      // are infrastructure.
      const row = await auditOfNewProject();
      expect(row.ip_address).toBe('203.0.113.7');
    });

    it('records the agent', async () => {
      const row = await auditOfNewProject();
      expect(row.user_agent).toBe('GrounUp/1.0 (macOS)');
    });

    it('resolves the actor email so the ledger reads without a join', async () => {
      const row = await auditOfNewProject();
      expect(row.actor_email).toBe('dana@ridgeline.test');
      expect(row.actor_id).toBe(owner);
    });
  });

  describe('when the request says something unusable', () => {
    it('discards a correlation id that is not a uuid rather than storing it', async () => {
      // Headers are attacker-controlled. The column keeps one meaning.
      await setHeaders({ 'x-grounup-correlation': 'not-a-uuid', 'user-agent': 'curl/8' });
      const row = await auditOfNewProject();
      expect(row.correlation_id).toBeNull();
      expect(row.user_agent).toBe('curl/8');
    });

    it('discards an address that is not an address', async () => {
      await setHeaders({ 'x-forwarded-for': 'nonsense' });
      const row = await auditOfNewProject();
      expect(row.ip_address).toBeNull();
    });

    it('survives headers that are not JSON at all', async () => {
      // The business write must not fail because a header was malformed.
      await h.sql(`select set_config('request.headers', '{not json', false)`);
      const row = await auditOfNewProject();
      expect(row.ip_address).toBeNull();
      expect(row.actor_id).toBe(owner);
    });

    it('survives no request context at all, as a direct session has none', async () => {
      await setHeaders(null);
      const row = await auditOfNewProject();
      expect(row.correlation_id).toBeNull();
      expect(row.ip_address).toBeNull();
      expect(row.user_agent).toBeNull();
      // The parts that never depended on a request still hold.
      expect(row.actor_id).toBe(owner);
      expect(row.actor_email).toBe('dana@ridgeline.test');
    });
  });

  describe('a service-role caller states who it is', () => {
    it('attributes a write to the API key that made it', async () => {
      /*
       * The gateway authenticates with an API key and runs as the service role,
       * so auth.uid() is null and every row it wrote was audited as an
       * anonymous insert. It now labels itself in a header, which is what the
       * public API function does per request.
       */
      await setHeaders({ 'x-grounup-actor': 'api_key:6f1b2c34' });
      await h.sql(
        `insert into projects (company_id, number, name, status)
         values ($1,'PRJ-KEY','From the API','active')`, [company]);
      const [row] = await h.sql<{ actor_id: string | null; actor_email: string | null }>(
        `select actor_id, actor_email from audit_events
         where entity_table='public.projects' order by occurred_at desc, id desc limit 1`);
      expect(row!.actor_id).toBeNull();
      expect(row!.actor_email).toBe('api_key:6f1b2c34');
    });

    it('never lets a stated label override a real signed-in user', async () => {
      // A header is a claim; a JWT is authenticated. The claim loses.
      await setHeaders({ 'x-grounup-actor': 'api_key:impersonation' });
      const row = await auditOfNewProject();
      expect(row.actor_email).toBe('dana@ridgeline.test');
    });
  });

  describe('the ledger is still append-only', () => {
    it('refuses an edit to a recorded event', async () => {
      await expect(h.sql(
        `update audit_events set user_agent='rewritten' where id=(select max(id) from audit_events)`))
        .rejects.toThrow(/append-only/);
    });
  });
});
