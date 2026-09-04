import { describe, expect, it } from 'vitest';
import {
  applyOverrides, validateOverride, assertOverride, resolveValue, isOverridden,
  MIN_REASON_LENGTH, type ValueOverride,
} from '../src/overrides.js';

const OVERRIDE: ValueOverride = {
  id: 'OV-1', entityTable: 'estimate_versions', entityId: 'EV-1',
  fieldPath: 'lines.L-001.directCost.labor', valueKind: 'money',
  originalValue: 12800, overrideValue: 14200,
  reason: 'Superintendent reports the haul road is single-lane, so the crew works short-handed.',
  requestedBy: 'alice', approvedBy: 'dana', approvedAt: '2026-09-02T12:00:00Z',
};

describe('validation', () => {
  it('accepts a complete override', () => {
    expect(validateOverride(OVERRIDE)).toEqual([]);
    expect(() => assertOverride(OVERRIDE)).not.toThrow();
  });

  it('refuses a reason too short to be one', () => {
    // A blank or token reason looks like a record and holds nothing.
    const p = validateOverride({ ...OVERRIDE, reason: 'because' });
    expect(p.join(' ')).toContain(`at least ${MIN_REASON_LENGTH} characters`);
  });

  it('refuses self-approval', () => {
    // An override the requester can approve is not a control.
    const p = validateOverride({ ...OVERRIDE, approvedBy: 'alice' });
    expect(p).toContain('An override cannot be approved by the person who requested it.');
  });

  it('refuses an override that changes nothing', () => {
    const p = validateOverride({ ...OVERRIDE, overrideValue: 12800 });
    expect(p.join(' ')).toContain('changes nothing');
  });

  it('refuses a non-finite numeric value', () => {
    expect(validateOverride({ ...OVERRIDE, overrideValue: Number.NaN }).join(' '))
      .toContain('must be a finite number');
  });

  it('refuses a numeric value on a text override', () => {
    expect(validateOverride({ ...OVERRIDE, valueKind: 'text', originalValue: 1, overrideValue: 2 }).join(' '))
      .toContain('must be a string');
  });

  it('refuses a missing field path or entity', () => {
    expect(validateOverride({ ...OVERRIDE, fieldPath: ' ' }).join(' ')).toContain('fieldPath is required');
    expect(validateOverride({ ...OVERRIDE, entityId: '' }).join(' ')).toContain('entityId are required');
  });

  it('reads no clock of its own', () => {
    expect(validateOverride({ ...OVERRIDE, approvedAt: 'yesterday' }).join(' ')).toContain('ISO');
  });

  it('reports every problem at once rather than one per attempt', () => {
    const p = validateOverride({
      ...OVERRIDE, reason: '', approvedBy: 'alice', approvedAt: 'soon', fieldPath: '',
    });
    expect(p.length).toBeGreaterThanOrEqual(4);
  });

  it('names the field in the thrown error', () => {
    expect(() => assertOverride({ ...OVERRIDE, reason: 'no' }))
      .toThrow(/lines\.L-001\.directCost\.labor/);
  });
});

describe('application', () => {
  const a = applyOverrides([OVERRIDE]);

  it('retains what the engine computed alongside the override', () => {
    // Overwriting the original destroys the evidence of what the engine
    // actually said, which is the only thing that makes the override
    // reviewable.
    expect(a.applied[0]!.override.originalValue).toBe(12800);
    expect(a.applied[0]!.override.overrideValue).toBe(14200);
  });

  it('computes the movement in money and as a share', () => {
    expect(a.applied[0]!.delta).toBe(1400);
    expect(a.applied[0]!.deltaPercent).toBe(0.109375);
    expect(a.netMoneyDelta).toBe(1400);
  });

  it('states who approved it, when, and why, in the derivation', () => {
    const d = a.applied[0]!.derivation;
    expect(d).toContain('engine computed 12800, overridden to 14200');
    expect(d).toContain('by dana on 2026-09-02T12:00:00Z');
    expect(d).toContain('haul road is single-lane');
  });

  it('refuses two overrides on one field', () => {
    // Whichever won would be an arbitrary choice about a number somebody is
    // bidding.
    expect(() => applyOverrides([OVERRIDE, { ...OVERRIDE, id: 'OV-2', overrideValue: 15000 }]))
      .toThrow(/overridden twice/);
  });

  it('allows the same field path on a different entity', () => {
    const other = applyOverrides([OVERRIDE, { ...OVERRIDE, id: 'OV-2', entityId: 'EV-2' }]);
    expect(other.applied).toHaveLength(2);
  });

  it('warns when the movement is large enough to suggest a bad input', () => {
    const big = applyOverrides([{ ...OVERRIDE, overrideValue: 25000 }]);
    expect(big.warnings.join(' ')).toContain('usually means the input is wrong');
  });

  it('does not warn on a modest correction', () => {
    expect(applyOverrides([{ ...OVERRIDE, overrideValue: 13000 }]).warnings).toEqual([]);
  });

  it('nets only money overrides into the money total', () => {
    const mixed = applyOverrides([
      OVERRIDE,
      { ...OVERRIDE, id: 'OV-2', fieldPath: 'lines.L-001.duration.days',
        valueKind: 'days', originalValue: 4, overrideValue: 5 },
    ]);
    expect(mixed.netMoneyDelta).toBe(1400);
    expect(mixed.applied.find((x) => x.override.valueKind === 'days')!.delta).toBe(1);
  });

  it('says plainly when nothing was overridden', () => {
    expect(applyOverrides([]).derivation).toEqual(['No values were overridden.']);
  });
});

describe('resolution hands back the provenance with the value', () => {
  const a = applyOverrides([OVERRIDE]);

  it('returns the override and says it is one', () => {
    const r = resolveValue(a, 'lines.L-001.directCost.labor', 12800);
    // A caller cannot use an overridden number without being handed the fact
    // that it was overridden.
    expect(r.value).toBe(14200);
    expect(r.overridden).toBe(true);
    expect(r.approvedBy).toBe('dana');
    expect(r.reason).toContain('haul road');
  });

  it('returns the computed value untouched where there is no override', () => {
    const r = resolveValue(a, 'lines.L-001.directCost.equipment', 9000);
    expect(r.value).toBe(9000);
    expect(r.overridden).toBe(false);
    expect(r.approvedBy).toBeUndefined();
  });

  it('reports which fields carry an override', () => {
    expect(isOverridden(a, 'lines.L-001.directCost.labor')).toBe(true);
    expect(isOverridden(a, 'lines.L-001.directCost.fuel')).toBe(false);
  });
});
