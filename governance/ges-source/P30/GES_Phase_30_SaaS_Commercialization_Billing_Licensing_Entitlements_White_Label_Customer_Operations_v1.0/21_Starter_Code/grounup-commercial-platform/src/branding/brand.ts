export interface BrandProfile {
  tenantId:string; displayName:string; logoAssetId?:string; primaryColor?:string;
  customDomainId?:string; legalFooter?:string;
}
// Render only allowlisted/sanitized brand fields. Branding must not alter platform security identity.
