export interface ApprovalRequest {
  approvalRequestId:string;
  tenantId:string;
  taskId:string;
  proposedAction:{toolId:string; arguments:unknown};
  evidenceIds:string[];
  requestedByAgentId:string;
  expiresAt?:string;
}
export interface ApprovalDecision {
  approvalRequestId:string;
  reviewerId:string;
  decision:'Approved'|'Rejected';
  decidedAt:string;
  reason?:string;
}
// Confidence score never substitutes for approval.
