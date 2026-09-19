export type ToolRisk = 'read'|'calculate'|'propose'|'write'|'approve'|'send'|'admin';
export interface ToolRequest {
  toolId: string;
  risk: ToolRisk;
  tenantId: string;
  actorId: string;
  projectId?: string;
}
export interface ToolDecision {
  allowed: boolean;
  requiresHumanApproval: boolean;
  reason: string;
  policyIds: string[];
}
export interface ToolPolicyEngine {
  evaluate(request: ToolRequest): Promise<ToolDecision>;
}
// Default deny. Agents cannot expand their own permissions.
