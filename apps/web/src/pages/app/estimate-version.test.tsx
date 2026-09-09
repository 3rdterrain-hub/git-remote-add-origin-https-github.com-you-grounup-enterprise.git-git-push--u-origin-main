/**
 * The estimate workspace, on a real version.
 *
 * The properties worth holding a screen to here are the ones that decide
 * whether a wrong number can reach a customer:
 *
 *   * a version that has been approved cannot be edited from this screen,
 *     because it cannot be edited at all — RULE-009 freezes it;
 *   * approving says in advance why it is unavailable, rather than letting
 *     somebody discover the rule by being refused;
 *   * an estimate the engine has blocked cannot be approved or issued from
 *     here, which is the gate migration 0097 added and nothing had before.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  version: null as unknown,
  fail: null as string | null,
  permissions: ['estimates.read', 'estimates.write', 'estimates.approve', 'estimates.issue'] as string[],
  updated: [] as Array<Record<string, unknown>>,
  /*
   * What was saved on a *line*, as against on the version. These were not
   * recorded by anything, which is part of why a markup that never reached the
   * database went unnoticed: no test had ever watched this call.
   */
  lineUpdates: [] as Array<{ id: string; fields: Record<string, unknown> }>,
  revised: [] as Array<{ id: string; reason: string }>,
  navigated: [] as string[],
  moved: [] as Array<{ line: string; after: string | null }>,
  inserted: [] as Array<Record<string, unknown>>,
  deleted: [] as string[],
  services: [] as Array<Record<string, unknown>>,
  added: [] as Array<Record<string, unknown>>,
  batches: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
  callFunction: async () => ({}),
}));

vi.mock('@/lib/data/session', () => ({
  usePermissions: () => ({ can: (p: string) => hoisted.permissions.includes(p), loading: false }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ estimateId: 'v-1' }),
    useNavigate: () => (to: string) => { hoisted.navigated.push(to); },
  };
});

vi.mock('@/lib/data/estimates', async () => {
  const actual = await vi.importActual<typeof import('./../../lib/data/estimates')>(
    '@/lib/data/estimates');
  return {
    ...actual,
    loadVersion: () => async () => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      return hoisted.version;
    },
    loadDrift: () => async () => [],
    searchServices: () => async () => hoisted.services,
    addLine: async (_c: unknown, input: Record<string, unknown>) => {
      hoisted.added.push(input);
      return 'l-new';
    },
    addLines: async (_c: unknown, input: Record<string, unknown>) => {
      hoisted.batches.push(input);
      return ['l-a', 'l-b'];
    },
    deleteLine: async (_c: unknown, id: string) => { hoisted.deleted.push(id); return 1; },
    updateVersion: async (_c: unknown, _v: string, fields: Record<string, unknown>) => {
      hoisted.updated.push(fields);
    },
    updateLine: async (_c: unknown, id: string, fields: Record<string, unknown>) => {
      hoisted.lineUpdates.push({ id, fields });
    },
    reviseVersion: async (_c: unknown, id: string, reason: string) => {
      hoisted.revised.push({ id, reason });
      return 'v-2';
    },
    moveLine: async (_c: unknown, line: string, after: string | null) => {
      hoisted.moved.push({ line, after });
    },
    insertLineAfter: async (_c: unknown, input: Record<string, unknown>) => {
      hoisted.inserted.push(input);
      return 'l-new';
    },
  };
});

const { EstimateVersionPage } = await import('./estimate-version');

const line = (over: Record<string, unknown> = {}) => ({
  id: 'l-1', sortOrder: 10, lineNumber: null, description: 'Mass excavation',
  serviceId: 's-1', serviceName: 'Mass excavation', costCode: 'CC-0006',
  unit: 'CY', measuredQuantity: 12_000, adjustedQuantity: 12_000,
  unitCost: 4.25, totalDirectCost: 51_000, laborHours: 180, equipmentHours: 210,
  confidenceBand: 'high', blocksIssue: false, hasProductionRate: true,
  clientVisible: true, markupOverride: null, wastePercent: 0, productionModifier: 1,
  parametricCostPerUnit: null, parametricBasis: null,
  ...over,
});

const version = (over: Record<string, unknown> = {}) => ({
  id: 'v-1', estimateId: 'e-1', estimateNumber: 'E-2026-0001', estimateName: 'Quarry haul road',
  customerName: 'Maumee Development', expiresAt: null, expired: false,
  createdAt: '2026-08-25T12:00:00Z', versionNumber: 1, status: 'draft',
  directCost: 51_000, indirectCost: 4_000, totalMarkup: 11_000, totalPrice: 66_000,
  bidPrice: 66_000, totalLaborHours: 180, totalEquipmentHours: 210,
  blockedFromIssue: false, confidence: 91.5, engineVersion: 'engine-2.0.0',
  calculatedAt: '2026-09-01T09:00:00Z', librarySnapshotId: null,
  approvedAt: null, issuedAt: null,
  costs: { labor: 30_000, burden: 9_000, equipment: 12_000, fuel: 0, material: 0,
           mobilization: 0, trucking: 0, disposal: 0, subcontract: 0, other: 0 },
  lines: [line()],
  show: { labor: false, equipment: false, materials: true, hauling: true,
          subcontract: true },
  assumptions: {
    shiftHours: 10, calendarEfficiency: 0.85, fuelPricePerGallon: 4.1,
    defPricePerGallon: 12.5, swellPercent: 0.25, shrinkPercent: 0.1,
    bidRoundingIncrement: 0,
  },
  ...over,
});

