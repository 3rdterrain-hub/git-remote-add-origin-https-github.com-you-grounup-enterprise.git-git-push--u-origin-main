import { describe, expect, it } from 'vitest';
import { readScenarios } from '../../supabase/functions/_shared/scenario-input.ts';

/**
 * What a caller sent, turned into scenarios the engine will accept.
 *
 * The engine has its own twenty-six tests for the arithmetic; this covers the
 * half that did not exist until it got a door — the boundary where a request
 * becomes a priced assumption.
 *
 * What it refuses is the interesting part, and the refusal that earns its place
 * is the missing reason. An estimator can defend "production is fifteen percent
 * worse because the south end is wet and we have seen it". Nobody can defend
 * "high is base plus twenty percent", and that is the first thing asked about
 * when a bid is opened.
 */
const ok = (adjustments: unknown) => readScenarios([
  { id: 'BASE', name: 'As estimated', kind: 'base', adjustments: [] },
  { id: 'WHATIF', name: 'What if', kind: 'custom', adjustments },
]);

describe('reading scenarios off the wire', () => {
  it('accepts a named adjustment with a reason', () => {
    const r = ok([{ driver: 'production', factor: 0.85, rationale: 'South end is wet' }]);
    expect('scenarios' in r).toBe(true);
    if (!('scenarios' in r)) return;
    expect(r.scenarios).toHaveLength(2);
    expect(r.scenarios[1]!.adjustments[0]).toEqual({
      driver: 'production', factor: 0.85, rationale: 'South end is wet',
    });
  });

  it('refuses an adjustment that will not say why', () => {
    const r = ok([{ driver: 'fuel_price', factor: 1.2, rationale: '' }]);
    expect('error' in r).toBe(true);
    if (!('error' in r)) return;
    expect(r.error).toMatch(/without saying why/);
  });

  it('refuses a driver the engine cannot move, and lists the ones it can', () => {
    const r = ok([{ driver: 'the_weather', factor: 1.2, rationale: 'It might rain' }]);
    expect('error' in r).toBe(true);
    if (!('error' in r)) return;
    expect(r.error).toMatch(/not something the engine can move/);
    /* Naming the alternatives, so the caller is not left guessing. */
    expect(r.error).toMatch(/fuel_price/);
  });

  it('refuses a factor that is not a positive number', () => {
    for (const factor of [0, -1, 'lots', null]) {
      const r = ok([{ driver: 'quantity', factor, rationale: 'Because' }]);
      expect('error' in r, `factor ${String(factor)} was accepted`).toBe(true);
    }
  });

  it('refuses a scenario with no adjustments list at all', () => {
    const r = readScenarios([{ id: 'X', name: 'Broken', kind: 'custom' }]);
    expect('error' in r).toBe(true);
    if (!('error' in r)) return;
    expect(r.error).toMatch(/has no adjustments/);
  });

  it('refuses anything that is not a list of scenarios', () => {
    for (const bad of [null, 'low,high', 42, { low: 1 }]) {
      expect('error' in readScenarios(bad)).toBe(true);
    }
  });

  it('takes an empty adjustment list, because that is what a base is', () => {
    const r = readScenarios([{ id: 'BASE', name: 'As estimated', kind: 'base', adjustments: [] }]);
    expect('scenarios' in r).toBe(true);
    if (!('scenarios' in r)) return;
    expect(r.scenarios[0]!.kind).toBe('base');
    expect(r.scenarios[0]!.adjustments).toEqual([]);
  });

  it('falls back to a custom kind rather than inventing low or high', () => {
    // An unrecognized kind is not a guess at the caller's intent. `custom`
    // prices it and says nothing about where it sits in a range.
    const r = readScenarios([
      { id: 'BASE', name: 'Base', kind: 'base', adjustments: [] },
      { id: 'W', name: 'Wat', kind: 'sideways', adjustments: [] },
    ]);
    if (!('scenarios' in r)) throw new Error('expected scenarios');
    expect(r.scenarios[1]!.kind).toBe('custom');
  });

  it('names an unnamed scenario by its position rather than refusing it', () => {
    const r = readScenarios([{ kind: 'base', adjustments: [] }]);
    if (!('scenarios' in r)) throw new Error('expected scenarios');
    expect(r.scenarios[0]!.id).toBe('S1');
    expect(r.scenarios[0]!.name).toBe('S1');
  });
});
