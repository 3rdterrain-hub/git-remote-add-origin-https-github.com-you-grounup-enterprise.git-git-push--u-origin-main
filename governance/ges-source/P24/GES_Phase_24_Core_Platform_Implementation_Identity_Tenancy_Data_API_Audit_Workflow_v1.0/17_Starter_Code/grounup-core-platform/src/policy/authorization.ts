import { RequestContext } from '../context/request-context';
export interface AuthorizationRequest { action: string; resourceType: string; resourceId?: string; attributes?: Record<string, unknown>; }
export interface AuthorizationDecision { allowed: boolean; policyIds: string[]; reason?: string; }
export interface AuthorizationPolicy {
  evaluate(ctx: RequestContext, request: AuthorizationRequest): Promise<AuthorizationDecision>;
}
// Required behavior: default deny when no policy explicitly permits.
