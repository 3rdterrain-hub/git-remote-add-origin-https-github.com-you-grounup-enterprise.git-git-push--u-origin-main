/**
 * Writing down a lead that came in some other way.
 *
 * The Leads tab could only ever fill itself from the public website form, while
 * the Lead-source card directly beneath it counted phone calls, referrals,
 * walk-ins and bid boards — every one of which was impossible to record. Found
 * by the owner using the product.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  wrote: [] as Array<[string, unknown]>,
  fail: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/leads', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/leads')>('@/lib/data/leads');
  return {
    ...actual,
    createLead: async (companyId: string, input: unknown) => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      hoisted.wrote.push(['lead', { companyId, ...(input as object) }]);
      return 'l-1';
    },
  };
});

/* The source list is the company's own; the picker is exercised in its own test. */
vi.mock('@/components/ui/category-select', () => ({
  CategorySelect: ({ id, value, onChange }: {
    id?: string; value?: string | null; onChange: (v: string) => void;
  }) => (
    <select id={id} aria-label="How they found you" value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}>
      <option value="Phone call">Phone call</option>
      <option value="Referral">Referral</option>
      <option value="Bid board">Bid board</option>
    </select>
  ),
}));

const { AddLead } = await import('./add-lead');

describe('writing down a lead', () => {
  beforeEach(() => { hoisted.wrote = []; hoisted.fail = null; });

  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    renderPage(<AddLead companyId="co-1" canWrite onAdded={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /Write down a lead/i }));
  };

  it('records a lead that came in by phone', async () => {
    const user = userEvent.setup();
    await open(user);
    await user.type(screen.getByLabelText(/Who called/i), 'Sandusky Aggregates');
    await user.type(screen.getByLabelText(/^Phone$/i), '419-555-0142');
    await user.click(screen.getByRole('button', { name: /Save the lead/i }));
    await waitFor(() => expect(hoisted.wrote[0]?.[0]).toBe('lead'));
    expect(hoisted.wrote[0]![1]).toMatchObject({
      companyId: 'co-1', companyName: 'Sandusky Aggregates', source: 'Phone call',
    });
  });

  it('will not save a lead with no way to reply to it', async () => {
    const user = userEvent.setup();
    await open(user);
    await user.type(screen.getByLabelText(/Who called/i), 'Nobody');
    /* Without a phone or an email there is no lead, only a note. */
    expect(screen.getByRole('button', { name: /Save the lead/i }).hasAttribute('disabled'))
      .toBe(true);
    await user.type(screen.getByLabelText(/^Email$/i), 'x@y.test');
    expect(screen.getByRole('button', { name: /Save the lead/i }).hasAttribute('disabled'))
      .toBe(false);
  });

  it('carries the source the company chose, not one written into the form', async () => {
    const user = userEvent.setup();
    await open(user);
    await user.type(screen.getByLabelText(/Who called/i), 'Plan room find');
    await user.type(screen.getByLabelText(/^Phone$/i), '419-555-0101');
    await user.selectOptions(screen.getByLabelText(/How they found you/i), 'Bid board');
    await user.click(screen.getByRole('button', { name: /Save the lead/i }));
    await waitFor(() => expect(hoisted.wrote[0]?.[0]).toBe('lead'));
    expect(hoisted.wrote[0]![1]).toMatchObject({ source: 'Bid board' });
  });

  it('shows what the database refused rather than swallowing it', async () => {
    hoisted.fail = 'Referral is not one of your lead source options';
    const user = userEvent.setup();
    await open(user);
    await user.type(screen.getByLabelText(/Who called/i), 'Someone');
    await user.type(screen.getByLabelText(/^Phone$/i), '419-555-0111');
    await user.click(screen.getByRole('button', { name: /Save the lead/i }));
    expect(await screen.findByText(/not one of your lead source options/i)).toBeTruthy();
  });

  it('says nothing can be written without permission', async () => {
    renderPage(<AddLead companyId="co-1" canWrite={false} onAdded={() => {}} />);
    const button = await screen.findByRole('button', { name: /Write down a lead/i });
    expect(button.hasAttribute('disabled')).toBe(true);
  });
});
