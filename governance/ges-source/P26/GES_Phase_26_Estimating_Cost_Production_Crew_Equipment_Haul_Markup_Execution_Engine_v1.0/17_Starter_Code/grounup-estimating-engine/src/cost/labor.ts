export function crewLaborHours(durationHours: number, crewCount: number): number {
  if (durationHours < 0 || crewCount < 0) throw new Error('Invalid labor input');
  return durationHours * crewCount;
}
export function laborCost(laborHours: number, loadedHourlyRate: number): number {
  return laborHours * loadedHourlyRate;
}
