export interface SecurityEvent {
  eventId:string; tenantId?:string; actorId?:string; serviceIdentityId?:string;
  eventType:string; severity:'info'|'low'|'medium'|'high'|'critical';
  occurredAt:string; correlationId:string; source:string;
  details:Record<string,unknown>; sourceRequirementIds:string[];
}
