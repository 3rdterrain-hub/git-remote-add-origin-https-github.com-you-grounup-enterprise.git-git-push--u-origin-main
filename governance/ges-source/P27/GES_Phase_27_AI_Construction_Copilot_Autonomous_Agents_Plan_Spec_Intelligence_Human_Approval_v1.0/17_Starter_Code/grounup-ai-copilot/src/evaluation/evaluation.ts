export interface EvaluationCase {
  caseId:string;
  input:unknown;
  expected:unknown;
  tags:string[];
}
export interface EvaluationResult {
  caseId:string;
  passed:boolean;
  metrics:Record<string,number>;
  notes?:string[];
}
export interface EvaluationRunner {
  run(datasetId:string, releaseId:string):Promise<EvaluationResult[]>;
}
