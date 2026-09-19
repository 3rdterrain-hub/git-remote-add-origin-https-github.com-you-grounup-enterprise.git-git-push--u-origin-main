export interface MetricDefinition {
  metricId:string; name:string; version:number; expression:string; grain:string; unit:string;
  timeBasis?:string; filters:string[]; ownerId:string;
  status:'Draft'|'InReview'|'Certified'|'Superseded'|'Archived'; sourceDatasetIds:string[];
}
