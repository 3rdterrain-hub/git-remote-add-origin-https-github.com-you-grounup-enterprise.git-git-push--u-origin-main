/**
 * The leads that came in, and the door that was missing for four migrations.
 *
 * `leads` was created in 0005, written by a public intake in 0065, given a
 * source in 0124, and read by nothing. `convert_lead` — the function that turns
 * a qualified lead into a customer and an opportunity in one transaction — was
 * granted to `authenticated` and called from nowhere. A contractor could
 * publish a form, watch the forms card say "14 leads taken", and never see one
 * of the fourteen.
 *
 * What is tested here is the joint: that the screen reads the leads, that
 * moving one writes the stage, that Convert calls `convert_lead`, and that the
 * database's own refusals reach the person reading the screen unaltered.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const hoisted = vi.hoisted(() => ({
  staged: [] as Array<{ lead: string; stage: string }>,
  reread: 0,
  converted: [] as Array<{ lead: string; name?: string; value?: number | null }>,
  convertFails: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/leads', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/leads')>('@/lib/data/leads');
  return {
    ...actual,
    setLeadStage: async (lead: string, stage: string) => { hoisted.staged.push({ lead, stage }); },
    convertLead: async (lead: string, name?: string, value?: number | null) => {
      if (hoisted.convertFails) throw new Error(hoisted.convertFails);
      hoisted.converted.push({ lead, name, value });
      return 'opp-1';
    },
  };
});

const { LeadInboxSection } = await import('./lead-inbox');
type Lead = Parameters<typeof LeadInboxSection>[0]['leads'][number];

const lead = (over: Record<string, unknown> = {}) => ({
  id: 'l-1', companyName: 'Maumee Development', contactName: 'Dana Reyes',
  email: 'dana@maumee.example', phone: '419-555-0143', city: 'Perrysburg', state: 'OH',
  description: 'Pad and stone for a 60x120 shop building.',
  estimatedValue: 84000, stage: 'new', source: 'Website', formName: 'Main site form',
  submittedAt: '2026-09-01T14:02:00Z', nextFollowUpAt: null, notes: null,
  convertedCustomerId: null, convertedAt: null, createdAt: '2026-09-01T14:02:00Z', ...over,
});

const show = (rows: Lead[] = [], canEdit = true) =>
  render(
    <MemoryRouter>
      <LeadInboxSection leads={rows} canEdit={canEdit} onChanged={() => { hoisted.reread += 1; }} />
    </MemoryRouter>,
  );

describe('the leads that came in', () => {
  beforeEach(() => {
    hoisted.staged = []; hoisted.converted = [];
    hoisted.convertFails = null; hoisted.reread = 0;
  });

  it('shows a lead that arrived through the public form', async () => {
    show([lead()]);
    expect(await screen.findByText('Maumee Development')).toBeInTheDocument();
    expect(screen.getByText('Dana Reyes')).toBeInTheDocument();
    expect(screen.getByText('dana@maumee.example')).toBeInTheDocument();
    expect(screen.getByText(/Pad and stone/)).toBeInTheDocument();
    // Which form brought it in, because that is why anyone keeps three of them.
    expect(screen.getByText('via Main site form')).toBeInTheDocument();
  });

  it('says so plainly when nothing has come in, and points at the form', async () => {
    show();
    expect(await screen.findByText('No leads yet')).toBeInTheDocument();
    expect(screen.getByText(/Website form tab/)).toBeInTheDocument();
  });

  it('moves a lead along, and writes the stage the button names', async () => {
    show([lead()]);
    await screen.findByText('Maumee Development');
    await userEvent.click(screen.getByRole('button', { name: /Qualified/ }));
    await waitFor(() => expect(hoisted.staged).toEqual([{ lead: 'l-1', stage: 'qualified' }]));
    // And tells the page to re-read, or the row keeps its old badge.
    await waitFor(() => expect(hoisted.reread).toBe(1));
  });

  it('will not offer Convert on a lead nobody has qualified', async () => {
    show([lead({ stage: 'new' })]);
    await screen.findByText('Maumee Development');
    expect(screen.getByRole('button', { name: /Convert/ })).toBeDisabled();
  });

  it('converts a qualified lead, carrying the name and the value it already has', async () => {
    show([lead({ stage: 'qualified' })]);
    await screen.findByText('Maumee Development');
    await userEvent.click(screen.getByRole('button', { name: /^Convert/ }));
    // Prefilled from the lead, so somebody with nothing to add can press it.
    const name = await screen.findByLabelText('Opportunity name');
    expect(name).toHaveValue('Maumee Development');
    expect(screen.getByLabelText('Estimated value')).toHaveValue(84000);
    await userEvent.click(screen.getByRole('button', { name: 'Convert' }));
    await waitFor(() => expect(hoisted.converted).toEqual([
      { lead: 'l-1', name: 'Maumee Development', value: 84000 },
    ]));
  });

  it('shows the database refusal in the words the database used', async () => {
    /*
     * `convert_lead` refuses a second conversion with 'That lead was already
     * converted', which is written to be read by a person. Replacing it with
     * something of ours would lose the only sentence that says what happened.
     */
    hoisted.convertFails = 'That lead was already converted';
    show([lead({ stage: 'qualified' })]);
    await screen.findByText('Maumee Development');
    await userEvent.click(screen.getByRole('button', { name: /^Convert/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Convert' }));
    expect(await screen.findByText('That lead was already converted')).toBeInTheDocument();
  });

  it('hides converted and unqualified leads until asked for everything', async () => {
    show([
      lead(),
      lead({ id: 'l-2', companyName: 'Closed Co', stage: 'converted', convertedAt: '2026-09-02T00:00:00Z' }),
    ]);
    await screen.findByText('Maumee Development');
    expect(screen.queryByText('Closed Co')).not.toBeInTheDocument();
  });

  it('gives somebody without crm.write nothing to press', async () => {
    show([lead({ stage: 'qualified' })], false);
    await screen.findByText('Maumee Development');
    expect(screen.queryByRole('button', { name: /^Convert/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Qualified/ })).not.toBeInTheDocument();
  });
});
