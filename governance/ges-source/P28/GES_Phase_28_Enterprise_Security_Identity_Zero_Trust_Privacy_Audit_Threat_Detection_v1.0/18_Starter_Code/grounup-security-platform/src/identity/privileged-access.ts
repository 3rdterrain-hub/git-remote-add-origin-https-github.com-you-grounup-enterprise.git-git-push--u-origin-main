export interface PrivilegedElevationRequest {
  requestId:string; tenantId:string; actorId:string; roleId:string;
  reason:string; requestedUntil:string; approvalId?:string;
}
export interface PrivilegedElevation {
  elevationId:string; actorId:string; roleId:string; startsAt:string; expiresAt:string;
  approvedBy:string; mfaVerified:true;
}
// Elevations expire automatically and are auditable.
