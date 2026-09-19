export interface FeatureDefinition { featureId:string; version:number; expression:string; sourceDatasetIds:string[]; eventTimeField:string; ownerId:string; }
export interface FeatureSnapshot { snapshotId:string; tenantId:string; asOf:string; featureVersions:Record<string,number>; sourceLineageIds:string[]; }
