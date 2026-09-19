import { RequestContext } from '../context/request-context';
export interface TransitionRequest { workflowId: string; transition: string; comment?: string; evidenceIds?: string[]; }
export interface TransitionResult { workflowId: string; fromState: string; toState: string; decisionId?: string; }
export interface WorkflowEngine { transition(ctx: RequestContext, request: TransitionRequest): Promise<TransitionResult>; }
