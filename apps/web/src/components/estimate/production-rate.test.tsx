/**
 * The rate this line goes at.
 *
 * The most consequential number on a line was the one an estimator could not
 * see: picked once when the line was created, never shown, never changeable.
 *
 * Two properties this file holds. The panel must say the *hours*, not only the
 * rate — "1,800 CY takes about 9 hours" is the sentence somebody is actually
 * asking for. And overriding must read as what it is: a rate filed against the
 * company, carrying a reason, marked unapproved. A screen that presented it as
 * a private adjustment would hide the one fact a reviewer needs.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LineProduction, RateOption } from '@/lib/data/production';

const hoisted = vi.hoisted(() => ({
  configured: true,
  production: null as LineProduction | null,
  options: [] as RateOption[],
  chosen: [] as Array<string | null>,
  overrides: [] as Array<Record<string, unknown>>,
  fail: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/production', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/production')>(
    '@/lib/data/production');
  return {
    ...actual,
    loadLineProduction: () => async () => hoisted.production,
    loadRateOptions: () => async () => hoisted.options,
    setLineRate: async (_c: unknown, _l: string, rateId: string | null) => {
      hoisted.chosen.push(rateId);
    },
    overrideLineProduction: async (_c: unknown, input: Record<string, unknown>) => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      hoisted.overrides.push(input);
      return 'pr-new';
    },
  };
});

const { ProductionRatePanel } = await import('./production-rate');

const production = (over: Partial<LineProduction> = {}): LineProduction => ({
  lineItemId: 'l-1', description: 'Mass excavation', unit: 'CY',
  measuredQuantity: 1800, productionRateId: 'pr-1', rateCode: 'PR-000123',
  ratePerHour: 220, rateUnit: 'CY', utilizationFactor: 0.83, shiftHours: 8,
  sourceType: 'seed_benchmark', confidenceScore: 0.45, sampleSize: 0,
  approvalState: 'pending', note: null, isOwnRate: false,
  taskName: 'Excavate and load', hoursAtThisRate: 9.86, ...over,
});

const option = (over: Partial<RateOption> = {}): RateOption => ({
  rateId: 'pr-2', taskName: 'Excavate and load', ratePerHour: 260, rateUnit: 'CY',
  utilizationFactor: 0.83, shiftHours: 8, sourceType: 'company_actual',
  confidenceScore: 0.85, sampleSize: 6, approvalState: 'approved',
  isOwn: true, unitMatches: true, rank: 1, isCurrent: false, ...over,
});

beforeEach(() => {
  hoisted.configured = true;
  hoisted.production = production();
  hoisted.options = [option(), option({ rateId: 'pr-1', isCurrent: true, isOwn: false,
    sourceType: 'seed_benchmark', sampleSize: 0, rank: 2 })];
  hoisted.chosen = [];
  hoisted.overrides = [];
  hoisted.fail = null;
});

describe('what the rate says', () => {
  it('gives the hours, not only the rate', async () => {
    render(<ProductionRatePanel lineId="l-1" editable onChanged={() => {}} />);
    expect(await screen.findByText(/takes about/)).toBeInTheDocument();
    expect(screen.getByText(/9\.9 hours/)).toBeInTheDocument();
  });

  it('says where the rate came from in words, not a code', async () => {
    render(<ProductionRatePanel lineId="l-1" editable onChanged={() => {}} />);
    expect(await screen.findByText('GrounUp benchmark')).toBeInTheDocument();
  });

  it('says when nobody has approved it', async () => {
    render(<ProductionRatePanel lineId="l-1" editable onChanged={() => {}} />);
    expect(await screen.findByText('Not approved')).toBeInTheDocument();
  });

  it("counts the jobs behind a company's measured rate", async () => {
    hoisted.production = production({ sourceType: 'company_actual', sampleSize: 6,
      approvalState: 'approved', isOwnRate: true });
    render(<ProductionRatePanel lineId="l-1" editable onChanged={() => {}} />);
    expect(await screen.findByText(/Your measured actual, 6 jobs/)).toBeInTheDocument();
  });

  it('refuses to imply hours from a rate measured in another unit', async () => {
    hoisted.production = production({ rateUnit: 'LF', hoursAtThisRate: null });
    render(<ProductionRatePanel lineId="l-1" editable onChanged={() => {}} />);
    expect(await screen.findByText(/measured in LF and the line is bid in CY/))
      .toBeInTheDocument();
    expect(screen.queryByText(/takes about/)).not.toBeInTheDocument();
  });

  it('says plainly when a line has no rate at all', async () => {
    hoisted.production = production({ productionRateId: null, ratePerHour: null,
      sourceType: null, hoursAtThisRate: null, approvalState: null });
    render(<ProductionRatePanel lineId="l-1" editable onChanged={() => {}} />);
    expect(await screen.findByText(/No production rate on this line/)).toBeInTheDocument();
  });
});

describe('changing it', () => {
  it('offers the alternatives and marks the one in use', async () => {
    render(<ProductionRatePanel lineId="l-1" editable onChanged={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /change rate/i }));
    expect(await screen.findByText('On this line')).toBeInTheDocument();
    expect(screen.getByText(/Your measured actual, 6 measured/)).toBeInTheDocument();
  });

  it('moves the line onto the one that was picked', async () => {
    render(<ProductionRatePanel lineId="l-1" editable onChanged={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /change rate/i }));
    /* The rate line is split across nodes by JSX, so anchor on the option's
       provenance, which is a single node and unique to this row. */
    const row = (await screen.findByText(/Your measured actual, 6 measured/))
      .closest('button')!;
    await userEvent.click(row);
    await waitFor(() => expect(hoisted.chosen).toEqual(['pr-2']));
  });

  it('will not offer a rate measured in the wrong unit as a choice', async () => {
    hoisted.options = [option({ rateId: 'pr-3', rateUnit: 'LF', unitMatches: false })];
    render(<ProductionRatePanel lineId="l-1" editable onChanged={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /change rate/i }));
    const row = (await screen.findByText(/not measured in CY/)).closest('button')!;
    expect(row).toBeDisabled();
  });

  it('lets the rate be cleared, since a lump sum has no production', async () => {
    render(<ProductionRatePanel lineId="l-1" editable onChanged={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /change rate/i }));
    await userEvent.click(await screen.findByText(/No production rate — drive the hours/));
    await waitFor(() => expect(hoisted.chosen).toEqual([null]));
  });

  it('offers nothing to change on a frozen version', async () => {
    render(<ProductionRatePanel lineId="l-1" editable={false} onChanged={() => {}} />);
    await screen.findByText(/takes about/);
    expect(screen.queryByRole('button', { name: /change rate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /use my own/i })).not.toBeInTheDocument();
  });
});

