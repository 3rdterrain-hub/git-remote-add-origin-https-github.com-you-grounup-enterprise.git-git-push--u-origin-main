export interface SecretReference {
  secretRefId:string;
  provider:string;
  pathOrKey:string;
  ownerId:string;
  rotationPolicyId:string;
  lastRotatedAt?:string;
  expiresAt?:string;
}
// Never place secret plaintext in this structure.
