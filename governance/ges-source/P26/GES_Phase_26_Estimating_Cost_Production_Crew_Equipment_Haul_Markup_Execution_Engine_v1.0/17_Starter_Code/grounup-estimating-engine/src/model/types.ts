export interface Money { amount: number; currency: string; }
export interface Quantity { value: number; unit: string; }
export interface CalculationTrace {
  formulaId: string;
  inputs: Record<string, unknown>;
  output: Record<string, unknown>;
  librarySnapshotId: string;
  sourceRequirementIds: string[];
}
export interface EstimateContext {
  tenantId: string;
  estimateId: string;
  estimateVersion: number;
  scenarioId: string;
  librarySnapshotId: string;
  currency: string;
}
