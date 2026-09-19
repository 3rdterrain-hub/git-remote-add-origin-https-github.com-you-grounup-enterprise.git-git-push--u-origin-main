export interface LibrarySnapshotItem {
  libraryType: string; recordCode: string; recordId: string; version: number; resolvedPayload: unknown; provenance: unknown;
}
export interface LibrarySnapshot {
  snapshotId: string; tenantId: string; createdAt: string; items: LibrarySnapshotItem[]; sourceRequirementIds: string[];
}
export interface SnapshotService {
  createEstimatorSnapshot(tenantId: string, recordRefs: Array<{libraryType: string; recordCode: string}>): Promise<LibrarySnapshot>;
}
// Snapshot results are immutable after creation.
