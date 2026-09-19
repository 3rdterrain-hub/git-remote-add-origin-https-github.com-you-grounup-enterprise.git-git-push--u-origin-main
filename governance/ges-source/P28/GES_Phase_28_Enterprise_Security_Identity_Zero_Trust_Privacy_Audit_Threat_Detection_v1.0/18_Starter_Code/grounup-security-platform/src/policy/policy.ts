import { SecurityContext } from '../contracts/security-context';
export interface PolicyRequest {
  action: string;
  resourceType: string;
  resourceId?: string;
  resourceAttributes?: Record<string, unknown>;
}
export interface PolicyDecision {
  allowed: boolean;
  requiresStepUp: boolean;
  reason: string;
  policyIds: string[];
}
export interface PolicyDecisionPoint {
  evaluate(ctx: SecurityContext, request: PolicyRequest): Promise<PolicyDecision>;
}
// Default deny when no explicit policy permits the action.
