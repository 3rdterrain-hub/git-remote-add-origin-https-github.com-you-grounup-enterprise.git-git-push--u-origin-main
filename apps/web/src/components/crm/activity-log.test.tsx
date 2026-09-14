/**
 * What was said, and what is due.
 *
 * `crm_activities` has carried an index on `(company_id, due_at) where
 * completed_at is null` since migration 0005 — built to answer "what is due
 * next" for a list nobody wrote. Its only writer was `convert_lead`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActivityRow, NewActivity } from '@/lib/data/crm-pipeline';
import { ActivityLog } from './activity-log';

const hoisted = vi.hoisted(() => ({
  rows: [] as ActivityRow[],
  logged: [] as NewActivity[],
  completed: [] as string[],
  failWith: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/crm-pipeline', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/crm-pipeline')>(
    '@/lib/data/crm-pipeline');
  return {
    ...actual,
    loadActivities: async () => hoisted.rows,
    logActivity: async (_c: unknown, input: NewActivity) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.logged.push(input);
      return 'a-new';
    },
    completeActivity: async (_c: unknown, id: string) => { hoisted.completed.push(id); },
  };
});

const entry = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: 'a-1', companyId: 'co-1', customerId: 'cu-1', opportunityId: null, leadId: null,
  activityType: 'call', subject: 'Spoke to Dana about the schedule',
  body: 'They want to start in March.', dueAt: null,
  completedAt: '2026-09-10T14:00:00Z', assignedTo: null,
  createdAt: '2026-09-10T14:00:00Z',
  customerName: 'Kingsway Development', opportunityName: null, opportunityNumber: null,
  leadName: null, overdue: false,
  ...over,
});

beforeEach(() => {
  hoisted.rows = [];
  hoisted.logged = [];
  hoisted.completed = [];
  hoisted.failWith = null;
});

const openCard = async (user: ReturnType<typeof userEvent.setup>) => {
  const toggle = screen.queryByRole('button', { expanded: false });
  if (toggle) await user.click(toggle);
};

describe('the activity log', () => {
  it('shows what was said, and who it was about', async () => {
    hoisted.rows = [entry()];
    const user = userEvent.setup();
    render(<ActivityLog customerId="cu-1" editable />);
    await openCard(user);
    expect(await screen.findByText('Spoke to Dana about the schedule')).toBeInTheDocument();
    expect(screen.getByText('They want to start in March.')).toBeInTheDocument();
    expect(screen.getByText(/Kingsway Development/)).toBeInTheDocument();
  });

  it('opens itself when something is outstanding', async () => {
    hoisted.rows = [entry({
      id: 'a-2', subject: 'Chase the geotech report', completedAt: null,
      dueAt: '2026-09-01T00:00:00Z', overdue: true, activityType: 'follow_up', body: null,
    })];
    render(<ActivityLog customerId="cu-1" editable />);
    expect(await screen.findByText('Chase the geotech report')).toBeInTheDocument();
    expect(screen.getByText('overdue')).toBeInTheDocument();
  });

  it('records something that already happened, with no due date', async () => {
    const user = userEvent.setup();
    render(<ActivityLog customerId="cu-1" editable />);
    await openCard(user);
    await user.click(await screen.findByRole('button', { name: /Log something/ }));
    await user.type(screen.getByLabelText('What about'), 'Rang about the schedule');
    await user.click(screen.getByRole('button', { name: 'Log it' }));
    await waitFor(() => expect(hoisted.logged).toHaveLength(1));
    expect(hoisted.logged[0]).toMatchObject({
      activityType: 'call', subject: 'Rang about the schedule',
      customerId: 'cu-1', completed: true,
    });
  });

  it('records something still to do when a date is given', async () => {
    /* The same record from either side of a date, which is why one form writes both. */
    const user = userEvent.setup();
    render(<ActivityLog customerId="cu-1" editable />);
    await openCard(user);
    await user.click(await screen.findByRole('button', { name: /Log something/ }));
    await user.type(screen.getByLabelText('What about'), 'Chase the geotech report');
    await user.type(screen.getByLabelText(/^Due/), '2026-10-01');
    expect(screen.getByRole('button', { name: 'Add the follow-up' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add the follow-up' }));
    await waitFor(() => expect(hoisted.logged).toHaveLength(1));
    expect(hoisted.logged[0]).toMatchObject({ completed: false, dueAt: '2026-10-01' });
  });

  it('needs to be told what it was about', async () => {
    const user = userEvent.setup();
    render(<ActivityLog customerId="cu-1" editable />);
    await openCard(user);
    await user.click(await screen.findByRole('button', { name: /Log something/ }));
    expect(screen.getByRole('button', { name: 'Log it' })).toBeDisabled();
  });

  it('ticks one off', async () => {
    hoisted.rows = [entry({ completedAt: null, dueAt: '2026-10-01T00:00:00Z' })];
    const user = userEvent.setup();
    render(<ActivityLog customerId="cu-1" editable />);
    await user.click(await screen.findByRole('button', { name: /Done/ }));
    await waitFor(() => expect(hoisted.completed).toEqual(['a-1']));
  });

  it('offers nothing to log where there is no subject to log it against', async () => {
    hoisted.rows = [entry()];
    const user = userEvent.setup();
    render(<ActivityLog editable />);
    await openCard(user);
    expect(await screen.findByText('Spoke to Dana about the schedule')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Log something/ })).not.toBeInTheDocument();
  });
});
