import {CommercialContext,EffectiveEntitlement} from '../contracts/commercial';
export interface EntitlementResolver {
  resolve(ctx:CommercialContext):Promise<EffectiveEntitlement[]>;
}
// Caller must ALSO pass normal identity/authorization/security policy. Entitlement alone never authorizes access.
