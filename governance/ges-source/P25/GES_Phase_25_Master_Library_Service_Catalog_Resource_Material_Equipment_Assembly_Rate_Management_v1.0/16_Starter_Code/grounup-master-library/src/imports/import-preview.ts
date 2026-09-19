export interface ImportRowResult {
  rowNumber: number;
  status: 'Valid' | 'Invalid' | 'Warning';
  proposedAction: 'Create' | 'NewVersion' | 'NoChange' | 'Reject';
  messages: string[];
}
export interface ImportPreview { importId: string; rows: ImportRowResult[]; canCommit: boolean; }
