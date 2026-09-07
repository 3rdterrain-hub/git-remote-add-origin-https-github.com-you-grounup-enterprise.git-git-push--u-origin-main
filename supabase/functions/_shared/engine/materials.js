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
import { assertNonNegative, factor, money, qty, roundTo } from './numeric.js';
/** Round up to the next whole multiple. */
function toMultiple(value, multiple) {
    if (multiple <= 0)
        return value;
    return qty(Math.ceil(roundTo(value / multiple, 6)) * multiple);
}
export function calculateMaterialCost(input) {
    assertNonNegative(input.netQuantity, 'netQuantity');
    assertNonNegative(input.unitCost, 'unitCost');
    const wastePercent = input.wastePercent ?? 0;
    assertNonNegative(wastePercent, 'wastePercent');
    const orderMultiple = input.orderMultiple ?? 0;
    assertNonNegative(orderMultiple, 'orderMultiple');
    const minimum = input.minimumOrderQuantity ?? 0;
    assertNonNegative(minimum, 'minimumOrderQuantity');
    const taxPercent = input.taxPercent ?? 0;
    assertNonNegative(taxPercent, 'taxPercent');
    const freightBasis = input.freightBasis ?? 'included';
    const freightAmount = input.freightAmount ?? 0;
    assertNonNegative(freightAmount, 'freightAmount');
    const source = input.source ?? 'catalog_seed';
    const warnings = [];
    const parts = [];
    const wasteQuantity = qty(input.netQuantity * wastePercent);
    const grossQuantity = qty(input.netQuantity + wasteQuantity);
    parts.push(wastePercent > 0
        ? `${input.netQuantity} ${input.unit} net + ${factor(wastePercent) * 100}% waste = ${grossQuantity} ${input.unit}`
        : `${input.netQuantity} ${input.unit} net, no waste allowance`);
    let orderedQuantity = grossQuantity;
    if (orderMultiple > 0) {
        orderedQuantity = toMultiple(orderedQuantity, orderMultiple);
        if (orderedQuantity !== grossQuantity) {
            parts.push(`rounded up to a ${orderMultiple} ${input.unit} order multiple = ${orderedQuantity} ${input.unit}`);
        }
    }
    if (minimum > 0 && orderedQuantity < minimum) {
        parts.push(`raised to the ${minimum} ${input.unit} supplier minimum`);
        orderedQuantity = qty(minimum);
        warnings.push(`The supplier minimum of ${minimum} ${input.unit} exceeds what the job needs `
            + `(${grossQuantity} ${input.unit}). The difference is paid for either way.`);
    }
    const surplusQuantity = qty(orderedQuantity - input.netQuantity);
    const materialCost = money(orderedQuantity * input.unitCost);
    parts.push(`${orderedQuantity} ${input.unit} x ${money(input.unitCost)}/${input.unit} = ${materialCost} material`);
    /*
     * A material at zero contributes nothing and looks exactly like a material
     * that was priced. That is the most expensive silence available to an
     * estimating engine: the line prices, the estimate totals, the bid goes out,
     * and the material is bought at whatever it actually costs.
     *
     * The engine cannot tell "nobody has costed this" from "the owner supplies
     * it", so it does not try. It says the number is zero and that somebody has
     * to mean it, and `costState` is how a library says which — an explicitly
     * free material is stated rather than inferred from an empty field.
     */
    if (input.unitCost === 0 && input.netQuantity > 0) {
        warnings.push(input.costState === 'free'
            ? `${input.name} is priced at zero on purpose (${input.freeReason ?? 'recorded as supplied at no cost'}), `
                + 'so it adds nothing to this line.'
            : `${input.name} has no cost in the library, so it adds nothing to this line. `
                + `${orderedQuantity} ${input.unit} will still be bought.`);
    }
    let freightCost = 0;
    switch (freightBasis) {
        case 'included':
            parts.push('freight included in the unit price');
            break;
        case 'percent_of_material':
            freightCost = money(materialCost * freightAmount);
            parts.push(`freight ${factor(freightAmount) * 100}% of material = ${freightCost}`);
            break;
        case 'per_unit':
            freightCost = money(orderedQuantity * freightAmount);
            parts.push(`freight ${orderedQuantity} ${input.unit} x ${money(freightAmount)} = ${freightCost}`);
            break;
        case 'per_load': {
            const perLoad = input.unitsPerLoad ?? 0;
            if (perLoad <= 0) {
                throw new RangeError('unitsPerLoad must be > 0 when freight is charged per load');
            }
            const loads = Math.ceil(roundTo(orderedQuantity / perLoad, 6));
            freightCost = money(loads * freightAmount);
            // Part loads are paid in full, which is why this rounds up rather than
            // pro-rating: half a truck still sends a truck.
            parts.push(`freight ${orderedQuantity} ${input.unit} / ${perLoad} per load = ${loads} load(s)`
                + ` x ${money(freightAmount)} = ${freightCost}`);
            break;
        }
        case 'lump_sum':
            freightCost = money(freightAmount);
            parts.push(`freight lump sum = ${freightCost}`);
            break;
    }
    const taxAmount = money((materialCost + freightCost) * taxPercent);
    if (taxPercent > 0) {
        parts.push(`tax ${factor(taxPercent) * 100}% on ${money(materialCost + freightCost)} = ${taxAmount}`);
    }
    const totalCost = money(materialCost + freightCost + taxAmount);
    parts.push(`total = ${totalCost}`);
    // Effective unit cost is against the *net* quantity, because that is what the
    // design uses. Dividing by the ordered quantity would hide the surplus.
    const effectiveUnitCost = input.netQuantity > 0
        ? money(totalCost / input.netQuantity)
        : 0;
    if (input.netQuantity > 0) {
        parts.push(`${totalCost} / ${input.netQuantity} ${input.unit} net = ${effectiveUnitCost} effective per ${input.unit}`);
    }
    if (surplusQuantity > 0 && input.netQuantity > 0) {
        const share = surplusQuantity / input.netQuantity;
        if (share >= 0.15) {
            warnings.push(`${surplusQuantity} ${input.unit} (${roundTo(share * 100, 1)}% of the net quantity) is bought but not installed. `
                + 'Check the order multiple and supplier minimum against the design quantity.');
        }
    }
    if (source === 'catalog_seed') {
        warnings.push(`${input.code} is priced from the GrounUp catalog seed. Replace it with a company price or a vendor quote before issuing.`);
    }
    if (input.quoteExpiresOn && input.asOf && input.quoteExpiresOn < input.asOf) {
        warnings.push(`The vendor quote for ${input.code} expired ${input.quoteExpiresOn}, before the ${input.asOf} pricing date.`);
    }
    if (freightBasis === 'included' && source === 'vendor_quote') {
        warnings.push(`${input.code} is quoted with freight included. Confirm the quote is delivered rather than ex-works.`);
    }
    return {
        id: input.id, code: input.code, name: input.name, unit: input.unit,
        netQuantity: qty(input.netQuantity),
        wasteQuantity, grossQuantity, orderedQuantity, surplusQuantity,
        materialCost, freightCost, taxAmount, totalCost, effectiveUnitCost,
        source,
        derivation: parts.join('; '),
        warnings,
    };
}
/** Total a set of material lines, keeping freight and tax separately visible (RULE-001). */
export function calculateMaterialPackage(inputs) {
    const lines = inputs.map(calculateMaterialCost);
    const materialCost = money(lines.reduce((a, l) => a + l.materialCost, 0));
    const freightCost = money(lines.reduce((a, l) => a + l.freightCost, 0));
    const taxAmount = money(lines.reduce((a, l) => a + l.taxAmount, 0));
    const totalCost = money(materialCost + freightCost + taxAmount);
    return {
        lines,
        materialCost, freightCost, taxAmount, totalCost,
        derivation: `${lines.length} material line(s): ${materialCost} material`
            + ` + ${freightCost} freight + ${taxAmount} tax = ${totalCost}`,
        warnings: lines.flatMap((l) => l.warnings),
    };
}
