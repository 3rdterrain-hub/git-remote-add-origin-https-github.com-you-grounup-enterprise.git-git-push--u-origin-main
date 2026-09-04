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

import type { EstimateInput, EstimateLineInput } from './estimate.js';

export const PORTABLE_SCHEMA_VERSION = '1.0.0';

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

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;

/**
 * Produce a portable document from an estimate input.
 *
 * The estimate input is exported rather than the priced result: inputs plus a
 * deterministic engine reproduce the result exactly, and inputs are what a
 * re-price needs. Exporting the outputs alone would give an archive that cannot
 * be recalculated.
 */
export function exportEstimate(estimate: EstimateInput, options: ExportOptions): PortableEstimate {
  if (!ISO_DATE_TIME.test(options.exportedAt)) {
    throw new RangeError(`exportedAt must be an ISO date or timestamp, received ${JSON.stringify(options.exportedAt)}`);
  }
  if (!options.engineVersion.trim()) {
    throw new RangeError('engineVersion is required so a re-import can tell which build produced the figures');
  }
  return {
    schemaVersion: PORTABLE_SCHEMA_VERSION,
    exportedAt: options.exportedAt,
    ...(options.exportedBy ? { exportedBy: options.exportedBy } : {}),
    engineVersion: options.engineVersion,
    // Deep clone so a later mutation of the caller's object cannot alter an
    // exported document that is already, conceptually, a record.
    estimate: structuredClone(estimate) as EstimateInput,
  };
}

export interface ImportResult {
  estimate: EstimateInput;
  document: PortableEstimate;
  /** Non-fatal observations: an older schema, a different engine build. */
  warnings: readonly string[];
}

export class PortableImportError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`The estimate document could not be imported:\n  ${problems.join('\n  ')}`);
    this.name = 'PortableImportError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function majorOf(version: string): number {
  return Number(version.split('.')[0] ?? Number.NaN);
}

/**
 * Read a portable document back into an estimate input.
 *
 * Every problem is collected before throwing, so a bad file reports everything
 * wrong with it at once rather than one issue per attempt.
 */
export function importEstimate(
  document: unknown,
  options: { engineVersion: string },
): ImportResult {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(document)) {
    throw new PortableImportError(['The document is not an object.']);
  }

  const schemaVersion = document.schemaVersion;
  if (typeof schemaVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(schemaVersion)) {
    problems.push('schemaVersion is missing or is not a semantic version.');
  } else {
    const theirs = majorOf(schemaVersion);
    const ours = majorOf(PORTABLE_SCHEMA_VERSION);
    if (theirs > ours) {
      // Partially understanding a newer file is how a field silently goes
      // missing from an estimate.
      problems.push(
        `The document uses schema ${schemaVersion}, which is newer than this build understands `
        + `(${PORTABLE_SCHEMA_VERSION}). Upgrade before importing it.`,
      );
    } else if (theirs < ours) {
      warnings.push(`The document uses schema ${schemaVersion}; this build writes ${PORTABLE_SCHEMA_VERSION}.`);
    }
  }

  if (typeof document.exportedAt !== 'string' || !ISO_DATE_TIME.test(document.exportedAt)) {
    problems.push('exportedAt is missing or is not an ISO date.');
  }
  if (typeof document.engineVersion !== 'string' || !document.engineVersion.trim()) {
    problems.push('engineVersion is missing.');
  } else if (document.engineVersion !== options.engineVersion) {
    // Not an error. A re-price against a different build is legitimate, and
    // sometimes the point — but it must be visible.
    warnings.push(
      `The document was produced by engine ${document.engineVersion}; this build is `
      + `${options.engineVersion}. Recalculated figures may differ.`,
    );
  }

  const estimate = document.estimate;
  if (!isRecord(estimate)) {
    problems.push('estimate is missing or is not an object.');
    throw new PortableImportError(problems);
  }

  if (typeof estimate.id !== 'string' || !estimate.id.trim()) problems.push('estimate.id is missing.');
  if (typeof estimate.name !== 'string' || !estimate.name.trim()) problems.push('estimate.name is missing.');
  if (typeof estimate.number !== 'string' || !estimate.number.trim()) problems.push('estimate.number is missing.');
  if (typeof estimate.version !== 'number' || !Number.isInteger(estimate.version)) {
    problems.push('estimate.version is missing or is not a whole number.');
  }
  if (!isRecord(estimate.pricingProfile)) {
    problems.push('estimate.pricingProfile is missing; an estimate cannot be priced without one.');
  }

  const lines = estimate.lines;
  if (!Array.isArray(lines)) {
    problems.push('estimate.lines is missing or is not an array.');
  } else if (lines.length === 0) {
    warnings.push('The estimate has no lines and will price at zero.');
  } else {
    lines.forEach((line, i) => {
      if (!isRecord(line)) { problems.push(`estimate.lines[${i}] is not an object.`); return; }
      const at = `estimate.lines[${i}]${typeof line.id === 'string' ? ` (${line.id})` : ''}`;
      if (typeof line.id !== 'string' || !line.id.trim()) problems.push(`${at}: id is missing.`);
      if (typeof line.description !== 'string' || !line.description.trim()) {
        problems.push(`${at}: description is missing.`);
      }
      if (!isRecord(line.quantity)) {
        problems.push(`${at}: quantity is missing.`);
      } else {
        if (typeof line.quantity.measured !== 'number' || !Number.isFinite(line.quantity.measured)) {
          problems.push(`${at}: quantity.measured must be a finite number.`);
        }
        if (typeof line.quantity.unit !== 'string' || !line.quantity.unit.trim()) {
          problems.push(`${at}: quantity.unit is missing.`);
        }
      }
    });

    const ids = lines
      .filter(isRecord)
      .map((l) => l.id)
      .filter((v): v is string => typeof v === 'string');
    const duplicates = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    if (duplicates.length) {
      // Two lines with one id makes the estimate impossible to reconcile
      // against its own detail.
      problems.push(`Duplicate line id(s): ${duplicates.join(', ')}.`);
    }
  }

  if (problems.length) throw new PortableImportError(problems);

  return {
    estimate: structuredClone(estimate) as unknown as EstimateInput,
    document: structuredClone(document) as unknown as PortableEstimate,
    warnings,
  };
}

/** Serialize a document to stable JSON, so two exports of one estimate match byte for byte. */
export function serializePortable(document: PortableEstimate): string {
  const sortKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (isRecord(value)) {
      return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
    }
    return value;
  };
  return JSON.stringify(sortKeys(document), null, 2) + '\n';
}

export function parsePortable(json: string, options: { engineVersion: string }): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new PortableImportError([`The file is not valid JSON: ${(err as Error).message}`]);
  }
  return importEstimate(parsed, options);
}

/** The line ids in a document, for reconciling an import against what was sent. */
export function portableLineIds(document: PortableEstimate): readonly string[] {
  return (document.estimate.lines ?? []).map((l: EstimateLineInput) => l.id);
}
