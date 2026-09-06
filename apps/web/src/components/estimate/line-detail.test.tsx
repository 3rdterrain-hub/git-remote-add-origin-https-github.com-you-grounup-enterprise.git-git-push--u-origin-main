/**
 * What a line is made of.
 *
 * `estimate_line_resources` has existed since migration 0006 with no way to put
 * anything in it, so an estimate line was a service and a quantity and
 * everything that decides what the work costs had nowhere to go.
 *
 * The property that matters most here is what this screen refuses to do. It
 * shows arithmetic on the estimator's own inputs — a loaded rate, a cycle time
 * — and it never computes a cost. Every figure in the cost column is the
 * engine's, and where the engine has not run yet the screen says "unpriced"
 * rather than showing a zero that reads like a free machine.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';
import type { LineResource, LineRow } from '@/lib/data/estimates';

const hoisted = vi.hoisted(() => ({
  configured: true,
  resources: [] as unknown[],
  saved: [] as Array<{ kind: string; fields: Record<string, unknown>; id: string | null }>,
  removed: [] as string[],
  lineUpdates: [] as Record<string, unknown>[],
  saveFails: null as string | null,
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
    loadLineResources: () => async () => hoisted.resources,
    saveLineResource: async (_c: unknown, input: {
      kind: string; fields: Record<string, unknown>; resourceId: string | null;
    }) => {
      if (hoisted.saveFails) throw new Error(hoisted.saveFails);
      hoisted.saved.push({ kind: input.kind, fields: input.fields, id: input.resourceId });
      return 'new-id';
    },
    deleteLineResource: async (_c: unknown, id: string) => { hoisted.removed.push(id); },
    updateLine: async (_c: unknown, _id: string, fields: Record<string, unknown>) => {
      hoisted.lineUpdates.push(fields);
    },
  };
});

const { LineDetail } = await import('./line-detail');

const resource = (over: Partial<LineResource> = {}): LineResource => ({
  id: 'r-1', kind: 'labor', sortOrder: 10,
  description: 'Excavator Operator', role: 'Operator', notes: null,
  quantity: 1, unit: null, unitRate: 0, hours: 0, headcount: 2,
  baseRate: 40, burdenRate: 15,
  drivesHours: false, productionPerHour: null,
  rateBasis: 'hour', mobilizationCost: 0, standbyDays: 0, minimumHours: null, isOwned: true,
  haulMode: 'hours', roundTripMiles: null, averageSpeedMph: null, truckCapacity: null,
  tonsPerLoad: null, loadMinutes: null, dumpMinutes: null, queueMinutes: null,
  includesDisposal: false,
  extendedCost: 0,
  ...over,
});

const line = (over: Partial<LineRow> = {}): LineRow => ({
  id: 'l-1', sortOrder: 10, lineNumber: null, description: 'Berm build',
  serviceId: 's-1', serviceName: 'Berm build', costCode: 'CC-0006',
  unit: 'LF', measuredQuantity: 1837, adjustedQuantity: 1837,
  unitCost: 0, totalDirectCost: 0, laborHours: 0, equipmentHours: 0,
  confidenceBand: 'high', blocksIssue: false, hasProductionRate: true,
  clientVisible: true, markupOverride: null, wastePercent: 0, quantityExpression: null, productionModifier: 1,
  ...over,
});

// Rendered with the router, because a line now offers the way to a drawing.
const show = (rows: LineResource[], over: Partial<LineRow> = {}) => {
  hoisted.resources = rows;
  return renderPage(<LineDetail line={line(over)} editable onChanged={vi.fn()} />);
};

/**
 * Open one of the tabs.
 *
 * Only the active tab's content is in the document, which is the right
 * behavior — a line with five crew members, three machines and a haul should
 * not render all of it to show one — so a test about equipment has to open
 * equipment.
 */
const openTab = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  await waitFor(() => expect(screen.getByRole('tab', { name })).toBeInTheDocument());
  await user.click(screen.getByRole('tab', { name }));
};

