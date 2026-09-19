export type QualitySeverity='Info'|'Warning'|'Blocking';
export interface QualityRule { ruleId:string; datasetId:string; description:string; severity:QualitySeverity; }
export interface QualityResult { ruleId:string; passed:boolean; observed?:unknown; expected?:unknown; evidenceIds:string[]; }
export interface DataQualityEngine { run(datasetId:string, version:number):Promise<QualityResult[]>; }
