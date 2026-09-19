export interface LibraryEvent {
  eventId: string; eventName: string; version: number; tenantId?: string;
  occurredAt: string; correlationId: string; recordId: string; recordVersion: number;
  sourceRequirementIds: string[]; payload: unknown;
}
