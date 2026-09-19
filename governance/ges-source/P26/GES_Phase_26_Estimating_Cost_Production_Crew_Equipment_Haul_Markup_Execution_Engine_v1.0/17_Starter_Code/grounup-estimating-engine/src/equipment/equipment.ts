export interface EquipmentRateSet { hourly?: number; daily?: number; weekly?: number; monthly?: number; hoursPerDay?: number; daysPerWeek?: number; }
export type RatePolicy = 'contracted' | 'least-cost-available-period';
export function referenceEquipmentCost(runtimeHours: number, rates: EquipmentRateSet, policy: RatePolicy): number {
  if (runtimeHours < 0) throw new Error('Invalid runtime');
  if (policy === 'contracted' && rates.hourly != null) return runtimeHours * rates.hourly;
  const hpd = rates.hoursPerDay ?? 8, dpw = rates.daysPerWeek ?? 5;
  const options:number[] = [];
  if (rates.hourly != null) options.push(runtimeHours * rates.hourly);
  if (rates.daily != null) options.push(Math.ceil(runtimeHours / hpd) * rates.daily);
  if (rates.weekly != null) options.push(Math.ceil(runtimeHours / (hpd*dpw)) * rates.weekly);
  if (!options.length) throw new Error('No applicable equipment rate');
  return Math.min(...options);
}
// Production use must follow the approved tenant rate-selection policy and may not assume linear conversions.
