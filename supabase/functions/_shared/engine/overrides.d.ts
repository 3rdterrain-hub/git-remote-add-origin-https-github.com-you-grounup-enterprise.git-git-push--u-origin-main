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
/** What kind of value is being overridden, so the record reads sensibly. */
export type OverrideValueKind = 'money' | 'quantity' | 'factor' | 'hours' | 'days' | 'text';
export interface ValueOverride {
    id: string;
    /** The record the value belongs to, e.g. `estimate_versions`. */
    entityTable: string;
    entityId: string;
    /** Which value, e.g. `lines.L-001.directCost.labor`. */
    fieldPath: string;
    valueKind: OverrideValueKind;
    /** What the engine computed. Always retained. */
    originalValue: number | string;
    /** What is to be used instead. */
    overrideValue: number | string;
    reason: string;
    requestedBy: string;
    approvedBy: string;
    /** Supplied by the caller. The engine reads no clock. */
    approvedAt: string;
}
export declare class OverrideError extends Error {
    readonly fieldPath: string;
    constructor(message: string, fieldPath: string);
}
/** Below this an explanation is a gesture rather than a reason. */
export declare const MIN_REASON_LENGTH = 12;
/**
 * Validate one override.
 *
 * Collects every problem rather than throwing on the first, so a bad override
 * reports everything wrong with it at once.
 */
export declare function validateOverride(o: ValueOverride): readonly string[];
export declare function assertOverride(o: ValueOverride): void;
export interface AppliedOverride {
    override: ValueOverride;
    /** Override less original, for numeric values. */
    delta: number | null;
    deltaPercent: number | null;
    derivation: string;
}
export interface OverrideApplication {
    applied: readonly AppliedOverride[];
    /** Field paths overridden, for a quick contains check. */
    overriddenPaths: readonly string[];
    /** Net money movement across money overrides. */
    netMoneyDelta: number;
    derivation: readonly string[];
    warnings: readonly string[];
}
/**
 * Apply a set of overrides, producing the record of what they changed.
 *
 * Two overrides on one field are refused rather than ordered. Whichever won
 * would be an arbitrary choice, and an arbitrary choice about a number somebody
 * is bidding is not something to make silently.
 */
export declare function applyOverrides(overrides: readonly ValueOverride[], options?: {
    warnAbovePercent?: number;
}): OverrideApplication;
/**
 * The value to use for a field: the override if there is one, otherwise the
 * computed figure.
 *
 * Returns the provenance alongside it, so a caller cannot use an overridden
 * number without being handed the fact that it was overridden.
 */
export declare function resolveValue<T extends number | string>(application: OverrideApplication, fieldPath: string, computed: T): {
    value: T;
    overridden: boolean;
    reason?: string;
    approvedBy?: string;
};
/** Whether a field carries an override, for marking it in the interface. */
export declare function isOverridden(application: OverrideApplication, fieldPath: string): boolean;
