import { RequestContext } from '../context/request-context';
export interface AuditRecord {
  auditEventId: string;
  tenantId: string;
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  occurredAt: string;
  correlationId: string;
  sourceRequirementIds: string[];
  evidence?: Record<string, unknown>;
}
export interface AuditWriter { append(ctx: RequestContext, record: AuditRecord): Promise<void>; }
