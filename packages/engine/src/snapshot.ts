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

import { assertFinite } from './numeric.js';

/** The library kinds an estimate can be priced from. */
export type SnapshotKind =
  | 'labor_rate' | 'equipment' | 'equipment_rate' | 'crew' | 'production_rate'
  | 'material' | 'assembly' | 'condition_modifier' | 'pricing_profile'
  | 'regional_factor' | 'cost_code' | 'service' | 'task' | 'trucking_rate'
  | 'disposal_site';

export const SNAPSHOT_KINDS: readonly SnapshotKind[] = [
  'labor_rate', 'equipment', 'equipment_rate', 'crew', 'production_rate',
  'material', 'assembly', 'condition_modifier', 'pricing_profile',
  'regional_factor', 'cost_code', 'service', 'task', 'trucking_rate',
  'disposal_site',
];

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

const ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;

/**
 * Serialize a value to a stable string.
 *
 * Object keys are sorted, so two captures of one row hash identically whatever
 * order the driver returned the columns in.
 */
function stable(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RangeError(`A snapshot cannot hold a non-finite number: ${value}`);
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * FNV-1a, 64-bit, as a 16-character hex digest.
 *
 * Chosen because the engine has no dependencies and performs no I/O, so a
 * cryptographic digest — which is async in every runtime that offers one —
 * is unavailable here. See the note on `LibrarySnapshot.digest`.
 */
export function digestOf(entries: readonly SnapshotEntry[]): string {
  const canonical = entries
    .map((e) => `${e.kind}|${e.sourceId}|${e.scope}|${e.sourceUpdatedAt}|${stable(e.payload)}`)
    .sort()
    .join('\n');
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < canonical.length; i++) {
    h ^= BigInt(canonical.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, '0');
}

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
export function captureSnapshot(
  entries: readonly SnapshotEntry[],
  options: CaptureOptions,
): LibrarySnapshot {
  if (!ISO.test(options.capturedAt)) {
    throw new RangeError(`capturedAt must be an ISO date or timestamp, received ${JSON.stringify(options.capturedAt)}`);
  }
  if (!options.engineVersion.trim()) {
    throw new RangeError('engineVersion is required: a snapshot must record which build priced with it');
  }

  const seen = new Map<string, SnapshotEntry>();
  for (const e of entries) {
    if (!SNAPSHOT_KINDS.includes(e.kind)) {
      throw new RangeError(`Unknown snapshot kind ${JSON.stringify(e.kind)}`);
    }
    if (!e.sourceId.trim()) throw new RangeError(`A ${e.kind} entry has no sourceId`);
    if (!ISO.test(e.sourceUpdatedAt)) {
      throw new RangeError(`${e.kind} ${e.sourceId}: sourceUpdatedAt must be an ISO timestamp`);
    }
    const key = `${e.kind}:${e.sourceId}`;
    const existing = seen.get(key);
    if (existing) {
      if (stable(existing.payload) !== stable(e.payload)) {
        throw new RangeError(
          `${e.kind} ${e.sourceId} was captured twice with different content. `
          + 'The library was read twice and gave two answers; keeping one silently would hide that.',
        );
      }
      continue;
    }
    seen.set(key, { ...e, payload: structuredClone(e.payload) as Record<string, unknown> });
  }

  const captured = [...seen.values()].sort(
    (a, b) => (a.kind + a.sourceId).localeCompare(b.kind + b.sourceId),
  );
  return {
    id: options.id,
    capturedAt: options.capturedAt,
    ...(options.capturedBy ? { capturedBy: options.capturedBy } : {}),
    engineVersion: options.engineVersion,
    entries: captured,
    digest: digestOf(captured),
  };
}

export class SnapshotIntegrityError extends Error {
  constructor(readonly snapshotId: string, readonly expected: string, readonly actual: string) {
    super(
      `Snapshot ${snapshotId} does not match its digest (expected ${expected}, computed ${actual}). `
      + 'Its contents changed after capture, so it can no longer be trusted to reproduce the estimate.',
    );
    this.name = 'SnapshotIntegrityError';
  }
}

export class SnapshotMissingEntryError extends Error {
  constructor(readonly kind: SnapshotKind, readonly sourceId: string) {
    super(
      `The snapshot holds no ${kind} with id ${sourceId}. `
      + 'Reading through to the live library would price this estimate with a rate it was never priced with.',
    );
    this.name = 'SnapshotMissingEntryError';
  }
}

/** Verify a snapshot still hashes to the digest it was captured with. */
export function verifySnapshot(snapshot: LibrarySnapshot): void {
  const actual = digestOf(snapshot.entries);
  if (actual !== snapshot.digest) {
    throw new SnapshotIntegrityError(snapshot.id, snapshot.digest, actual);
  }
}

/**
 * Read a row back out of a snapshot.
 *
 * Refuses when the row is absent rather than falling back to the live library.
 * A fallback is how a snapshot silently stops being one: the estimate would
 * reprice against a rate it was never priced with, and the number would look
 * entirely plausible.
 */
export function resolveFromSnapshot<T>(
  snapshot: LibrarySnapshot,
  kind: SnapshotKind,
  sourceId: string,
): T {
  const entry = snapshot.entries.find((e) => e.kind === kind && e.sourceId === sourceId);
  if (!entry) throw new SnapshotMissingEntryError(kind, sourceId);
  return structuredClone(entry.payload) as T;
}

export function snapshotHas(snapshot: LibrarySnapshot, kind: SnapshotKind, sourceId: string): boolean {
  return snapshot.entries.some((e) => e.kind === kind && e.sourceId === sourceId);
}

export interface DriftEntry {
  kind: SnapshotKind;
  sourceId: string;
  status: 'unchanged' | 'changed' | 'deleted';
  snapshotUpdatedAt: string;
  liveUpdatedAt?: string;
  /** Fields whose value differs, with both values. */
  changedFields: readonly { field: string; from: unknown; to: unknown }[];
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
export function compareSnapshotToLive(
  snapshot: LibrarySnapshot,
  live: ReadonlyMap<string, { updatedAt: string; payload: Readonly<Record<string, unknown>> } | null>,
  options: { checkedAt: string },
): DriftReport {
  if (!ISO.test(options.checkedAt)) {
    throw new RangeError(`checkedAt must be an ISO date or timestamp, received ${JSON.stringify(options.checkedAt)}`);
  }
  const entries: DriftEntry[] = [];
  for (const e of snapshot.entries) {
    const current = live.get(`${e.kind}:${e.sourceId}`) ?? null;
    if (current === null) {
      entries.push({
        kind: e.kind, sourceId: e.sourceId, status: 'deleted',
        snapshotUpdatedAt: e.sourceUpdatedAt, changedFields: [],
      });
      continue;
    }
    const changedFields: { field: string; from: unknown; to: unknown }[] = [];
    const fields = new Set([...Object.keys(e.payload), ...Object.keys(current.payload)]);
    for (const f of fields) {
      if (stable(e.payload[f]) !== stable(current.payload[f])) {
        changedFields.push({ field: f, from: e.payload[f], to: current.payload[f] });
      }
    }
    entries.push({
      kind: e.kind, sourceId: e.sourceId,
      status: changedFields.length ? 'changed' : 'unchanged',
      snapshotUpdatedAt: e.sourceUpdatedAt,
      liveUpdatedAt: current.updatedAt,
      changedFields: changedFields.sort((a, b) => a.field.localeCompare(b.field)),
    });
  }

  const changed = entries.filter((e) => e.status === 'changed').length;
  const deleted = entries.filter((e) => e.status === 'deleted').length;
  const unchanged = entries.length - changed - deleted;
  return {
    snapshotId: snapshot.id,
    checkedAt: options.checkedAt,
    total: entries.length,
    unchanged, changed, deleted,
    entries,
    isClean: changed === 0 && deleted === 0,
    summary: changed === 0 && deleted === 0
      ? `All ${entries.length} library row(s) are unchanged since ${snapshot.capturedAt}.`
      : `${changed} changed and ${deleted} deleted of ${entries.length} library row(s) since ${snapshot.capturedAt}.`
        + ' Re-pricing this estimate against the live library would produce a different number.',
  };
}

/** A numeric field's movement, for reporting drift in money terms. */
export function driftDelta(entry: DriftEntry, field: string): number | null {
  const change = entry.changedFields.find((c) => c.field === field);
  if (!change) return null;
  if (typeof change.from !== 'number' || typeof change.to !== 'number') return null;
  return assertFinite(change.to - change.from, `${field} delta`);
}
