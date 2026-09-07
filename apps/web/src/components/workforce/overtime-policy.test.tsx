/**
 * The overtime rule.
 *
 * Four numbers that decide what people are paid, on a settings screen — the
 * exact shape of thing that gets set once and never read again. So the panel
 * states the rule as a sentence, and this file holds the sentence to being
 * *true* for every combination the fields allow.
 *
 * The two defaults are load-bearing and are tested as such: federal rather than
 * California, because paying overtime nobody owes is a silent cost; and no
 * rounding, because the seven-minute rule is the most common way a time system
 * quietly shorts people.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OvertimePolicy } from '@/lib/data/time-clock';

const hoisted = vi.hoisted(() => ({
  configured: true,
  policy: null as OvertimePolicy | null,
  saved: [] as OvertimePolicy[],
  refuse: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/time-clock', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/time-clock')>(
    '@/lib/data/time-clock');
  return {
    ...actual,
    loadOvertimePolicy: async () => hoisted.policy ?? actual.DEFAULT_OVERTIME,
    saveOvertimePolicy: async (_c: string, p: OvertimePolicy) => {
      if (hoisted.refuse) throw new Error(hoisted.refuse);
      hoisted.saved.push(p);
    },
  };
});

import { OvertimePolicyCard } from './overtime-policy';
import { describeOvertime, DEFAULT_OVERTIME } from '@/lib/data/time-clock';

beforeEach(() => {
  hoisted.configured = true;
  hoisted.policy = null;
  hoisted.saved = [];
  hoisted.refuse = null;
});

// ---------------------------------------------------------------------------
describe('the rule said out loud', () => {
  it('describes the federal default without inventing a daily rule', () => {
    expect(describeOvertime(DEFAULT_OVERTIME))
      .toBe('Overtime after 40 hours in a week. Minutes are counted as worked, with no rounding.');
  });

  it('describes a daily and weekly rule together', () => {
    expect(describeOvertime({ ...DEFAULT_OVERTIME, dailyOvertimeAfter: 8 }))
      .toContain('Overtime after 8 hours in a day, and 40 hours in a week');
  });

  it('describes double time when there is one', () => {
    expect(describeOvertime({
      ...DEFAULT_OVERTIME, dailyOvertimeAfter: 8, dailyDoubletimeAfter: 12,
    })).toContain('double time after 12');
  });

  it('says plainly when no overtime is calculated at all', () => {
    expect(describeOvertime({
      ...DEFAULT_OVERTIME, weeklyOvertimeAfter: null,
    })).toBe('Every hour at straight time. No overtime is calculated.');
  });

  it('names the rounding when a company has turned it on', () => {
    expect(describeOvertime({ ...DEFAULT_OVERTIME, roundingMinutes: 15 }))
      .toContain('rounded to the nearest 15 minutes');
  });

  it('names the direction when it is not the nearest', () => {
    expect(describeOvertime({
      ...DEFAULT_OVERTIME, roundingMinutes: 15, roundingDirection: 'down',
    })).toContain('rounded down to 15 minutes');
  });
});

// ---------------------------------------------------------------------------
describe('the panel', () => {
  it('opens on the federal rule, not a daily one', async () => {
    render(<OvertimePolicyCard companyId="c1" canEdit />);
    expect(await screen.findByText(/Overtime after 40 hours in a week/)).toBeInTheDocument();
    expect(screen.getByLabelText('Daily overtime after')).toHaveValue('');
  });

  it('offers no rounding as the default', async () => {
    render(<OvertimePolicyCard companyId="c1" canEdit />);
    expect(await screen.findByText(/no rounding/)).toBeInTheDocument();
  });

  it('updates the sentence as the fields change, before anything is saved', async () => {
    render(<OvertimePolicyCard companyId="c1" canEdit />);
    await userEvent.type(await screen.findByLabelText('Daily overtime after'), '8');
    expect(await screen.findByText(/Overtime after 8 hours in a day/)).toBeInTheDocument();
    expect(hoisted.saved).toEqual([]);
  });

  it('treats an emptied field as no rule rather than zero', async () => {
    hoisted.policy = { ...DEFAULT_OVERTIME, dailyOvertimeAfter: 8 };
    render(<OvertimePolicyCard companyId="c1" canEdit />);
    await userEvent.clear(await screen.findByLabelText('Daily overtime after'));
    await userEvent.click(screen.getByRole('button', { name: /Save the rule/ }));
    await waitFor(() => expect(hoisted.saved[0]?.dailyOvertimeAfter).toBeNull());
  });

  it('saves what is on screen', async () => {
    render(<OvertimePolicyCard companyId="c1" canEdit />);
    await userEvent.type(await screen.findByLabelText('Daily overtime after'), '10');
    await userEvent.click(screen.getByRole('button', { name: /Save the rule/ }));
    await waitFor(() => expect(hoisted.saved[0]).toMatchObject({
      dailyOvertimeAfter: 10, weeklyOvertimeAfter: 40,
    }));
  });

  it('shows the database refusal rather than a generic failure', async () => {
    hoisted.refuse = 'Setting the overtime rule needs the company.manage permission.';
    render(<OvertimePolicyCard companyId="c1" canEdit />);
    await userEvent.click(await screen.findByRole('button', { name: /Save the rule/ }));
    expect(await screen.findByRole('alert'))
      .toHaveTextContent('needs the company.manage permission');
  });

  it('offers no save at all without the permission, and says why', async () => {
    render(<OvertimePolicyCard companyId="c1" canEdit={false} />);
    expect(await screen.findByText(/needs the company.manage permission/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save the rule/ })).not.toBeInTheDocument();
  });

  it('warns about rounding down rather than offering it silently', async () => {
    render(<OvertimePolicyCard companyId="c1" canEdit />);
    expect(await screen.findByText(/Rounding down shortens every partial interval/))
      .toBeInTheDocument();
  });
});
