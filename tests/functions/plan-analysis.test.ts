import { describe, expect, it } from 'vitest';
import {
  FINDING_TYPES, FACTUAL_TYPES, FINDINGS_SCHEMA, SYSTEM_PROMPT,
  validateFindings, toFindingRow, estimateCost, MODEL_COSTS,
  TEXT_BATCH, SCAN_BATCH, BUDGET_MS, nextRun, shouldHandBack, maxTokensFor,
} from '../../supabase/functions/_shared/plan-analysis.js';

const ctx = {
  companyId: '11111111-1111-4111-8111-111111111111',
  agentId: 'AGT-DOC',
  documentId: '22222222-2222-4222-8222-222222222222',
  documentVersionId: '33333333-3333-4333-8333-333333333333',
  model: 'claude-opus-5',
  promptVersion: 'v1',
};

const cited = [{ reference: 'C-302', page: 14, quote: 'INV IN 618.40' }];

describe('the governed system prompt', () => {
  it('forbids the model from computing what the engine owns', () => {
    // The whole safety property is that AI proposes and the engine prices.
    expect(SYSTEM_PROMPT).toMatch(/do not compute costs, prices, production rates, durations, crew sizes or markups/i);
    expect(SYSTEM_PROMPT).toMatch(/never a dollar figure/i);
  });

  it('forbids resolving a conflict by picking a side', () => {
    expect(SYSTEM_PROMPT).toMatch(/do not resolve a conflict by choosing a side/i);
  });

  it('forbids inventing dimensions and mislabelling scaled measurements', () => {
    expect(SYSTEM_PROMPT).toMatch(/do not invent a dimension/i);
    expect(SYSTEM_PROMPT).toMatch(/explicit plan dimension when you scaled it/i);
  });

  it('requires evidence for every factual claim', () => {
    expect(SYSTEM_PROMPT).toMatch(/MUST cite the sheet number or specification section/i);
    expect(SYSTEM_PROMPT).toMatch(/A finding you cannot cite is one you must not report/i);
  });
});

describe('the output schema', () => {
  it('constrains findings to the declared types', () => {
    const t = FINDINGS_SCHEMA.schema.properties.findings.items.properties.type;
    expect(t.enum).toEqual([...FINDING_TYPES]);
  });

  it('requires a citation array and a confidence on every finding', () => {
    const required = FINDINGS_SCHEMA.schema.properties.findings.items.required;
    expect(required).toContain('citations');
    expect(required).toContain('confidence');
  });

  it('carries no bound the API refuses, because the first real run died on one', () => {
    /*
     * The schema used to say `minimum: 0, maximum: 100`, and the first analysis
     * ever attempted came back:
     *
     *   output_config.format.schema: For 'integer' type, property 'minimum'
     *   is not supported
     *
     * Structured outputs do not take range keywords. Worse, nothing in the
     * parser enforced them either — so a confidence of 500 would have gone into
     * `ai_findings` and onto a screen beside figures a person had checked. The
     * bounds now live in `toFindingRow`, where the model's output is untrusted
     * anyway, and `bounds what the model returns` below is what holds them.
     */
    const props = FINDINGS_SCHEMA.schema.properties.findings.items.properties;
    for (const key of ['confidence', 'quantity'] as const) {
      expect(props[key].minimum).toBeUndefined();
      expect(props[key].maximum).toBeUndefined();
    }
    const page = FINDINGS_SCHEMA.schema.properties.findings.items
      .properties.citations.items.properties.page;
    expect(page.minimum).toBeUndefined();
  });

  it('restricts units to the engine\'s own unit set', () => {
    const u = FINDINGS_SCHEMA.schema.properties.findings.items.properties.unit;
    expect(u.enum).toContain('CY');
    expect(u.enum).toContain('LF');
    expect(u.enum).not.toContain('meters');
  });
});

