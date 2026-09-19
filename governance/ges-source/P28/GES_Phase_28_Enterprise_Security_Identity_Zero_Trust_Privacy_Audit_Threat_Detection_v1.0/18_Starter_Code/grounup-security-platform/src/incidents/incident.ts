export type IncidentState='New'|'Triaged'|'Contained'|'Recovering'|'Resolved'|'Closed';
export interface SecurityIncident {
  incidentId:string; severity:'low'|'medium'|'high'|'critical'; state:IncidentState;
  tenantId?:string; title:string; createdAt:string; evidenceIds:string[];
  containmentActions:string[]; sourceRequirementIds:string[];
}
