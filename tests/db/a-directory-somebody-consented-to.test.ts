/**
 * A directory somebody consented to.
 *
 * `network_vendors` and `network_ratings` are the only deliberately cross-tenant
 * tables in this schema — a published listing is readable by every company on
 * the platform, because a directory one company can see is not a directory. They
 * have existed since 0023 with no writer and no reader, and the Network screen
 * has been showing five invented vendors on a live route the whole time.
 *
 * The two refusals worth more than the rest:
 *
 *   * **Nothing is published without recorded consent.** Another company's legal
 *     name, contact details and insurance status become visible to everybody.
 *   * **Nobody rates their own listing.** RLS checks a company rates *as
 *     itself* and stops there — it never stopped a company listing a sub and
 *     giving it five stars, in a directory other contractors hire from.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '5c9c9c9c-9c9c-4c9c-8c9c-9c9c9c9c9c9c';
const OTHER = '6d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d';

describe('a directory somebody consented to', () => {
  let h: Harness;
  let mine = '';
  let theirs = '';
  let listing = '';

  const asOwner = <T>(fn: () => Promise<T>) => h.asUser(OWNER, fn);
  const one = <T>(sql: string, args: unknown[] = []) =>
    asOwner(() => h.sql<T>(sql, args)).then((r) => r[0]!);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [[OWNER, 'o@net.test'], [OTHER, 't@net.test']]) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, email]);
    }
    mine = (await asOwner(() => h.sql<{ id: string }>(
      `select app.provision_company('Net Civil','net-civil','enterprise') as id`)))[0]!.id;
    theirs = (await h.asUser(OTHER, () => h.sql<{ id: string }>(
      `select app.provision_company('Other Civil','other-net','enterprise') as id`)))[0]!.id;
  }, 180_000);

  describe('the listing', () => {
    it('starts private to the company that made it', async () => {
      listing = (await one<{ id: string }>(
        `select public.list_network_vendor($1,'Maumee Concrete LLC','Maumee Concrete',
           array['Concrete','Flatwork'], array['Lucas County'],'Toledo','OH',
           null,null,null,'2027-06-30',500000,false,false,true) as id`, [mine])).id;
      const row = await one<{ is_published: boolean; consent_on_record: boolean }>(
        `select is_published, consent_on_record from my_network_vendors where id = $1`,
        [listing]);
      expect(row.is_published).toBe(false);
      expect(row.consent_on_record).toBe(false);
    });

    it('is invisible to every other company while it is a draft', async () => {
      const rows = await h.asUser(OTHER, () => h.sql(
        `select id from my_network_vendors where id = $1`, [listing]));
      expect(rows).toHaveLength(0);
    });

    it('refuses to publish without their consent on record', async () => {
      // Their legal name, contacts and insurance become readable by everybody.
      await expect(asOwner(() => h.sql(
        `select public.publish_network_vendor($1)`, [listing])))
        .rejects.toThrow(/needs their consent on record first/);
    });

    it('refuses a consent record that does not say how they agreed', async () => {
      await expect(asOwner(() => h.sql(
        `select public.record_network_consent($1,'ok')`, [listing])))
        .rejects.toThrow(/Say how the vendor agreed/);
    });

    it('records who claimed the consent, when, and in what words', async () => {
      await asOwner(() => h.sql(
        `select public.record_network_consent($1,'Signed listing form returned 3 March 2026')`,
        [listing]));
      const row = await one<{ consent_note: string; consent_recorded_at: string }>(
        `select consent_note, consent_recorded_at from my_network_vendors where id = $1`,
        [listing]);
      expect(row.consent_note).toBe('Signed listing form returned 3 March 2026');
      expect(row.consent_recorded_at).not.toBeNull();
      const [who] = await asOwner(() => h.sql<{ consent_recorded_by: string }>(
        `select consent_recorded_by from network_vendors where id = $1`, [listing]));
      /* A person putting their name to the claim is what makes it worth anything. */
      expect(who!.consent_recorded_by).toBe(OWNER);
    });

    it('publishes once consent is on file, and every company can then see it', async () => {
      await asOwner(() => h.sql(`select public.publish_network_vendor($1)`, [listing]));
      const seen = await h.asUser(OTHER, () => h.sql<{ display_name: string; is_mine: boolean }>(
        `select display_name, is_mine from my_network_vendors where id = $1`, [listing]));
      expect(seen).toHaveLength(1);
      expect(seen[0]!.display_name).toBe('Maumee Concrete');
      expect(seen[0]!.is_mine).toBe(false);
    });

    it('can be taken back down', async () => {
      await asOwner(() => h.sql(`select public.publish_network_vendor($1,false)`, [listing]));
      const gone = await h.asUser(OTHER, () => h.sql(
        `select id from my_network_vendors where id = $1`, [listing]));
      expect(gone).toHaveLength(0);
      await asOwner(() => h.sql(`select public.publish_network_vendor($1,true)`, [listing]));
    });

    it('will not list the same vendor twice', async () => {
      await expect(asOwner(() => h.sql(
        `select public.list_network_vendor($1,'Maumee Concrete LLC')`, [mine])))
        .rejects.toThrow(/already list Maumee Concrete LLC/);
    });

    it('says how long the insurance has left rather than leaving two dates', async () => {
      const row = await one<{ insurance_lapsed: boolean; days_until_insurance_lapses: number }>(
        `select insurance_lapsed, days_until_insurance_lapses
           from my_network_vendors where id = $1`, [listing]);
      expect(row.insurance_lapsed).toBe(false);
      expect(Number(row.days_until_insurance_lapses)).toBeGreaterThan(0);
    });
  });

  describe('the ratings', () => {
    it('refuses a company rating a listing it owns', async () => {
      // Nothing in the schema stopped this, and it is the failure that would
      // make the whole directory worthless.
      await expect(asOwner(() => h.sql(
        `select public.rate_network_vendor($1,$2,5,5,5,5,true)`, [listing, mine])))
        .rejects.toThrow(/cannot rate a listing you own/);
    });

    it('takes a rating from a company that worked with them', async () => {
      const id = (await h.asUser(OTHER, () => h.sql<{ id: string }>(
        `select public.rate_network_vendor($1,$2,5,4,5,3,true,null,
           'Flatwork crew was on time every day; paperwork was slow') as id`,
        [listing, theirs])))[0]!.id;
      const row = await one<{ overall: string; rating_count: number }>(
        `select r.overall, v.rating_count from my_network_ratings r
           join my_network_vendors v on v.id = r.network_vendor_id
          where r.id = $1`, [id]);
      /* Generated from the four, so it cannot disagree with them. */
      expect(Number(row.overall)).toBeCloseTo(4.25, 2);
      expect(Number(row.rating_count)).toBe(1);
    });

    it('will not take a second rating for the same job', async () => {
      await expect(h.asUser(OTHER, () => h.sql(
        `select public.rate_network_vendor($1,$2,1,1,1,1,false)`, [listing, theirs])))
        .rejects.toThrow(/already rated Maumee Concrete for that job/);
    });

    it('will not be edited afterwards', async () => {
      /*
       * A rating somebody can quietly revise after a dispute is not a record.
       *
       * 0024 left the update policy off deliberately, so the write does not
       * raise — it matches no row and changes nothing. Asserting the value is
       * untouched is the honest check: "it threw" would have passed for the
       * wrong reason the day somebody added a policy.
       */
      await h.asUser(OTHER, () => h.sql(
        `update network_ratings set quality = 1 where rating_company_id = $1`, [theirs]));
      const [row] = await h.asUser(OTHER, () => h.sql<{ quality: number }>(
        `select quality from network_ratings where rating_company_id = $1`, [theirs]));
      expect(Number(row!.quality)).toBe(5);
    });

    it('does not tell other companies who left it', async () => {
      /*
       * A rating carries weight because it is on the record, not because the
       * reader knows which contractor left it. Naming them turns a directory
       * into a place people settle scores.
       */
      const row = await one<{ project_number: string | null; is_mine: boolean }>(
        `select project_number, is_mine from my_network_ratings
          where network_vendor_id = $1`, [listing]);
      expect(row.is_mine).toBe(false);
      expect(row.project_number).toBeNull();
    });

    it('will not let a stranger rate an unpublished listing, or learn it exists', async () => {
      /*
       * The refusal comes back as "No such listing" rather than "that is not
       * published", and that is the better answer: row level security hides the
       * draft from every other company, so the function cannot see it either.
       * Telling a stranger it exists but is unpublished would leak which subs a
       * competitor is quietly evaluating.
       */
      const draft = (await one<{ id: string }>(
        `select public.list_network_vendor($1,'Unpublished Excavating') as id`, [mine])).id;
      await expect(h.asUser(OTHER, () => h.sql(
        `select public.rate_network_vendor($1,$2,5,5,5,5,true)`, [draft, theirs])))
        .rejects.toThrow(/No such listing/);

      /* And the owner's own attempt is refused on its merits, with the reason. */
      await asOwner(() => h.sql(`select public.record_network_consent($1,
        'Verbal agreement with their owner, 14 March 2026')`, [draft]));
      await expect(h.asUser(OTHER, () => h.sql(
        `select public.rate_network_vendor($1,$2,5,5,5,5,true)`, [draft, theirs])))
        .rejects.toThrow(/No such listing/);
    });

    it('averages with the count beside it, never on its own', async () => {
      const row = await one<{ average_overall: string; rating_count: number }>(
        `select average_overall, rating_count from my_network_vendors where id = $1`,
        [listing]);
      // One rating shown as a score has more authority than it has earned, so
      // the count travels with it everywhere.
      /* Rounded to one place: a subcontractor scores 4.3, not 4.25. */
      expect(Number(row.average_overall)).toBeCloseTo(4.3, 2);
      expect(Number(row.rating_count)).toBe(1);
    });
  });
});