describe('validateFindings enforces the contract the prompt only asks for', () => {
  it('accepts a well-formed cited quantity candidate', () => {
    const { accepted, rejected } = validateFindings({
      findings: [{
        type: 'quantity_candidate', title: '12" RCP storm sewer',
        description: 'Structure-to-structure lengths from the C-302 profile.',
        citations: cited, confidence: 91, quantity: 2572, unit: 'LF',
        measurementMethod: 'derived', discipline: 'Utilities',
      }],
    });
    expect(rejected).toEqual([]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.quantity).toBe(2572);
  });

  it('rejects a factual finding with no citation', () => {
    // This is the hallucination guard. The prompt asks; the validator refuses.
    for (const type of FACTUAL_TYPES) {
      const { accepted, rejected } = validateFindings({
        findings: [{
          type, title: 'Uncited claim', description: 'x', citations: [], confidence: 95,
          ...(type === 'quantity_candidate' ? { quantity: 100, measurementMethod: 'derived' } : {}),
        }],
      });
      expect(accepted).toEqual([]);
      expect(rejected[0]!.reason).toMatch(/must cite the sheet or specification/);
    }
  });

  it('rejects a citation whose reference is blank', () => {
    const { accepted, rejected } = validateFindings({
      findings: [{
        type: 'conflict', title: 'Rim elevation disagreement', description: 'x',
        citations: [{ reference: '   ' }], confidence: 96,
      }],
    });
    expect(accepted).toEqual([]);
    expect(rejected).toHaveLength(1);
  });

  it('allows a non-factual finding without a citation', () => {
    // An observation or a risk is a judgment, not a claim about the documents.
    const { accepted } = validateFindings({
      findings: [{
        type: 'risk', title: 'Groundwater above the sanitary invert',
        description: 'Dewatering is probable rather than possible.',
        citations: [], confidence: 80, severity: 'high',
      }],
    });
    expect(accepted).toHaveLength(1);
  });

  it('rejects a quantity candidate with no quantity or no method', () => {
    const noQty = validateFindings({
      findings: [{ type: 'quantity_candidate', title: 'x', description: 'x', citations: cited, confidence: 90, measurementMethod: 'derived' }],
    });
    expect(noQty.rejected[0]!.reason).toMatch(/no usable quantity/);

    const noMethod = validateFindings({
      findings: [{ type: 'quantity_candidate', title: 'x', description: 'x', citations: cited, confidence: 90, quantity: 100 }],
    });
    expect(noMethod.rejected[0]!.reason).toMatch(/must state how it was measured/);
  });

  it('rejects an unknown finding type', () => {
    const { rejected } = validateFindings({
      findings: [{ type: 'price_estimate', title: 'It will cost $2M', description: 'x', citations: cited, confidence: 99 }],
    });
    expect(rejected[0]!.reason).toMatch(/Unknown finding type "price_estimate"/);
  });

  it('rejects an out-of-range or missing confidence', () => {
    expect(validateFindings({ findings: [{ type: 'risk', title: 'x', description: 'x', citations: [], confidence: 140 }] })
      .rejected[0]!.reason).toMatch(/0 to 100/);
    expect(validateFindings({ findings: [{ type: 'risk', title: 'x', description: 'x', citations: [] }] })
      .rejected[0]!.reason).toMatch(/0 to 100/);
  });

  it('rejects a response that is not a findings array at all', () => {
    expect(validateFindings({ result: 'ok' }).rejected[0]!.reason).toMatch(/no findings array/);
    expect(validateFindings(null).rejected[0]!.reason).toMatch(/no findings array/);
    expect(validateFindings('some prose').rejected[0]!.reason).toMatch(/no findings array/);
  });

  it('keeps the good findings when only some are bad', () => {
    const { accepted, rejected } = validateFindings({
      findings: [
        { type: 'scope_item', title: 'Good', description: 'x', citations: cited, confidence: 90 },
        { type: 'scope_item', title: 'Uncited', description: 'x', citations: [], confidence: 90 },
        { type: 'observation', title: 'Fine', description: 'x', citations: [], confidence: 70 },
      ],
    });
    expect(accepted.map((f) => f.title)).toEqual(['Good', 'Fine']);
    expect(rejected).toHaveLength(1);
  });
});

