import { EvidenceRef } from '../contracts/ai';
export interface EvidenceService {
  resolvePermitted(tenantId:string, actorId:string, evidenceIds:string[]):Promise<EvidenceRef[]>;
  assertPermission(tenantId:string, actorId:string, evidence:EvidenceRef):Promise<void>;
}
// Citations must never reveal a source the actor cannot open.
