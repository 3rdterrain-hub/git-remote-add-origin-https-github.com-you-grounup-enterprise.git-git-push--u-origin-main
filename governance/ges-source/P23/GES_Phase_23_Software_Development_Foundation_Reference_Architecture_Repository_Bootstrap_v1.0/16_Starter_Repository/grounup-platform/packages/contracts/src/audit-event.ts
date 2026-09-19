export interface AuditEvent {
  eventId: string;
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
