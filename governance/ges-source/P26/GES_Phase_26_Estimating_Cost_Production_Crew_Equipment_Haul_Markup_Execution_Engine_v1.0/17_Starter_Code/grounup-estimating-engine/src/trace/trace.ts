import { CalculationTrace } from '../model/types';
export function trace(formulaId:string, inputs:Record<string,unknown>, output:Record<string,unknown>, librarySnapshotId:string, sourceRequirementIds:string[]):CalculationTrace {
  return { formulaId, inputs, output, librarySnapshotId, sourceRequirementIds };
}
