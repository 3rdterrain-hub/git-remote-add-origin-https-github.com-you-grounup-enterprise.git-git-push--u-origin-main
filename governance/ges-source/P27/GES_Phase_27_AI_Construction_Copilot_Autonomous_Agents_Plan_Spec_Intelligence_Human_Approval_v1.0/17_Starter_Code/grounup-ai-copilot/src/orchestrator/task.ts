export type AgentTaskState =
  'Requested'|'ContextBuilding'|'Planning'|'Running'|'AwaitingApproval'|
  'Completed'|'Rejected'|'Failed'|'Degraded';

export interface AgentTask {
  taskId: string;
  tenantId: string;
  actorId: string;
  objective: string;
  state: AgentTaskState;
  allowedToolIds: string[];
  maxToolCalls: number;
  maxCostUsd?: number;
  deadlineAt?: string;
  sourceRequirementIds: string[];
}
