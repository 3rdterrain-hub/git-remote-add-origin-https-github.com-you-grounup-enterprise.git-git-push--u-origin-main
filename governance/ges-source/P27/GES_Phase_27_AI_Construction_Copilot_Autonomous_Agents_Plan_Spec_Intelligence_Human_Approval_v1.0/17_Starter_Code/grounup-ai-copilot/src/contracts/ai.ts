export type AIResultStatus =
  | 'Draft' | 'Advisory' | 'PendingHumanReview' | 'Approved'
  | 'Rejected' | 'Failed' | 'Degraded';

export interface EvidenceRef {
  evidenceId: string;
  sourceType: 'document'|'sheet'|'spec-section'|'record'|'calculation-trace'|'library-record';
  sourceId: string;
  sourceVersion?: string;
  location?: string;
  excerptHash?: string;
}

export interface GovernedAIResult<T = unknown> {
  resultId: string;
  tenantId: string;
  projectId?: string;
  taskId: string;
  agentId: string;
  modelVersion: string;
  promptVersion: string;
  toolVersions: string[];
  evidence: EvidenceRef[];
  confidence?: number;
  requiresHumanReview: boolean;
  status: AIResultStatus;
  output: T;
  sourceRequirementIds: string[];
}
