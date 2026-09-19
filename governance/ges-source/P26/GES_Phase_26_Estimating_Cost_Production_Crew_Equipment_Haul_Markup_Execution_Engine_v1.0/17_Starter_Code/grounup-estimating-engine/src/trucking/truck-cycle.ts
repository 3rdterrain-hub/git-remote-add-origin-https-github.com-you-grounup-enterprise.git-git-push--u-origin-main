export interface TruckCycleInput {
  loadMinutes: number; outboundMinutes: number; dumpQueueMinutes: number; returnMinutes: number; delayMinutes?: number;
}
export function cycleMinutes(i: TruckCycleInput): number {
  return i.loadMinutes + i.outboundMinutes + i.dumpQueueMinutes + i.returnMinutes + (i.delayMinutes ?? 0);
}
export function trips(quantity: number, payload: number): number {
  if (quantity < 0 || payload <= 0) throw new Error('Invalid haul input');
  return Math.ceil(quantity / payload);
}
export function balancedTruckCount(sourceProductionPerHour: number, payload: number, cycleMin: number): number {
  if (sourceProductionPerHour < 0 || payload <= 0 || cycleMin <= 0) throw new Error('Invalid truck balance input');
  return Math.max(1, Math.ceil((sourceProductionPerHour * (cycleMin/60)) / payload));
}
