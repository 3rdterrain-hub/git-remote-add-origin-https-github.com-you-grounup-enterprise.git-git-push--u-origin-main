export interface RequestContext {
  correlationId: string;
  tenantId: string;
  actorId: string;
  roles: string[];
  scopes: string[];
  environment: string;
  sourceRequirementIds: string[];
}
