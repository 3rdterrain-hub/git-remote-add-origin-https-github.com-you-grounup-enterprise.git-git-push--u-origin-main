export function purchaseQuantity(installed:number, wasteFactor:number):number {
  if (installed < 0 || wasteFactor < 0) throw new Error('Invalid material input');
  return installed * (1 + wasteFactor);
}
export function materialCost(purchaseQty:number, unitPrice:number, freight:number=0):number {
  return purchaseQty * unitPrice + freight;
}