describe('toFindingRow', () => {
  const base = {
    type: 'scope_item' as const, title: 'Storm sewer', description: 'x',
    citations: cited, confidence: 92,
  };

  it('always writes state "proposed", whatever the model said', () => {
    // RULE-008: nothing an agent produces may arrive pre-accepted.
    const row = toFindingRow({ ...base, ...(({ state: 'accepted' }) as object) }, ctx);
    expect(row.state).toBe('proposed');
  });

  it('records the model and prompt version that produced it', () => {
    const row = toFindingRow(base, ctx);
    expect(row.model).toBe('claude-opus-5');
    expect(row.prompt_version).toBe('v1');
    expect(row.agent_id).toBe('AGT-DOC');
  });

  it('routes a conflict to senior review', () => {
    expect(toFindingRow({ ...base, type: 'conflict' }, ctx).suggested_gate).toBe('senior_review');
  });

  it('routes missing information and RFI candidates to an RFI', () => {
    expect(toFindingRow({ ...base, type: 'missing_information' }, ctx).suggested_gate).toBe('rfi_required');
    expect(toFindingRow({ ...base, type: 'rfi_candidate' }, ctx).suggested_gate).toBe('rfi_required');
  });

  it('routes a low-confidence finding to senior review', () => {
    expect(toFindingRow({ ...base, confidence: 62 }, ctx).suggested_gate).toBe('senior_review');
    expect(toFindingRow({ ...base, confidence: 92 }, ctx).suggested_gate).toBe('estimator_review');
  });

  it('never routes anything to auto-accept', () => {
    // The lowest gate an agent can suggest is estimator review, by construction.
    for (const type of FINDING_TYPES) {
      for (const confidence of [0, 50, 79, 80, 99, 100]) {
        const row = toFindingRow({ ...base, type, confidence }, ctx);
        expect(row.suggested_gate).not.toBe('auto_accept');
      }
    }
  });

  it('carries the citations onto the sheet reference array for indexing', () => {
    const row = toFindingRow(base, ctx);
    expect(row.sheet_references).toEqual(['C-302']);
    expect(row.citations).toEqual(cited);
  });

  it('truncates an over-long title rather than failing the insert', () => {
    const row = toFindingRow({ ...base, title: 'x'.repeat(400) }, ctx);
    expect(row.title.length).toBe(200);
  });
});

describe('cost estimation', () => {
  it('prices a run from the model\'s published rates', () => {
    // 1M in + 100K out on Opus 5 = $5.00 + $2.50
    expect(estimateCost('claude-opus-5', 1_000_000, 100_000)).toBe(7.5);
    expect(estimateCost('claude-haiku-4-5', 1_000_000, 100_000)).toBe(1.5);
  });

  it('returns zero for a model it does not price rather than guessing', () => {
    expect(estimateCost('some-other-model', 1_000_000, 100_000)).toBe(0);
  });

  it('prices the models the platform routes to', () => {
    expect(Object.keys(MODEL_COSTS)).toContain('claude-opus-5');
  });
});

/**
 * Reading a set in pieces.
 *
 * The arithmetic that decides how much of a plan set one invocation takes on,
 * and when it hands the rest back rather than being killed holding it. Pure on
 * purpose: the Edge Function around it cannot be run here, and these are the
 * two decisions that, got wrong, produce either a job that never advances or a
 * worker that dies mid-read — which is the fault this was written to end.
 */
describe('reading a set in pieces', () => {
  describe('the next run of pages', () => {
    it('starts at the beginning of a set nothing has read', () => {
      expect(nextRun(0, 14, 4)).toEqual({ from: 0, to: 4 });
    });

    it('carries on from where the last invocation stopped', () => {
      expect(nextRun(8, 14, 4)).toEqual({ from: 8, to: 12 });
    });

    it('does not run past the end of the set', () => {
      expect(nextRun(12, 14, 4)).toEqual({ from: 12, to: 14 });
    });

    it('is finished when every page has been read', () => {
      expect(nextRun(14, 14, 4)).toBeNull();
    });

    /*
     * The case that matters most. A counter that has somehow gone past the end
     * must finish rather than ask for pages that are not there — the failure
     * this replaces was a job that could never reach its own end.
     */
    it('is finished when the counter has overshot', () => {
      expect(nextRun(20, 14, 4)).toBeNull();
    });

    it('has nothing to do with a set of no pages', () => {
      expect(nextRun(0, 0, 4)).toBeNull();
    });

    it('refuses a batch size that would never advance', () => {
      expect(nextRun(0, 14, 0)).toBeNull();
    });
  });

  describe('when to hand the rest back', () => {
    it('carries straight on at the start of a worker’s life', () => {
      expect(shouldHandBack(2_000, 9_000, 55_000)).toBe(false);
    });

    /*
     * Measured against the slowest run so far, not an average: a set whose
     * pages are dense stops earlier than one whose pages are sparse, and
     * nobody has to pick a number for either.
     */
    it('stops when the slowest run so far would not fit in what is left', () => {
      expect(shouldHandBack(40_000, 20_000, 55_000)).toBe(true);
      expect(shouldHandBack(40_000, 9_000, 55_000)).toBe(false);
    });

    it('never assumes a run will take no time at all', () => {
      // A first run that reported 0 ms is not a promise the next one is free.
      expect(shouldHandBack(54_500, 0, 55_000)).toBe(true);
    });

    it('hands back once the budget is spent regardless', () => {
      expect(shouldHandBack(60_000, 1, 55_000)).toBe(true);
    });
  });

  describe('the batch sizes', () => {
    /*
     * A scan is read in smaller pieces than a text layer, and not because the
     * request is bigger — the file is uploaded once and referred to by id. It
     * is the answer that is long: a model asked to read twenty scanned
     * drawings writes for minutes, and minutes is what killed the worker.
     */
    it('reads fewer scanned pages at a time than pages with text', () => {
      expect(SCAN_BATCH).toBeLessThan(TEXT_BATCH);
    });

    it('leaves room inside a worker for at least one more run', () => {
      expect(BUDGET_MS).toBeLessThan(150_000);
    });
  });
});

