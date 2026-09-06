/**
 * Arranging the workspace.
 *
 * The navigation was a constant: eighteen items in one order for a chief
 * estimator who lives in the estimator and a fleet manager who never opens it.
 * What is tested here is that a person's arrangement survives — including the
 * two ways it could silently not: a preference that fails to save and is
 * treated as saved, and a screen the application adds later that disappears
 * because it is not in anybody's saved order.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Calculator, HardHat, LayoutDashboard, Truck } from 'lucide-react';
import { applyNavOrder, DEFAULT_NAV, type NavPreference } from '@/lib/data/preferences';

const hoisted = vi.hoisted(() => ({ configured: true, saved: null as unknown, fail: null as string | null }));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/preferences', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/preferences')>(
    '@/lib/data/preferences');
  return {
    ...actual,
    saveNavPreference: async (_c: unknown, value: unknown) => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      hoisted.saved = value;
    },
  };
});

const { CustomizeNavDialog } = await import('./customize-nav');

const ITEMS = [
  { key: '/app', label: 'Dashboard', icon: LayoutDashboard },
  { key: '/app/estimates', label: 'Estimator', icon: Calculator },
  { key: '/app/projects', label: 'Projects', icon: HardHat },
  { key: '/app/fleet', label: 'Fleet', icon: Truck },
];

describe('applying a saved arrangement', () => {
  it('puts the arranged items first, in the order they were arranged', () => {
    const pref: NavPreference = { placement: 'side', order: ['/app/fleet', '/app'], hidden: [] };
    expect(applyNavOrder(ITEMS, pref).map((i) => i.label))
      .toEqual(['Fleet', 'Dashboard', 'Estimator', 'Projects']);
  });

  it('puts a screen the application added later at the end rather than nowhere', () => {
    /*
     * The alternative — showing only what is in the saved order — would hide a
     * feature the customer is paying for the moment the platform ships one, and
     * they would have no way of knowing it existed.
     */
    const pref: NavPreference = {
      placement: 'side', order: ['/app', '/app/estimates'], hidden: [],
    };
    const withNew = [...ITEMS, { key: '/app/claims', label: 'Claims', icon: HardHat }];
    expect(applyNavOrder(withNew, pref).map((i) => i.label))
      .toEqual(['Dashboard', 'Estimator', 'Projects', 'Fleet', 'Claims']);
  });

  it('leaves out what the person put away', () => {
    const pref: NavPreference = { placement: 'side', order: [], hidden: ['/app/fleet'] };
    expect(applyNavOrder(ITEMS, pref).map((i) => i.label))
      .toEqual(['Dashboard', 'Estimator', 'Projects']);
  });

  it('ignores an item in a saved order that no longer exists', () => {
    // A screen the platform removed. The arrangement survives the rest.
    const pref: NavPreference = {
      placement: 'side', order: ['/app/gone', '/app/fleet'], hidden: [],
    };
    expect(applyNavOrder(ITEMS, pref).map((i) => i.label))
      .toEqual(['Fleet', 'Dashboard', 'Estimator', 'Projects']);
  });
});

describe('the arrange dialog', () => {
  beforeEach(() => { hoisted.configured = true; hoisted.saved = null; hoisted.fail = null; });

  const open = (value: NavPreference = DEFAULT_NAV, onSaved = vi.fn()) => {
    render(<CustomizeNavDialog open onOpenChange={vi.fn()} items={ITEMS}
      value={value} onSaved={onSaved} />);
    return onSaved;
  };

  it('offers both placements and shows which one is in force', () => {
    open({ ...DEFAULT_NAV, placement: 'top' });
    expect(screen.getByRole('button', { name: /Across the top/ }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Down the side/ }))
      .toHaveAttribute('aria-pressed', 'false');
  });

  it('moves an item with the buttons, not only by dragging', async () => {
    // The buttons are the accessible way to do it, they work on a phone, and
    // they are how somebody moves an item eleven places.
    const user = userEvent.setup();
    const onSaved = open();
    await user.click(screen.getByLabelText('Move Fleet up'));
    await user.click(screen.getByRole('button', { name: 'Save arrangement' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect((onSaved.mock.calls[0]![0] as NavPreference).order)
      .toEqual(['/app', '/app/estimates', '/app/fleet', '/app/projects']);
  });

  it('cannot move the first item up or the last one down', () => {
    open();
    expect(screen.getByLabelText('Move Dashboard up')).toBeDisabled();
    expect(screen.getByLabelText('Move Fleet down')).toBeDisabled();
  });

  it('records the whole order, not only what was touched', async () => {
    /*
     * An item nobody moved still gets a recorded position. Otherwise the next
     * screen the platform adds above it would shift it, and the person would
     * find their arrangement quietly rearranged.
     */
    const user = userEvent.setup();
    const onSaved = open();
    await user.click(screen.getByRole('button', { name: 'Save arrangement' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect((onSaved.mock.calls[0]![0] as NavPreference).order).toHaveLength(ITEMS.length);
  });

  it('hides an item without pretending it was taken away', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByLabelText('Hide Projects'));
    expect(screen.getByText('3 of 4 shown')).toBeInTheDocument();
    // Still listed, so it can come back to the place it had.
    expect(screen.getByLabelText('Show Projects')).toBeInTheDocument();
    expect(screen.getByText(/does not change what you are permitted to open/))
      .toBeInTheDocument();
  });

  it('says a save failed instead of closing as though it worked', async () => {
    /*
     * The failure this guards against is silent: a dialog that closes on a
     * failed write looks exactly like one that closed on a successful one, and
     * the person finds out on Monday when their arrangement is gone.
     */
    hoisted.fail = 'Could not find the function public.set_my_preference';
    const user = userEvent.setup();
    const onSaved = open();
    await user.click(screen.getByRole('button', { name: 'Save arrangement' }));
    await waitFor(() =>
      expect(screen.getByText(/Could not find the function/)).toBeInTheDocument());
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('puts everything back where it shipped', async () => {
    const user = userEvent.setup();
    open({ placement: 'top', order: ['/app/fleet'], hidden: ['/app/projects'] });
    await user.click(screen.getByRole('button', { name: /Back to the original/ }));
    expect(screen.getByRole('button', { name: /Down the side/ }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('4 of 4 shown')).toBeInTheDocument();
  });
});
