/**
 * Where a lead came from.
 *
 * Migration 0065 gave a company a public form and filed the lead under whatever
 * text was typed into `lead_intake_forms.source_label`. So "Website", "website"
 * and "web site" are three sources, and the question a company actually asks —
 * which of these is bringing work in — has no answer.
 *
 * Two things are tested harder than the rest. The guard is on the *form's*
 * label as well as the lead's, so a bad source is refused while somebody is
 * configuring a form rather than when the first real stranger uses it. And the
 * intake built in 0065 still works unchanged, because a governance rule that
 * breaks the feature it governs is worse than no rule.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('where a lead came from', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  let company = '';

  const as = <T,>(q: string, p?: unknown[]) =>
    h.asUser(owner, () => h.sql<T extends object ? T : never>(q, p));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test')
                 on conflict (id) do nothing`, [owner]);
    company = (await as<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','business') as id`))[0]!.id;
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  // ---------------------------------------------------------------------------
  describe('the list a company starts with', () => {
    it('ships sources rather than an empty picker', async () => {
      const [r] = await as<{ c: string }>(
        `select count(*)::text as c from library_categories
         where kind = 'lead_source' and company_id is null`);
      expect(Number(r!.c)).toBeGreaterThanOrEqual(12);
    });

    it('includes the one the intake already writes', async () => {
      /*
       * `lead_intake_forms.source_label` has defaulted to 'website' since 0065.
       * A platform list that did not cover it would have refused every form
       * created since — the guard compares case-insensitively, so 'Website'
       * covers it and the value a lead carries is left exactly as it was.
       */
      const [r] = await as<{ name: string }>(
        `select name from library_categories
         where kind = 'lead_source' and company_id is null and lower(name) = 'website'`);
      expect(r!.name).toBe('Website');
    });

    it('offers them through a view a picker can read', async () => {
      const [r] = await as<{ c: string }>(
        `select count(*)::text as c from my_lead_sources`);
      expect(Number(r!.c)).toBeGreaterThanOrEqual(12);
    });
  });

  // ---------------------------------------------------------------------------
  describe('the guard on a lead', () => {
    it('accepts one of the platform sources', async () => {
      const [r] = await as<{ id: string }>(
        `insert into leads (company_id, company_name, source)
         values ($1, 'Kirk Builders', 'Referral') returning id`, [company]);
      expect(r!.id).toBeTruthy();
    });

    it('refuses one that is not on the list', async () => {
      await expect(as(
        `insert into leads (company_id, company_name, source)
         values ($1, 'Kirk Builders', 'Carrier pigeon')`, [company]))
        .rejects.toThrow(/not one of your lead source options/);
    });

    it('says how to fix it rather than only that it is wrong', async () => {
      /*
       * The remedy travels in the error's `hint`, not its message — that is
       * where PostgreSQL puts "here is what to do about it", and it reaches a
       * client as a separate field rather than inside the sentence.
       */
      const err = await as(
        `insert into leads (company_id, company_name, source)
         values ($1, 'Kirk Builders', 'Carrier pigeon')`, [company])
        .then(() => null, (e: unknown) => e as { message: string; hint?: string });
      expect(err?.message).toMatch(/not one of your lead source options/);
      expect(err?.hint ?? '').toMatch(/add_library_category/);
    });

    it('accepts one the company adds for itself', async () => {
      await as(`select app.add_library_category('lead_source', 'Carrier pigeon', $1)`, [company]);
      const [r] = await as<{ id: string }>(
        `insert into leads (company_id, company_name, source)
         values ($1, 'Kirk Builders', 'Carrier pigeon') returning id`, [company]);
      expect(r!.id).toBeTruthy();
    });

    it('still allows no source at all, because ungrouped is a real answer', async () => {
      const [r] = await as<{ id: string }>(
        `insert into leads (company_id, company_name) values ($1, 'No source given')
         returning id`, [company]);
      expect(r!.id).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  describe('the guard on the form', () => {
    it('refuses a label at the moment somebody configures it', async () => {
      /*
       * The point of guarding both columns. Guarding only the lead would move
       * the failure to the first real stranger who used the form.
       */
      await expect(as(
        `insert into lead_intake_forms (company_id, name, source_label)
         values ($1, 'Bad form', 'Skywriting')`, [company]))
        .rejects.toThrow(/not one of your lead source options/);
    });

    it('accepts the default the migration shipped with', async () => {
      const [r] = await as<{ source_label: string }>(
        `insert into lead_intake_forms (company_id, name)
         values ($1, 'Contact page') returning source_label`, [company]);
      expect(r!.source_label).toBe('website');
    });

    it('leaves the value spelled the way it was written', async () => {
      const [r] = await as<{ source_label: string }>(
        `select source_label from lead_intake_forms where name = 'Contact page'`);
      expect(r!.source_label).toBe('website');
    });
  });

  // ---------------------------------------------------------------------------
  describe('the intake built in 0065 still works', () => {
    it('takes a submission and files it under the form label', async () => {
      const [f] = await as<{ public_key: string }>(
        `select public_key from lead_intake_forms where name = 'Contact page'`);
      await h.asAnon(() => h.sql(
        `select submit_lead($1, 'Rhodes Excavating', 'Dale Rhodes', 'dale@example.test')`,
        [f!.public_key]));
      const [l] = await as<{ source: string; stage: string }>(
        `select source, stage from leads where company_name = 'Rhodes Excavating'`);
      expect(l!.source).toBe('website');
      expect(l!.stage).toBe('new');
    });
  });

  // ---------------------------------------------------------------------------
  describe('counting what each source brought in', () => {
    it('counts the leads filed under one', async () => {
      const [r] = await as<{ leads_from_here: string }>(
        `select leads_from_here::text from my_lead_sources
         where name = 'Referral' and company_id is null`);
      expect(Number(r!.leads_from_here)).toBeGreaterThanOrEqual(1);
    });

    it('shows nobody anything anonymously', async () => {
      await h.asAnon(async () => {
        await expect(h.sql(`select * from my_lead_sources`)).rejects.toThrow(/permission denied/);
      });
    });
  });
});
