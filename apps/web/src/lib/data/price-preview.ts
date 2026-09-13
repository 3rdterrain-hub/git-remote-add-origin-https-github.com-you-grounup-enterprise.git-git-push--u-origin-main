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

/**
 * The contingency the engine will actually charge, which is not always the one
 * on the panel.
 *
 * `calculateEstimate` derives a contingency from the weighted confidence of the
 * run and applies **the higher** of that and the profile's, unless somebody has
 * approved an override. A bid at 70.6 confidence is charged 8% however firmly
 * the profile says 3%, and the estimate is priced right — but the panel was
 * previewing the profile's figure, coming out five points light, and then
 * telling the estimator the *correct* recorded price was stale and should be
 * re-priced. Following that advice changed nothing, because the engine applied
 * the same 8% again.
 *
 * So the preview carries the same three inputs the engine has and applies the
 * same rule, and the panel says which of the three won.
 */
export interface ContingencyContext {
  /** What the last run's weighted confidence justifies, from the engine. */
  recommended: number;
  /**
   * The version's own figure, and only when it is an approved override —
   * migration 0006 requires a reason and an approver for one, and the Edge
   * Function passes it to the engine on no weaker terms.
   */
  override?: number | null;
}

/** Which of the three contingencies was charged, and why. */
export interface AppliedContingency {
  applied: number;
  source: 'override' | 'profile' | 'confidence_band';
  recommended: number;
  /** What the panel holds, or null when contingency is off or absent there. */
  onPanel: number | null;
}

export interface PreviewInput {
  /** The engine's own figures from the last run. Not recomputed. */
  directCost: number;
  indirectCost: number;
  /** Adjustments as they stand on screen, including unsaved edits. */
  markups: readonly EstimateMarkup[];
  discount: Discount;
  method?: 'parallel' | 'stacked';
  regionalFactor?: number;
  /**
   * Omitted on an estimate that has never been priced, where there is no
   * confidence to derive a contingency from. The preview then charges exactly
   * what the panel holds, which is all it can honestly say.
   */
  contingency?: ContingencyContext;
}

export interface PricePreview {
  totalPrice: number;
  totalMarkup: number;
  discountAmount: number;
  grossMarginPercent: number;
  components: ReadonlyArray<{ code: string; label: string; amount: number }>;
  warnings: readonly string[];
  derivation: readonly string[];
  /** Null when no confidence figure was available to derive one from. */
  contingency: AppliedContingency | null;
}

/**
 * The engine's contingency rule, in the one place both sides read it from.
 *
 * Mirrors `calculateEstimate` in `@grounup/engine`: an approved override wins;
 * otherwise the profile's figure is used only when it is at least what the
 * confidence band justifies; otherwise the confidence band wins.
 */
export function resolveContingency(
  ctx: ContingencyContext, onPanel: number | null,
): AppliedContingency {
  if (ctx.override !== null && ctx.override !== undefined) {
    return { applied: ctx.override, source: 'override', recommended: ctx.recommended, onPanel };
  }
  if (onPanel !== null && onPanel >= ctx.recommended) {
    return { applied: onPanel, source: 'profile', recommended: ctx.recommended, onPanel };
  }
  return { applied: ctx.recommended, source: 'confidence_band', recommended: ctx.recommended, onPanel };
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
  const onPanel = enabled.map((m) => ({
    code: m.code,
    label: m.label,
    percent: m.percent,
    basis: m.basis,
    sequence: m.sequence,
    disclosed: m.disclosed,
  }));

  /*
   * Substituted exactly as `calculateEstimate` substitutes it: CONT is dropped
   * and re-added at the applied rate on the profile's own basis, and left out
   * entirely at zero rather than shown as a line charged nothing.
   */
  const contingency = input.contingency
    ? resolveContingency(
        input.contingency,
        enabled.find((m) => m.code === 'CONT')?.percent ?? null)
    : null;
  const components = contingency === null
    ? onPanel
    : [
        ...onPanel.filter((c) => c.code !== 'CONT'),
        ...(contingency.applied > 0
          ? [{
              code: 'CONT', label: 'Contingency', percent: contingency.applied,
              basis: 'profile_default' as const, sequence: 30, disclosed: false,
            }]
          : []),
      ];

  const profile: PricingProfile = {
    id: 'preview',
    name: 'Preview',
    method: input.method ?? 'parallel',
    components,
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
    contingency,
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
