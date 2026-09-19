export interface ServiceWritebackProposal {
  tenantId:string; estimateId:string; serviceCode?:string; proposedName:string;
  proposedCategory:string; proposedUnit:string; evidenceIds:string[]; status:'Proposed';
}
// Send to Phase 25 governed writeback workflow; do not publish directly.
