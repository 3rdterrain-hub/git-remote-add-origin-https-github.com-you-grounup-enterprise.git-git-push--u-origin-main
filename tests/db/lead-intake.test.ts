import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Leads arriving from outside.
 *
 * This is the only write in GrounUp an unauthenticated visitor may perform, so
 * it is the only surface where the usual reasoning does not apply: everywhere
 * else the question is "may this person do this to this company", and here
 * there is no person.
 *
 * The tests that matter are therefore about what a stranger cannot learn. A
 * public form must not become an oracle for which companies exist, must not let
 * anybody read what was submitted, and must not let one visitor fill a
 * company's pipeline.
 */
describe('public lead intake', () => {
  let h: Harness;
  const owner   = '11111111-1111-4111-8111-111111111111';
  const other   = '22222222-2222-4222-8222-222222222222';
  let company = '';
  let key = '';
  let formId = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [[owner, 'o@r.test'], [other, 'x@o.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2) on conflict (id) do nothing`,
        [id, email]);
    }
    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','business') as id`)))[0]!.id;
    await h.asUser(other, () => h.sql(`select app.provision_company('Other','other','business')`));

    const [f] = await h.asUser(owner, () => h.sql<{ id: string; public_key: string }>(
      `insert into lead_intake_forms (company_id, name, source_label)
       values ($1,'Website contact','website') returning id, public_key`, [company]));
    formId = f!.id;
    key = f!.public_key;
  });

  afterAll(async () => { await h?.db.close(); });

  /**
   * A visitor: no JWT, and the `anon` database role.
   *
   * Written through the harness's own anonymous mode rather than a bare query,
   * because a bare query runs privileged — and a test that believed it was
   * checking what a stranger can reach, while running as the owner of the
   * database, would pass while proving nothing.
   *
   * Calls `public.submit_lead`, which is the only thing a visitor can reach:
   * `anon` has no USAGE on the `app` schema at all.
   */
  const anon = <T,>(sql: string, params: unknown[] = []) =>
    h.asAnon(() => h.sql<T>(sql, params));

  // ---------------------------------------------------------- accepting one
  describe('accepting a submission', () => {
    it('records a lead against the company the form belongs to', async () => {
      const [r] = await anon<{ ok: boolean }>(
        `select public.submit_lead($1,'Wood County Engineering','Dana Reyes',
           'dana@woodcounty.test',null,'Sanitary extension, about 3,000 LF',
           'Perrysburg','OH') as ok`, [key]);
      expect(r!.ok).toBe(true);

      const [l] = await h.asUser(owner, () => h.sql<{
        company_name: string; stage: string; source: string; contact_name: string;
      }>(`select company_name, stage, source, contact_name from leads
           where intake_form_id = $1`, [formId]));
      expect(l!.company_name).toBe('Wood County Engineering');
      expect(l!.source).toBe('website');
      expect(l!.contact_name).toBe('Dana Reyes');
    });

    it('lands unqualified, with nothing a stranger claimed treated as fact', async () => {
      /*
       * Everything typed into a public form is a claim. Prefilling a value, a
       * score or an assignee would put a stranger's guess into a company's
       * pipeline as though it were the company's own judgment.
       */
      const [l] = await h.asUser(owner, () => h.sql<{
        stage: string; estimated_value: string | null; assigned_to: string | null;
        qualification_score: number | null;
      }>(`select stage, estimated_value, assigned_to, qualification_score
            from leads where intake_form_id = $1`, [formId]));
      expect(l!.stage).toBe('new');
      expect(l!.estimated_value).toBeNull();
      expect(l!.assigned_to).toBeNull();
      expect(l!.qualification_score).toBeNull();
    });

    it('needs something to reply to', async () => {
      await expect(anon(
        `select public.submit_lead($1,'No Contact Co','Someone')`, [key]))
        .rejects.toThrow(/email address or a phone number/);
    });

    it('needs to know who is asking', async () => {
      await expect(anon(
        `select public.submit_lead($1,'x',null,'a@b.test')`, [key]))
        .rejects.toThrow(/Tell us who you are/);
    });

    it('truncates rather than letting a stranger write a novel', async () => {
      await anon(`select public.submit_lead($1,$2,null,'long@b.test',null,$3)`,
        [key, 'A'.repeat(500), 'B'.repeat(9000)]);
      const [l] = await h.asUser(owner, () => h.sql<{ n: number; d: number }>(
        `select length(company_name) as n, length(project_description) as d
           from leads where email = 'long@b.test'`));
      expect(l!.n).toBe(200);
      expect(l!.d).toBe(4000);
    });
  });

  // ------------------------------------------------------- what it will not say
  describe('tells a stranger nothing', () => {
    it('answers an unknown key and a disabled form identically', async () => {
      /*
       * Anything else is an oracle: submit against a guess, and a different
       * error tells you a company exists here.
       */
      // Valid input throughout, so nothing masks the answer about the key
      // itself — the input checks run first on purpose, so that a stranger gets
      // the same complaint about their own typing whatever key they guessed.
      const unknown = await anon(
        `select public.submit_lead('no-such-key','Probe Co',null,'a@b.test')`)
        .catch((e: Error) => e.message);

      await h.asUser(owner, () => h.sql(
        `update lead_intake_forms set is_active = false where id = $1`, [formId]));
      const disabled = await anon(
        `select public.submit_lead($1,'Probe Co',null,'a@b.test')`, [key])
        .catch((e: Error) => e.message);

      expect(disabled).toBe(unknown);
      expect(String(unknown)).toMatch(/not available/);

      await h.asUser(owner, () => h.sql(
        `update lead_intake_forms set is_active = true where id = $1`, [formId]));
    });

    it('lets a visitor read nothing at all', async () => {
      // anon may call one function and select from nothing.
      for (const table of ['leads', 'lead_intake_forms', 'companies', 'customers']) {
        const rows = await anon(`select 1 from ${table} limit 1`).catch(() => []);
        expect(rows, `anon can read ${table}`).toEqual([]);
      }
    });

    it('shows one company nothing of another company forms', async () => {
      const rows = await h.asUser(other, () => h.sql(
        `select 1 from lead_intake_forms where company_id = $1`, [company]));
      expect(rows).toEqual([]);
    });

    it('answers a robot filling the hidden field exactly like a success', async () => {
      /*
       * Told "rejected", a robot adapts. Told "thank you", it moves on — and
       * nothing is written.
       */
      const before = await h.asUser(owner, () => h.sql<{ n: string }>(
        `select count(*)::text as n from leads where intake_form_id = $1`, [formId]));
      const [r] = await anon<{ ok: boolean }>(
        `select public.submit_lead($1,'Robot Co',null,'bot@b.test',null,null,null,null,'gotcha') as ok`,
        [key]);
      expect(r!.ok).toBe(true);
      const after = await h.asUser(owner, () => h.sql<{ n: string }>(
        `select count(*)::text as n from leads where intake_form_id = $1`, [formId]));
      expect(after[0]!.n).toBe(before[0]!.n);
    });
  });

  // ------------------------------------------------------------ rate limiting
  describe('rate limiting', () => {
    it('stops a form being used to fill a pipeline', async () => {
      const [f] = await h.asUser(owner, () => h.sql<{ public_key: string }>(
        `insert into lead_intake_forms (company_id, name, max_per_hour_per_form)
         values ($1,'Tight',2) returning public_key`, [company]));
      const k = f!.public_key;
      await anon(`select public.submit_lead($1,'One',null,'1@b.test')`, [k]);
      await anon(`select public.submit_lead($1,'Two',null,'2@b.test')`, [k]);
      await expect(anon(`select public.submit_lead($1,'Three',null,'3@b.test')`, [k]))
        .rejects.toThrow(/too many submissions in the last hour/);
    });

    it('counts from the rows rather than a counter somebody has to reset', async () => {
      /*
       * The limit is a query over what was actually submitted, so it cannot
       * drift from reality and there is no state to clear.
       */
      const [f] = await h.asUser(owner, () => h.sql<{ id: string; public_key: string }>(
        `insert into lead_intake_forms (company_id, name, max_per_hour_per_form)
         values ($1,'Windowed',1) returning id, public_key`, [company]));
      await anon(`select public.submit_lead($1,'Old',null,'old@b.test')`, [f!.public_key]);
      // Age the submission out of the window.
      await h.sql(`update leads set submitted_at = now() - interval '2 hours'
                    where intake_form_id = $1`, [f!.id]);
      await expect(anon(`select public.submit_lead($1,'New',null,'new@b.test')`, [f!.public_key]))
        .resolves.toBeDefined();
    });
  });

  // ----------------------------------------------------------- down the funnel
  describe('converting a lead', () => {
    let lead = '';
    beforeAll(async () => {
      lead = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `select id from leads where company_name = 'Wood County Engineering'`)))[0]!.id;
    });

    it('refuses a lead nobody has spoken to', async () => {
      // Converting straight from `new` puts an unexamined stranger into the
      // pipeline with a value attached, which is how a forecast stops meaning
      // anything.
      await expect(h.asUser(owner, () => h.sql(`select app.convert_lead($1)`, [lead])))
        .rejects.toThrow(/Only a qualified lead/);
    });

    it('creates a customer and an opportunity from a qualified one', async () => {
      await h.asUser(owner, () => h.sql(
        `update leads set stage = 'qualified' where id = $1`, [lead]));
      const [r] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `select app.convert_lead($1,'Wood County sanitary extension',480000) as id`, [lead]));

      const [o] = await h.asUser(owner, () => h.sql<{
        name: string; stage: string; estimated_value: string; number: string;
      }>(`select name, stage, estimated_value, number from opportunities where id = $1`, [r!.id]));
      expect(o!.name).toBe('Wood County sanitary extension');
      expect(o!.stage).toBe('identified');
      expect(Number(o!.estimated_value)).toBe(480000);
      expect(o!.number).toMatch(/^OPP-\d{4}-\d{4}$/);

      const [l] = await h.asUser(owner, () => h.sql<{
        stage: string; converted_customer_id: string; converted_at: string;
      }>(`select stage, converted_customer_id, converted_at from leads where id = $1`, [lead]));
      expect(l!.stage).toBe('converted');
      expect(l!.converted_customer_id).not.toBeNull();
      expect(l!.converted_at).not.toBeNull();
    });

    it('leaves a note saying where the opportunity came from', async () => {
      const [a] = await h.asUser(owner, () => h.sql<{ subject: string; body: string }>(
        `select subject, body from crm_activities where lead_id = $1`, [lead]));
      expect(a!.subject).toBe('Lead converted to an opportunity');
      expect(a!.body).toMatch(/Arrived from website/);
    });

    it('refuses to convert the same lead twice', async () => {
      await expect(h.asUser(owner, () => h.sql(`select app.convert_lead($1)`, [lead])))
        .rejects.toThrow(/already converted/);
    });

    it('reuses a customer of the same name instead of making a second', async () => {
      /*
       * How a CRM ends up with four records for the same contractor: every
       * enquiry creates one.
       */
      await anon(`select public.submit_lead($1,'Wood County Engineering','Dana',
        'dana2@woodcounty.test',null,'Another job')`, [key]);
      const second = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `select id from leads where email = 'dana2@woodcounty.test'`)))[0]!.id;
      await h.asUser(owner, () => h.sql(
        `update leads set stage = 'qualified' where id = $1`, [second]));
      await h.asUser(owner, () => h.sql(`select app.convert_lead($1)`, [second]));

      const [n] = await h.asUser(owner, () => h.sql<{ n: string }>(
        `select count(*)::text as n from customers
          where company_id = $1 and name = 'Wood County Engineering'`, [company]));
      expect(Number(n!.n)).toBe(1);
    });
  });

  /*
   * The door, as opposed to the machinery behind it.
   *
   * Everything above exercises `app.convert_lead`. What a browser reaches is
   * `public.convert_lead`, and what a screen reads is a fixed list of columns
   * on `leads` — neither of which was touched by any test, because for four
   * migrations neither was touched by any code. This block is the joint.
   */
  describe('what the lead inbox reaches', () => {
    let fresh = '';
    beforeAll(async () => {
      fresh = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into leads (company_id, company_name, contact_name, email, phone,
                            project_description, estimated_value, city, state_province, source)
         values ($1, 'Perrysburg Storage', 'Dana Reyes', 'dana@perrysburg.test',
                 '419-555-0143', 'Pad and stone for a 60x120 shop', 84000,
                 'Perrysburg', 'OH', 'Website')
         returning id`, [company])))[0]!.id;
    });

    it('reads exactly the columns the screen selects, with the form it came through', async () => {
      const rows = await h.asUser(owner, () => h.sql<Record<string, unknown>>(
        `select l.id, l.company_name, l.contact_name, l.email, l.phone, l.city,
                l.state_province, l.project_description, l.estimated_value, l.stage,
                l.source, l.submitted_at, l.next_follow_up_at, l.notes,
                l.converted_customer_id, l.converted_at, l.created_at, f.name as form_name
           from leads l
           left join lead_intake_forms f on f.id = l.intake_form_id
          where l.id = $1`, [fresh]));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.company_name).toBe('Perrysburg Storage');
      expect(Number(rows[0]!.estimated_value)).toBe(84000);
      // Typed in by hand, so it never went through a form and has no submitted_at.
      expect(rows[0]!.form_name).toBeNull();
      expect(rows[0]!.submitted_at).toBeNull();
    });

    it('moves a stage through an ordinary update, which is all the screen does', async () => {
      await h.asUser(owner, () => h.sql(
        `update leads set stage = 'contacted' where id = $1`, [fresh]));
      const [row] = await h.asUser(owner, () => h.sql<{ stage: string }>(
        `select stage from leads where id = $1`, [fresh]));
      expect(row!.stage).toBe('contacted');
    });

    it('refuses `converted` set by hand, which is why the screen never offers it', async () => {
      /*
       * The table's own constraint requires a customer on a converted lead, and
       * the only thing that can attach one is `convert_lead`. A stage select
       * offering 'converted' would produce a check violation a person could do
       * nothing about.
       */
      await expect(h.asUser(owner, () => h.sql(
        `update leads set stage = 'converted' where id = $1`, [fresh])))
        .rejects.toThrow();
    });

    it('converts through the public function a browser can actually call', async () => {
      await h.asUser(owner, () => h.sql(
        `update leads set stage = 'qualified' where id = $1`, [fresh]));
      const [r] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `select public.convert_lead($1, 'Perrysburg Storage — pad and stone', 84000) as id`,
        [fresh]));
      const [opp] = await h.asUser(owner, () => h.sql<{ name: string; stage: string }>(
        `select name, stage from opportunities where id = $1`, [r!.id]));
      expect(opp!.name).toBe('Perrysburg Storage — pad and stone');
      const [l] = await h.asUser(owner, () => h.sql<{ stage: string; converted_customer_id: string }>(
        `select stage, converted_customer_id from leads where id = $1`, [fresh]));
      expect(l!.stage).toBe('converted');
      expect(l!.converted_customer_id).toBeTruthy();
    });

    it('is granted to a signed-in person and to nobody else', async () => {
      const [g] = await h.sql<{ authenticated: boolean; anon: boolean }>(
        `select has_function_privilege('authenticated',
                  'public.convert_lead(uuid, text, numeric)', 'execute') as authenticated,
                has_function_privilege('anon',
                  'public.convert_lead(uuid, text, numeric)', 'execute') as anon`);
      expect(g!.authenticated).toBe(true);
      expect(g!.anon).toBe(false);
    });
  });
});