describe('using your own number', () => {
  const openOverride = async () => {
    render(<ProductionRatePanel lineId="l-1" editable onChanged={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /use my own/i }));
  };

  it('says it files a rate rather than adjusting the line privately', async () => {
    await openOverride();
    expect(screen.getByText(/files a rate against your company carrying your reason/i))
      .toBeInTheDocument();
    expect(screen.getByText(/marked not approved/i)).toBeInTheDocument();
  });

  it('will not send a reason too short to review', async () => {
    await openOverride();
    await userEvent.type(screen.getByLabelText('CY per hour'), '240');
    await userEvent.type(screen.getByLabelText(/why this is right/i), 'faster');
    expect(screen.getByRole('button', { name: /use this rate/i })).toBeDisabled();
    expect(screen.getByText(/A sentence, not a word/)).toBeInTheDocument();
  });

  it('sends the rate and the reason together', async () => {
    await openOverride();
    await userEvent.type(screen.getByLabelText('CY per hour'), '240');
    await userEvent.type(screen.getByLabelText(/why this is right/i),
      'Our crew ran this at 240 on the last two ponds');
    await userEvent.click(screen.getByRole('button', { name: /use this rate/i }));
    await waitFor(() => expect(hoisted.overrides).toHaveLength(1));
    expect(hoisted.overrides[0]).toMatchObject({
      lineId: 'l-1', perHour: 240,
      reason: 'Our crew ran this at 240 on the last two ponds',
    });
  });

  it('shows the reason back once it is the rate in force', async () => {
    hoisted.production = production({
      sourceType: 'estimator_judgment', isOwnRate: true,
      note: 'Our crew ran this at 240 on the last two ponds',
    });
    render(<ProductionRatePanel lineId="l-1" editable onChanged={() => {}} />);
    expect(await screen.findByText(/Your reason: Our crew ran this at 240/))
      .toBeInTheDocument();
  });

  it('shows what went wrong rather than closing the field', async () => {
    hoisted.fail = 'Say why this rate is right for this work, in a sentence';
    await openOverride();
    await userEvent.type(screen.getByLabelText('CY per hour'), '240');
    await userEvent.type(screen.getByLabelText(/why this is right/i),
      'A reason long enough to pass the client check');
    await userEvent.click(screen.getByRole('button', { name: /use this rate/i }));
    expect(await screen.findByText(/Say why this rate is right/)).toBeInTheDocument();
  });
});
