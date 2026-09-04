/**
 * Portable estimates — the import and export path.
 *
 * An estimate that cannot leave the platform is an estimate the customer does
 * not own. Export exists so a priced estimate can be archived, handed to an
 * auditor, moved between companies in a group, or re-priced years later against
 * the rates that were in force when it was written.
 *
 * Two properties make it worth having, and both are tested:
 *
 *   * **Round-trip fidelity.** Export then import produces the same priced
 *     result, to the cent. An export that loses a modifier or a soil factor is
 *     worse than none: it looks like a record and is not one.
 *   * **Refusal over repair.** Import validates and refuses. Silently defaulting
 *     a missing swell factor would produce a plausible, wrong number — the exact
 *     failure this engine exists to prevent.
 *
 * The document carries its own schema version. A file written by a later
 * version is refused rather than partially understood.
 */
import type { EstimateInput } from './estimate.js';
export declare const PORTABLE_SCHEMA_VERSION = "1.0.0";
export interface PortableEstimate {
    schemaVersion: string;
    /** Supplied by the caller. The engine reads no clock. */
    exportedAt: string;
    exportedBy?: string;
    /** The engine build that produced the figures, so a re-import can compare. */
    engineVersion: string;
    estimate: EstimateInput;
}
export interface ExportOptions {
    exportedAt: string;
    exportedBy?: string;
    engineVersion: string;
}
/**
 * Produce a portable document from an estimate input.
 *
 * The estimate input is exported rather than the priced result: inputs plus a
 * deterministic engine reproduce the result exactly, and inputs are what a
 * re-price needs. Exporting the outputs alone would give an archive that cannot
 * be recalculated.
 */
export declare function exportEstimate(estimate: EstimateInput, options: ExportOptions): PortableEstimate;
export interface ImportResult {
    estimate: EstimateInput;
    document: PortableEstimate;
    /** Non-fatal observations: an older schema, a different engine build. */
    warnings: readonly string[];
}
export declare class PortableImportError extends Error {
    readonly problems: readonly string[];
    constructor(problems: readonly string[]);
}
/**
 * Read a portable document back into an estimate input.
 *
 * Every problem is collected before throwing, so a bad file reports everything
 * wrong with it at once rather than one issue per attempt.
 */
export declare function importEstimate(document: unknown, options: {
    engineVersion: string;
}): ImportResult;
/** Serialize a document to stable JSON, so two exports of one estimate match byte for byte. */
export declare function serializePortable(document: PortableEstimate): string;
export declare function parsePortable(json: string, options: {
    engineVersion: string;
}): ImportResult;
/** The line ids in a document, for reconciling an import against what was sent. */
export declare function portableLineIds(document: PortableEstimate): readonly string[];
