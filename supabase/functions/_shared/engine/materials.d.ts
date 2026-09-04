/**
 * Material cost.
 *
 * Material was the one estimating bucket that entered the price as a figure
 * with no working behind it. That made it the only cost on the estimate a
 * reviewer could not check, which is exactly the position the rest of this
 * engine exists to avoid.
 *
 * The arithmetic is not "quantity x unit cost". Four things sit between the
 * two, and each is a real way a material line goes wrong:
 *
 *   * **Waste.** Placed quantity is not purchased quantity. Pipe bedding
 *     compacts, mix is left in the truck, sheet goods are cut.
 *   * **Order multiples.** Nobody sells 3.2 pallets. Rounding up to a whole
 *     pallet is money that is spent whether or not it is installed, and an
 *     estimate that ignores it is short by the remainder every time.
 *   * **Minimum orders.** A supplier with a 10-ton minimum charges for 10 tons
 *     when the job needs 4.
 *   * **Freight.** Delivered cost is what the job pays. Quoting ex-works and
 *     pricing delivered is a standard way to lose the margin on a material
 *     package.
 */
export type FreightBasis = 'included' | 'percent_of_material' | 'per_unit' | 'per_load' | 'lump_sum';
export interface MaterialInput {
    id: string;
    code: string;
    name: string;
    unit: string;
    /** Quantity the design requires, before waste. */
    netQuantity: number;
    /** Supplier price per unit, in the state the supplier quotes. */
    unitCost: number;
    /** Fraction added for waste, breakage and over-placement. 0.05 is 5%. */
    wastePercent?: number;
    /** The supplier sells only in multiples of this. 1 means any quantity. */
    orderMultiple?: number;
    /** The supplier will not sell less than this. */
    minimumOrderQuantity?: number;
    freightBasis?: FreightBasis;
    /** Meaning depends on `freightBasis`: a fraction, a rate per unit or per load, or a lump sum. */
    freightAmount?: number;
    /** Units carried per delivery. Required when freight is charged per load. */
    unitsPerLoad?: number;
    /** Sales or use tax on the material, as a fraction. */
    taxPercent?: number;
    /** A quoted price is firmer than a catalog price, and the estimate should say which. */
    source?: 'vendor_quote' | 'company_price' | 'regional_average' | 'catalog_seed';
    quoteExpiresOn?: string;
    /** Date the estimate is priced as of. Required to judge a quote's expiry. */
    asOf?: string;
}
export interface MaterialCostResult {
    id: string;
    code: string;
    name: string;
    unit: string;
    netQuantity: number;
    wasteQuantity: number;
    /** Net plus waste, before any supplier rounding. */
    grossQuantity: number;
    /** What is actually bought, after order multiples and minimums. */
    orderedQuantity: number;
    /** Bought but not installed. Money spent that the design does not use. */
    surplusQuantity: number;
    materialCost: number;
    freightCost: number;
    taxAmount: number;
    totalCost: number;
    /** Total divided by the quantity the design needs — what the line really costs. */
    effectiveUnitCost: number;
    source: NonNullable<MaterialInput['source']>;
    derivation: string;
    warnings: readonly string[];
}
export declare function calculateMaterialCost(input: MaterialInput): MaterialCostResult;
export interface MaterialPackageResult {
    lines: readonly MaterialCostResult[];
    materialCost: number;
    freightCost: number;
    taxAmount: number;
    totalCost: number;
    derivation: string;
    warnings: readonly string[];
}
/** Total a set of material lines, keeping freight and tax separately visible (RULE-001). */
export declare function calculateMaterialPackage(inputs: readonly MaterialInput[]): MaterialPackageResult;
