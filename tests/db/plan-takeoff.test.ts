/**
 * A drawing becomes a quantity.
 *
 * `ai-analyze-document` has existed since migration 0019 and could not be
 * reached: it takes a `documentVersionId`, and nothing in this platform ever
 * created one. There was no upload, so no document, so no version to analyze.
 * The most-asked-for thing in estimating — hand it the plans, get quantities
 * back — was a working Edge Function with no door.
 *
 * The property that carries the weight is RULE-008, and it is worth being
 * precise about what it means here. The model proposes; a person accepts; the
 * line records that it came from AI and who accepted it. The model's own
 * confidence never becomes the line's, because line confidence is the engine's
 * to compute — a number the model scored itself is not evidence about an
 * estimate.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('a drawing becomes a quantity', () => {
  let h: Harness;
  const chief = '11111111-1111-4111-8111-111111111111';
  const rival = '22222222-2222-4222-8222-222222222222';
  let company = '';
  let rivalCompany = '';
  let version = '';
  let documentVersion = '';
  let n = 0;

  const asChief = <T,>(q: string, p?: unknown[]) =>
    h.asUser(chief, () => h.sql<T extends object ? T : never>(q, p));

  /** A finding of the shape `ai-analyze-document` writes. */
  const finding = (over: Record<string, unknown> = {}) =>
    asChief<{ id: string }>(
      `insert into ai_findings (company_id, agent_id, document_id, document_version_id,
                                finding_type, title, description, payload, citations,
                                sheet_references, confidence, model, prompt_version)
       select $1, 'AGT-DOC', dv.document_id, dv.id, $2, $3, $4, $5::jsonb,
              '[{"sheet":"C-101","quote":"120 LF of 12in RCP"}]'::jsonb,
              array['C-101'], $6, 'claude-opus-5', 'v1'
         from document_versions dv where dv.id = $7
       returning id`,
      [company,
       over.finding_type ?? 'quantity_candidate',
       over.title ?? `Storm sewer, 12in RCP ${++n}`,
       over.description ?? 'Taken from the dimensioned run on C-101.',
       JSON.stringify(over.payload ?? { quantity: 120, unit: 'LF', method: 'dimensioned' }),
       over.confidence ?? 88,
       documentVersion]).then((r) => r[0]!.id);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, mail] of [[chief, 'chief@ridge.test'], [rival, 'r@kesler.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, mail]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, mail]);
    }
    company = (await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    rivalCompany = (await h.asUser(rival, () => h.sql<{ id: string }>(
      `select app.provision_company('Kesler','kesler','enterprise') as id`)))[0]!.id;

    const e = (await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.create_estimate('Plan takeoff', null, null, null, $1) as id`,
      [company])))[0]!.id;
    version = (await h.asUser(chief, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [e])))[0]!.v;

    documentVersion = (await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.register_document_version($1,'Bid set',$2,'plans.pdf',
              'application/pdf', 4200000, 'plan_set', null, 42) as id`,
      [company, `${company}/bid-set.pdf`])))[0]!.id;
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  describe('registering an upload', () => {
    it('refuses a path that does not belong to the company', async () => {
      /*
       * The storage policy decides whose file an object is from the first path
       * segment. A row pointing anywhere else is a document the platform lists
       * and nobody can open.
       */
      await expect(asChief(
        `select app.register_document_version($1,'Bid set','somebody-else/plans.pdf','plans.pdf')`,
        [company])).rejects.toThrow(/does not belong to this company/i);
    });

    it('files the document and its first version together', async () => {
      const id = (await asChief<{ id: string }>(
        `select app.register_document_version($1,'Bid set',$2,'plans.pdf',
                'application/pdf',4200000,'plan_set',null,42) as id`,
        [company, `${company}/plans.pdf`]))[0]!.id;
      const [r] = await asChief<{ file_name: string; version_number: number;
                                  current_version: number; page_count: number }>(
        `select dv.file_name, dv.version_number, d.current_version, dv.page_count
           from document_versions dv join documents d on d.id = dv.document_id
          where dv.id = $1`, [id]);
      expect(r!.file_name).toBe('plans.pdf');
      expect(r!.version_number).toBe(1);
      expect(r!.current_version).toBe(1);
      expect(r!.page_count).toBe(42);
      documentVersion = id;
    });

    it('shows it on the list a screen reads, with nothing found yet', async () => {
      const [r] = await asChief<{ finding_count: string; awaiting_review: string }>(
        `select finding_count, awaiting_review from my_documents
          where current_version_id = $1`, [documentVersion]);
      expect(Number(r!.finding_count)).toBe(0);
      expect(Number(r!.awaiting_review)).toBe(0);
    });

    it("refuses an estimate that is not the company's", async () => {
      const theirs = (await h.asUser(rival, () => h.sql<{ id: string }>(
        `select app.create_estimate('Theirs', null, null, null, $1) as id`,
        [rivalCompany])))[0]!.id;
      await expect(asChief(
        `select app.register_document_version($1,'Bid set',$2,'p.pdf',null,null,'plan_set',$3)`,
        [company, `${company}/p2.pdf`, theirs])).rejects.toThrow(/not one of yours/i);
    });
  });

  describe('accepting a quantity the model found', () => {
    it('becomes a line carrying the quantity and the unit', async () => {
      const f = await finding();
      const lineId = (await asChief<{ id: string }>(
        `select app.accept_finding_as_line($1,$2,'Checked against the profile on C-501') as id`,
        [f, version]))[0]!.id;
      const [l] = await asChief<{ description: string; measured_quantity: string; unit: string }>(
        `select description, measured_quantity, unit::text
           from estimate_line_items where id = $1`, [lineId]);
      expect(Number(l!.measured_quantity)).toBe(120);
      expect(l!.unit).toBe('LF');
      expect(l!.description).toMatch(/Storm sewer/);
    });

    it('records that it came from AI and who accepted it', async () => {
      const f = await finding();
      const lineId = (await asChief<{ id: string }>(
        `select app.accept_finding_as_line($1,$2) as id`, [f, version]))[0]!.id;
      const [l] = await asChief<{ origin: string; ai_agent_id: string;
                                  ai_accepted_by: string; refs: string[] }>(
        `select origin, ai_agent_id, ai_accepted_by, source_references as refs
           from estimate_line_items where id = $1`, [lineId]);
      expect(l!.origin).toBe('ai_suggested');
      expect(l!.ai_agent_id).toBe('AGT-DOC');
      expect(l!.ai_accepted_by).toBe(chief);
      expect(l!.refs).toEqual(['C-101']);
    });

    it("does not carry the model's confidence onto the line", async () => {
      /*
       * RULE-008 in the place it matters most. The model scored itself 88; the
       * line's confidence is the engine's to compute from the rate, the sources
       * and the checks. A model's self-assessment is not evidence about an
       * estimate, and letting it set the line's score would make every AI line
       * look verified.
       */
      const f = await finding({ confidence: 99 });
      const lineId = (await asChief<{ id: string }>(
        `select app.accept_finding_as_line($1,$2) as id`, [f, version]))[0]!.id;
      const [l] = await asChief<{ confidence_score: string; band: string; cost: string }>(
        `select confidence_score, confidence_band::text as band, total_direct_cost as cost
           from estimate_line_items where id = $1`, [lineId]);
      expect(Number(l!.confidence_score)).toBe(0);
      expect(l!.band).toBe('do_not_price');
      expect(Number(l!.cost)).toBe(0);
    });

    it('marks the finding accepted and points it at the line it became', async () => {
      const f = await finding();
      const lineId = (await asChief<{ id: string }>(
        `select app.accept_finding_as_line($1,$2) as id`, [f, version]))[0]!.id;
      const [r] = await asChief<{ state: string; reviewed_by: string;
                                  applied_entity_table: string; applied_entity_id: string }>(
        `select state, reviewed_by, applied_entity_table, applied_entity_id
           from ai_findings where id = $1`, [f]);
      expect(r!.state).toBe('accepted');
      expect(r!.reviewed_by).toBe(chief);
      expect(r!.applied_entity_table).toBe('estimate_line_items');
      expect(r!.applied_entity_id).toBe(lineId);
    });

    it('refuses to accept the same finding twice', async () => {
      const f = await finding();
      await asChief(`select app.accept_finding_as_line($1,$2)`, [f, version]);
      await expect(asChief(`select app.accept_finding_as_line($1,$2)`, [f, version]))
        .rejects.toThrow(/already been accepted/i);
    });

    it('refuses a finding that is not a quantity', async () => {
      const f = await finding({ finding_type: 'scope_item', payload: {} });
      await expect(asChief(`select app.accept_finding_as_line($1,$2)`, [f, version]))
        .rejects.toThrow(/only a quantity candidate/i);
    });

    it('refuses a quantity candidate with no usable quantity', async () => {
      const f = await finding({ payload: { unit: 'LF' } });
      await expect(asChief(`select app.accept_finding_as_line($1,$2)`, [f, version]))
        .rejects.toThrow(/no usable quantity/i);
    });

    it("refuses to put another company's finding on this estimate", async () => {
      const f = await finding();
      const theirs = (await h.asUser(rival, () => h.sql<{ id: string }>(
        `select app.create_estimate('Theirs', null, null, null, $1) as id`,
        [rivalCompany])))[0]!.id;
      const theirVersion = (await h.asUser(rival, () => h.sql<{ v: string }>(
        `select current_version_id as v from estimates where id = $1`, [theirs])))[0]!.v;
      await expect(h.asUser(rival, () => h.sql(
        `select app.accept_finding_as_line($1,$2)`, [f, theirVersion])))
        .rejects.toThrow(/no such finding/i);
    });

    it('refuses a version that is no longer open', async () => {
      const f = await finding();
      const e = (await asChief<{ id: string }>(
        `select app.create_estimate('Frozen', null, null, null, $1) as id`, [company]))[0]!.id;
      const v = (await asChief<{ v: string }>(
        `select current_version_id as v from estimates where id = $1`, [e]))[0]!.v;
      await h.asService(() => h.sql(
        `update estimate_versions set status = 'archived' where id = $1`, [v]));
      await expect(asChief(`select app.accept_finding_as_line($1,$2)`, [f, v]))
        .rejects.toThrow(/make a new version/i);
    });
  });

  describe('setting one aside', () => {
    it('records why it was not used', async () => {
      const f = await finding();
      await asChief(`select app.reject_finding($1,'Already in the sitework allowance')`, [f]);
      const [r] = await asChief<{ state: string; review_note: string }>(
        `select state, review_note from ai_findings where id = $1`, [f]);
      expect(r!.state).toBe('rejected');
      expect(r!.review_note).toMatch(/sitework allowance/);
    });

    it('refuses to set one aside silently', async () => {
      const f = await finding();
      await expect(asChief(`select app.reject_finding($1,'no')`, [f]))
        .rejects.toThrow(/say why this was not used/i);
    });
  });

  describe('what a screen reads', () => {
    it('lifts the quantity and unit out of the payload', async () => {
      const f = await finding();
      const [r] = await asChief<{ quantity: string; unit: string; method: string;
                                  sheet_references: string[]; document_name: string }>(
        `select quantity, unit, method, sheet_references, document_name
           from my_ai_findings where id = $1`, [f]);
      expect(Number(r!.quantity)).toBe(120);
      expect(r!.unit).toBe('LF');
      expect(r!.method).toBe('dimensioned');
      expect(r!.sheet_references).toEqual(['C-101']);
      expect(r!.document_name).toBe('Bid set');
    });

    it('counts what is still waiting on a person', async () => {
      const [r] = await asChief<{ finding_count: string; awaiting_review: string }>(
        `select finding_count, awaiting_review from my_documents
          where current_version_id = $1`, [documentVersion]);
      expect(Number(r!.finding_count)).toBeGreaterThan(0);
      expect(Number(r!.awaiting_review)).toBeLessThan(Number(r!.finding_count));
    });

    it("shows one company nothing of another's", async () => {
      const rows = await h.asUser(rival, () => h.sql(`select id from my_ai_findings`));
      expect(rows).toEqual([]);
      const docs = await h.asUser(rival, () => h.sql(`select id from my_documents`));
      expect(docs).toEqual([]);
    });
  });
});
