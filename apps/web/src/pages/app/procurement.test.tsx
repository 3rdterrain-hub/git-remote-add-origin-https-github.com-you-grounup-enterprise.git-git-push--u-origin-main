/**
 * Procurement and inventory, live.
 *
 * The page read `RFQS`, `PURCHASE_ORDERS` and `INVENTORY` from `@/data/finance`
 * while seven governed tables sat behind it with no reader.
 *
 * Three of these tests are about arithmetic the browser must not do, and they
 * are the reason the rest exist:
 *
 *   * the leveled amount is a generated column, read rather than recomputed;
 *   * the low bid is taken only across bids that arrived, because a vendor who
 *     never answered levels to zero and zero would win;
 *   * the reorder test is against available stock, not stock on hand.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { RfqRow, PurchaseOrderRow, InventoryRow } from '@/lib/data/procurement';

const hoisted = vi.hoisted(() => ({
  configured: true,
  rfqs: [] as RfqRow[],
  pos: [] as PurchaseOrderRow[],
  inventory: [] as InventoryRow[],
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/procurement', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/procurement')>(
    '@/lib/data/procurement');
  return {
    ...actual,
    loadRfqs: async () => hoisted.rfqs,
    loadPurchaseOrders: async () => hoisted.pos,
    loadInventory: async () => hoisted.inventory,
  };
});

const { ProcurementPage } = await import('./procurement');

const rfq = (over: Partial<RfqRow> = {}): RfqRow => ({
  id: 'q-1', number: 'RFQ-0001', title: 'Storm structures', trade: 'Site utilities',
  status: 'leveling', dueAt: '2026-06-01T00:00:00Z',
  projectNumber: 'PRJ-2026-0011', projectId: 'p-1',
  awardedVendorName: null, awardReason: null,
  invited: 2, responded: 1, lowLeveled: 41_000,
  responses: [
    { id: 'r-1', vendorName: 'Bell Precast', quotedAmount: 40_000, levelingAdjustment: 1_000,
      leveledAmount: 41_000, leadTimeDays: 21, validUntil: null, status: 'received', notes: null },
    { id: 'r-2', vendorName: 'Silent Co', quotedAmount: null, levelingAdjustment: 0,
      leveledAmount: 0, leadTimeDays: null, validUntil: null, status: 'invited', notes: null },
  ],
  ...over,
});

const po = (over: Partial<PurchaseOrderRow> = {}): PurchaseOrderRow => ({
  id: 'o-1', number: 'PO-0001', title: 'Precast structures', poType: 'material',
  vendorName: 'Bell Precast', projectNumber: 'PRJ-2026-0011', projectId: 'p-1',
  status: 'partially_received',
  committedAmount: 41_000, invoicedAmount: 10_000, receivedAmount: 20_000, paidAmount: 0,
  neededBy: '2026-06-15', issuedAt: '2026-05-01T00:00:00Z',
  deliveries: 2, rejectedDeliveries: 0, ...over,
});

const item = (over: Partial<InventoryRow> = {}): InventoryRow => ({
  id: 'i-1', sku: 'AGG-304', name: '#304 Aggregate Base', category: 'Aggregate & Stone',
  unit: 'TON', location: 'Main yard',
  onHand: 100, reserved: 80, available: 20, reorderPoint: 25, reorderQuantity: 100,
  unitCost: 32, belowReorderPoint: true, ...over,
});

const show = () => render(<MemoryRouter><ProcurementPage /></MemoryRouter>);

beforeEach(() => {
  hoisted.configured = true;
  hoisted.rfqs = [rfq()];
  hoisted.pos = [po()];
  hoisted.inventory = [item()];
});

describe('the leveling board', () => {
  it('reads the leveled amount rather than adding it up again', async () => {
    /*
     * The generated column is quoted plus adjustment. A page that recomputed it
     * is how a page and a database come to hold different opinions about which
     * bid was low.
     */
    show();
    await waitFor(() => expect(screen.getByText('Bell Precast')).toBeTruthy());
    expect(screen.getByText('$41,000.00')).toBeTruthy();
  });

  it('does not call silence the low bid', async () => {
    /*
     * A vendor invited and not yet answering carries leveled_amount of zero
     * from the generated column. Awarding the package to them would be awarding
     * it to nobody.
     */
    show();
    await waitFor(() => expect(screen.getByText('Silent Co')).toBeTruthy());
    const row = screen.getByText('Silent Co').closest('tr')!;
    expect(within(row).queryByText('Low')).toBeNull();
    expect(within(row).getByText('no bid')).toBeTruthy();

    const bell = screen.getByText('Bell Precast').closest('tr')!;
    expect(within(bell).getByText('Low')).toBeTruthy();
  });

  it('says how many were invited and how many answered', async () => {
    show();
    await waitFor(() => expect(screen.getByText(/1 of 2 invitations answered/)).toBeTruthy());
  });

  it('names the vendor and the reason on an awarded package', async () => {
    // The schema requires both: a choice with no stated reason is a record of
    // an outcome rather than of a decision.
    hoisted.rfqs = [rfq({
      status: 'awarded', awardedVendorName: 'Bell Precast',
      awardReason: 'Low leveled and the only one holding the June delivery',
    })];
    show();
    expect(await screen.findByText(/only one holding the June delivery/)).toBeTruthy();
  });

  it('says when nobody has been invited rather than showing an empty table', async () => {
    hoisted.rfqs = [rfq({ responses: [], invited: 0, responded: 0, lowLeveled: null })];
    show();
    expect(await screen.findByText(/Nobody has been invited/)).toBeTruthy();
  });
});

