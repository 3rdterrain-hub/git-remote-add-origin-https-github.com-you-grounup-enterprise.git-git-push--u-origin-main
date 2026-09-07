/**
 * A rate you type, and a crew you did not have to assemble.
 *
 * The property that matters most is that a line cannot end up carrying both. A
 * typed rate with resources built up underneath it reports a number nobody can
 * reproduce from what is on the line, which is the failure this whole schema is
 * arranged to prevent — so the screen refuses to offer the rate while there are
 * resources, and hides the suggestions once a rate is set.
 *
 * After that: the basis is required rather than optional, because "Sub quote,
 * Delaney Bros, 14 Aug" and "roughly what we got last year" are different
 * numbers; and the suggestions are shown before anything is written, because a
 * screen that filled the resources in the moment a service was picked would be
 * making a claim about the job on the estimator's behalf.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ResourceSuggestion } from '@/lib/data/estimates';

const hoisted = vi.hoisted(() => ({
  suggestions: [] as ResourceSuggestion[],
  applied: [] as Array<{ lineId: string; kinds?: string[] }>,
  setRate: [] as Array<{ rate: number; basis: string }>,
  cleared: [] as string[],
  failWith: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {},
}));

vi.mock('@/lib/data/estimates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/estimates')>(
    '@/lib/data/estimates');
  return {
    ...actual,
    loadResourceSuggestions: () => async () => hoisted.suggestions,
    applyResourceSuggestions: async (_c: unknown, lineId: string, kinds?: string[]) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.applied.push({ lineId, kinds });
      return kinds ? 1 : hoisted.suggestions.filter((s) => !s.alreadyOnLine && !s.isOptional).length;
    },
    setLineUnitCost: async (_c: unknown, _l: string, rate: number, basis: string) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.setRate.push({ rate, basis });
    },
    clearLineUnitCost: async (_c: unknown, lineId: string) => { hoisted.cleared.push(lineId); },
  };
});

const { UnitCostPanel, ResourceSuggestions } = await import('./unit-cost');

const suggestion = (over: Partial<ResourceSuggestion> = {}): ResourceSuggestion => ({
  kind: 'equipment', resourceId: 'e-1', name: 'Excavator 320',
  quantityPerUnit: 0.02, quantity: 10, unit: 'HR', unitRate: 145,
  extendedCost: 1450, isOptional: false, alreadyOnLine: false, ...over,
});

const panel = (over: Partial<React.ComponentProps<typeof UnitCostPanel>> = {}) => {
  const onChanged = vi.fn();
  render(<UnitCostPanel lineId="l-1" unit="CY" rate={null} basis={null}
    hasResources={false} editable onChanged={onChanged} {...over} />);
  return { onChanged };
};

beforeEach(() => {
  hoisted.suggestions = [];
  hoisted.applied = [];
  hoisted.setRate = [];
  hoisted.cleared = [];
  hoisted.failWith = null;
});

// ---------------------------------------------------------------------------
describe('pricing a line at a rate', () => {
  it('offers it on a line with nothing built up', async () => {
    panel();
    expect(await screen.findByRole('button', { name: /Price at a unit cost/ }))
      .toBeInTheDocument();
  });

  it('refuses to offer it when the line already has resources, and says why', () => {
    panel({ hasResources: true });
    expect(screen.getByRole('button', { name: /Price at a unit cost/ })).toBeDisabled();
    expect(screen.getByText(/reports a number nobody\s+can reproduce/)).toBeInTheDocument();
  });

  it('will not save a rate with no basis behind it', async () => {
    panel();
    await userEvent.click(screen.getByRole('button', { name: /Price at a unit cost/ }));
    await userEvent.type(screen.getByLabelText('Cost per CY'), '48250');
    expect(screen.getByRole('button', { name: /Use this rate/ })).toBeDisabled();
  });

  it('will not save a basis too short to say anything', async () => {
    panel();
    await userEvent.click(screen.getByRole('button', { name: /Price at a unit cost/ }));
    await userEvent.type(screen.getByLabelText('Cost per CY'), '100');
    await userEvent.type(screen.getByLabelText('Where the rate came from'), 'ok');
    expect(screen.getByRole('button', { name: /Use this rate/ })).toBeDisabled();
  });

  it('saves the rate with the reason', async () => {
    const { onChanged } = panel();
    await userEvent.click(screen.getByRole('button', { name: /Price at a unit cost/ }));
    await userEvent.type(screen.getByLabelText('Cost per CY'), '48250');
    await userEvent.type(screen.getByLabelText('Where the rate came from'),
      'Sub quote, Delaney Bros, 14 Aug');
    await userEvent.click(screen.getByRole('button', { name: /Use this rate/ }));
    await waitFor(() => expect(hoisted.setRate).toEqual([
      { rate: 48250, basis: 'Sub quote, Delaney Bros, 14 Aug' },
    ]));
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows the database refusal rather than a generic failure', async () => {
    hoisted.failWith = 'This line has 2 lines under it, and a parent is the sum of its children.';
    panel();
    await userEvent.click(screen.getByRole('button', { name: /Price at a unit cost/ }));
    await userEvent.type(screen.getByLabelText('Cost per CY'), '10');
    await userEvent.type(screen.getByLabelText('Where the rate came from'), 'An allowance');
    await userEvent.click(screen.getByRole('button', { name: /Use this rate/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('a parent is the sum of its children');
  });
});

// ---------------------------------------------------------------------------
describe('a line already priced at a rate', () => {
  it('says the rate, the unit and where it came from', () => {
    panel({ rate: 48250, basis: 'Sub quote, Delaney Bros, 14 Aug' });
    expect(screen.getByText(/48,250\.00 per CY/)).toBeInTheDocument();
    expect(screen.getByText('Sub quote, Delaney Bros, 14 Aug')).toBeInTheDocument();
  });

  it('says it is scored as an allowance, which decides the review it needs', () => {
    panel({ rate: 100, basis: 'An allowance' });
    expect(screen.getByText(/scored as an\s+allowance/)).toBeInTheDocument();
  });

  it('offers a way back to building it up', async () => {
    panel({ rate: 100, basis: 'An allowance' });
    await userEvent.click(screen.getByRole('button', { name: /Build it up instead/ }));
    await waitFor(() => expect(hoisted.cleared).toEqual(['l-1']));
  });

  it('offers nothing to somebody who cannot edit the estimate', () => {
    panel({ rate: 100, basis: 'An allowance', editable: false });
    expect(screen.queryByRole('button', { name: /Build it up instead/ })).not.toBeInTheDocument();
    expect(screen.getByText(/100\.00 per CY/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('what the library says the line is made of', () => {
  it('says nothing at all when the library has nothing to offer', async () => {
    /*
     * A panel reading "no suggestions" would be noise on the majority of lines
     * in a bid nobody has built a library for yet.
     */
    const { container } = render(
      <ResourceSuggestions lineId="l-1" editable onChanged={() => {}} />);
    // It shows a loading line first; what matters is where it settles.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows each component scaled to the line and priced', async () => {
    hoisted.suggestions = [suggestion()];
    render(<ResourceSuggestions lineId="l-1" editable onChanged={() => {}} />);
    expect(await screen.findByText('Excavator 320')).toBeInTheDocument();
    expect(screen.getByText('10.00 HR')).toBeInTheDocument();
    expect(screen.getByText('$1,450.00')).toBeInTheDocument();
  });

  it('adds nothing until it is asked to', async () => {
    hoisted.suggestions = [suggestion()];
    render(<ResourceSuggestions lineId="l-1" editable onChanged={() => {}} />);
    await screen.findByText('Excavator 320');
    expect(hoisted.applied).toEqual([]);
  });

  it('takes them all in one press, with the total said first', async () => {
    hoisted.suggestions = [
      suggestion(),
      suggestion({ kind: 'material', resourceId: 'm-1', name: 'Aggregate base', extendedCost: 550 }),
    ];
    render(<ResourceSuggestions lineId="l-1" editable onChanged={() => {}} />);
    const button = await screen.findByRole('button', { name: /Add all 2 \(\$2,000\.00\)/ });
    await userEvent.click(button);
    await waitFor(() => expect(hoisted.applied).toEqual([{ lineId: 'l-1', kinds: undefined }]));
  });

  it('takes one kind on its own', async () => {
    hoisted.suggestions = [
      suggestion(),
      suggestion({ kind: 'material', resourceId: 'm-1', name: 'Aggregate base' }),
    ];
    render(<ResourceSuggestions lineId="l-1" editable onChanged={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add material' }));
    await waitFor(() => expect(hoisted.applied).toEqual([{ lineId: 'l-1', kinds: ['material'] }]));
  });

  it('marks what is already on the line rather than offering it again', async () => {
    hoisted.suggestions = [suggestion({ alreadyOnLine: true })];
    render(<ResourceSuggestions lineId="l-1" editable onChanged={() => {}} />);
    expect(await screen.findByText('already on the line')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add all/ })).not.toBeInTheDocument();
  });

  it('marks an optional component rather than adding it silently', async () => {
    hoisted.suggestions = [suggestion({ isOptional: true })];
    render(<ResourceSuggestions lineId="l-1" editable onChanged={() => {}} />);
    expect(await screen.findByText('optional')).toBeInTheDocument();
  });

  it('offers no adding at all to somebody who cannot edit the estimate', async () => {
    hoisted.suggestions = [suggestion()];
    render(<ResourceSuggestions lineId="l-1" editable={false} onChanged={() => {}} />);
    expect(await screen.findByText('Excavator 320')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add/ })).not.toBeInTheDocument();
  });

  it('shows the database refusal rather than a generic failure', async () => {
    hoisted.suggestions = [suggestion()];
    hoisted.failWith = 'This line is priced at a typed rate. Clear the rate first.';
    render(<ResourceSuggestions lineId="l-1" editable onChanged={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /Add all/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Clear the rate first');
  });
});
