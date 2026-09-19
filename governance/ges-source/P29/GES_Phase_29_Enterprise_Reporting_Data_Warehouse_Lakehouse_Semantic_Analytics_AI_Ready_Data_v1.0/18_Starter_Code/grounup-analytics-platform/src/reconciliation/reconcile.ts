export interface ReconciliationResult {
  reconciliationId:string; sourceControl:number; targetControl:number; difference:number; tolerance:number; passed:boolean; evidenceIds:string[];
}
export function reconcile(source:number,target:number,tolerance:number):ReconciliationResult {
  const difference=target-source;
  return {reconciliationId:'generated',sourceControl:source,targetControl:target,difference,tolerance,passed:Math.abs(difference)<=tolerance,evidenceIds:[]};
}
