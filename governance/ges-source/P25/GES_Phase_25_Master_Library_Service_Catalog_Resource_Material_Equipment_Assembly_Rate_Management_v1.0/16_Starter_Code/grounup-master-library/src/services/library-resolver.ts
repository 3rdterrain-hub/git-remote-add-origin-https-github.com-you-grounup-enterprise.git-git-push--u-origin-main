export interface ResolveContext {
  tenantId: string;
  asOf: string;
  regionProfileId?: string;
  vendorSourceIds?: string[];
}
export interface ResolvedLibraryValue<T> {
  value: T;
  sourceRecordId: string;
  sourceVersion: number;
  precedence: 'vendor' | 'tenant-override' | 'regional' | 'base';
  provenance: Record<string, unknown>;
}
export interface LibraryResolver {
  resolve<T>(libraryType: string, recordCode: string, context: ResolveContext): Promise<ResolvedLibraryValue<T>>;
}
