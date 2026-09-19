export interface TenantContext {
  tenantId: string;
  actorId: string;
  correlationId: string;
  roles: string[];
  scopes: string[];
}
