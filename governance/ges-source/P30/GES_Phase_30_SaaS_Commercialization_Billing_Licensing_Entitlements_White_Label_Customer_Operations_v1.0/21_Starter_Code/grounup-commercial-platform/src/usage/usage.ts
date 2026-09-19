export interface UsageEvent {
  usageEventId:string; idempotencyKey:string; tenantId:string; meterKey:string;
  quantity:number; occurredAt:string; resourceId?:string; sourceEventId?:string;
}
export interface UsageCollector { accept(event:UsageEvent):Promise<'accepted'|'duplicate'|'rejected'>; }
