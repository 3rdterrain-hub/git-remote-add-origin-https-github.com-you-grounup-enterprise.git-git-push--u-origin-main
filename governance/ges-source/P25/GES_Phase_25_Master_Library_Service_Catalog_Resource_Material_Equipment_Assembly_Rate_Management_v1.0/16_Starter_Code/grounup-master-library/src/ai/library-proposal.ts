export interface AIWritebackProposal {
  proposalId: string;
  tenantId: string;
  libraryType: string;
  proposedRecordCode: string;
  proposedPayload: unknown;
  evidenceIds: string[];
  provider: string;
  model: string;
  confidence?: number;
  status: 'Proposed' | 'Reviewed' | 'ApprovedToDraft' | 'Rejected';
}
// AI cannot publish. Approval may only create a governed draft/version.
