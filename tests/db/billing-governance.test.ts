/**
 * Plan versioning and the billing audit trail, against real PostgreSQL.
 *
 * The catalog used to be a live table with no history, and `entitlements`
 * copied whatever it said at the moment a webhook arrived. Editing a plan
 * re-termed every existing subscriber, and nothing could answer what a customer
 * had actually been sold.
 *
 * These tests prove the database now refuses that: terms are versioned by
 * trigger rather than by discipline, a published version cannot be edited, an
 * entitlement cannot exceed the terms it names, and what Stripe sent cannot be
 * rewritten.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('plan versioning', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  let company = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test'), ($2,'x@k.test')`, [owner, other]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test'), ($2,'x@k.test') on conflict (id) do nothing`, [owner, other]);
    company = (await h.asUser(owner, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','business') as id`)))[0]!.id;
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  // ------------------------------------------------------------- publication
  describe('a version is published, not remembered', () => {
    it('gives every seeded plan a version 1', async () => {
      const rows = await h.sql<{ plan_id: string; version: number }>(
        `select plan_id, version from plan_versions order by plan_id`);
      const plans = await h.sql<{ id: string }>(`select id from plans order by id`);
      expect(rows.map((r) => r.plan_id)).toEqual(plans.map((p) => p.id));
      expect(rows.every((r) => Number(r.version) === 1)).toBe(true);
    });

    it('copies the terms rather than pointing at them', async () => {
      const [v] = await h.sql<{ features: string[]; max_seats: number }>(
        `select features, max_seats from plan_versions where plan_id = 'starter' and version = 1`);
      const [p] = await h.sql<{ features: string[]; max_seats: number }>(
        `select features, max_seats from plans where id = 'starter'`);
      expect(v!.features).toEqual(p!.features);
      expect(Number(v!.max_seats)).toBe(Number(p!.max_seats));
    });

    it('publishes a new version when a commercial term changes', async () => {
      await h.sql(`update plans set max_seats = 4 where id = 'starter'`);
      const rows = await h.sql<{ version: number; max_seats: number }>(
        `select version, max_seats from plan_versions where plan_id='starter' order by version`);
      expect(rows).toHaveLength(2);
      expect(Number(rows[1]!.version)).toBe(2);
      expect(Number(rows[1]!.max_seats)).toBe(4);
      // Version 1 still says what it said.
      expect(Number(rows[0]!.max_seats)).toBe(3);
    });

    it('publishes a new version when the feature set changes', async () => {
      await h.sql(`update plans set features = features || array['reports'] where id = 'starter'`);
      const [latest] = await h.sql<{ version: number; features: string[] }>(
        `select version, features from plan_versions where plan_id='starter' order by version desc limit 1`);
      expect(Number(latest!.version)).toBe(3);
      expect(latest!.features).toContain('reports');
    });

    it('publishes nothing for marketing copy', async () => {
      // A version per typo would make the history unreadable and protect
      // nobody. Only terms re-term a customer.
      const before = await h.sql<{ n: string }>(`select count(*) as n from plan_versions where plan_id='starter'`);
      await h.sql(`update plans set tagline = 'A different tagline', sort_order = 99 where id = 'starter'`);
      const after = await h.sql<{ n: string }>(`select count(*) as n from plan_versions where plan_id='starter'`);
      expect(after[0]!.n).toBe(before[0]!.n);
    });

    it('publishes a version for a plan created later', async () => {
      await h.sql(
        `insert into plans (id, name, tier, features, trial_days)
         values ('field_only','Field Only',5,array['field_production'],7)`);
      const rows = await h.sql<{ version: number; features: string[] }>(
        `select version, features from plan_versions where plan_id='field_only'`);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.features).toEqual(['field_production']);
    });

    it('cannot be edited once published', async () => {
      await expect(h.sql(`update plan_versions set features = array['*'] where plan_id='starter' and version=1`))
        .rejects.toThrow(/append-only/);
    });

    it('cannot be deleted', async () => {
      await expect(h.sql(`delete from plan_versions where plan_id='starter' and version=1`))
        .rejects.toThrow(/append-only/);
    });

    it('derives the current version rather than flagging it', async () => {
      const [current] = await h.sql<{ version: number }>(
        `select version from plan_versions where id = app.current_plan_version('starter')`);
      const [max] = await h.sql<{ version: number }>(
        `select max(version) as version from plan_versions where plan_id='starter'`);
      expect(Number(current!.version)).toBe(Number(max!.version));
    });
  });

  // ------------------------------------------------------------- entitlement
  describe('entitlement cannot exceed the terms it names', () => {
    it('accepts an entitlement that matches its version', async () => {
      const [v] = await h.sql<{ id: string; features: string[] }>(
        `select id, features from plan_versions where plan_id='professional' and version=1`);
      await h.sql(
        `insert into entitlements (company_id, plan_id, plan_version_id, is_active, features, valid_until)
         values ($1,'professional',$2,true,$3, now() + interval '30 days')
         on conflict (company_id) do update set plan_id=excluded.plan_id,
           plan_version_id=excluded.plan_version_id, is_active=excluded.is_active,
           features=excluded.features, valid_until=excluded.valid_until`,
        [company, v!.id, v!.features]);
      const [e] = await h.sql<{ plan_version_id: string }>(
        `select plan_version_id from entitlements where company_id=$1`, [company]);
      expect(e!.plan_version_id).toBe(v!.id);
    });

    it('refuses an entitlement granting more than its version publishes', async () => {
      // This is the drift versioning exists to stop: a row claiming features
      // the customer never bought.
      const [v] = await h.sql<{ id: string }>(
        `select id from plan_versions where plan_id='professional' and version=1`);
      await expect(h.sql(
        `update entitlements set features = array['*'] where company_id=$1`, [company]))
        .rejects.toThrow(/cannot exceed the terms it was sold under/);
      expect(v!.id).toBeTruthy();
    });

    it('refuses a version belonging to a different plan', async () => {
      const [v] = await h.sql<{ id: string }>(
        `select id from plan_versions where plan_id='business' and version=1`);
      await expect(h.sql(
        `update entitlements set plan_version_id=$2 where company_id=$1`, [company, v!.id]))
        .rejects.toThrow(/belongs to plan business/);
    });

    it('lets a manual grant differ, because that is what a manual grant is', async () => {
      // It already has to name who granted it and why, which is the control.
      const [v] = await h.sql<{ id: string }>(
        `select id from plan_versions where plan_id='professional' and version=1`);
      await h.sql(
        `update entitlements set source='manual_grant', granted_by=$2,
           grant_reason='Migration support agreed with the customer', features=array['*']
         where company_id=$1`, [company, owner]);
      const [e] = await h.sql<{ features: string[]; source: string }>(
        `select features, source from entitlements where company_id=$1`, [company]);
      expect(e!.source).toBe('manual_grant');
      expect(e!.features).toEqual(['*']);
      expect(v!.id).toBeTruthy();
    });

    it('still requires a manual grant to name a granter and a reason', async () => {
      await expect(h.sql(
        `update entitlements set granted_by=null, grant_reason=null where company_id=$1`, [company]))
        .rejects.toThrow(/entitlements_manual_reason/);
    });
  });

  // ----------------------------------------------------------- what was sold
  describe('what a subscription was sold under', () => {
    it('pins the version onto the subscription', async () => {
      const [v] = await h.sql<{ id: string }>(
        `select id from plan_versions where plan_id='professional' and version=1`);
      await h.sql(
        `insert into subscriptions (company_id, plan_id, plan_version_id, stripe_customer_id,
           stripe_subscription_id, status)
         values ($1,'professional',$2,'cus_test','sub_test','active')`, [company, v!.id]);
      const [s] = await h.sql<{ version: number }>(
        `select pv.version from subscriptions s
         join plan_versions pv on pv.id = s.plan_version_id
         where s.stripe_subscription_id='sub_test'`);
      expect(Number(s!.version)).toBe(1);
    });

    it('keeps saying version 1 after the plan moves on', async () => {
      await h.sql(`update plans set max_active_projects = 999 where id='professional'`);
      const [s] = await h.sql<{ version: number; max_active_projects: number }>(
        `select pv.version, pv.max_active_projects from subscriptions s
         join plan_versions pv on pv.id = s.plan_version_id
         where s.stripe_subscription_id='sub_test'`);
      expect(Number(s!.version)).toBe(1);
      expect(Number(s!.max_active_projects)).toBe(75);
    });

    it('refuses to delete a version somebody is on', async () => {
      // on delete restrict: the terms of a live sale cannot be removed.
      await expect(h.sql(`delete from plans where id='professional'`)).rejects.toThrow();
    });
  });

  // ----------------------------------------------------------------- tenancy
  describe('tenancy and exposure', () => {
    it('forces row level security on plan_versions', async () => {
      const [row] = await h.sql<{ rls: boolean; forced: boolean }>(
        `select relrowsecurity as rls, relforcerowsecurity as forced
         from pg_class where relname='plan_versions'`);
      expect(row!.rls).toBe(true);
      expect(row!.forced).toBe(true);
    });

    it('shows an anonymous caller nothing', async () => {
      // The privilege gate refused a wider grant, and it was right to: a
      // visitor comparing prices reads plans and plan_prices.
      await expect(h.asAnon(() => h.sql(`select id from plan_versions limit 1`))).rejects.toThrow();
    });

    it('shows any authenticated user the published terms', async () => {
      const rows = await h.asUser(other, () => h.sql(`select id from plan_versions`));
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------------- audit gaps
  describe('the audit gaps behind it', () => {
    it('audits the work calendars that move every schedule date', async () => {
      // Migration 0011 attached audit by looping over the tables that existed
      // then; nothing ran that loop for anything added afterwards.
      const [cal] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into work_calendars (company_id, code, name, working_weekdays)
         values ($1,'AUD','Audited','{1,2,3,4,5}'::smallint[]) returning id`, [company]));
      const rows = await h.sql<{ action: string }>(
        `select action from audit_events where entity_table='public.work_calendars' and entity_id=$1`,
        [cal!.id]);
      expect(rows.length).toBeGreaterThan(0);
    });

    it('maintains updated_at on a calendar', async () => {
      const [cal] = await h.asUser(owner, () => h.sql<{ id: string; updated_at: string }>(
        `insert into work_calendars (company_id, code, name, working_weekdays)
         values ($1,'UPD','Touch','{1,2,3,4,5}'::smallint[]) returning id, updated_at`, [company]));
      await h.asUser(owner, () => h.sql(
        `update work_calendars set name='Touched' where id=$1`, [cal!.id]));
      const [after] = await h.sql<{ updated_at: string }>(
        `select updated_at from work_calendars where id=$1`, [cal!.id]);
      expect(new Date(after!.updated_at).getTime())
        .toBeGreaterThan(new Date(cal!.updated_at).getTime());
    });

    it('freezes what Stripe sent while letting processing advance', async () => {
      await h.sql(
        `insert into stripe_events (id, type, payload) values ('evt_1','customer.subscription.updated','{"a":1}')`);
      await h.sql(
        `update stripe_events set processing_state='processed', processed_at=now(), attempts=1 where id='evt_1'`);
      const [row] = await h.sql<{ processing_state: string }>(
        `select processing_state from stripe_events where id='evt_1'`);
      expect(row!.processing_state).toBe('processed');

      await expect(h.sql(`update stripe_events set payload='{"a":2}' where id='evt_1'`))
        .rejects.toThrow(/cannot be rewritten/);
      await expect(h.sql(`update stripe_events set type='other' where id='evt_1'`))
        .rejects.toThrow(/cannot be rewritten/);
    });

    it('skips a replayed event rather than applying it twice', async () => {
      // The primary key is the idempotency barrier.
      const before = await h.sql<{ n: string }>(`select count(*) as n from stripe_events`);
      await h.sql(
        `insert into stripe_events (id, type, payload) values ('evt_1','customer.subscription.updated','{"a":9}')
         on conflict (id) do nothing`);
      const after = await h.sql<{ n: string }>(`select count(*) as n from stripe_events`);
      expect(after[0]!.n).toBe(before[0]!.n);
      const [row] = await h.sql<{ payload: { a: number } }>(`select payload from stripe_events where id='evt_1'`);
      expect(row!.payload.a).toBe(1);
    });
  });
});

describe('plan limits are enforced, not merely recorded', () => {
  let h: Harness;
  const owner = '33333333-3333-4333-8333-333333333333';
  let starter = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'lim@r.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'lim@r.test') on conflict (id) do nothing`, [owner]);
    // Starter allows 3 seats, 25 active estimates and 10 active projects.
    starter = (await h.asUser(owner, () =>
      h.sql<{ id: string }>(`select app.provision_company('Small','small','starter') as id`)))[0]!.id;
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  const addEstimate = (n: number) => h.asUser(owner, () => h.sql(
    `insert into estimates (company_id, number, name) values ($1,$2,$3)`,
    [starter, `EST-${n}`, `Estimate ${n}`]));

  it('reads the limit from the entitlement', async () => {
    const [row] = await h.sql<{ n: number }>(
      `select app.plan_limit($1,'max_active_estimates') as n`, [starter]);
    expect(Number(row!.n)).toBe(25);
  });

  it('refuses an unknown limit key rather than returning null', async () => {
    await expect(h.sql(`select app.plan_limit($1,'max_dogs')`, [starter]))
      .rejects.toThrow(/Unknown plan limit/);
  });

  it('accepts work up to the limit', async () => {
    for (let i = 1; i <= 25; i++) await addEstimate(i);
    const [row] = await h.sql<{ n: string }>(
      `select count(*) as n from estimates where company_id=$1`, [starter]);
    expect(Number(row!.n)).toBe(25);
  });

  it('refuses the one past it, and says what to do', async () => {
    await expect(addEstimate(26))
      .rejects.toThrow(/This plan allows 25 active estimates.*Upgrade to add more/);
  });

  it('frees an allowance when work is archived rather than deleted', async () => {
    // A company that archives last year's bids has not used up this year's
    // allowance. Telling them otherwise pushes them to delete their history.
    await h.asUser(owner, () => h.sql(
      `update estimates set status='archived' where company_id=$1 and number='EST-1'`, [starter]));
    await expect(addEstimate(26)).resolves.toBeDefined();
  });

  it('counts an invited user against the seat limit', async () => {
    // A seat is consumed when it is offered, or a company could invite past
    // the limit and have the overage appear when people sign in.
    const [role] = await h.sql<{ id: string }>(
      `select id from roles where key='estimator' and company_id is null`);
    for (const email of ['a@x.test', 'b@x.test']) {
      const id = crypto.randomUUID();
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2) on conflict (id) do nothing`, [id, email]);
      await h.sql(
        `insert into company_memberships (company_id, user_id, role_id, status)
         values ($1,$2,$3,'invited')`, [starter, id, role!.id]);
    }
    const extra = crypto.randomUUID();
    await h.sql(`insert into auth.users (id, email) values ($1,'c@x.test')`, [extra]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'c@x.test') on conflict (id) do nothing`, [extra]);
    await expect(h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status)
       values ($1,$2,$3,'invited')`, [starter, extra, role!.id]))
      .rejects.toThrow(/This plan allows 3 users/);
  });

  it('lets an unlimited plan through', async () => {
    const boss = crypto.randomUUID();
    await h.sql(`insert into auth.users (id, email) values ($1,'boss@x.test')`, [boss]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'boss@x.test') on conflict (id) do nothing`, [boss]);
    const big = (await h.asUser(boss, () =>
      h.sql<{ id: string }>(`select app.provision_company('Big','big','enterprise') as id`)))[0]!.id;
    const [limit] = await h.sql<{ n: number | null }>(
      `select app.plan_limit($1,'max_active_estimates') as n`, [big]);
    expect(limit!.n).toBeNull();
    for (let i = 1; i <= 30; i++) {
      await h.asUser(boss, () => h.sql(
        `insert into estimates (company_id, number, name) values ($1,$2,'Big')`, [big, `B-${i}`]));
    }
    const [count] = await h.sql<{ n: string }>(
      `select count(*) as n from estimates where company_id=$1`, [big]);
    expect(Number(count!.n)).toBe(30);
  });

  it('never locks a company out for having no entitlement at all', async () => {
    // A billing gap must not become a data outage.
    await h.sql(`delete from entitlements where company_id=$1`, [starter]);
    const [limit] = await h.sql<{ n: number | null }>(
      `select app.plan_limit($1,'max_active_estimates') as n`, [starter]);
    expect(limit!.n).toBeNull();
    await expect(addEstimate(99)).resolves.toBeDefined();
  });

  it('reports usage against allowance', async () => {
    const rows = await h.asUser(owner, () => h.sql<{ resource: string; used: string; allowed: number | null }>(
      `select resource, used, allowed from reporting_plan_usage where company_id=$1 order by resource`,
      [starter]));
    expect(rows.map((r) => r.resource)).toEqual(['active estimates', 'active projects', 'users']);
    expect(Number(rows[0]!.used)).toBeGreaterThan(20);
  });

  it('runs the usage view as the caller', async () => {
    const [row] = await h.sql<{ options: string[] | null }>(`
      select c.reloptions as options from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relname='reporting_plan_usage'`);
    expect(row!.options).toContain('security_invoker=true');
  });
});
