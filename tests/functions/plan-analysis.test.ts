import { describe, expect, it } from 'vitest';
import {
  FINDING_TYPES, FACTUAL_TYPES, FINDINGS_SCHEMA, SYSTEM_PROMPT,
  validateFindings, toFindingRow, estimateCost, MODEL_COSTS,
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

  it('bounds confidence to 0-100', () => {
    const c = FINDINGS_SCHEMA.schema.properties.findings.items.properties.confidence;
    expect(c.minimum).toBe(0);
    expect(c.maximum).toBe(100);
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
