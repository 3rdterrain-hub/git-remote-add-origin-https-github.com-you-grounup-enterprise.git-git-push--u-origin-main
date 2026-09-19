export interface SecurityContext {
  tenantId: string;
  actorId: string;
  sessionId: string;
  correlationId: string;
  roles: string[];
  scopes: string[];
  attributes: Record<string, string | number | boolean>;
  authStrength: 'password'|'mfa'|'hardware'|'service';
  riskLevel: 'low'|'medium'|'high'|'critical';
}
