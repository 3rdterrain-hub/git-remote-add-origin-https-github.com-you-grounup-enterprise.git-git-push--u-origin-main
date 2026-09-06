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
  };
});

const { MarkupPanel } = await import('./markup-panel');

const markup = (over: Partial<EstimateMarkup> = {}): EstimateMarkup => ({
  code: 'OH', label: 'Overhead', percent: 0.10, basis: 'profile_default',
  sequence: 10, disclosed: false, enabled: true, ...over,
});

const show = (editable = true) =>
  render(<MarkupPanel versionId="v-1" editable={editable} />);

describe('markup and adjustments', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.fail = null;
    hoisted.markups = [markup()]; hoisted.fromProfile = true;
    hoisted.adopted = 0; hoisted.set = []; hoisted.removed = [];
  });

  it('says the numbers are coming from the company profile', async () => {
    await waitFor(() => { show(); });
    await waitFor(() =>
      expect(screen.getByText(/Coming from your pricing profile/)).toBeInTheDocument());
    expect(screen.getByText(/affects this estimate and not every open one/))
      .toBeInTheDocument();
  });

  it('says when the bid carries its own', async () => {
    hoisted.fromProfile = false;
    show();
    await waitFor(() =>
      expect(screen.getByText(/This bid carries its own/)).toBeInTheDocument());
    expect(screen.getByText(/pricing profile is unchanged/)).toBeInTheDocument();
  });

  it('shows a fraction as the percentage a person types', async () => {
    hoisted.markups = [markup({ percent: 0.073, code: 'TAX', label: 'Tax' })];
    show();
    await waitFor(() => expect(screen.getByLabelText('Tax percent')).toHaveValue('7.3'));
  });

  it('copies the profile down before the first change', async () => {
    /*
     * Otherwise switching tax on would silently drop the overhead and profit
     * that were coming from the profile — a bid priced without its markup.
     */
    const user = userEvent.setup();
    show();
    await waitFor(() => expect(screen.getByLabelText('Apply Tax')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Apply Tax'));
    await waitFor(() => expect(hoisted.adopted).toBe(1));
    expect(hoisted.set[0]!.code).toBe('TAX');
  });

  it('does not copy again once the bid has its own', async () => {
    hoisted.fromProfile = false;
    const user = userEvent.setup();
    show();
    await waitFor(() => expect(screen.getByLabelText('Apply Tax')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Apply Tax'));
    await waitFor(() => expect(hoisted.set).toHaveLength(1));
    expect(hoisted.adopted).toBe(0);
  });

  it('sends a percentage as the fraction the schema stores', async () => {
    hoisted.fromProfile = false;
    const user = userEvent.setup();
    show();
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
    show();
    await waitFor(() => expect(screen.getByLabelText('Apply Bond / permit')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Apply Bond / permit'));
    await waitFor(() => expect(hoisted.set).toHaveLength(1));
    expect(hoisted.set[0]!.fields).toMatchObject({ basis: 'marked_up_total' });
    expect(screen.getAllByText('On the marked-up total, in a second pass.').length).toBe(2);
  });

  it('marks which adjustments the customer is told about', async () => {
    show();
    await waitFor(() =>
      expect(screen.getAllByText('shown to the customer').length).toBe(2));
  });

  it('explains that switching one off is not the same as zero', async () => {
    show();
    await waitFor(() => expect(
      screen.getByText(/a bond charged at nothing still reads as a line the customer was billed for/)
    ).toBeInTheDocument());
    expect(screen.getByText(/an empty panel is not the same as a job with no overhead/))
      .toBeInTheDocument();
  });

  it('removes one from the bid', async () => {
    hoisted.fromProfile = false;
    const user = userEvent.setup();
    show();
    await waitFor(() =>
      expect(screen.getByLabelText('Remove Overhead from this bid')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Remove Overhead from this bid'));
    await waitFor(() => expect(hoisted.removed).toEqual(['OH']));
  });

  it('offers no removal while the numbers are the profile\'s', async () => {
    // Removing one would mean removing it from the company standard, which is
    // not what somebody clicking a bin on an estimate means.
    show();
    await waitFor(() => expect(screen.getByLabelText('Apply Overhead')).toBeInTheDocument());
    expect(screen.queryByLabelText('Remove Overhead from this bid')).not.toBeInTheDocument();
  });

  it('says a change failed rather than showing it as though it took', async () => {
    hoisted.fail = 'This version is approved; make a new version to change it';
    const user = userEvent.setup();
    show();
    await waitFor(() => expect(screen.getByLabelText('Apply Tax')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Apply Tax'));
    await waitFor(() =>
      expect(screen.getByText(/make a new version to change it/)).toBeInTheDocument());
  });

  it('changes nothing on a frozen version', async () => {
    show(false);
    await waitFor(() => expect(screen.getByLabelText('Apply Overhead')).toBeDisabled());
    expect(screen.getByLabelText('Overhead percent')).toBeDisabled();
  });
});
