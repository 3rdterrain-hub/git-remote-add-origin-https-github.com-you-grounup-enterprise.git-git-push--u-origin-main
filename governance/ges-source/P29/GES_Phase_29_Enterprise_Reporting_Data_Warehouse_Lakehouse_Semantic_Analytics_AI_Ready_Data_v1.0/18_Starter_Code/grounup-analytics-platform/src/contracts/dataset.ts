export type CertificationStatus='Draft'|'InReview'|'Certified'|'Superseded'|'Archived';
export interface AnalyticsDataset {
  datasetId:string; tenantScope:'tenant'|'platform'; version:number; status:CertificationStatus;
  grain:string; ownerId:string; sourceDatasetIds:string[]; transformationVersionIds:string[];
  freshnessSlaId?:string; lineageId:string; sourceRequirementIds:string[];
}
