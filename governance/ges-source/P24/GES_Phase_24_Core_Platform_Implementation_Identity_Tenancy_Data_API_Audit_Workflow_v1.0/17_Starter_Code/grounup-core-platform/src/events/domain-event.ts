export interface DomainEvent<T = unknown> {
  eventId: string; eventName: string; version: number; tenantId: string;
  occurredAt: string; correlationId: string; actorId?: string; payload: T;
  sourceRequirementIds: string[];
}
export interface EventOutbox { enqueue<T>(event: DomainEvent<T>): Promise<void>; }
