export interface CommercialSecurityContext {
  tenantId:string; actorId:string; roles:string[]; permissions:string[];
}
export function requirePermission(ctx:CommercialSecurityContext, permission:string):void {
  if(!ctx.permissions.includes(permission)) throw new Error('commercial_permission_denied');
}
