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
    hoisted.updated = []; hoisted.revised = []; hoisted.navigated = [];
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
   * The columns hold still.
   *
   * Both editors used to render inside their own cell carrying a minimum width
   * — twenty-two rems for the rate and its basis, thirteen for the markup. A
   * table sizes its columns from what is in them, so clicking one number made
   * that column demand the width, every other column give some up to pay for
   * it, and every row in the estimate shift sideways at once. The row being
   * edited was the only one anybody was looking at and the whole grid moved
   * under it.
   *
   * The editor is a row now. These hold it there, because "put it back in the
   * cell, it is simpler" is a reasonable-looking change that brings the bug
   * straight back.
   */
  describe('typing a rate or a markup does not move the columns', () => {
    it('opens the rate editor outside the cell it was clicked in', async () => {
      hoisted.version = version();
      renderPage(<EstimateVersionPage />);
      const cost = await screen.findByRole('button', { name: 'Unit cost for Mass excavation' });
      const cell = cost.closest('td')!;
      await userEvent.click(cost);

      const field = await screen.findByLabelText('Where the rate came from');
      expect(cell).not.toContainElement(field);
      // And it is a row of its own, spanning the table.
      expect(field.closest('td')!.getAttribute('colspan')).toBe('10');
    });

    it('opens the markup editor outside the cell it was clicked in', async () => {
      hoisted.version = version();
      renderPage(<EstimateVersionPage />);
      const markup = await screen.findByRole('button', { name: 'Markup for Mass excavation' });
      const cell = markup.closest('td')!;
      await userEvent.click(markup);

      /*
       * By role, because the button and the field share an accessible name on
       * purpose — the thing you click and the thing you type into are the same
       * control as far as a screen reader is concerned.
       */
      const field = await screen.findByRole('textbox', { name: 'Markup for Mass excavation' });
      expect(cell).not.toContainElement(field);
      expect(field.closest('td')!.getAttribute('colspan')).toBe('10');
    });

    it('leaves nothing in the cell that could widen its column', async () => {
      hoisted.version = version();
      renderPage(<EstimateVersionPage />);
      const cost = await screen.findByRole('button', { name: 'Unit cost for Mass excavation' });
      await userEvent.click(cost);
      /*
       * The specific shape of the bug: a minimum width inside a table cell.
       * Anything in the column may be as wide as the number it shows and no
       * wider.
       */
      const cell = cost.closest('td')!;
      for (const el of [cell, ...Array.from(cell.querySelectorAll('*'))]) {
        expect(el.className).not.toMatch(/min-w-/);
      }
    });

    it('closes the rate editor when the markup one is opened', async () => {
      hoisted.version = version();
      renderPage(<EstimateVersionPage />);
      await userEvent.click(
        await screen.findByRole('button', { name: 'Unit cost for Mass excavation' }));
      expect(await screen.findByLabelText('Where the rate came from')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Markup for Mass excavation' }));
      await waitFor(() =>
        expect(screen.queryByLabelText('Where the rate came from')).not.toBeInTheDocument());
    });

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

    it('gives the grid fixed columns, so no cell can re-proportion it', async () => {
      hoisted.version = version();
      const { container } = renderPage(<EstimateVersionPage />);
      await screen.findByRole('button', { name: 'Unit cost for Mass excavation' });
      const table = container.querySelector('table')!;
      expect(table.className).toMatch(/table-fixed/);
      expect(table.querySelectorAll('colgroup > col')).toHaveLength(10);
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
      const target = screen
        .getByRole('button', { name: /drag to reorder Rock removal/i })
        .closest('tr')!;

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
      const cell = plus.closest('td')!;
      expect(cell).toContainElement(grip);
      expect(cell.compareDocumentPosition(grip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(plus.compareDocumentPosition(grip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('puts the wrench between what the line is and how much of it there is', async () => {
      hoisted.version = version({
        lines: [line({ id: 'l-1', description: 'Strip and stockpile topsoil' })],
      });
      renderPage(<EstimateVersionPage />);
      const wrench = await screen.findByRole('button',
        { name: /crew, equipment, material and haul on Strip and stockpile topsoil/i });
      const quantity = screen.getByLabelText(/quantity for Strip and stockpile topsoil/i);

      // Its own cell, after the description and before the quantity.
      const cell = wrench.closest('td')!;
      expect(cell).not.toContainElement(quantity);
      expect(wrench.compareDocumentPosition(quantity) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy();
      /* The hours card lower down lists descriptions too, so anchor on the
         row's own drag handle rather than on the text. */
      const grip = screen.getByRole('button',
        { name: /drag to reorder Strip and stockpile topsoil/i });
      expect(grip.compareDocumentPosition(wrench) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy();
    });

    it('leaves the eye and the remove at the end, where a decision about the row goes', async () => {
      hoisted.version = version({
        lines: [line({ id: 'l-1', description: 'Strip and stockpile topsoil' })],
      });
      renderPage(<EstimateVersionPage />);
      const remove = await screen.findByRole('button',
        { name: /^Remove Strip and stockpile topsoil$/i });
      const cell = remove.closest('td')!;
      expect(within(cell).getByRole('button',
        { name: /(hide|show) Strip and stockpile topsoil (from|on) the proposal/i }))
        .toBeInTheDocument();
      expect(within(cell).queryByRole('button', { name: /add a line under/i })).toBeNull();
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
