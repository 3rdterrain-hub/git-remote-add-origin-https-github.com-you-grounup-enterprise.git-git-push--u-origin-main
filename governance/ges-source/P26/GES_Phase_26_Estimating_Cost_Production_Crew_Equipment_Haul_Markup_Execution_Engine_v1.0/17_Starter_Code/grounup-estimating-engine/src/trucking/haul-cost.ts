export function hourlyHaulCost(truckCount:number, hourlyRate:number, durationHours:number):number {
  return truckCount * hourlyRate * durationHours;
}
export function tripHaulCost(trips:number, tripRate:number):number {
  return trips * tripRate;
}
