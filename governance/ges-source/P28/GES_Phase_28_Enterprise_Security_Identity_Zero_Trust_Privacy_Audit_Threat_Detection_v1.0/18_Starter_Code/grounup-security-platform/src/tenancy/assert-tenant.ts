import { SecurityContext } from '../contracts/security-context';
export function assertTenant(ctx: SecurityContext, resourceTenantId: string): void {
  if (ctx.tenantId !== resourceTenantId) throw new Error('TENANT_ACCESS_DENIED');
}
