/**
 * From nothing to a bid that went out.
 *
 * The estimating schema has been complete since migration 0006 and the pricing
 * engine since 0058, but there was no path from a person to either: no way to
 * create an estimate, add a line, or move one to issued. This walks the whole
 * path against real PostgreSQL, and asserts the rules that make an estimate a
 * document rather than a draft — including the one the engine had been
 * computing since 0058 that nothing read.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const CHIEF = '22222222-2222-4222-8222-222222222222';
const SENIOR = '33333333-3333-4333-8333-333333333333';
const OUTSIDER = '44444444-4444-4444-8444-444444444444';

describe('building an estimate', () => {
  let h: Harness;
  let ridgeline = '';
  let kesler = '';
  let service = '';
  let serviceUnit = '';

  /** Create an estimate and hand back its first version. */
  const newVersion = async (user: string, name: string) => {
    const [e] = await h.asUser(user, () => h.sql<{ id: string }>(
      `select app.create_estimate($1, null, null, null, $2) as id`, [name, ridgeline]));
    const [v] = await h.asUser(user, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [e!.id]));
    return v!.v;
  };

  const member = async (company: string, user: string, roleKey: string) => {
    const [role] = await h.sql<{ id: string }>(
      `select id from roles where key = $1 and company_id is null`, [roleKey]);
    await h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status, joined_at)
       values ($1,$2,$3,'active',now())`, [company, user, role!.id]);
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, mail] of [[OWNER, 'o@r.test'], [CHIEF, 'c@r.test'],
                              [SENIOR, 's@r.test'], [OUTSIDER, 'x@k.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, mail]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, mail]);
    }
    ridgeline = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    kesler = (await h.asUser(OUTSIDER, () => h.sql<{ id: string }>(
      `select app.provision_company('Kesler','kesler','enterprise') as id`)))[0]!.id;
    await member(ridgeline, CHIEF, 'chief_estimator');
    await member(ridgeline, SENIOR, 'senior_estimator');

    // A real service out of the master library, with a rate somebody measured.
    const [s] = await h.sql<{ id: string; default_unit: string }>(
      `select s.id, s.default_unit::text as default_unit
         from services s
         join assembly_components ac
           on ac.assembly_id = s.default_assembly_id and ac.component_kind = 'task'
         join production_rates pr on pr.task_id = ac.task_id and pr.status = 'active'
        where s.company_id is null and s.status = 'active'
        group by s.id, s.default_unit
        order by min(s.name) limit 1`);
    service = s!.id; serviceUnit = s!.default_unit;
  }, 240_000);

  afterAll(async () => { await h?.db.close(); });

  // ---------------------------------------------------------------------------
  it('creates the estimate, its first version, and the pointer between them', async () => {
    const id = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.create_estimate('Ridgeline Quarry Haul Road') as id`)))[0]!.id;

    const [row] = await h.asUser(OWNER, () => h.sql<{
      number: string; status: string; current_version_id: string;
      version_number: number; version_status: string; profile: string | null;
      estimator_id: string;
    }>(`select e.number, e.status::text as status, e.current_version_id,
               v.version_number, v.status::text as version_status,
               v.pricing_profile_id as profile, e.estimator_id
          from estimates e join estimate_versions v on v.id = e.current_version_id
         where e.id = $1`, [id]));

    expect(row!.number).toMatch(/^E-\d{4}-0001$/);
    expect(row!.status).toBe('draft');
    expect(row!.version_number).toBe(1);
    expect(row!.version_status).toBe('draft');
    expect(row!.estimator_id).toBe(OWNER);
    // It carries the company's own pricing profile, not nothing.
    expect(row!.profile).not.toBeNull();
  });

  it('numbers per company, so a second company also starts at one', async () => {
    const id = (await h.asUser(OUTSIDER, () => h.sql<{ id: string }>(
      `select app.create_estimate('Kesler Sitework') as id`)))[0]!.id;
    const [row] = await h.asUser(OUTSIDER, () =>
      h.sql<{ number: string }>(`select number from estimates where id = $1`, [id]));
    expect(row!.number).toMatch(/^E-\d{4}-0001$/);
    expect(kesler).toBeTruthy();
  });

  it('refuses a customer belonging to somebody else', async () => {
    const [c] = await h.asUser(OUTSIDER, () => h.sql<{ id: string }>(
      `insert into customers (company_id, code, name)
         values ($1,'CUS-K1','Kesler Client') returning id`,
      [kesler]));
    await expect(h.asUser(OWNER, () => h.sql(
      `select app.create_estimate('Poached', $1)`, [c!.id]))).rejects.toThrow(/not one of yours/i);
  });

  it('refuses someone with no estimating permission', async () => {
    await expect(h.asUser(OUTSIDER, () => h.sql(
      `select app.create_estimate('Not mine', null, null, null, $1)`, [ridgeline])))
      .rejects.toThrow(/permission/i);
  });

  // ---------------------------------------------------------------------------
  describe('adding a line from the library', () => {
    let version = '';
    beforeAll(async () => {
      const id = (await h.asUser(SENIOR, () => h.sql<{ id: string }>(
        `select app.create_estimate('Lines', null, null, null, $1) as id`, [ridgeline])))[0]!.id;
      version = (await h.asUser(SENIOR, () => h.sql<{ current_version_id: string }>(
        `select current_version_id from estimates where id = $1`, [id])))[0]!.current_version_id;
    });

    it('takes the unit, the description, the cost code and a production rate', async () => {
      const line = (await h.asUser(SENIOR, () => h.sql<{ id: string }>(
        `select app.add_estimate_line($1, $2, null, 1200) as id`, [version, service])))[0]!.id;

      const [row] = await h.asUser(SENIOR, () => h.sql<{
        description: string; unit: string; qty: string; rate: string | null;
        cost_code: string | null; sort_order: number; total_direct_cost: string;
      }>(`select l.description, l.unit::text as unit, l.measured_quantity as qty,
                 l.production_rate_id as rate, l.cost_code_id as cost_code,
                 l.sort_order, l.total_direct_cost
            from estimate_line_items l where l.id = $1`, [line]));

      const [svc] = await h.sql<{ name: string }>(
        `select name from services where id = $1`, [service]);
      expect(row!.description).toBe(svc!.name);
      expect(row!.unit).toBe(serviceUnit);
      expect(Number(row!.qty)).toBe(1200);
      expect(row!.rate).not.toBeNull();      // the library earned its place
      expect(row!.sort_order).toBe(10);
      // Unpriced until the engine runs. Costs are not the caller's to write.
      expect(Number(row!.total_direct_cost)).toBe(0);
    });

    it('refuses a unit the service is not measured in', async () => {
      const [bad] = await h.sql<{ unit: string }>(
        `select u.unit::text as unit from unnest(enum_range(null::app.unit_code)) u(unit)
          where u.unit <> all (select unnest(supported_units) from services where id = $1)
          limit 1`, [service]);
      await expect(h.asUser(SENIOR, () => h.sql(
        `select app.add_estimate_line($1,$2,null,5,$3)`, [version, service, bad!.unit])))
        .rejects.toThrow(/not measured in/i);
    });

    it('refuses a service from another company\'s library', async () => {
      const [foreign] = await h.asUser(OUTSIDER, () => h.sql<{ id: string }>(
        `insert into services (company_id, code, name, default_unit, supported_units,
                               status, origin, approved_by, approved_at)
         values ($1,'K-1','Kesler Private','CY','{CY}','active','company',$2,now())
         returning id`, [kesler, OUTSIDER]));
      await expect(h.asUser(SENIOR, () => h.sql(
        `select app.add_estimate_line($1,$2,null,5)`, [version, foreign!.id])))
        .rejects.toThrow(/not in your library/i);
    });

    it('allows a free-text line with no service at all', async () => {
      const line = (await h.asUser(SENIOR, () => h.sql<{ id: string }>(
        `select app.add_estimate_line($1, null, 'Mobilization', 1, 'LS') as id`,
        [version])))[0]!.id;
      const [row] = await h.asUser(SENIOR, () => h.sql<{ description: string; sort: number }>(
        `select description, sort_order as sort from estimate_line_items where id = $1`, [line]));
      expect(row!.description).toBe('Mobilization');
      expect(row!.sort).toBe(20);          // lands after the first
    });

    it('refuses a line with neither a service nor a description', async () => {
      await expect(h.asUser(SENIOR, () => h.sql(
        `select app.add_estimate_line($1, null, null, 5)`, [version])))
        .rejects.toThrow(/needs a description/i);
    });
  });

  // ---------------------------------------------------------------------------
  describe('approving and issuing', () => {
    let estimate = '';
    let version = '';

    /** What the engine would have written, so the rest of the path can be tested. */
    const price = async (v: string, opts: { blocked?: boolean; total?: number } = {}) => {
      const lines = await h.sql<{ id: string }>(
        `select id from estimate_line_items where estimate_version_id = $1`, [v]);
      await h.asService(() => h.sql(
        `select app.record_engine_result($1, 'test-1.0.0',
           jsonb_build_object('direct_cost', $2::numeric, 'total_price', $2::numeric,
                              'bid_price', $2::numeric,
                              'blocked_from_issue', $3::boolean),
           $4::jsonb)`,
        [v, opts.total ?? 250000, opts.blocked ?? false,
         JSON.stringify(lines.map((l) => ({
           id: l.id, total_direct_cost: 1000, cost_labor_wage: 1000, blocks_issue: false })))]));
    };

    beforeAll(async () => {
      estimate = (await h.asUser(SENIOR, () => h.sql<{ id: string }>(
        `select app.create_estimate('Haul Road', null, null, null, $1) as id`,
        [ridgeline])))[0]!.id;
      version = (await h.asUser(SENIOR, () => h.sql<{ v: string }>(
        `select current_version_id as v from estimates where id = $1`, [estimate])))[0]!.v;
    });

    it('refuses to approve an estimate with nothing on it', async () => {
      await expect(h.asUser(CHIEF, () => h.sql(
        `select app.set_estimate_status($1,'approved')`, [version])))
        .rejects.toThrow(/nothing on this estimate/i);
    });

    it('refuses to approve a line that has a quantity and no price', async () => {
      await h.asUser(SENIOR, () => h.sql(
        `select app.add_estimate_line($1,$2,null,1200)`, [version, service]));
      await expect(h.asUser(CHIEF, () => h.sql(
        `select app.set_estimate_status($1,'approved')`, [version])))
        .rejects.toThrow(/no price\. Price it first/i);
    });

    it('refuses to approve what the engine has not cleared to issue', async () => {
      // 0006 defaults `blocked_from_issue` to true and 0058 has the engine set
      // it. Until now the only thing that read it was the award-to-project
      // conversion — you could send a customer a bid the engine had blocked.
      await price(version, { blocked: true });
      await expect(h.asUser(CHIEF, () => h.sql(
        `select app.set_estimate_status($1,'approved')`, [version])))
        .rejects.toThrow(/has not cleared this estimate/i);
    });

    it('refuses to approve when a single line is too unconfident to bid', async () => {
      const [l] = await h.sql<{ id: string; description: string }>(
        `select id, description from estimate_line_items
          where estimate_version_id = $1 limit 1`, [version]);
      await h.asService(() => h.sql(
        `select app.record_engine_result($1,'test-1.0.0','{}'::jsonb,
           jsonb_build_array(jsonb_build_object('id', $2::text, 'blocks_issue', true)))`,
        [version, l!.id]));
      await expect(h.asUser(CHIEF, () => h.sql(
        `select app.set_estimate_status($1,'approved')`, [version])))
        .rejects.toThrow(new RegExp(
          l!.description.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      await h.asService(() => h.sql(
        `select app.record_engine_result($1,'test-1.0.0','{}'::jsonb,
           jsonb_build_array(jsonb_build_object('id', $2::text, 'blocks_issue', false)))`,
        [version, l!.id]));
    });

    it('refuses the author signing off their own work below chief authority', async () => {
      await price(version);
      await expect(h.asUser(SENIOR, () => h.sql(
        `select app.set_estimate_status($1,'approved')`, [version])))
        .rejects.toThrow(/cannot be the one who approves it/i);
    });

    it('refuses an estimator without approval permission', async () => {
      await expect(h.asUser(OUTSIDER, () => h.sql(
        `select app.set_estimate_status($1,'approved')`, [version])))
        .rejects.toThrow(/permission/i);
    });

    it('lets a chief estimator approve it, and the estimate follows its version', async () => {
      await h.asUser(CHIEF, () => h.sql(
        `select app.set_estimate_status($1,'approved','Reviewed against the takeoff')`,
        [version]));
      const [row] = await h.asUser(CHIEF, () => h.sql<{
        vstatus: string; estatus: string; by: string; at: string | null;
      }>(`select v.status::text as vstatus, e.status::text as estatus,
                 v.approved_by as by, v.approved_at as at
            from estimate_versions v join estimates e on e.id = v.estimate_id
           where v.id = $1`, [version]));
      expect(row!.vstatus).toBe('approved');
      expect(row!.estatus).toBe('approved');   // the list is honest without a join
      expect(row!.by).toBe(CHIEF);
      expect(row!.at).not.toBeNull();
    });

    it('froze the library rows that priced it', async () => {
      // 0026 built library_snapshots, its immutability and its drift report,
      // and nothing ever wrote one — so every approval was refused by 0026's
      // own trigger. Approval captures it now.
      const [snap] = await h.asUser(CHIEF, () => h.sql<{
        entry_count: number; digest: string; engine_version: string; kinds: string;
      }>(`select s.entry_count, s.digest, s.engine_version,
                 (select string_agg(distinct e.kind, ',' order by e.kind)
                    from library_snapshot_entries e where e.snapshot_id = s.id) as kinds
            from library_snapshots s
            join estimate_versions v on v.library_snapshot_id = s.id
           where v.id = $1`, [version]));
      expect(snap).toBeDefined();
      expect(snap!.engine_version).toBe('test-1.0.0');
      expect(snap!.digest).toMatch(/^[0-9a-f]{16}$/);
      expect(snap!.entry_count).toBeGreaterThan(0);
      // The service, its cost code, the rate that priced it and the tasks it
      // is made of — the rows that would change the number if they moved.
      for (const kind of ['service', 'cost_code', 'production_rate', 'task', 'assembly']) {
        expect(snap!.kinds.split(','), `snapshot is missing ${kind}`).toContain(kind);
      }
    });

    it('reports no drift against a library nobody has touched', async () => {
      const drift = await h.asUser(CHIEF, () => h.sql<{ status: string }>(
        `select status from estimate_drift($1) where status <> 'unchanged'`, [version]));
      expect(drift).toHaveLength(0);
    });

    it('writes an audit row naming the approver and the reason', async () => {
      const [a] = await h.sql<{ action: string; actor: string; reason: string }>(
        `select action::text as action, actor_id as actor, reason
           from audit_events
          where entity_table = 'public.estimate_versions' and entity_id = $1
            and action = 'approve' order by id desc limit 1`, [version]);
      expect(a!.actor).toBe(CHIEF);
      expect(a!.reason).toBe('Reviewed against the takeoff');
    });

    it('will not reprice an approved version', async () => {
      // RULE-009. The signature is on this number.
      await expect(price(version, { total: 310000 }))
        .rejects.toThrow(/immutable \(RULE-009\)/i);
    });

    it('issues a proposal, freezing the price that was sent', async () => {
      const proposal = (await h.asUser(CHIEF, () => h.sql<{ id: string }>(
        `select app.issue_proposal($1, null, 'Thank you for the opportunity.') as id`,
        [version])))[0]!.id;

      const [p] = await h.asUser(CHIEF, () => h.sql<{
        number: string; title: string; total: string; status: string;
        issued_at: string | null; validity: number; vstatus: string;
        vissued_by: string; vissued_at: string | null;
      }>(`select p.number, p.title, p.total_price as total, p.status::text as status,
                 p.issued_at, p.validity_days as validity, v.status::text as vstatus,
                 v.issued_by as vissued_by, v.issued_at as vissued_at
            from proposals p join estimate_versions v on v.id = p.estimate_version_id
           where p.id = $1`, [proposal]));

      expect(p!.number).toMatch(/^P-\d{4}-0001$/);
      expect(p!.title).toBe('Haul Road');      // falls back to the estimate name
      expect(Number(p!.total)).toBe(250000);
      expect(p!.status).toBe('issued');
      expect(p!.issued_at).not.toBeNull();
      expect(p!.validity).toBe(30);
      expect(p!.vstatus).toBe('issued');       // approved -> issued, which 0006 refused
      // 0006 has carried issued_by/issued_at since the beginning and nothing
      // ever set either, though a check constraint demanded issued_at.
      expect(p!.vissued_by).toBe(CHIEF);
      expect(p!.vissued_at).not.toBeNull();
    });

    it('refuses to edit or reopen a version that has gone out', async () => {
      await expect(h.asUser(SENIOR, () => h.sql(
        `select app.add_estimate_line($1,$2,null,10)`, [version, service])))
        .rejects.toThrow(/make a new version/i);
      await expect(h.asUser(CHIEF, () => h.sql(
        `select app.set_estimate_status($1,'draft')`, [version])))
        .rejects.toThrow(/already gone out/i);
    });

    /*
     * `accepted_at`, `accepted_by_name` and `declined_at` have been on
     * `proposals` since 0006 and listed as mutable by 0013, and nothing ever
     * wrote one — so a bid the customer signed left its estimate at 'issued'
     * forever and the platform had no record of which jobs a company won.
     */
    describe('when the customer answers', () => {
      let proposal = '';
      beforeAll(async () => {
        [proposal] = (await h.asUser(CHIEF, () => h.sql<{ id: string }>(
          `select id from proposals where estimate_version_id = $1`, [version])))
          .map((r) => r.id);
      });

      it('will not accept a proposal on nobody\'s signature', async () => {
        await expect(h.asUser(CHIEF, () => h.sql(
          `select app.record_proposal_outcome($1,'accepted','  ')`, [proposal])))
          .rejects.toThrow(/Say who accepted it/i);
      });

      it('refuses an outcome that is not one', async () => {
        await expect(h.asUser(CHIEF, () => h.sql(
          `select app.record_proposal_outcome($1,'maybe','M. Reyes')`, [proposal])))
          .rejects.toThrow(/accepted, declined, withdrawn or expired/i);
      });

      it('keeps another company from answering on your behalf', async () => {
        await expect(h.asUser(OUTSIDER, () => h.sql(
          `select app.record_proposal_outcome($1,'accepted','M. Reyes')`, [proposal])))
          .rejects.toThrow(/permission/i);
      });

      it('records who signed, and moves the estimate with it', async () => {
        await h.asUser(CHIEF, () => h.sql(
          `select app.record_proposal_outcome($1,'accepted','M. Reyes')`, [proposal]));
        const [row] = await h.asUser(CHIEF, () => h.sql<{
          status: string; by: string; at: string | null; vstatus: string; estatus: string;
        }>(`select p.status, p.accepted_by_name as by, p.accepted_at as at,
                   v.status::text as vstatus, e.status::text as estatus
              from proposals p
              join estimate_versions v on v.id = p.estimate_version_id
              join estimates e on e.id = v.estimate_id
             where p.id = $1`, [proposal]));
        expect(row!.status).toBe('accepted');
        expect(row!.by).toBe('M. Reyes');
        expect(row!.at).not.toBeNull();
        // The whole point: the bid is won, not still sitting out for decision.
        expect(row!.vstatus).toBe('awarded');
        expect(row!.estatus).toBe('awarded');
      });

      it('says so in the audit trail, naming the proposal', async () => {
        const [a] = await h.sql<{ reason: string; action: string }>(
          `select reason, action::text as action from audit_events
            where entity_table = 'public.estimate_versions' and entity_id = $1
              and action = 'award' order by id desc limit 1`, [version]);
        expect(a!.reason).toMatch(/^Proposal P-\d{4}-0001 accepted by M\. Reyes$/);
      });

      it('has no second answer to record', async () => {
        await expect(h.asUser(CHIEF, () => h.sql(
          `select app.record_proposal_outcome($1,'declined')`, [proposal])))
          .rejects.toThrow(/is accepted, so there is no answer to record/i);
      });
    });

    it('will not issue something that was never approved', async () => {
      const fresh = await newVersion(CHIEF, 'Unapproved');
      await expect(h.asUser(CHIEF, () => h.sql(
        `select app.set_estimate_status($1,'issued')`, [fresh])))
        .rejects.toThrow(/approved before it is issued/i);
      await expect(h.asUser(CHIEF, () => h.sql(
        `select app.issue_proposal($1)`, [fresh])))
        .rejects.toThrow(/approved before a proposal/i);
    });

    it('lets a chief estimator approve work they built themselves', async () => {
      const own = await newVersion(CHIEF, 'Chief own');
      await h.asUser(CHIEF, () => h.sql(
        `select app.add_estimate_line($1,$2,null,100)`, [own, service]));
      await price(own);
      await h.asUser(CHIEF, () => h.sql(
        `select app.set_estimate_status($1,'approved')`, [own]));
      const [row] = await h.asUser(CHIEF, () => h.sql<{ s: string }>(
        `select status::text as s from estimate_versions where id = $1`, [own]));
      expect(row!.s).toBe('approved');
    });

    it('keeps another company out of all of it', async () => {
      for (const stmt of [
        `select app.add_estimate_line($1,null,'Sneak',1,'LS')`,
        `select app.set_estimate_status($1,'lost')`,
        `select app.issue_proposal($1)`,
      ]) {
        await expect(h.asUser(OUTSIDER, () => h.sql(stmt, [version])))
          .rejects.toThrow(/permission/i);
      }
    });
  });

  /*
   * A bid priced against September fuel is not a bid in March. `expires_at` is
   * the fact; expired is derived from it and the clock, never stored — a stored
   * flag is wrong from the moment it passes until something corrects it, and
   * the something never exists.
   */
  describe('an estimate that expires', () => {
    let estimate = '';
    let version = '';

    beforeAll(async () => {
      const [e] = await h.asUser(CHIEF, () => h.sql<{ id: string }>(
        `select app.create_estimate('Expiring', null, null, null, $1,
                                     now() + interval '30 days') as id`, [ridgeline]));
      estimate = e!.id;
      const [v] = await h.asUser(CHIEF, () => h.sql<{ v: string }>(
        `select current_version_id as v from estimates where id = $1`, [estimate]));
      version = v!.v;
      await h.asUser(CHIEF, () => h.sql(
        `select app.add_estimate_line($1,$2,null,500)`, [version, service]));
    });

    it('records when it was made and when it stops being good', async () => {
      const [row] = await h.asUser(CHIEF, () => h.sql<{
        created: string; expires: string; expired: boolean;
      }>(`select created_at as created, expires_at as expires,
                 app.estimate_is_expired(id) as expired
            from estimates where id = $1`, [estimate]));
      expect(row!.created).not.toBeNull();
      expect(row!.expires).not.toBeNull();
      expect(row!.expired).toBe(false);
    });

    it('refuses an expiry that has already passed', async () => {
      await expect(h.asUser(CHIEF, () => h.sql(
        `select app.set_estimate_expiry($1, now() - interval '1 day')`, [estimate])))
        .rejects.toThrow(/would expire it immediately/i);
    });

    it('will not approve an estimate whose price has stopped being good', async () => {
      // Moved past by the clock, not by a status anybody set.
      // Backdated so the expiry is after creation and still behind the clock —
      // which is the constraint doing its job: an estimate cannot expire before
      // it was written.
      await h.sql(
        `update estimates set created_at = now() - interval '40 days',
                              expires_at = now() - interval '1 hour' where id = $1`, [estimate]);
      const lines = await h.sql<{ id: string }>(
        `select id from estimate_line_items where estimate_version_id = $1`, [version]);
      const priced = JSON.stringify(
        lines.map((l) => ({ id: l.id, total_direct_cost: 900, blocks_issue: false })));
      await h.asService(() => h.sql(
        `select app.record_engine_result($1,'test-1.0.0',
           jsonb_build_object('total_price', 90000, 'bid_price', 90000,
                              'blocked_from_issue', false),
           $2::jsonb)`,
        [version, priced]));

      await expect(h.asUser(CHIEF, () => h.sql(
        `select app.set_estimate_status($1,'approved')`, [version])))
        .rejects.toThrow(/expired on /i);
      const [row] = await h.asUser(CHIEF, () => h.sql<{ expired: boolean }>(
        `select app.estimate_is_expired(id) as expired from estimates where id = $1`, [estimate]));
      expect(row!.expired).toBe(true);
    });

    it('approves once the expiry is moved out', async () => {
      await h.asUser(CHIEF, () => h.sql(
        `select app.set_estimate_expiry($1, now() + interval '60 days')`, [estimate]));
      await h.asUser(CHIEF, () => h.sql(
        `select app.set_estimate_status($1,'approved')`, [version]));
      const [row] = await h.asUser(CHIEF, () => h.sql<{ s: string }>(
        `select status::text as s from estimate_versions where id = $1`, [version]));
      expect(row!.s).toBe('approved');
    });

    it('will not change the terms once they are with the customer', async () => {
      await h.asUser(CHIEF, () => h.sql(`select app.set_estimate_status($1,'issued')`, [version]));
      await expect(h.asUser(CHIEF, () => h.sql(
        `select app.set_estimate_expiry($1, now() + interval '90 days')`, [estimate])))
        .rejects.toThrow(/already with the customer/i);
    });

    it('attaches the estimate to a client', async () => {
      const [c] = await h.asUser(CHIEF, () => h.sql<{ id: string }>(
        `insert into customers (company_id, code, name)
         values ($1,'CUS-R1','Maumee Development') returning id`, [ridgeline]));
      const [e] = await h.asUser(CHIEF, () => h.sql<{ id: string }>(
        `select app.create_estimate('For a client', $1, null, null, $2) as id`,
        [c!.id, ridgeline]));
      const [row] = await h.asUser(CHIEF, () => h.sql<{ name: string }>(
        `select cu.name from estimates e join customers cu on cu.id = e.customer_id
          where e.id = $1`, [e!.id]));
      expect(row!.name).toBe('Maumee Development');
    });
  });

  it('exposes each door on the public schema for the browser, and none to anon',
    async () => {
      const rows = await h.sql<{ name: string; anon: boolean; auth: boolean }>(
        `select p.proname as name,
                has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as auth
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('create_estimate','add_estimate_line',
                              'set_estimate_status','issue_proposal')`);
      expect(rows).toHaveLength(4);
      for (const r of rows) {
        expect(r.anon, `${r.name} is reachable anonymously`).toBe(false);
        expect(r.auth, `${r.name} is not reachable by a signed-in user`).toBe(true);
      }
    });
});