describe('the estimate workspace', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.fail = null;
    hoisted.permissions = ['estimates.read', 'estimates.write', 'estimates.approve', 'estimates.issue'];
    hoisted.version = version();
    hoisted.updated = []; hoisted.lineUpdates = []; hoisted.revised = []; hoisted.navigated = [];
    hoisted.moved = []; hoisted.inserted = [];
    hoisted.services = []; hoisted.added = []; hoisted.batches = [];
    hoisted.deleted = [];
  });

  it('shows the engine result and says which build produced it', async () => {
    renderPage(<EstimateVersionPage />);
    await waitFor(() => expect(screen.getByText(/E-2026-0001/)).toBeInTheDocument());
    expect(screen.getByText(/Priced by engine engine-2\.0\.0/)).toBeInTheDocument();
    expect(screen.getAllByText('$66,000.00').length).toBeGreaterThan(0);
  });

  it('lets the estimator change the quantity, the unit and the unit cost on the line', async () => {
    /*
     * This used to assert the opposite — that the unit cost was the engine's
     * and had no field. It is still the engine's *answer*; what changed is that
     * an estimator holding a subcontract quote can say so on the line instead
     * of opening a panel to find the control. The rate they type carries a
     * stated basis, which is what keeps it reviewable.
     */
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(screen.getByLabelText('Quantity for Mass excavation')).toBeInTheDocument());
    expect(screen.getByLabelText('Unit for Mass excavation')).toBeInTheDocument();
    expect(screen.getByLabelText('Unit cost for Mass excavation')).toBeInTheDocument();
  });

  it('leaves the total to the engine, with no field for it', async () => {
    // The one number on the row nobody types: it is the sum of everything else.
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(screen.getByLabelText('Quantity for Mass excavation')).toBeInTheDocument());
    expect(screen.queryByLabelText(/^total for/i)).not.toBeInTheDocument();
  });

  it('says the unit cost was typed rather than computed', async () => {
    hoisted.version = version({
      lines: [line({ parametricCostPerUnit: 48250, parametricBasis: 'Sub quote, Delaney Bros' })],
    });
    renderPage(<EstimateVersionPage />);
    expect(await screen.findByText('typed')).toBeInTheDocument();
  });

  it('will not approve a version with a line that has a quantity and no price', async () => {
    hoisted.version = version({
      lines: [line({ totalDirectCost: 0, unitCost: 0 })], directCost: 0, calculatedAt: null,
    });
    renderPage(<EstimateVersionPage />);
    await waitFor(() => expect(screen.getByText(/have a quantity and no price/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
  });

  it('will not approve what the engine has blocked, and says so', async () => {
    hoisted.version = version({ blockedFromIssue: true });
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(screen.getByText('The pricing engine has not cleared this estimate.'))
        .toBeInTheDocument());
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
  });

  it('names the line that is blocking the bid', async () => {
    hoisted.version = version({ lines: [line({ blocksIssue: true, confidenceBand: 'do_not_price' })] });
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(screen.getByText(/1 line is not confident enough to bid/)).toBeInTheDocument());
    expect(screen.getByLabelText('This line blocks issue')).toBeInTheDocument();
  });

  it('will not approve an estimate whose price has stopped being good', async () => {
    hoisted.version = version({ expiresAt: '2026-08-30T12:00:00Z', expired: true });
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(screen.getByText(/This estimate expired on Aug 30, 2026/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
  });

  it('says when it was made and how long it stands', async () => {
    hoisted.version = version({ expiresAt: '2026-12-01T12:00:00Z' });
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(screen.getByText(/created Aug 25, 2026, valid until Dec 1, 2026/))
        .toBeInTheDocument());
  });

  it('offers no approval to somebody who cannot approve', async () => {
    hoisted.permissions = ['estimates.read', 'estimates.write'];
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(screen.getByText('You do not have permission to approve an estimate.'))
        .toBeInTheDocument());
  });

  /**
   * One line, on one line, with every field on it.
   *
   * Asked for four times in four ways: the typing box is not big enough to see
   * what is being typed; the words should stay on one line; keep the line item
   * boxes smaller; the lines box should show all the fields entirely. And after
   * a table was made to hold still: everything on a line item needs to align
   * neatly.
   *
   * Two shapes were tried and both were wrong. A table sizes itself to the sum
   * of its content and then makes the screen scroll, so the last fields sit off
   * the right edge — and shaving it from ten columns to eight bought one screen
   * size. A card that wrapped the numbers under the description fixed the width
   * and broke the requirement, because it put one line item on two lines.
   *
   * What holds all of it at once is a grid: the same column template on every
   * row, so the columns line up down the estimate the way a table's do; the
   * description on `1fr`, so the field being typed into is the one that gets
   * the room; and no minimum width anywhere, so nothing is ever off the edge.
   */
  describe('a line is one line, and all of it is on screen', () => {
    const cardOf = (container: HTMLElement, id = 'l-1') =>
      container.querySelector(`[data-line="${id}"]`) as HTMLElement;

    it('puts every field of the line in one row', async () => {
      hoisted.version = version();
      const { container } = renderPage(<EstimateVersionPage />);
      await screen.findByRole('button', { name: 'Unit cost for Mass excavation' });
      const row = cardOf(container).firstElementChild as HTMLElement;

      for (const control of [
        'Unit cost for Mass excavation',
        'Markup for Mass excavation',
        'Quantity for Mass excavation',
        'Unit for Mass excavation',
        'Drag to reorder Mass excavation',
      ]) {
        expect(row, `${control} is not on the line`)
          .toContainElement(screen.getByLabelText(control) as HTMLElement);
      }
    });

    it('sets no minimum width anywhere on the line, so nothing scrolls off the edge', async () => {
      hoisted.version = version();
      const { container } = renderPage(<EstimateVersionPage />);
      await screen.findByRole('button', { name: 'Unit cost for Mass excavation' });
      const card = cardOf(container);
      for (const el of [card, ...Array.from(card.querySelectorAll('*'))]) {
        expect(el.className.toString(), 'a minimum width puts a field off the edge')
          .not.toMatch(/min-w-\[/);
      }
    });

    it('gives every row the same columns, so they line up down the estimate', async () => {
      hoisted.version = version({
        lines: [line({ id: 'l-1' }), line({ id: 'l-2', description: 'Rock removal' })],
      });
      const { container } = renderPage(<EstimateVersionPage />);
      await screen.findByRole('button', { name: 'Unit cost for Rock removal' });
      const a = (cardOf(container, 'l-1').firstElementChild as HTMLElement).className;
      const b = (cardOf(container, 'l-2').firstElementChild as HTMLElement).className;
      expect(a).toBe(b);
      expect(a).toMatch(/grid-cols-\[/);
    });

    it('gives the description the room that is left, rather than a fixed slice', async () => {
      hoisted.version = version();
      const { container } = renderPage(<EstimateVersionPage />);
      await screen.findByRole('button', { name: 'Unit cost for Mass excavation' });
      const row = (cardOf(container).firstElementChild as HTMLElement).className;
      /*
       * `1fr` on the service column, with a real floor under it: the field
       * being typed into is the one that grows, and it never gets squeezed
       * below something a line description can be read in.
       */
      const service = row.match(/grid-cols-\[[^_]+_([^_]+)_/)![1]!;
      expect(service).toMatch(/^minmax\(\d+rem,1fr\)$/);
      const floor = Number(service.match(/minmax\((\d+)rem/)![1]);
      expect(floor, 'the description can be squeezed too narrow to read')
        .toBeGreaterThanOrEqual(16);
    });

    it('keeps the words on one line rather than wrapping them', async () => {
      hoisted.version = version({
        lines: [line({
          description: 'Strip and stockpile topsoil across the north half of the site',
        })],
      });
      renderPage(<EstimateVersionPage />);
      const words = await screen.findByRole('button', { name: /change what line/i });
      expect(words.className).toMatch(/truncate/);
    });

    it('gives the lines the whole width rather than two thirds of it', async () => {
      /*
       * The lines card shared a row with three explainers — `lg:grid-cols-3`
       * with the lines on `col-span-2` — so a third of every screen went to
       * cards that are read once and collapsed, and the thing being worked on
       * all day got what was left. That is what pushed the last fields off the
       * edge, and no amount of shaving columns was going to fix it.
       */
      hoisted.version = version();
      const { container } = renderPage(<EstimateVersionPage />);
      await screen.findByRole('button', { name: 'Unit cost for Mass excavation' });
      const card = container.querySelector('[data-line="l-1"]')!.closest('.rounded-\\[--radius-card\\], [class*="rounded"]');
      // Nothing between the line and the page may take a share of the row.
      let el: HTMLElement | null = container.querySelector('[data-line="l-1"]') as HTMLElement;
      while (el) {
        expect(el.className.toString(), 'the lines are sharing their row')
          .not.toMatch(/col-span-2/);
        el = el.parentElement;
      }
      expect(card).not.toBeNull();
    });

    it('lines every value up under the column that names it', async () => {
      /*
       * Eleven columns, and the same template on the header and on every row —
       * so a value can never sit under the wrong word. Checked by counting
       * rather than by eye, because "looks aligned" is what three attempts at
       * this already claimed.
       */
      hoisted.version = version({
        lines: [line({ id: 'l-1' }), line({ id: 'l-2', description: 'Rock removal' })],
      });
      const { container } = renderPage(<EstimateVersionPage />);
      await screen.findByRole('button', { name: 'Unit cost for Rock removal' });

      const header = container.querySelector('[data-line-header]') as HTMLElement;
      const rows = Array.from(container.querySelectorAll('[data-line]'))
        .map((c) => c.firstElementChild as HTMLElement);

      // Same template, and the same number of cells, header and rows alike.
      for (const row of rows) {
        // Same grid template — the part that decides where a value lands.
        const template = (c: string) => c.match(/grid-cols-\[[^\]]+\]/)![0];
        expect(template(row.className)).toBe(template(header.className));
        expect(row.children.length).toBe(header.children.length);
      }
    });

    it('sizes no column by its content, because two grids size that differently', async () => {
      /*
       * The bug this replaced, and it was invisible in the markup: the first
       * and last columns were `auto`. The header's are empty, so they collapsed
       * to nothing; the rows' hold buttons, so they were wide. Two independent
       * grids resolve `auto` against their own content, so every column between
       * them shifted and TOTAL sat to the right of its own numbers.
       *
       * A shared template is only shared if every track is a fixed size or a
       * fraction. Nothing here may be content-sized.
       */
      hoisted.version = version();
      const { container } = renderPage(<EstimateVersionPage />);
      await screen.findByRole('button', { name: 'Unit cost for Mass excavation' });
      const header = container.querySelector('[data-line-header]') as HTMLElement;
      const template = header.className.match(/grid-cols-\[([^\]]+)\]/)![1]!;

      for (const track of template.split('_')) {
        expect(track, `"${track}" is sized by its content`).not.toMatch(/^(auto|min-content|max-content)$/);
      }
    });

    it('names each column once, at the top', async () => {
      hoisted.version = version();
      renderPage(<EstimateVersionPage />);
      await screen.findByRole('button', { name: 'Unit cost for Mass excavation' });
      for (const label of ['Service', 'Qty', 'Unit', 'Cond.', 'Unit cost',
                           'Markup', '+Markup', 'Total']) {
        expect(screen.getAllByText(label).length).toBeGreaterThan(0);
      }
    });

    it('opens the rate editor under the line without moving it', async () => {
      hoisted.version = version();
      const { container } = renderPage(<EstimateVersionPage />);
      await userEvent.click(
        await screen.findByRole('button', { name: 'Unit cost for Mass excavation' }));

      const field = await screen.findByLabelText('Where the rate came from');
      const card = cardOf(container);
      expect(card).toContainElement(field);
      // Under the row, not inside it: an editor on the row would widen a column.
      expect(card.firstElementChild).not.toContainElement(field);
    });

    it('takes the markup as an input on the row, not a panel under it', async () => {
      /*
       * It was a button that opened an editor row, because an input inside a
       * table cell widened its column and shoved every number sideways. The
       * columns are fixed tracks now, so the control is what it should always
       * have been: a box on the line that you type into.
       */
      hoisted.version = version();
      const { container } = renderPage(<EstimateVersionPage />);
      const field = await screen.findByRole('textbox', { name: 'Markup for Mass excavation' });
      // On the row itself, not in a panel beneath it.
      expect(cardOf(container).firstElementChild).toContainElement(field);
    });

    it('saves the markup the estimator types, under the name the database reads', async () => {
      hoisted.version = version();
      renderPage(<EstimateVersionPage />);
      const field = await screen.findByRole('textbox', { name: 'Markup for Mass excavation' });
      await userEvent.type(field, '30');
      await userEvent.tab();
      /*
       * `markup_override`. The camelCase key matched nothing in
       * `update_estimate_line`, so the value was dropped and the call reported
       * success — the markup typed on a line had never once been saved.
       */
      await waitFor(() => expect(hoisted.lineUpdates).toContainEqual({ id: 'l-1', fields: { markup_override: 0.3 } }));
    });

    it('puts an empty markup back under the profile rather than at zero', async () => {
      hoisted.version = version({ lines: [line({ markupOverride: 0.3 })] });
      renderPage(<EstimateVersionPage />);
      const field = await screen.findByRole('textbox', { name: 'Markup for Mass excavation' });
      await userEvent.clear(field);
      await userEvent.tab();
      await waitFor(() => expect(hoisted.lineUpdates).toContainEqual({ id: 'l-1', fields: { markup_override: null } }));
    });

    it('takes a typed zero as a real answer, which is not the same as empty', async () => {
      hoisted.version = version();
      renderPage(<EstimateVersionPage />);
      const field = await screen.findByRole('textbox', { name: 'Markup for Mass excavation' });
      await userEvent.type(field, '0');
      await userEvent.tab();
      await waitFor(() => expect(hoisted.lineUpdates).toContainEqual({ id: 'l-1', fields: { markup_override: 0 } }));
    });

    /*
     * There used to be a test here that opening the markup closed the rate
     * editor. Two panels competing for the space under one row needed that
     * rule; the markup is a box on the line now, so there is only one panel and
     * nothing for it to close. Typing a markup while a rate is being written is
     * two different fields, and neither should interrupt the other.
     */

    it('leaves the editor on Escape without writing anything', async () => {
      hoisted.version = version();
      renderPage(<EstimateVersionPage />);
      await userEvent.click(
        await screen.findByRole('button', { name: 'Unit cost for Mass excavation' }));
      await userEvent.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.queryByLabelText('Where the rate came from')).not.toBeInTheDocument());
      expect(hoisted.updated).toEqual([]);
    });
  });

  it('offers no editing at all once the version is approved', async () => {
    hoisted.version = version({
      status: 'approved', approvedAt: '2026-09-02T10:00:00Z', librarySnapshotId: 'snap-1',
    });
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(screen.getByText(/This version is Approved and frozen/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /add line/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /price with the engine/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Quantity for Mass excavation')).not.toBeInTheDocument();
    // And it offers the thing an approved estimate is actually for.
    expect(screen.getByRole('button', { name: /issue proposal/i })).toBeInTheDocument();
  });

  it('says what the library has done since the version was priced', async () => {
    hoisted.version = version({ status: 'approved', librarySnapshotId: 'snap-1' });
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(screen.getByText('Nothing it was priced with has changed.')).toBeInTheDocument());
  });

  it('keeps every cost bucket separately visible', async () => {
    renderPage(<EstimateVersionPage />);
    // RULE-001. A single "cost" figure is exactly what this forbids.
    await waitFor(() => expect(screen.getByText('Labor wage')).toBeInTheDocument());
    for (const bucket of ['Labor burden', 'Equipment ownership']) {
      expect(screen.getByText(bucket)).toBeInTheDocument();
    }
  });

  it('shows a read failure as a failure', async () => {
    hoisted.fail = 'JWT expired';
    renderPage(<EstimateVersionPage />);
    await waitFor(() => expect(screen.getByText('JWT expired')).toBeInTheDocument());
    expect(screen.queryByText('Strip and stockpile topsoil')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  describe("this bid's assumptions", () => {
    /*
     * The section starts shut and shows its numbers on the header, so a person
     * reading the bid does not have to open it and a person changing one does.
     * These tests open it the way that person would.
     *
     * They used not to. The earlier collapsible card hid a shut section with a
     * CSS class, so its fields stayed in the document — invisible on screen,
     * still reachable by keyboard, and still findable here. Every assertion
     * below was passing against a form nobody could see.
     */
    const openAssumptions = async () => {
      await userEvent.click(
        await screen.findByRole('button', { name: /this bid's assumptions/i }));
    };

    it('shows the numbers on the header without being opened', async () => {
      renderPage(<EstimateVersionPage />);
      expect(await screen.findByText(/diesel \$4\.10 · swell 25%/i)).toBeInTheDocument();
    });

    it('shows the numbers the engine actually reads off the version', async () => {
      renderPage(<EstimateVersionPage />);
      await openAssumptions();
      await waitFor(() => expect(screen.getByLabelText('Diesel, $/gal')).toBeInTheDocument());
      expect(screen.getByLabelText('Diesel, $/gal')).toHaveValue(4.1);
      expect(screen.getByLabelText('Swell')).toHaveValue(0.25);
    });

    it('saves one when it changes, and only when it changes', async () => {
      renderPage(<EstimateVersionPage />);
      await openAssumptions();
      const field = await screen.findByLabelText('Diesel, $/gal');
      await userEvent.clear(field);
      await userEvent.type(field, '4.55');
      await userEvent.tab();
      await waitFor(() => expect(hoisted.updated).toHaveLength(1));
      expect(hoisted.updated[0]).toEqual({ fuel_price_per_gallon: 4.55 });

      /* Blurring an untouched field is not an edit and must not write one. */
      const swell = screen.getByLabelText('Swell');
      swell.focus();
      await userEvent.tab();
      expect(hoisted.updated).toHaveLength(1);
    });

    it('is read-only once the version is frozen', async () => {
      hoisted.version = version({ status: 'approved', approvedAt: '2026-09-02T00:00:00Z' });
      renderPage(<EstimateVersionPage />);
      await openAssumptions();
      await waitFor(() => expect(screen.getByLabelText('Swell')).toBeDisabled());
    });

    it('says the price does not follow on its own', async () => {
      renderPage(<EstimateVersionPage />);
      await openAssumptions();
      expect(await screen.findByText(/nothing recalculates on its own/i)).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  describe('creating a revision', () => {
    it('is offered exactly when the version is frozen', async () => {
      renderPage(<EstimateVersionPage />);
      await waitFor(() => expect(screen.getByText(/E-2026-0001/)).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /create revision/i })).not.toBeInTheDocument();

      hoisted.version = version({ status: 'issued', issuedAt: '2026-09-02T00:00:00Z' });
      renderPage(<EstimateVersionPage />);
      expect(await screen.findByRole('button', { name: /create revision/i })).toBeInTheDocument();
    });

    it('will not send a reason too short to explain anything', async () => {
      hoisted.version = version({ status: 'issued', issuedAt: '2026-09-02T00:00:00Z' });
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button', { name: /create revision/i }));
      const dialog = await screen.findByRole('dialog');
      const submit = within(dialog).getByRole('button', { name: /create revision/i });
      expect(submit).toBeDisabled();
      await userEvent.type(within(dialog).getByLabelText(/why this revision exists/i), 'oops');
      expect(submit).toBeDisabled();
    });

    it('copies it forward with the reason, and opens the new version', async () => {
      hoisted.version = version({ status: 'issued', issuedAt: '2026-09-02T00:00:00Z' });
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button', { name: /create revision/i }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/why this revision exists/i),
        'Owner moved the pond outlet');
      await userEvent.click(within(dialog).getByRole('button', { name: /create revision/i }));
      await waitFor(() => expect(hoisted.revised).toHaveLength(1));
      expect(hoisted.revised[0]).toEqual({ id: 'v-1', reason: 'Owner moved the pond outlet' });
      await waitFor(() => expect(hoisted.navigated).toEqual(['/app/estimates/v-2']));
    });

    it('says what a revision carries, so nobody expects to lose the crew', async () => {
      hoisted.version = version({ status: 'issued', issuedAt: '2026-09-02T00:00:00Z' });
      renderPage(<EstimateVersionPage />);
      expect(await screen.findByText(/crew, equipment, material, haul, modifiers and markups/))
        .toBeInTheDocument();
    });
  });


  // -------------------------------------------------------------------------
  describe('the boxes across the top', () => {
    it('shows only the blocking lines when the blocked tile is clicked', async () => {
      hoisted.version = version({
        blockedFromIssue: true,
        lines: [
          line({ id: 'l-1', description: 'Strip and stockpile topsoil', blocksIssue: false }),
          line({ id: 'l-2', description: 'Rock removal', blocksIssue: true }),
        ],
      });
      renderPage(<EstimateVersionPage />);
      /*
       * Anchored on the row's own controls: the hours card lower down lists the
       * same descriptions, so the text alone no longer identifies a row.
       */
      const row = (d: string) => screen.queryByRole('button',
        { name: new RegExp(`crew, equipment, material and haul on ${d}`, 'i') });
      await waitFor(() => expect(row('Strip and stockpile topsoil')).toBeInTheDocument());

      await userEvent.click(screen.getByRole('button',
        { name: /show only the lines that are blocking this bid/i }));
      await waitFor(() => expect(row('Strip and stockpile topsoil')).not.toBeInTheDocument());
      expect(row('Rock removal')).toBeInTheDocument();
    });

    it('says the table is filtered, and that the total still covers everything', async () => {
      hoisted.version = version({
        blockedFromIssue: true,
        lines: [
          line({ id: 'l-1', description: 'Strip and stockpile topsoil', blocksIssue: false }),
          line({ id: 'l-2', description: 'Rock removal', blocksIssue: true }),
        ],
      });
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button',
        { name: /show only the lines that are blocking this bid/i }));
      expect(await screen.findByText(/1 other is hidden/i)).toBeInTheDocument();
      expect(screen.getByText(/the whole estimate, not the 1 shown/i)).toBeInTheDocument();
    });

    it('offers no filter on an estimate the engine has cleared', async () => {
      renderPage(<EstimateVersionPage />);
      await waitFor(() => expect(screen.getByText(/E-2026-0001/)).toBeInTheDocument());
      expect(screen.queryByRole('button',
        { name: /show only the lines that are blocking this bid/i })).not.toBeInTheDocument();
    });
  });


  // -------------------------------------------------------------------------
  describe('working on a line from the row it is on', () => {
    const twoLines = () => version({
      lines: [
        line({ id: 'l-1', description: 'Strip and stockpile topsoil', serviceName: 'Topsoil' }),
        line({ id: 'l-2', description: 'Rock removal', serviceName: 'Rock' }),
      ],
    });

    it('keeps the build-up behind one click rather than on the row', async () => {
      hoisted.version = twoLines();
      renderPage(<EstimateVersionPage />);
      await waitFor(() => expect(
        screen.getByRole('button', { name: /drag to reorder Strip and stockpile topsoil/i }))
        .toBeInTheDocument());
      expect(screen.queryByRole('tab', { name: /crew/i })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button',
        { name: /crew, equipment, material and haul on Strip and stockpile topsoil/i }));
      expect(await screen.findByRole('tab', { name: /crew/i })).toBeInTheDocument();
    });

    it('says what the wrench opens, so it is not a mystery icon', async () => {
      hoisted.version = twoLines();
      renderPage(<EstimateVersionPage />);
      expect(await screen.findByRole('button',
        { name: /crew, equipment, material and haul on Rock removal/i })).toBeInTheDocument();
    });

    it('moves a line to sit after the row it was dropped on', async () => {
      hoisted.version = twoLines();
      renderPage(<EstimateVersionPage />);
      const grip = await screen.findByRole('button',
        { name: /drag to reorder Strip and stockpile topsoil/i });
      // The card is the drop target now, and it says which line it is.
      const target = screen
        .getByRole('button', { name: /drag to reorder Rock removal/i })
        .closest('[data-line]')!;

      fireEvent.dragStart(grip);
      fireEvent.dragOver(target);
      fireEvent.drop(target);

      await waitFor(() => expect(hoisted.moved).toEqual([{ line: 'l-1', after: 'l-2' }]));
    });

    it('offers a way to drop a line into first place', async () => {
      hoisted.version = twoLines();
      renderPage(<EstimateVersionPage />);
      const grip = await screen.findByRole('button', { name: /drag to reorder Rock removal/i });
      expect(screen.queryByText(/drop here to put it first/i)).not.toBeInTheDocument();

      fireEvent.dragStart(grip);
      const strip = await screen.findByText(/drop here to put it first/i);
      fireEvent.dragOver(strip);
      fireEvent.drop(strip);

      await waitFor(() => expect(hoisted.moved).toEqual([{ line: 'l-2', after: null }]));
    });

    it('offers neither drag nor plus on a version that is frozen', async () => {
      hoisted.version = version({
        status: 'approved', approvedAt: '2026-09-02T00:00:00Z',
        lines: [line({ id: 'l-1', description: 'Strip and stockpile topsoil' })],
      });
      renderPage(<EstimateVersionPage />);
      await waitFor(() => expect(screen.getByRole('button',
        { name: /crew, equipment, material and haul on Strip and stockpile topsoil/i }))
        .toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /drag to reorder/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /add a line under/i })).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  describe('a blank line, right where you are looking', () => {
    /*
     * The fast path. A dialog is a mode, and a mode costs a click to enter and
     * a click to leave on every one of thirty lines.
     */
    const oneLine = () => version({
      lines: [line({ id: 'l-1', description: 'Strip and stockpile topsoil' })],
    });

    it('opens in the table rather than over it', async () => {
      hoisted.version = oneLine();
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button',
        { name: /add a line under Strip and stockpile topsoil/i }));
      expect(await screen.findByLabelText('What is this line?')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('suggests from the library as it is typed', async () => {
      hoisted.version = oneLine();
      hoisted.services = [
        { id: 's-9', code: 'SVC-0006', name: 'Mass excavation', category: 'Earthwork',
          defaultUnit: 'CY', supportedUnits: ['CY'], isOwn: false },
      ];
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button', { name: /^add line$/i }));
      await userEvent.type(await screen.findByLabelText('What is this line?'), 'mass');
      expect(await screen.findByRole('option', { name: /Mass excavation/ })).toBeInTheDocument();
    });

    it('takes the unit from the service picked with the keyboard', async () => {
      hoisted.version = oneLine();
      hoisted.services = [
        { id: 's-9', code: 'SVC-0006', name: 'Mass excavation', category: 'Earthwork',
          defaultUnit: 'CY', supportedUnits: ['CY'], isOwn: false },
      ];
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button', { name: /^add line$/i }));
      const field = await screen.findByLabelText('What is this line?');
      await userEvent.type(field, 'mass');
      await screen.findByRole('option', { name: /Mass excavation/ });
      await userEvent.keyboard('{ArrowDown}{Enter}');
      expect(screen.getByLabelText('Unit for this line')).toHaveValue('CY');
      expect(screen.getByText(/From the library: SVC-0006/)).toBeInTheDocument();
    });

    it('keeps the typed words when nothing in the library matches', async () => {
      hoisted.version = oneLine();
      hoisted.services = [];
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button', { name: /^add line$/i }));
      await userEvent.type(await screen.findByLabelText('What is this line?'), 'Mobilization');
      await userEvent.click(screen.getByRole('button', { name: /add this line/i }));
      await waitFor(() => expect(hoisted.added).toHaveLength(1));
      expect(hoisted.added[0]).toMatchObject({ description: 'Mobilization', serviceId: null });
    });

    it('adds under the row whose plus was pressed', async () => {
      hoisted.version = oneLine();
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button',
        { name: /add a line under Strip and stockpile topsoil/i }));
      await userEvent.type(await screen.findByLabelText('What is this line?'), 'Haul off');
      await userEvent.click(screen.getByRole('button', { name: /add this line/i }));
      await waitFor(() => expect(hoisted.inserted).toHaveLength(1));
      expect(hoisted.inserted[0]!.afterLineId).toBe('l-1');
    });

    it('will not write a line with nothing in it', async () => {
      hoisted.version = oneLine();
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button', { name: /^add line$/i }));
      await screen.findByLabelText('What is this line?');
      expect(screen.getByRole('button', { name: /add this line/i })).toBeDisabled();
    });

    it('closes on Escape without writing anything', async () => {
      hoisted.version = oneLine();
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button', { name: /^add line$/i }));
      const field = await screen.findByLabelText('What is this line?');
      await userEvent.type(field, 'Never mind{Escape}');
      await waitFor(() =>
        expect(screen.queryByLabelText('What is this line?')).not.toBeInTheDocument());
      expect(hoisted.added).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('shopping the library for several at once', () => {
    it('adds everything ticked in one call', async () => {
      hoisted.version = version({ lines: [line({ id: 'l-1', description: 'Only line' })] });
      hoisted.services = [
        { id: 's-1', code: 'SVC-0006', name: 'Mass excavation', category: 'Earthwork',
          defaultUnit: 'CY', supportedUnits: ['CY'], isOwn: false },
        { id: 's-2', code: 'SVC-0050', name: 'Storm sewer installation', category: 'Utilities',
          defaultUnit: 'LF', supportedUnits: ['LF'], isOwn: false },
      ];
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button', { name: /from library/i }));
      const dialog = await screen.findByRole('dialog');

      await userEvent.click(await within(dialog).findByLabelText('Add Mass excavation'));
      await userEvent.click(within(dialog).getByLabelText('Add Storm sewer installation'));
      expect(within(dialog).getByRole('button', { name: /add 2 lines/i })).toBeInTheDocument();

      await userEvent.click(within(dialog).getByRole('button', { name: /add 2 lines/i }));
      await waitFor(() => expect(hoisted.batches).toHaveLength(1));
      expect(hoisted.batches[0]!.lines).toEqual([
        { serviceId: 's-1', unit: 'CY' },
        { serviceId: 's-2', unit: 'LF' },
      ]);
    });

    it('reaches the library from a row, and lands the lines under it', async () => {
      /*
       * The toolbar's "From library" appends to the end. An estimator halfway
       * down a bid who wants eight things from a trade wants them *here* — the
       * position is the reason they were scrolling. It is a second control
       * beside the plus rather than a menu on it, because typing a line as you
       * think of it happens thirty times in a bid and must not cost a click.
       */
      hoisted.version = version({
        lines: [
          line({ id: 'l-1', description: 'Strip topsoil' }),
          line({ id: 'l-2', description: 'Mass grading' }),
        ],
      });
      hoisted.services = [
        { id: 's-9', code: 'SVC-0100', name: 'Rock excavation', category: 'Earthwork',
          defaultUnit: 'CY', supportedUnits: ['CY'], isOwn: false },
      ];
      renderPage(<EstimateVersionPage />);
      await userEvent.click(
        await screen.findByRole('button', { name: 'Add from the library under Strip topsoil' }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/directly under "Strip topsoil"/)).toBeInTheDocument();

      await userEvent.click(await within(dialog).findByLabelText('Add Rock excavation'));
      await userEvent.click(within(dialog).getByRole('button', { name: /add 1 line/i }));

      await waitFor(() => expect(hoisted.batches).toHaveLength(1));
      expect(hoisted.batches[0]!.afterLineId).toBe('l-1');
    });

    it('offers both paths on every row, and neither is behind a menu', async () => {
      hoisted.version = version({ lines: [line({ id: 'l-1', description: 'Strip topsoil' })] });
      renderPage(<EstimateVersionPage />);
      expect(await screen.findByRole('button', { name: 'Add a line under Strip topsoil' }))
        .toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add from the library under Strip topsoil' }))
        .toBeInTheDocument();
    });

    it('will not add an empty selection', async () => {
      hoisted.version = version({ lines: [line()] });
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button', { name: /from library/i }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('button', { name: /add lines/i })).toBeDisabled();
    });

    it('says quantities start at zero, because nobody has measured them', async () => {
      hoisted.version = version({ lines: [line()] });
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button', { name: /from library/i }));
      expect(await screen.findByText(/quantities start at zero/i)).toBeInTheDocument();
    });
  });


  // -------------------------------------------------------------------------
  describe('taking a line off', () => {
    const twoLines = () => version({
      lines: [
        line({ id: 'l-1', description: 'Strip and stockpile topsoil' }),
        line({ id: 'l-2', description: 'Rock removal' }),
      ],
    });

    it('asks a second time rather than removing on one press', async () => {
      hoisted.version = twoLines();
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button',
        { name: /^Remove Strip and stockpile topsoil$/i }));
      expect(hoisted.deleted).toEqual([]);
      expect(await screen.findByRole('button',
        { name: /confirm removing Strip and stockpile topsoil/i })).toBeInTheDocument();
    });

    it('removes it once confirmed', async () => {
      hoisted.version = twoLines();
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button',
        { name: /^Remove Strip and stockpile topsoil$/i }));
      await userEvent.click(screen.getByRole('button',
        { name: /confirm removing Strip and stockpile topsoil/i }));
      await waitFor(() => expect(hoisted.deleted).toEqual(['l-1']));
    });

    it('lets the line be kept after all', async () => {
      hoisted.version = twoLines();
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button',
        { name: /^Remove Strip and stockpile topsoil$/i }));
      await userEvent.click(screen.getByRole('button', { name: /keep this line/i }));
      await waitFor(() => expect(screen.getByRole('button',
        { name: /^Remove Strip and stockpile topsoil$/i })).toBeInTheDocument());
      expect(hoisted.deleted).toEqual([]);
    });

    it('offers no removal on a version that is frozen', async () => {
      hoisted.version = version({
        status: 'approved', approvedAt: '2026-09-02T00:00:00Z',
        lines: [line({ id: 'l-1', description: 'Strip and stockpile topsoil' })],
      });
      renderPage(<EstimateVersionPage />);
      await waitFor(() => expect(screen.getByRole('button',
        { name: /crew, equipment, material and haul on Strip and stockpile topsoil/i }))
        .toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /^Remove /i })).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  describe('where each control sits on the row', () => {
    it('puts the plus first, then the handle, then the line', async () => {
      /*
       * The plus is what an estimator reaches for most while building a bid, so
       * it takes the position the eye lands on when it enters a row. The handle
       * follows it, because a drag handle still has to be near the row's start
       * to be findable.
       */
      hoisted.version = version({
        lines: [line({ id: 'l-1', description: 'Strip and stockpile topsoil' })],
      });
      renderPage(<EstimateVersionPage />);
      const plus = await screen.findByRole('button',
        { name: /add a line under Strip and stockpile topsoil/i });
      const grip = screen.getByRole('button',
        { name: /drag to reorder Strip and stockpile topsoil/i });
      // Order on the card, which is what the eye actually follows. The cell
      // this used to assert against no longer exists — a line is a card now.
      expect(plus.compareDocumentPosition(grip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const description = screen.getByRole('button',
        { name: /change what line "Strip and stockpile topsoil" says/i });
      expect(grip.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy();
    });

    it('puts the wrench between what the line is and how much of it there is', async () => {
      hoisted.version = version({
        lines: [line({ id: 'l-1', description: 'Strip and stockpile topsoil' })],
      });
      renderPage(<EstimateVersionPage />);
      const wrench = await screen.findByRole('button',
        { name: /crew, equipment, material and haul on Strip and stockpile topsoil/i });
      const quantity = screen.getByLabelText(/quantity for Strip and stockpile topsoil/i);

      // After the description, before the quantity.
      expect(wrench.compareDocumentPosition(quantity) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy();
      /* The hours card lower down lists descriptions too, so anchor on the
         row's own drag handle rather than on the text. */
      const grip = screen.getByRole('button',
        { name: /drag to reorder Strip and stockpile topsoil/i });
      expect(grip.compareDocumentPosition(wrench) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy();
    });

    it('puts the eye with the line number at the front, not beside the trash', async () => {
      /*
       * It sat at the far end next to Remove, which put a thing you read — is
       * this on the customer's copy — beside a thing you press once and regret.
       * It belongs with the line's identity, where its state is visible without
       * hunting for it.
       */
      hoisted.version = version({
        lines: [line({ id: 'l-1', description: 'Strip and stockpile topsoil' })],
      });
      renderPage(<EstimateVersionPage />);
      const eye = await screen.findByRole('button',
        { name: /(hide|show) Strip and stockpile topsoil (from|on) the proposal/i });
      const words = screen.getByRole('button',
        { name: /change what line "Strip and stockpile topsoil" says/i });
      const remove = screen.getByRole('button',
        { name: /^Remove Strip and stockpile topsoil$/i });

      // Before the words, and a long way before the trash.
      expect(eye.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(eye.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('leaves removing the line at the end, where a decision about it goes', async () => {
      hoisted.version = version({
        lines: [line({ id: 'l-1', description: 'Strip and stockpile topsoil' })],
      });
      renderPage(<EstimateVersionPage />);
      const remove = await screen.findByRole('button',
        { name: /^Remove Strip and stockpile topsoil$/i });
      const plus = screen.getByRole('button',
        { name: /add a line under Strip and stockpile topsoil/i });
      expect(plus.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy();
      expect(within(remove.parentElement!)
        .queryByRole('button', { name: /add a line under/i })).toBeNull();
    });

  });

  // -------------------------------------------------------------------------
  describe('shopping the library with room to work', () => {
    it('groups what it found by category', async () => {
      hoisted.version = version({ lines: [line()] });
      hoisted.services = [
        { id: 's-1', code: 'SVC-0006', name: 'Mass excavation', category: 'Earthwork',
          defaultUnit: 'CY', supportedUnits: ['CY'], isOwn: false },
        { id: 's-2', code: 'SVC-0007', name: 'Rock excavation', category: 'Earthwork',
          defaultUnit: 'CY', supportedUnits: ['CY'], isOwn: false },
        { id: 's-3', code: 'SVC-0050', name: 'Storm sewer installation', category: 'Utilities',
          defaultUnit: 'LF', supportedUnits: ['LF'], isOwn: false },
      ];
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button', { name: /from library/i }));
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText('Earthwork')).toBeInTheDocument();
      expect(within(dialog).getByText('Utilities')).toBeInTheDocument();
    });

    it('files a service with no category rather than dropping it', async () => {
      hoisted.version = version({ lines: [line()] });
      hoisted.services = [
        { id: 's-1', code: 'SVC-X', name: 'Something of your own', category: null,
          defaultUnit: 'LS', supportedUnits: ['LS'], isOwn: true },
      ];
      renderPage(<EstimateVersionPage />);
      await userEvent.click(await screen.findByRole('button', { name: /from library/i }));
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText('Uncategorized')).toBeInTheDocument();
      expect(within(dialog).getByText('Something of your own')).toBeInTheDocument();
    });
  });

});

/**
 * Three things the first real estimate opened in a browser showed.
 *
 * Every one of them was invisible to jsdom, because jsdom lays nothing out: a
 * grid track has no width, a box that overflows it overflows by zero, and text
 * that wraps to four lines wraps to none. They are held here by the properties
 * that caused them rather than by pixels.
 */
describe('what the line looked like on a real screen', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.fail = null;
    hoisted.permissions = ['estimates.read', 'estimates.write'];
    hoisted.version = version();
    hoisted.lineUpdates = []; hoisted.updated = []; hoisted.navigated = [];
    hoisted.moved = []; hoisted.inserted = []; hoisted.services = [];
    hoisted.added = []; hoisted.batches = []; hoisted.deleted = []; hoisted.revised = [];
  });

  it('gives the quantity box the width of its column rather than one of its own', async () => {
    /*
     * `w-24` was 96px of input inside a 64px track. It overflowed 16px each
     * side, touched the unit picker with no gap and reached back over the
     * wrench. A fixed width inside a fixed track is two sources of truth about
     * one number.
     *
     * Asserted on what renders rather than on the source file: jsdom lays
     * nothing out, so a width cannot be measured here — but the declaration
     * that sets it is on the element, and the element is what ships.
     */
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(screen.getAllByLabelText(/^Quantity for /).length).toBeGreaterThan(0));
    const box = screen.getAllByLabelText(/^Quantity for /)[0]!;
    expect(box.className).toContain('w-full');
    expect(box.className).not.toContain('w-24');
  });

  it('leaves the last column wide enough for the badge that lives in it', async () => {
    /*
     * The confidence badge is 91px on its own and shared a 4rem track with the
     * delete button. It spilled 53px to its left, over the total — "not priced"
     * rendered as "not", and on a priced line it would have covered the last
     * digits of the money.
     *
     * The header and the rows have to carry the same eleven tracks or the
     * columns do not line up down the estimate, so both are checked.
     */
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(document.querySelector('[data-line-header]')).not.toBeNull());

    for (const el of [
      document.querySelector('[data-line-header]')!,
      document.querySelector('[data-line] > div')!,
    ]) {
      const template = el.className.match(/grid-cols-\[([^\]]+)\]/)?.[1];
      expect(template).toBeTruthy();
      const tracks = template!.split('_');
      expect(tracks).toHaveLength(11);
      // The quantity, and the cluster at the end.
      expect(tracks[3]).toBe('5.5rem');
      expect(tracks[10]).toBe('7.5rem');
    }
  });

  it('says nothing about waste before the engine has computed any', async () => {
    /*
     * `adjusted_quantity` is an engine output — `not null default 0` until the
     * engine writes it. Comparing it against the measured quantity was true on
     * every unpriced line, so a line measured at 500 LF read "net 0.00": waste
     * and loss appearing to have taken the whole quantity, on an estimate the
     * engine had never seen.
     */
    hoisted.version = version({
      lines: [line({
        id: 'l-waste', description: 'Electrical duct bank installation',
        serviceName: 'Electrical duct bank installation',
        measuredQuantity: 500, adjustedQuantity: 0, unit: 'LF',
      })],
    });
    renderPage(<EstimateVersionPage />);
    // Twice on the row: the service name, and the description under it.
    await waitFor(() =>
      expect(screen.getAllByText('Electrical duct bank installation').length)
        .toBeGreaterThan(0));
    expect(screen.queryByText(/^net /)).not.toBeInTheDocument();
  });

  it('puts nothing under the quantity, priced or not', async () => {
    /*
     * A note lived under the quantity — what it came to net of waste — and it
     * was asked for gone. Waste is a property of the line rather than of the
     * number typed into it, so it is read and set in the wrench panel with the
     * rest of what the line is made of. The cell holds one control and
     * nothing else, which is also what keeps every row the same height.
     */
    hoisted.version = version({
      lines: [line({
        id: 'l-waste', description: 'Electrical duct bank installation',
        serviceName: 'Electrical duct bank installation',
        measuredQuantity: 500, adjustedQuantity: 525, unit: 'LF', wastePercent: 0.05,
      })],
    });
    renderPage(<EstimateVersionPage />);
    await waitFor(() =>
      expect(screen.getAllByText('Electrical duct bank installation').length)
        .toBeGreaterThan(0));

    expect(screen.queryByText(/^net /)).not.toBeInTheDocument();
    expect(screen.queryByText(/after waste and loss/)).not.toBeInTheDocument();
  });
});
