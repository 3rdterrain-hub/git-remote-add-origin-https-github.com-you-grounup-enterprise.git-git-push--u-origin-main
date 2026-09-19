export interface AnalyticsSecurityContext {
  tenantId:string; actorId:string; roles:string[]; projectIds?:string[];
  allowedClassifications:string[]; allowedColumns?:string[];
}
