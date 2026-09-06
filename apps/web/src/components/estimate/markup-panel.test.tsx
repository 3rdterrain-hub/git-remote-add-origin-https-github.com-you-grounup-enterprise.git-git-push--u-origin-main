/**
 * Markup on this bid.
 *
 * The distinction the panel exists to make: adjusting a bond here changes this
 * estimate, and editing the pricing profile would change every open one. A
 * screen that did not say which was happening would be the most expensive kind
 * of ambiguity — a rate somebody set for one job quietly applied to twenty.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EstimateMarkup } from '@/lib/data/estimates';

const hoisted = vi.hoisted(() => ({
  configured: true,
  markups: [] as EstimateMarkup[],
  fromProfile: true,
  adopted: 0,
  set: [] as Array<{ code: string; fields: Record<string, unknown> }>,
  removed: [] as string[],
  fail: null as string | null,
  discount: { percent: 0, amount: 0, reason: null as string | null },
  discountSet: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/estimates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/estimates')>(
    '@/lib/data/estimates');
  return {
    ...actual,
    loadEstimateMarkups: () => async () => ({
      markups: hoisted.markups, fromProfile: hoisted.fromProfile,
    }),
    setEstimateMarkup: async (_c: unknown, _v: string, code: string,
                              fields: Record<string, unknown>) => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      hoisted.set.push({ code, fields });
    },
    adoptProfileMarkups: async () => { hoisted.adopted += 1; return 3; },
    removeEstimateMarkup: async (_c: unknown, _v: string, code: string) => {
      hoisted.removed.push(code);
    },
    loadDiscount: () => async () => hoisted.discount,
    setEstimateDiscount: async (_c: unknown, input: Record<string, unknown>) => {
      hoisted.discountSet.push(input);
    },
  };
});

const { MarkupPanel } = await import('./markup-panel');

const markup = (over: Partial<EstimateMarkup> = {}): EstimateMarkup => ({
  code: 'OH', label: 'Overhead', percent: 0.10, basis: 'profile_default',
  sequence: 10, disclosed: false, enabled: true, ...over,
});

/*
 * The panel is a collapsible section now and starts shut, showing the markups
 * it holds on its header. Opening it is what every one of these tests is about,
 * so it happens here rather than in each.
 */
const show = async (editable = true, cost?: {
  directCost?: number; indirectCost?: number; storedPrice?: number;
}) => {
  const r = render(<MarkupPanel versionId="v-1" editable={editable}
    directCost={cost?.directCost ?? 0}
    indirectCost={cost?.indirectCost ?? 0}
    storedPrice={cost?.storedPrice ?? 0} />);
  await userEvent.click(
    await screen.findByRole('button', { name: /markup and adjustments/i }));
  return r;
};

