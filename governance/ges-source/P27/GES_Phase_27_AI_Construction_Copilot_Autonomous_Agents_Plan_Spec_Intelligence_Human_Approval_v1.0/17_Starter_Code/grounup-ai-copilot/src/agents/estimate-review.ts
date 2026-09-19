export interface Phase26Tool {
  readCalculationTrace(tenantId:string, estimateId:string, version:number):Promise<unknown>;
  recalculate(tenantId:string, estimateId:string, version:number, scenarioId:string):Promise<unknown>;
}
export class EstimateReviewAgent {
  constructor(private readonly phase26:Phase26Tool) {}
  async verifyMath(tenantId:string, estimateId:string, version:number, scenarioId:string) {
    const trace = await this.phase26.readCalculationTrace(tenantId, estimateId, version);
    const recalculated = await this.phase26.recalculate(tenantId, estimateId, version, scenarioId);
    return { trace, recalculated, authoritativeMathSource:'Phase26' as const };
  }
}
// The agent reviews; it does not invent authoritative estimate arithmetic.
