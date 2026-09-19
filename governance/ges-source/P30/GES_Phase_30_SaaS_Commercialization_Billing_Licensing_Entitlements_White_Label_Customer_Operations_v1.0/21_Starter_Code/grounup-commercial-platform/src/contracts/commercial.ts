export type CommercialStatus='Trial'|'Active'|'PastDue'|'Suspended'|'Cancelling'|'Cancelled';
export interface EffectiveEntitlement { key:string; enabled:boolean; limit?:number; unit?:string; source:string; sourceVersion:number; }
export interface CommercialContext { tenantId:string; subscriptionId?:string; planVersionId:string; status:CommercialStatus; }
