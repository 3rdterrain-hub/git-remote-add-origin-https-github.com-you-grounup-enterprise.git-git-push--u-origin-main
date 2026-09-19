export type LibraryStatus = 'Draft' | 'InReview' | 'Approved' | 'Published' | 'Superseded' | 'Archived';

export interface LibraryRecord<T = Record<string, unknown>> {
  libraryRecordId: string;
  tenantId?: string;
  libraryType: string;
  recordCode: string;
  name: string;
  version: number;
  status: LibraryStatus;
  effectiveFrom: string;
  effectiveTo?: string;
  sourceId?: string;
  payload: T;
  sourceRequirementIds: string[];
}
