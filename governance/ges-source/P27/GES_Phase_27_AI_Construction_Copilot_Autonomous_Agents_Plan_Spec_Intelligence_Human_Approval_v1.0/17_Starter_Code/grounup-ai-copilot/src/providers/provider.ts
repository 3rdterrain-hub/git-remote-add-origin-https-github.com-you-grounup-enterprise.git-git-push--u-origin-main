export interface ModelRequest {
  tenantId:string;
  purpose:string;
  messages:Array<{role:string; content:string}>;
  dataClassification:string;
}
export interface ModelResponse {
  provider:string;
  model:string;
  modelVersion?:string;
  text:string;
  usage:{inputTokens?:number; outputTokens?:number; costUsd?:number};
}
export interface AIProvider {
  invoke(request:ModelRequest):Promise<ModelResponse>;
}
// Provider selection must be driven by approved model/data-classification policy.
