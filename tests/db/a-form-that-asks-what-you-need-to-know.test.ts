import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * A lead form a company writes the questions for.
 *
 * 0065 built the intake with six fixed fields and no way to ask anything else;
 * 0229 lets a company write its own questions, offer choices, and change a form
 * that is already live. The tests worth having are about the refusals, because
 * every one of them is a place the form could instead have taken a value and
 * changed nothing:
 *
 *   * an answer to a question the form does not ask
 *   * an answer that is not one of the offered choices
 *   * a required question left empty by a snippet somebody edited
 *   * a form filed under a source that is not on the company's list
 *
 * And one about what a stranger may learn: the public reader hands back a
 * form's questions and must say nothing at all about who owns it.
 */
describe('a form that asks what you need to know', () => {
  let h: Harness;
  const owner = '31111111-1111-4111-8111-111111111111';
  const guest = '32222222-2222-4222-8222-222222222222';
  let company = '';
  let formId = '';
  let key = '';

  const anon = <T,>(sql: string, params: unknown[] = []) =>
    h.asAnon(() => h.sql<T>(sql, params));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [[owner, 'fo@r.test'], [guest, 'fg@r.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2) on conflict (id) do nothing`,
        [id, email]);
    }
    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Cutbank','cutbank','business') as id`)))[0]!.id;
    await h.asUser(guest, () => h.sql(`select app.provision_company('Elsewhere','elsewhere','business')`));

    const [f] = await h.asUser(owner, () => h.sql<{ id: string; public_key: string }>(
      `insert into lead_intake_forms (company_id, name, source_label)
       values ($1,'Contact page','Website') returning id, public_key`, [company]));
    formId = f!.id;
    key = f!.public_key;
  });

  afterAll(async () => { await h?.db.close(); });

  // -------------------------------------------------------------- questions
  describe('writing the questions', () => {
    it('adds a choice question and offers exactly what was given', async () => {
      const [q] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `select app.add_lead_form_question($1,'What kind of work?','select',true,null,
           array['Site work','Demolition','Utilities']) as id`, [formId]));
      expect(q!.id).toBeTruthy();

      const [row] = await h.asUser(owner, () => h.sql<{
        label: string; kind: string; is_required: boolean; choices: string[];
      }>(`select label, kind, is_required, choices from my_lead_form_questions
           where id = $1`, [q!.id]));
      expect(row!.kind).toBe('select');
      expect(row!.is_required).toBe(true);
      expect(row!.choices).toEqual(['Site work', 'Demolition', 'Utilities']);
    });

    it('refuses a choice question with nothing to choose from', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `select app.add_lead_form_question($1,'Pick one','select')`, [formId])))
        .rejects.toThrow(/nothing to choose from/i);
    });

    it('refuses options on a question that is not a choice', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `select app.add_lead_form_question($1,'Notes','text',false,null,array['A','B'])`,
        [formId]))).rejects.toThrow(/only a choice question has options/i);
    });

    it('refuses a second question of the same name on one form', async () => {
      await h.asUser(owner, () => h.sql(
        `select app.add_lead_form_question($1,'When do you need it?','text')`, [formId]));
      await expect(h.asUser(owner, () => h.sql(
        `select app.add_lead_form_question($1,'when do you NEED it?','text')`, [formId])))
        .rejects.toThrow();
    });

    it('lets a company add an option to a live question', async () => {
      const [q] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `select id from my_lead_form_questions where form_id = $1 and kind = 'select'`,
        [formId]));
      await h.asUser(owner, () => h.sql(
        `select app.add_lead_form_choice($1,'Grading')`, [q!.id]));
      const [row] = await h.asUser(owner, () => h.sql<{ choices: string[] }>(
        `select choices from my_lead_form_questions where id = $1`, [q!.id]));
      expect(row!.choices).toContain('Grading');
    });

    it('refuses an option the question already offers', async () => {
      const [q] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `select id from my_lead_form_questions where form_id = $1 and kind = 'select'`,
        [formId]));
      await expect(h.asUser(owner, () => h.sql(
        `select app.add_lead_form_choice($1,'  grading ')`, [q!.id])))
        .rejects.toThrow(/already offers/i);
    });

    it('will not let another company touch the questions', async () => {
      await expect(h.asUser(guest, () => h.sql(
        `select app.add_lead_form_question($1,'Sneaked in','text')`, [formId])))
        .rejects.toThrow();
    });
  });

  // ------------------------------------------------------------- the form
  describe('changing a form that is already live', () => {
    it('writes the three columns that had no writer since 0065', async () => {
      const [f] = await h.asUser(owner, () => h.sql<{
        name: string; max_per_hour_per_form: number;
        max_per_hour_per_address: number; redirect_url: string | null;
      }>(`select name, max_per_hour_per_form, max_per_hour_per_address, redirect_url
            from app.set_lead_form($1,'Estimate request',null,120,10,'https://3rdterrain.com/thanks')`,
        [formId]));
      expect(f!.name).toBe('Estimate request');
      expect(f!.max_per_hour_per_form).toBe(120);
      expect(f!.max_per_hour_per_address).toBe(10);
      expect(f!.redirect_url).toBe('https://3rdterrain.com/thanks');
    });

    it('clears the redirect only when told to, not by passing nothing', async () => {
      const [kept] = await h.asUser(owner, () => h.sql<{ redirect_url: string | null }>(
        `select redirect_url from app.set_lead_form($1,'Estimate request')`, [formId]));
      expect(kept!.redirect_url).toBe('https://3rdterrain.com/thanks');

      const [cleared] = await h.asUser(owner, () => h.sql<{ redirect_url: string | null }>(
        `select redirect_url from app.set_lead_form($1,null,null,null,null,null,true)`, [formId]));
      expect(cleared!.redirect_url).toBeNull();
    });

    it('refuses a redirect that is not a web address', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `select app.set_lead_form($1,null,null,null,null,'javascript:alert(1)')`, [formId])))
        .rejects.toThrow(/http:\/\/ or https:\/\//i);
    });

    it('refuses a source that is not on the company list', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `select app.set_lead_form($1,null,'Skywriting')`, [formId])))
        .rejects.toThrow(/no lead source called/i);
    });
  });

  // ------------------------------------------------------------- answering
  describe('answering them', () => {
    const contact = `'Cutbank test','Dana','d@x.test'`;

    const questionId = async (label: string) => {
      const [q] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `select id from my_lead_form_questions where form_id = $1 and label = $2`,
        [formId, label]));
      return q!.id;
    };

    it('stores the answer beside the lead, with the question as it was asked', async () => {
      const kind = await questionId('What kind of work?');
      const [r] = await anon<{ ok: boolean }>(
        `select public.submit_lead($1,${contact},null,null,null,null,null,
           jsonb_build_object($2::text,'Utilities')) as ok`, [key, kind]);
      expect(r!.ok).toBe(true);

      const [a] = await h.asUser(owner, () => h.sql<{ label: string; answer: string }>(
        `select a.label, a.answer from my_lead_answers a
          join leads l on l.id = a.lead_id
         where l.intake_form_id = $1 and a.question_id = $2
         order by a.created_at desc limit 1`, [formId, kind]));
      expect(a!.label).toBe('What kind of work?');
      expect(a!.answer).toBe('Utilities');
    });

    it('stores the company spelling, not the sender’s', async () => {
      const kind = await questionId('What kind of work?');
      await anon(`select public.submit_lead($1,'Case test','D','c@x.test',null,null,null,null,null,
           jsonb_build_object($2::text,'utilities'))`, [key, kind]);
      const [a] = await h.asUser(owner, () => h.sql<{ answer: string }>(
        `select a.answer from my_lead_answers a join leads l on l.id = a.lead_id
          where l.company_name = 'Case test' and a.question_id = $1`, [kind]));
      expect(a!.answer).toBe('Utilities');
    });

    it('refuses an answer to a question the form does not ask', async () => {
      await expect(anon(
        `select public.submit_lead($1,${contact},null,null,null,null,null,
           jsonb_build_object('budget','a lot'))`, [key]))
        .rejects.toThrow(/does not ask/i);
    });

    it('refuses an answer that is not one of the choices', async () => {
      const kind = await questionId('What kind of work?');
      await expect(anon(
        `select public.submit_lead($1,${contact},null,null,null,null,null,
           jsonb_build_object($2::text,'Roofing'))`, [key, kind]))
        .rejects.toThrow(/not one of the choices/i);
    });

    it('refuses a required question left empty, however the page was edited', async () => {
      await expect(anon(
        `select public.submit_lead($1,${contact},null,null,null,null,null,'{}'::jsonb)`, [key]))
        .rejects.toThrow(/answer what kind of work/i);
    });

    it('writes no lead at all when an answer is refused', async () => {
      const before = await h.asUser(owner, () => h.sql<{ n: string }>(
        `select count(*) as n from leads where intake_form_id = $1`, [formId]));
      await expect(anon(
        `select public.submit_lead($1,'Rolled back','D','r@x.test',null,null,null,null,null,
           jsonb_build_object('budget','a lot'))`, [key])).rejects.toThrow();
      const after = await h.asUser(owner, () => h.sql<{ n: string }>(
        `select count(*) as n from leads where intake_form_id = $1`, [formId]));
      expect(after[0]!.n).toBe(before[0]!.n);
    });

    it('answers a robot like a success and writes nothing', async () => {
      const [r] = await anon<{ ok: boolean }>(
        `select public.submit_lead($1,'Robot','D','b@x.test',null,null,null,null,'http://spam',
           jsonb_build_object('budget','nonsense')) as ok`, [key]);
      expect(r!.ok).toBe(true);
      const rows = await h.asUser(owner, () => h.sql(
        `select 1 from leads where company_name = 'Robot'`));
      expect(rows).toEqual([]);
    });
  });

  // --------------------------------------------------------- what a stranger learns
  describe('what the public reader gives away', () => {
    it('hands back the questions and their choices', async () => {
      const rows = await anon<{ label: string; kind: string; choices: string[] }>(
        `select label, kind, choices from public.lead_form_questions($1) order by sort_order`,
        [key]);
      expect(rows.map((r) => r.label)).toContain('What kind of work?');
      const pick = rows.find((r) => r.kind === 'select');
      expect(pick!.choices).toContain('Site work');
    });

    it('says nothing about the company that owns the form', async () => {
      const cols = await h.sql<{ parameter_name: string }>(
        `select p.parameter_name from information_schema.parameters p
          where p.specific_schema = 'public'
            and p.specific_name like 'lead_form_questions%'
            and p.parameter_mode = 'TABLE'`);
      const names = cols.map((c) => c.parameter_name);
      expect(names).not.toContain('company_id');
      expect(names).not.toContain('form_id');
    });

    it('answers an unknown key exactly like a switched-off form', async () => {
      const unknown = await anon(`select * from public.lead_form_questions('nope-no-such-key')`);
      await h.asUser(owner, () => h.sql(
        `update lead_intake_forms set is_active = false where id = $1`, [formId]));
      const off = await anon(`select * from public.lead_form_questions($1)`, [key]);
      await h.asUser(owner, () => h.sql(
        `update lead_intake_forms set is_active = true where id = $1`, [formId]));
      expect(unknown).toEqual([]);
      expect(off).toEqual([]);
    });

    it('lets a stranger read none of the three new tables', async () => {
      for (const table of ['lead_form_questions', 'lead_form_choices', 'lead_answers']) {
        const rows = await anon(`select 1 from ${table} limit 1`).catch(() => []);
        expect(rows, `anon can read ${table}`).toEqual([]);
      }
    });
  });
});
