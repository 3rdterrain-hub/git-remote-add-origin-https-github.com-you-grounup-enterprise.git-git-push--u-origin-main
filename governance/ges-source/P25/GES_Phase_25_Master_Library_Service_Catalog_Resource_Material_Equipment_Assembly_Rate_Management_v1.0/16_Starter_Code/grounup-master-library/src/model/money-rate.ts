export interface MoneyRate {
  amount: number;
  currency: string;
  unit: string;
  effectiveFrom: string;
  effectiveTo?: string;
  regionProfileId?: string;
  sourceId?: string;
}