describe('markup and adjustments', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.fail = null;
    hoisted.markups = [markup()]; hoisted.fromProfile = true;
    hoisted.adopted = 0; hoisted.set = []; hoisted.removed = [];
    hoisted.discount = { percent: 0, amount: 0, reason: null };
    hoisted.discountSet = [];
  });

  it('says the numbers are coming from the company profile', async () => {
    await show();
    await waitFor(() =>
      expect(screen.getByText(/Coming from your pricing profile/)).toBeInTheDocument());
    expect(screen.getByText(/affects this estimate and not every open one/))
      .toBeInTheDocument();
  });

  it('says when the bid carries its own', async () => {
    hoisted.fromProfile = false;
    await show();
    await waitFor(() =>
      expect(screen.getByText(/This bid carries its own/)).toBeInTheDocument());
    expect(screen.getByText(/pricing profile is unchanged/)).toBeInTheDocument();
  });

  it('shows a fraction as the percentage a person types', async () => {
    hoisted.markups = [markup({ percent: 0.073, code: 'TAX', label: 'Tax' })];
    await show();
    await waitFor(() => expect(screen.getByLabelText('Tax percent')).toHaveValue('7.3'));
  });

  it('copies the profile down before the first change', async () => {
    /*
     * Otherwise switching tax on would silently drop the overhead and profit
     * that were coming from the profile — a bid priced without its markup.
     */
    const user = userEvent.setup();
    await show();
    await waitFor(() => expect(screen.getByLabelText('Apply Tax')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Apply Tax'));
    await waitFor(() => expect(hoisted.adopted).toBe(1));
    expect(hoisted.set[0]!.code).toBe('TAX');
  });

  it('does not copy again once the bid has its own', async () => {
    hoisted.fromProfile = false;
    const user = userEvent.setup();
    await show();
    await waitFor(() => expect(screen.getByLabelText('Apply Tax')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Apply Tax'));
    await waitFor(() => expect(hoisted.set).toHaveLength(1));
    expect(hoisted.adopted).toBe(0);
  });

  it('sends a percentage as the fraction the schema stores', async () => {
    hoisted.fromProfile = false;
    const user = userEvent.setup();
    await show();
    await waitFor(() => expect(screen.getByLabelText('Tax percent')).toBeInTheDocument());
    const field = screen.getByLabelText('Tax percent');
    await user.clear(field);
    await user.type(field, '7.3');
    await user.tab();
    await waitFor(() => expect(hoisted.set).toHaveLength(1));
    expect(hoisted.set[0]!.fields).toMatchObject({ percent: 0.073, enabled: true });
  });

  it('carries the basis, because bond and tax are charged differently', async () => {
    /*
     * Bond and tax apply to the marked-up total in a second pass; overhead and
     * profit apply against cost. Backwards is a few percent on every bonded bid.
     */
    hoisted.fromProfile = false;
    const user = userEvent.setup();
    await show();
    await waitFor(() => expect(screen.getByLabelText('Apply Bond / permit')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Apply Bond / permit'));
    await waitFor(() => expect(hoisted.set).toHaveLength(1));
    expect(hoisted.set[0]!.fields).toMatchObject({ basis: 'marked_up_total' });
    expect(screen.getAllByText('On the marked-up total, in a second pass.').length).toBe(2);
  });

  it('marks which adjustments the customer is told about', async () => {
    await show();
    await waitFor(() =>
      expect(screen.getAllByText('shown to the customer').length).toBe(2));
  });

  it('explains that switching one off is not the same as zero', async () => {
    await show();
    await waitFor(() => expect(
      screen.getByText(/a bond charged at nothing still reads as a line the customer was billed for/)
    ).toBeInTheDocument());
    expect(screen.getByText(/an empty panel is not the same as a job with no overhead/))
      .toBeInTheDocument();
  });

  it('removes one from the bid', async () => {
    hoisted.fromProfile = false;
    const user = userEvent.setup();
    await show();
    await waitFor(() =>
      expect(screen.getByLabelText('Remove Overhead from this bid')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Remove Overhead from this bid'));
    await waitFor(() => expect(hoisted.removed).toEqual(['OH']));
  });

  it('offers no removal while the numbers are the profile\'s', async () => {
    // Removing one would mean removing it from the company standard, which is
    // not what somebody clicking a bin on an estimate means.
    await show();
    await waitFor(() => expect(screen.getByLabelText('Apply Overhead')).toBeInTheDocument());
    expect(screen.queryByLabelText('Remove Overhead from this bid')).not.toBeInTheDocument();
  });

  it('says a change failed rather than showing it as though it took', async () => {
    hoisted.fail = 'This version is approved; make a new version to change it';
    const user = userEvent.setup();
    await show();
    await waitFor(() => expect(screen.getByLabelText('Apply Tax')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Apply Tax'));
    await waitFor(() =>
      expect(screen.getByText(/make a new version to change it/)).toBeInTheDocument());
  });

  it('keeps the discount apart from the markup, and says why', async () => {
    /*
     * The engine refuses a negative markup component on purpose: one that
     * reduced the price would make "what is this marked up at" unanswerable.
     */
    await show();
    await waitFor(() => expect(screen.getByLabelText('Apply a discount')).toBeInTheDocument());
    expect(screen.getByText(/five percent off means five percent off the number quoted/))
      .toBeInTheDocument();
    expect(screen.getByText(/still an answerable question/)).toBeInTheDocument();
  });

  it('starts a discount at something rather than zero', async () => {
    // A switch that turns on and changes nothing looks broken.
    const user = userEvent.setup();
    await show();
    await waitFor(() => expect(screen.getByLabelText('Apply a discount')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Apply a discount'));
    await waitFor(() => expect(hoisted.discountSet).toHaveLength(1));
    expect(hoisted.discountSet[0]).toMatchObject({ percent: 0.05 });
  });

  it('clears both halves when it is switched off', async () => {
    hoisted.discount = { percent: 0.05, amount: 1000, reason: 'Negotiated' };
    const user = userEvent.setup();
    await show();
    await waitFor(() => expect(screen.getByLabelText('Apply a discount')).toBeChecked());
    await user.click(screen.getByLabelText('Apply a discount'));
    await waitFor(() => expect(hoisted.discountSet).toHaveLength(1));
    expect(hoisted.discountSet[0]).toMatchObject({ percent: 0, amount: 0 });
  });

  it('says when nobody recorded why the price was cut', async () => {
    hoisted.discount = { percent: 0.05, amount: 0, reason: null };
    await show();
    await waitFor(() =>
      expect(screen.getByText(/cannot tell what was given away/)).toBeInTheDocument());
  });

  it('keeps quiet once there is a reason', async () => {
    hoisted.discount = { percent: 0.05, amount: 0, reason: 'Repeat customer' };
    await show();
    await waitFor(() =>
      expect(screen.getByLabelText('Discount reason')).toHaveValue('Repeat customer'));
    expect(screen.queryByText(/cannot tell what was given away/)).not.toBeInTheDocument();
  });

  it('moves the total as the adjustments change, without waiting on the engine', async () => {
    /*
     * Bid day. `calculatePrice` here is the same module the pricing Edge
     * Function runs — vendored with a fingerprint the build refuses to let
     * drift — so this is the first implementation called from the other side
     * rather than a second opinion about the arithmetic.
     */
    hoisted.markups = [
      markup({ percent: 0.10 }),
      markup({ code: 'PROFIT', label: 'Profit', percent: 0.15, sequence: 20 }),
    ];
    await show(true, { directCost: 100_000, storedPrice: 125_000 });
    await waitFor(() => expect(screen.getByText('$125,000.00')).toBeInTheDocument());
    expect(screen.getByText('Total price')).toBeInTheDocument();
    expect(screen.getByText(/same engine that writes the price/)).toBeInTheDocument();
  });

  it('says when the preview has drifted from what is recorded', async () => {
    // A preview read as the bid is worse than no preview at all.
    hoisted.markups = [markup({ percent: 0.30 })];
    await show(true, { directCost: 100_000, storedPrice: 125_000 });
    await waitFor(() =>
      expect(screen.getByText('With these adjustments')).toBeInTheDocument());
    expect(screen.getByText(/still recorded at \$125,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/a preview, not the bid/)).toBeInTheDocument();
  });

  it('previews nothing at all on an estimate that was never priced', async () => {
    // Markup on zero would put a confident total in front of somebody who has
    // not priced anything.
    await show(true, { directCost: 0 });
    await waitFor(() => expect(
      screen.getByText(/Price the estimate and the total will move/)).toBeInTheDocument());
  });

  it('shows the engine\'s own warning about selling below cost', async () => {
    hoisted.markups = [markup({ percent: 0.10 })];
    hoisted.discount = { percent: 0.30, amount: 0, reason: 'Wanted the work' };
    await show(true, { directCost: 100_000, storedPrice: 110_000 });
    await waitFor(() =>
      expect(screen.getByText(/loses money at the number quoted/)).toBeInTheDocument());
  });

  it('changes nothing on a frozen version', async () => {
    await show(false);
    await waitFor(() => expect(screen.getByLabelText('Apply Overhead')).toBeDisabled());
    expect(screen.getByLabelText('Overhead percent')).toBeDisabled();
  });
});