describe('the build-up behind a line', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.saveFails = null;
    hoisted.saved = []; hoisted.removed = []; hoisted.lineUpdates = [];
    hoisted.resources = [];
  });

  it('derives the loaded rate rather than asking for it a third time', async () => {
    // The wage and the burden are separate so the loaded rate cannot be
    // contradicted by a number somebody typed beside them.
    show([resource()]);
    await waitFor(() => expect(screen.getByText('$55.00')).toBeInTheDocument());
  });

  it('says a cost is unpriced rather than showing a free machine', async () => {
    const user = userEvent.setup();
    show([resource({ kind: 'equipment', description: 'Dozer D5', extendedCost: 0 })]);
    await openTab(user, /Equipment/);
    await waitFor(() => expect(screen.getAllByText('unpriced').length).toBeGreaterThan(0));
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('adds up the fleet rate from the rows that drive it', async () => {
    /*
     * Two dozers at 100 an hour are 200 between them, and every other row on
     * the line works those same hours. 1837 LF at 200/hr is 9.19 hours.
     */
    show([
      resource({ id: 'e-1', kind: 'equipment', description: 'Dozer D5',
        drivesHours: true, productionPerHour: 100, quantity: 2, headcount: null }),
    ]);
    await waitFor(() =>
      expect(screen.getByText(/200\.00 LF\/hr/)).toBeInTheDocument());
    expect(screen.getByText(/9\.19 hr for 1,837\.00 LF/)).toBeInTheDocument();
  });

  it('says plainly when nothing drives the hours', async () => {
    show([resource()]);
    await waitFor(() =>
      expect(screen.getByText(/hours are entered by hand/)).toBeInTheDocument());
    expect(screen.getByText(/does not move when the quantity changes/)).toBeInTheDocument();
  });

  it('gives a production rate to a row somebody ticks, because the database demands one',
    async () => {
      // A driver with no rate is refused by `elr_driver_needs_production`, and
      // throwing that at somebody ticking a box would be a bad way to learn it.
      const user = userEvent.setup();
      show([resource({ kind: 'equipment', description: 'Roller', productionPerHour: null })]);
      await openTab(user, /Equipment/);
      await waitFor(() =>
        expect(screen.getByLabelText('Roller drives the hours')).toBeInTheDocument());
      await user.click(screen.getByLabelText('Roller drives the hours'));
      await waitFor(() => expect(hoisted.saved).toHaveLength(1));
      expect(hoisted.saved[0]!.fields).toMatchObject({
        drives_hours: true, production_per_hour: 1,
      });
    });

  it('bills a machine on the basis it is rented at, and says how many periods',
    async () => {
      /*
       * A weekly machine on nine hours of production is billed one week, not
       * a fifth of one — the rounding is most of what a weekly rate costs.
       */
      const user = userEvent.setup();
      show([
        resource({ id: 'e-1', kind: 'equipment', description: 'Dozer D5',
          rateBasis: 'week', unitRate: 2650, drivesHours: true,
          productionPerHour: 100, quantity: 2, headcount: null }),
      ]);
      await openTab(user, /Equipment/);
      await waitFor(() => expect(screen.getByText('Billed: 1 week')).toBeInTheDocument());
    });

  it('offers mobilization, standby and a callout minimum', async () => {
    const user = userEvent.setup();
    show([resource({ kind: 'equipment', description: 'Dozer D5', mobilizationCost: 600 })]);
    await openTab(user, /Equipment/);
    await waitFor(() => expect(screen.getByLabelText('Mobilization')).toBeInTheDocument());
    expect(screen.getByLabelText('Standby days')).toBeInTheDocument();
    expect(screen.getByLabelText('Minimum hours')).toBeInTheDocument();
  });

  it('shows the haul cycle from the route, and says whose number it is', async () => {
    /*
     * 12 miles at 25 mph is 28.8 minutes of driving, plus 7 loading, 4 dumping
     * and 10 queueing — 49.8 minutes. Shown so an estimator can sanity-check
     * the route; the trips and the cost are the engine's.
     */
    const user = userEvent.setup();
    show([resource({
      kind: 'trucking', description: 'Quad-Axle Dump Truck', haulMode: 'trip',
      roundTripMiles: 12, averageSpeedMph: 25, truckCapacity: 22,
      loadMinutes: 7, dumpMinutes: 4, queueMinutes: 10, unitRate: 135,
    })]);
    await openTab(user, /Hauling/);
    await waitFor(() => expect(screen.getByText(/Cycle: 49\.8 min/)).toBeInTheDocument());
    expect(screen.getByText(/sizes the trucks from what the loader can actually load/))
      .toBeInTheDocument();
  });

  it('brings a usable route when the haul is switched to trip-based', async () => {
    // A trip haul with no route is refused by `elr_trip_inputs`, so switching
    // to it has to arrive with something rather than an error.
    const user = userEvent.setup();
    show([resource({ kind: 'trucking', description: 'Tri-axle', haulMode: 'hours' })]);
    await openTab(user, /Hauling/);
    await waitFor(() =>
      expect(screen.getByLabelText('How the haul is priced')).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('How the haul is priced'), 'trip');
    await waitFor(() => expect(hoisted.saved).toHaveLength(1));
    expect(hoisted.saved[0]!.fields).toMatchObject({
      haul_mode: 'trip', round_trip_miles: 10, average_speed_mph: 25, truck_capacity: 16,
    });
  });

  it('leaves an hourly haul asking for hours', async () => {
    const user = userEvent.setup();
    show([resource({ kind: 'trucking', description: 'Tri-axle', haulMode: 'hours', hours: 12 })]);
    await openTab(user, /Hauling/);
    await waitFor(() => expect(screen.getByLabelText('Hours')).toBeInTheDocument());
    expect(screen.queryByLabelText('Round-trip miles')).not.toBeInTheDocument();
  });

  it('commits a change once, on leaving the field', async () => {
    const user = userEvent.setup();
    show([resource()]);
    await waitFor(() => expect(screen.getByDisplayValue('40')).toBeInTheDocument());
    const base = screen.getByDisplayValue('40');
    await user.clear(base);
    await user.type(base, '42');
    await user.tab();
    await waitFor(() => expect(hoisted.saved).toHaveLength(1));
    expect(hoisted.saved[0]!.fields).toEqual({ base_rate: 42 });
  });

  it('does not write when nothing changed', async () => {
    // Tabbing across a row should not write five rows to the database.
    const user = userEvent.setup();
    show([resource()]);
    await waitFor(() => expect(screen.getByDisplayValue('40')).toBeInTheDocument());
    await user.click(screen.getByDisplayValue('40'));
    await user.tab();
    expect(hoisted.saved).toHaveLength(0);
  });

  it('removes a row', async () => {
    const user = userEvent.setup();
    show([resource()]);
    await waitFor(() =>
      expect(screen.getByLabelText('Remove Excavator Operator')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Remove Excavator Operator'));
    await waitFor(() => expect(hoisted.removed).toEqual(['r-1']));
  });

  it('says a save failed rather than showing the change as though it took', async () => {
    hoisted.saveFails = 'This version is approved; make a new version to change it';
    const user = userEvent.setup();
    show([resource()]);
    await waitFor(() => expect(screen.getByDisplayValue('40')).toBeInTheDocument());
    const base = screen.getByDisplayValue('40');
    await user.clear(base);
    await user.type(base, '99');
    await user.tab();
    await waitFor(() =>
      expect(screen.getByText(/make a new version to change it/)).toBeInTheDocument());
  });

  it('offers nothing to edit on a frozen version', async () => {
    hoisted.resources = [resource()];
    renderPage(<LineDetail line={line()} editable={false} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('$55.00')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Add crew member/ })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('40')).toBeDisabled();
    // And no line settings at all, because none of them may change either.
    expect(screen.queryByLabelText('Show this line to the customer')).not.toBeInTheDocument();
  });

  it('sets this line\'s own markup, and lets it fall back to the profile', async () => {
    const user = userEvent.setup();
    show([resource()], { markupOverride: 0.3 });
    await waitFor(() => expect(screen.getByLabelText('Markup %')).toBeInTheDocument());
    const markup = screen.getByLabelText('Markup %');
    // A decimal text field rather than a number input, so the value is a string.
    expect(markup).toHaveValue('30');
    await user.clear(markup);
    await user.tab();
    await waitFor(() => expect(hoisted.lineUpdates).toHaveLength(1));
    // Cleared means "use the profile", which is a value somebody chooses.
    expect(hoisted.lineUpdates[0]).toEqual({ markup_override: null });
  });

  it('offers the way to a drawing, carrying the line', async () => {
    /*
     * Takeoff could apply a measurement to a line from the moment it was built;
     * nothing went the other way. An estimator looking at an empty quantity had
     * to leave the estimate, find the drawing, and hunt for the line again.
     */
    show([resource()]);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Measure on a drawing/ }))
        .toHaveAttribute('href', '/app/takeoff?line=l-1'));
  });

  it('hides a line from the proposal without taking it out of the estimate', async () => {
    const user = userEvent.setup();
    show([resource()]);
    await waitFor(() =>
      expect(screen.getByLabelText('Show this line to the customer')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Show this line to the customer'));
    await waitFor(() => expect(hoisted.lineUpdates).toEqual([{ client_visible: false }]));
    expect(screen.getByText(/still priced and still counted internally/)).toBeInTheDocument();
  });
});
