export function durationHours(quantity: number, productionPerHour: number): number {
  if (quantity < 0 || productionPerHour <= 0) throw new Error('Invalid quantity or production rate');
  return quantity / productionPerHour;
}
export function adjustedProduction(base: number, modifiers: number[]): number {
  if (base <= 0) throw new Error('Invalid base production');
  return modifiers.reduce((v, m) => v * m, base);
}