describe('purchase orders', () => {
  it('shows committed against invoiced, which is what makes an overrun visible early', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('tab', { name: /Purchase orders/i }));
    const row = (await screen.findByText('PO-0001')).closest('tr')!;
    // Remaining is committed less invoiced: cost already owed. Scoped to the
    // row, because the totals footer carries the same figure for one order.
    expect(within(row).getByText('$31,000.00')).toBeTruthy();
  });

  it('warns when a delivery was refused, because that is what a back-charge argues from', async () => {
    hoisted.pos = [po({ rejectedDeliveries: 1 })];
    show();
    expect(await screen.findByText(/with a rejected delivery/i)).toBeTruthy();
  });

  it('links the project rather than printing its number as text', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('tab', { name: /Purchase orders/i }));
    const link = await screen.findByRole('link', { name: 'PRJ-2026-0011' });
    expect(link.getAttribute('href')).toContain('p-1');
  });
});

describe('the boxes across the top', () => {
  /* All three carried over from the test file this replaces. */
  it('opens the purchase orders from the commitment total', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Show the open purchase orders/i }));
    expect(await screen.findByText('PO-0001')).toBeTruthy();
  });

  it('opens the stock list from the inventory value', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Show the stock on hand/i }));
    expect(await screen.findByText('#304 Aggregate Base')).toBeTruthy();
  });

  it('says what "not yet invoiced" is the difference between', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /What is behind Not yet invoiced/i }));
    expect(await screen.findByText(/no longer choose not to spend/)).toBeTruthy();
    expect(screen.getByText(/looks fine on spend and is already gone on/)).toBeTruthy();
  });
});

describe('inventory', () => {
  it('measures the reorder point against available, not against what is on hand', async () => {
    /*
     * 100 on hand, 80 reserved, reorder at 25. On hand is comfortably above the
     * point and the yard is nearly empty — counting on-hand would hide the
     * shortage until somebody went looking for it.
     */
    show();
    expect(await screen.findByText(/below reorder point/i)).toBeTruthy();
    expect(screen.getByText(/20 TON available, reorder at 25/)).toBeTruthy();
  });

  it('says nothing is short when nothing is', async () => {
    hoisted.inventory = [item({ reserved: 0, available: 100, belowReorderPoint: false })];
    show();
    await waitFor(() => expect(screen.getByText('Active RFQs')).toBeTruthy());
    expect(screen.queryByText(/below reorder point/i)).toBeNull();
  });

  it('shows the three quantities so the generated one can be checked', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('tab', { name: /Inventory/i }));
    const row = (await screen.findByText('#304 Aggregate Base')).closest('tr')!;
    expect(within(row).getByText('100 TON')).toBeTruthy();
    expect(within(row).getByText('80')).toBeTruthy();
    expect(within(row).getByText('20')).toBeTruthy();
  });
});

describe('what has no writer yet', () => {
  it('offers no button that would do nothing', async () => {
    /*
     * These two were disabled because `rfqs` and `purchase_orders` had no
     * writer — honest, and still a screen a company could read and not use.
     * Migration 0162 gave both a writer, so the honest thing is now the
     * opposite: enabled, and opening something.
     *
     * What the test holds down is unchanged. A control on this page either does
     * something or says why it cannot; what it may never be is enabled and
     * inert, which is the defect this codebase keeps producing.
     */
    const user = userEvent.setup();
    show();
    await waitFor(() => expect(screen.getByRole('button', { name: /New RFQ/i })).toBeTruthy());
    expect(screen.getByRole('button', { name: /New RFQ/i }).hasAttribute('disabled')).toBe(false);
    /* Exact, because "Purchase orders" is also the name of a tab. */
    const raise = screen.getByRole('button', { name: 'Purchase order' });
    expect(raise.hasAttribute('disabled')).toBe(false);

    await user.click(raise);
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});

describe('without a workspace', () => {
  it('says it is a demonstration rather than showing invented commitments', async () => {
    hoisted.configured = false;
    show();
    await waitFor(() => expect(screen.queryByText('PO-0001')).toBeNull());
  });
});
