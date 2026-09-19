export interface GovernedAIRequest {
  tenantId: string;
  actorId: string;
  purpose: string;
  sourceRequirementIds: string[];
  modelPolicyId: string;
  inputEvidenceIds: string[];
}
export interface GovernedAIResult<T = unknown> {
  output: T;
  provider: string;
  model: string;
  modelVersion?: string;
  confidence?: number;
  evidenceIds: string[];
  requiresHumanReview: boolean;
  evaluationPolicyId: string;
}
