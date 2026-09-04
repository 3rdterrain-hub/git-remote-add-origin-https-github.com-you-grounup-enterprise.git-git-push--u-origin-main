/**
 * Library snapshots.
 *
 * An estimate is priced from library rows: a labor classification, a production
 * rate, an equipment rate, a pricing profile. Those rows keep moving — wages
 * settle, fuel changes, a supplier requotes. Without a snapshot, an estimate
 * references them live, and two things go wrong quietly:
 *
 *   * Editing a rate changes what an *already issued* estimate says it cost.
 *     The number a customer was shown is no longer the number the system holds.
 *   * Reopening a two-year-old estimate prices it against today's library, and
 *     nothing says it happened.
 *
 * A snapshot fixes both by copying the rows in, not pointing at them. Copying
 * rather than referencing matters: a referenced row can be edited or deleted,
 * and a deleted rate would leave an old estimate unreproducible at exactly the
 * moment somebody needs to defend it.
 *
 * The snapshot also records each row's `updated_at`, so drift against the live
 * library can be reported — "this was priced with a wage that has since risen
 * 4%" is a useful thing to be told before re-issuing.
 */
/** The library kinds an estimate can be priced from. */
export type SnapshotKind = 'labor_rate' | 'equipment' | 'equipment_rate' | 'crew' | 'production_rate' | 'material' | 'assembly' | 'condition_modifier' | 'pricing_profile' | 'regional_factor' | 'cost_code' | 'service' | 'task' | 'trucking_rate' | 'disposal_site';
export declare const SNAPSHOT_KINDS: readonly SnapshotKind[];
export interface SnapshotEntry {
    kind: SnapshotKind;
    /** The library row's id, so drift can be checked against the live row. */
    sourceId: string;
    /** The row's `updated_at` when it was captured. */
    sourceUpdatedAt: string;
    /**
     * Scope the row was read at: `platform`, `group` or `company`. A company
     * override and the platform row it overrode are different rows, and an
     * estimate has to record which one priced it.
     */
    scope: 'platform' | 'group' | 'company';
    /** The row itself, copied. */
    payload: Readonly<Record<string, unknown>>;
}
export interface LibrarySnapshot {
    id: string;
    /** Set by the caller. The engine reads no clock. */
    capturedAt: string;
    capturedBy?: string;
    engineVersion: string;
    entries: readonly SnapshotEntry[];
    /**
     * Content digest over the entries, for detecting accidental change.
     *
     * This is a drift check, not a tamper control: it is a fast non-cryptographic
     * hash, and anyone who can rewrite the entries can rewrite the digest.
     * Tamper resistance is the database's job — the snapshot tables are
     * append-only and their triggers refuse an update.
     */
    digest: string;
}
/**
 * FNV-1a, 64-bit, as a 16-character hex digest.
 *
 * Chosen because the engine has no dependencies and performs no I/O, so a
 * cryptographic digest — which is async in every runtime that offers one —
 * is unavailable here. See the note on `LibrarySnapshot.digest`.
 */
export declare function digestOf(entries: readonly SnapshotEntry[]): string;
export interface CaptureOptions {
    id: string;
    capturedAt: string;
    capturedBy?: string;
    engineVersion: string;
}
/**
 * Capture a snapshot from the rows an estimate was priced with.
 *
 * Duplicate entries are refused rather than deduplicated: the same library row
 * captured twice with two different payloads means the caller read it twice and
 * got two answers, and silently keeping one of them would hide that.
 */
export declare function captureSnapshot(entries: readonly SnapshotEntry[], options: CaptureOptions): LibrarySnapshot;
export declare class SnapshotIntegrityError extends Error {
    readonly snapshotId: string;
    readonly expected: string;
    readonly actual: string;
    constructor(snapshotId: string, expected: string, actual: string);
}
export declare class SnapshotMissingEntryError extends Error {
    readonly kind: SnapshotKind;
    readonly sourceId: string;
    constructor(kind: SnapshotKind, sourceId: string);
}
/** Verify a snapshot still hashes to the digest it was captured with. */
export declare function verifySnapshot(snapshot: LibrarySnapshot): void;
/**
 * Read a row back out of a snapshot.
 *
 * Refuses when the row is absent rather than falling back to the live library.
 * A fallback is how a snapshot silently stops being one: the estimate would
 * reprice against a rate it was never priced with, and the number would look
 * entirely plausible.
 */
export declare function resolveFromSnapshot<T>(snapshot: LibrarySnapshot, kind: SnapshotKind, sourceId: string): T;
export declare function snapshotHas(snapshot: LibrarySnapshot, kind: SnapshotKind, sourceId: string): boolean;
export interface DriftEntry {
    kind: SnapshotKind;
    sourceId: string;
    status: 'unchanged' | 'changed' | 'deleted';
    snapshotUpdatedAt: string;
    liveUpdatedAt?: string;
    /** Fields whose value differs, with both values. */
    changedFields: readonly {
        field: string;
        from: unknown;
        to: unknown;
    }[];
}
export interface DriftReport {
    snapshotId: string;
    checkedAt: string;
    total: number;
    unchanged: number;
    changed: number;
    deleted: number;
    entries: readonly DriftEntry[];
    /** True when nothing the estimate was priced with has moved. */
    isClean: boolean;
    summary: string;
}
/**
 * Compare a snapshot against the live library.
 *
 * Answers the question somebody asks before re-issuing an old estimate: has
 * anything it was priced with changed, and by how much.
 */
export declare function compareSnapshotToLive(snapshot: LibrarySnapshot, live: ReadonlyMap<string, {
    updatedAt: string;
    payload: Readonly<Record<string, unknown>>;
} | null>, options: {
    checkedAt: string;
}): DriftReport;
/** A numeric field's movement, for reporting drift in money terms. */
export declare function driftDelta(entry: DriftEntry, field: string): number | null;
