export interface MarkupStep { id:string; percent:number; basis:'direct'|'running-total'|'selected'; }
export function applyMarkup(directCost:number, steps:MarkupStep[]):number {
  let total=directCost;
  for (const s of steps) {
    const basis = s.basis === 'direct' ? directCost : total;
    total += basis * s.percent;
  }
  return total;
}
// Production implementation must honor the approved selected-basis configuration and exclusions.
