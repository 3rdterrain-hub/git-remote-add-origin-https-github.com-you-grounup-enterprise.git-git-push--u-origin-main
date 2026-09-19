export interface AISecurityRequest {
  tenantId:string; actorId:string; provider:string; model:string;
  dataClassification:string; toolId?:string; purpose:string;
}
export interface AISecurityDecision {
  allowed:boolean; requiresRedaction:boolean; requiresHumanApproval:boolean;
  allowedToolIds:string[]; reason:string; policyIds:string[];
}
// AI policy may restrict further, never widen ordinary user/data access.
