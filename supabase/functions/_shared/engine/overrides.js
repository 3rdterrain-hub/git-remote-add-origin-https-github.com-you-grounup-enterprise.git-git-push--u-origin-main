/**
 * Value overrides.
 *
 * Every engine here computes a number, and sometimes a person has to change it.
 * A superintendent knows the haul road is worse than the model says. A
 * principal has to hit a number to stay in a bid. That is legitimate, and
 * pretending otherwise just pushes the change somewhere the platform cannot see
 * — a spreadsheet, or a rate quietly edited to make one line come out right.
 *
 * So an override is a first-class record rather than an edit. Four properties
 * make it one, and each is enforced:
 *
 *   * **The computed value is retained.** An override that overwrites the
 *     original destroys the evidence of what the engine actually said, which is
 *     the only thing that makes the override reviewable.
 *   * **A reason is required.** "Because I said so" is not a reason, and a
 *     blank one is worse: it looks like a record and holds nothing.
 *   * **Somebody other than the requester approves it.** An override the
 *     requester can approve is not a control.
 *   * **The overridden figure says it was overridden.** A number that silently
 *     differs from its own derivation is the single most dangerous thing an
 *     estimate can contain.
 */
import { money, roundTo } from './numeric.js';
export class OverrideError extends Error {
    fieldPath;
    constructor(message, fieldPath) {
        super(message);
        this.fieldPath = fieldPath;
        this.name = 'OverrideError';
    }
}
const ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;
/** Below this an explanation is a gesture rather than a reason. */
export const MIN_REASON_LENGTH = 12;
/**
 * Validate one override.
 *
 * Collects every problem rather than throwing on the first, so a bad override
 * reports everything wrong with it at once.
 */
export function validateOverride(o) {
    const problems = [];
    if (!o.fieldPath.trim())
        problems.push('fieldPath is required: an override has to say what it changes.');
    if (!o.entityTable.trim() || !o.entityId.trim())
        problems.push('entityTable and entityId are required.');
    if (o.reason.trim().length < MIN_REASON_LENGTH) {
        problems.push(`reason must be at least ${MIN_REASON_LENGTH} characters. `
            + 'A blank or token reason looks like a record and holds nothing.');
    }
    if (!o.requestedBy.trim())
        problems.push('requestedBy is required.');
    if (!o.approvedBy.trim())
        problems.push('approvedBy is required.');
    if (o.requestedBy.trim() === o.approvedBy.trim()) {
        // Segregation of duties, the same rule the approval tiers run on.
        problems.push('An override cannot be approved by the person who requested it.');
    }
    if (!ISO.test(o.approvedAt))
        problems.push('approvedAt must be an ISO date or timestamp.');
    const numeric = o.valueKind !== 'text';
    for (const [name, v] of [['originalValue', o.originalValue], ['overrideValue', o.overrideValue]]) {
        if (numeric && (typeof v !== 'number' || !Number.isFinite(v))) {
            problems.push(`${name} must be a finite number for a ${o.valueKind} override.`);
        }
        if (!numeric && typeof v !== 'string') {
            problems.push(`${name} must be a string for a text override.`);
        }
    }
    if (numeric && typeof o.originalValue === 'number' && typeof o.overrideValue === 'number'
        && o.originalValue === o.overrideValue) {
        problems.push('The override equals the computed value, so it changes nothing and should not be recorded.');
    }
    return problems;
}
export function assertOverride(o) {
    const problems = validateOverride(o);
    if (problems.length) {
        throw new OverrideError(`Override ${o.id} on ${o.fieldPath} is not valid:\n  ${problems.join('\n  ')}`, o.fieldPath);
    }
}
const kindDelta = (o) => {
    if (o.valueKind === 'text')
        return null;
    const a = o.originalValue;
    const b = o.overrideValue;
    return o.valueKind === 'money' ? money(b - a) : roundTo(b - a, 6);
};
/**
 * Apply a set of overrides, producing the record of what they changed.
 *
 * Two overrides on one field are refused rather than ordered. Whichever won
 * would be an arbitrary choice, and an arbitrary choice about a number somebody
 * is bidding is not something to make silently.
 */
export function applyOverrides(overrides, options = {}) {
    const warnAbove = options.warnAbovePercent ?? 0.2;
    const seen = new Map();
    for (const o of overrides) {
        assertOverride(o);
        const key = `${o.entityTable}:${o.entityId}:${o.fieldPath}`;
        const existing = seen.get(key);
        if (existing) {
            throw new OverrideError(`${o.fieldPath} is overridden twice, by ${existing.id} and ${o.id}. `
                + 'Whichever won would be an arbitrary choice about a number somebody is bidding.', o.fieldPath);
        }
        seen.set(key, o);
    }
    const warnings = [];
    const applied = [...seen.values()]
        .sort((a, b) => a.fieldPath.localeCompare(b.fieldPath))
        .map((o) => {
        const delta = kindDelta(o);
        const original = o.originalValue;
        const deltaPercent = delta !== null && typeof original === 'number' && original !== 0
            ? roundTo(delta / Math.abs(original), 6)
            : null;
        if (deltaPercent !== null && Math.abs(deltaPercent) >= warnAbove) {
            warnings.push(`${o.fieldPath} was overridden by ${roundTo(deltaPercent * 100, 1)}% `
                + `(${original} to ${o.overrideValue}). A movement that large usually means the input is wrong `
                + 'rather than the calculation.');
        }
        return {
            override: o,
            delta,
            deltaPercent,
            derivation: `${o.fieldPath}: engine computed ${original}, overridden to ${o.overrideValue}`
                + (delta !== null ? ` (${delta >= 0 ? '+' : ''}${delta})` : '')
                + ` by ${o.approvedBy} on ${o.approvedAt} — ${o.reason}`,
        };
    });
    const netMoneyDelta = money(applied
        .filter((a) => a.override.valueKind === 'money')
        .reduce((sum, a) => sum + (a.delta ?? 0), 0));
    return {
        applied,
        overriddenPaths: applied.map((a) => a.override.fieldPath),
        netMoneyDelta,
        derivation: applied.length === 0
            ? ['No values were overridden.']
            : [
                `${applied.length} value(s) overridden, net ${netMoneyDelta >= 0 ? '+' : ''}${netMoneyDelta}`,
                ...applied.map((a) => `  ${a.derivation}`),
            ],
        warnings,
    };
}
/**
 * The value to use for a field: the override if there is one, otherwise the
 * computed figure.
 *
 * Returns the provenance alongside it, so a caller cannot use an overridden
 * number without being handed the fact that it was overridden.
 */
export function resolveValue(application, fieldPath, computed) {
    const hit = application.applied.find((a) => a.override.fieldPath === fieldPath);
    if (!hit)
        return { value: computed, overridden: false };
    return {
        value: hit.override.overrideValue,
        overridden: true,
        reason: hit.override.reason,
        approvedBy: hit.override.approvedBy,
    };
}
/** Whether a field carries an override, for marking it in the interface. */
export function isOverridden(application, fieldPath) {
    return application.overriddenPaths.includes(fieldPath);
}