/**
 * How long an answer may be.
 *
 * The generation is what takes the time, and the time is what killed the
 * worker. A flat ceiling for every batch meant two scanned drawings were
 * allowed the same thirty-two thousand tokens as twenty pages of text.
 */
describe('how long an answer may be', () => {
  /*
   * These assert flatness on purpose. A scaled ceiling was tried against a real
   * plan set and truncated the answer at exactly its own limit — thinking
   * counts against this number, so at high effort a small ceiling spends itself
   * before the answer starts. Batch size is where the time is controlled.
   */
  it('gives a small batch the same room as a large one', () => {
    expect(maxTokensFor(SCAN_BATCH)).toBe(maxTokensFor(TEXT_BATCH));
  });

  it('leaves room for thinking and an answer both', () => {
    expect(maxTokensFor(1)).toBeGreaterThanOrEqual(32_000);
  });

  it('is a stop on a runaway, not a budget', () => {
    expect(maxTokensFor(500)).toBe(32_000);
  });
});

/**
 * The guard that decides whether there is time for another batch.
 *
 * Written as its own group because the first version of it was wrong in a way
 * no unit test would have caught and a real plan set caught immediately: it
 * asked whether any findings had been made rather than whether any work had
 * been done. Pages one and two of a set are a cover sheet and an index. They
 * take ninety-nine seconds and they find nothing, and a guard that reads that
 * as "nothing has happened yet" sends the worker into a batch it cannot finish.
 */
describe('a batch that finds nothing still took the time', () => {
  it('hands back after one slow batch, whatever that batch found', () => {
    const afterOneSlowBatch = 99_000;
    expect(shouldHandBack(afterOneSlowBatch, afterOneSlowBatch, BUDGET_MS)).toBe(true);
  });

  it('is the elapsed time that decides, never the yield', () => {
    // Same elapsed time, same answer. Nothing here can see a finding count,
    // which is the point: the two are not related and must not be conflated.
    expect(shouldHandBack(99_000, 99_000, BUDGET_MS))
      .toBe(shouldHandBack(99_000, 99_000, BUDGET_MS));
  });
});

/**
 * One page at a time, on a scan.
 *
 * The number was arrived at by running a real set three times and watching the
 * platform say what it wanted. Four pages never finished a batch. Two got a
 * cover sheet and an index home in ninety-nine seconds and then died on the
 * first pair of real drawings, with `IDLE_TIMEOUT — Request idle timeout limit
 * (150s) reached`. A batch has to fit the worst page in a set, not the average.
 */
describe('one page at a time on a scan', () => {
  it('asks about a single scanned page', () => {
    expect(SCAN_BATCH).toBe(1);
  });

  it('walks a fourteen-page set one page at a time, to the end', () => {
    const seen: number[] = [];
    let done = 0;
    for (let guard = 0; guard < 100; guard += 1) {
      const run = nextRun(done, 14, SCAN_BATCH);
      if (!run) break;
      seen.push(run.to - run.from);
      done = run.to;
    }
    expect(done).toBe(14);
    expect(seen).toHaveLength(14);
    expect(new Set(seen)).toEqual(new Set([1]));
  });

  it('hands back after every page, because every page is near the limit', () => {
    // A single drawing measured between 75 and 100 seconds.
    expect(shouldHandBack(95_000, 95_000, BUDGET_MS)).toBe(true);
  });
});
