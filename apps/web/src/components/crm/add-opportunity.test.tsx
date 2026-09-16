/**
 * Opening an opportunity.
 *
 * The Pipeline tab said "An opportunity arrives when a qualified lead
 * converts", and that was literally the only way: `move_opportunity_stage` and
 * `update_opportunity` could work one, and nothing could create one. A repeat
 * customer ringing up about next year had to be entered as a stranger through a
 * public web form and converted.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  customers: [] as unknown[],
  wrote: [] as Array<[string, unknown]>,
  fail: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/crm', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/crm')>('@/lib/data/crm');
  return { ...actual, loadCrmCustomers: async () => hoisted.customers };
});

vi.mock('@/lib/data/crm-pipeline', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/crm-pipeline')>(
    '@/lib/data/crm-pipeline');
  return {
    ...actual,
    createOpportunity: async (_c: unknown, input: unknown) => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      hoisted.wrote.push(['opportunity', input]);
      return 'o-1';
    },
  };
});

const { AddOpportunity } = await import('./add-opportunity');

describe('opening an opportunity', () => {
  beforeEach(() => {
    hoisted.wrote = []; hoisted.fail = null;
    hoisted.customers = [{ id: 'c-1', code: 'CUS-0001', name: 'Toledo Public Works' }];
  });

  it('opens one against a customer without inventing a lead first', async () => {
    const user = userEvent.setup();
    renderPage(<AddOpportunity canWrite onAdded={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /Open an opportunity/i }));
    await user.selectOptions(screen.getByLabelText(/Who it is for/i), 'c-1');
    await user.type(screen.getByLabelText(/What the job is/i), 'Transfer station pad');
    await user.type(screen.getByLabelText(/Roughly worth/i), '520000');
    await user.click(screen.getByRole('button', { name: /^Open it$/i }));
    await waitFor(() => expect(hoisted.wrote[0]?.[0]).toBe('opportunity'));
    expect(hoisted.wrote[0]![1]).toMatchObject({
      customerId: 'c-1', name: 'Transfer station pad', estimatedValue: 520000,
    });
  });

  it('says an opportunity belongs to a customer when there are none', async () => {
    hoisted.customers = [];
    renderPage(<AddOpportunity canWrite onAdded={() => {}} />);
    const button = await screen.findByRole('button', { name: /Open an opportunity/i });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(true));
    expect(button.getAttribute('title')).toMatch(/belongs to a customer/i);
  });

  it('will not open one with no customer chosen', async () => {
    const user = userEvent.setup();
    renderPage(<AddOpportunity canWrite onAdded={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /Open an opportunity/i }));
    await user.type(screen.getByLabelText(/What the job is/i), 'Something');
    expect(screen.getByRole('button', { name: /^Open it$/i }).hasAttribute('disabled')).toBe(true);
  });
});
