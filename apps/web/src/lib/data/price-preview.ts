/**
 * What the price becomes, before the engine is asked.
 *
 * On bid day an estimator moves a markup, a contingency or a discount and needs
 * the total to move with them. Every price in this platform is written by the
 * pricing Edge Function, which is correct and is a network round trip — so the
 * screen has been showing a stale number between the change and the answer.
 *
 * This closes that gap without weakening the rule that the engine owns the
 * price, and the way it does so matters:
 *
 *   * **It is the engine.** `calculatePrice` is imported from `@grounup/engine`
 *     — the same module the Edge Function runs, vendored with a fingerprint the
 *     build refuses to let drift. This is not a second implementation of the
 *     arithmetic; it is the first one, called from the other side.
 *
 *   * **It only previews what markup is a function of.** Direct and indirect
 *     cost come from the last engine run and are not recomputed here. Moving a
 *     markup does not change what the work costs, so the preview is exact
 *     rather than approximate. Changing a quantity or a crew *does* change
 *     cost, and that still needs the engine, because the rates come from the
 *     library and RULE-003 decides which one wins.
 *
 *   * **It is never written.** The preview lives in the browser and dies there.
 *     What is stored is what the engine wrote, which is the whole point of
 *     migration 0058.
 */
import {
  calculatePrice, type PricingProfile, type PriceResult,
} from '@grounup/engine';
import type { EstimateMarkup, Discount } from './estimates';

export interface PreviewInput {
  /** The engine's own figures from the last run. Not recomputed. */
  directCost: number;
  indirectCost: number;
  /** Adjustments as they stand on screen, including unsaved edits. */
  markups: readonly EstimateMarkup[];
  discount: Discount;
  method?: 'parallel' | 'stacked';
  regionalFactor?: number;
}

export interface PricePreview {
  totalPrice: number;
  totalMarkup: number;
  discountAmount: number;
  grossMarginPercent: number;
  components: ReadonlyArray<{ code: string; label: string; amount: number }>;
  warnings: readonly string[];
  derivation: readonly string[];
}

/**
 * Price the adjustments on screen against the cost the engine last computed.
 *
 * Returns null when there is nothing to price against: an unpriced estimate has
 * no direct cost, and showing a total built on zero would put a confident
 * number in front of somebody who has not priced anything.
 */
export function previewPrice(input: PreviewInput): PricePreview | null {
  if (!(input.directCost > 0)) return null;

  const enabled = input.markups.filter((m) => m.enabled);
  const profile: PricingProfile = {
    id: 'preview',
    name: 'Preview',
    method: input.method ?? 'parallel',
    components: enabled.map((m) => ({
      code: m.code,
      label: m.label,
      percent: m.percent,
      basis: m.basis,
      sequence: m.sequence,
      disclosed: m.disclosed,
    })),
    ...(input.regionalFactor !== undefined ? { regionalFactor: input.regionalFactor } : {}),
    ...(input.discount.percent > 0 || input.discount.amount > 0
      ? {
          discount: {
            percent: input.discount.percent,
            amount: input.discount.amount,
            ...(input.discount.reason ? { reason: input.discount.reason } : {}),
          },
        }
      : {}),
  };

  let result: PriceResult;
  try {
    result = calculatePrice(input.directCost, input.indirectCost, profile);
  } catch {
    // The engine refuses inputs it cannot price — a negative percentage, a
    // discount above the price. A preview that threw would take the screen
    // down over a half-typed number.
    return null;
  }

  return {
    totalPrice: result.totalPrice,
    totalMarkup: result.totalMarkup,
    discountAmount: result.discountAmount,
    grossMarginPercent: result.grossMarginPercent,
    components: result.appliedMarkups.map((m) => ({
      code: m.code, label: m.label, amount: m.amount,
    })),
    warnings: result.warnings,
    derivation: result.derivation,
  };
}

/**
 * Whether the preview and the stored price still agree.
 *
 * A screen showing a preview that differs from what is recorded has to say so,
 * or somebody will read the preview as the bid. A cent of difference is
 * rounding; anything more is an estimate that has not been priced since it was
 * changed.
 */
export function previewDiffersFromStored(preview: number, stored: number): boolean {
  return Math.abs(preview - stored) > 0.01;
}
