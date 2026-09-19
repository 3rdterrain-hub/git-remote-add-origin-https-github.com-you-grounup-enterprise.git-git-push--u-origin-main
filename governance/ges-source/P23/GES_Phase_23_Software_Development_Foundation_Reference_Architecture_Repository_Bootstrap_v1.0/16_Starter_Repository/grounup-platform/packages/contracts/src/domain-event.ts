export interface DomainEvent<T = unknown> {
  eventId: string;
  eventName: string;
  version: number;
  tenantId: string;
  occurredAt: string;
  correlationId: string;
  payload: T;
}
