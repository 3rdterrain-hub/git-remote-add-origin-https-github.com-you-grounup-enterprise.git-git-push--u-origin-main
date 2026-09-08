/**
 * A rate sheet from your dealer.
 *
 * `import_equipment_rates` was reachable from SQL and nothing else — the fifth
 * working feature in this codebase with no door. This is the door.
 *
 * The screen decides nothing; every judgment stays in the database function
 * where it was tested. What it is responsible for is that the refusals get read.
 * A rate sheet whose daily-only lines were silently divided into hourly rates
 * would import cleanly and price every estimate wrong, so the refusal has to be
 * as visible as the success.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EquipmentRateImportReport } from '@/lib/data/library';
import { ImportRateSheet } from './import-rate-sheet';

const hoisted = vi.hoisted(() => ({
  sent: [] as Array<{ companyId: string; rows: Record<string, string>[] }>,
  report: null as EquipmentRateImportReport | null,
  failWith: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));

vi.mock('@/lib/data/library', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/library')>('@/lib/data/library');
  return {
    ...actual,
    importEquipmentRates: async (
      _c: unknown, companyId: string, rows: Record<string, string>[],
    ) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.sent.push({ companyId, rows });
      return hoisted.report!;
    },
  };
});

const empty: EquipmentRateImportReport = {
  priced: 0, machinesCreated: 0, rejected: [], needsReview: [], approved: true,
};

const onImported = vi.fn();

beforeEach(() => {
  hoisted.sent = [];
  hoisted.report = { ...empty };
  hoisted.failWith = null;
  onImported.mockClear();
});

const panel = (over: Partial<React.ComponentProps<typeof ImportRateSheet>> = {}) =>
  render(<ImportRateSheet companyId="co-1" canWrite onImported={onImported} {...over} />);

const pick = async (text: string) => {
  await userEvent.upload(
    screen.getByLabelText('Rate sheet CSV'),
    new File([text], 'rates.csv', { type: 'text/csv' }));
};

describe('bringing in a rate sheet', () => {
  it('says how many rows it read and which columns it will use', async () => {
    panel();
    await pick('equipment,hourly_rate,daily_rate,dealer_branch\nCat 336,210,1600,Toledo\n');
    await waitFor(() => expect(screen.getByText(/Reading/)).toBeInTheDocument());
    expect(screen.getByText('equipment, hourly_rate, daily_rate')).toBeInTheDocument();
    expect(screen.getByText('dealer_branch')).toBeInTheDocument();
  });

  it('refuses a file with nothing that names a machine', async () => {
    panel();
    await pick('machine,hourly_rate\nCat 336,210\n');
    await waitFor(() =>
      expect(screen.getByText(/has no "equipment" column/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^Import/ })).not.toBeInTheDocument();
  });

  it('accepts a sheet keyed on code rather than name', async () => {
    panel();
    await pick('code,hourly_rate\nEQF-8282,210\n');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Import/ })).toBeInTheDocument());
  });

  it('sends the rows as they were read', async () => {
    panel();
    await pick('Equipment,Hourly_Rate\n"Excavator, hydraulic 30t",212.75\n');
    await userEvent.click(await screen.findByRole('button', { name: /^Import/ }));
    await waitFor(() => expect(hoisted.sent).toHaveLength(1));
    expect(hoisted.sent[0]).toEqual({
      companyId: 'co-1',
      rows: [{ equipment: 'Excavator, hydraulic 30t', hourly_rate: '212.75' }],
    });
  });

  it('says before anything is written that a daily-only line will be refused', async () => {
    panel();
    await pick('equipment,hourly_rate\nCat 336,210\n');
    await waitFor(() =>
      expect(screen.getByText(/a rental day is a calendar day rather than/i)).toBeInTheDocument());
  });

  describe('the report', () => {
    it('gives the counts', async () => {
      hoisted.report = { ...empty, priced: 412, machinesCreated: 17 };
      panel();
      await pick('equipment,hourly_rate\nCat 336,210\n');
      await userEvent.click(await screen.findByRole('button', { name: /^Import/ }));
      expect(await screen.findByText('412')).toBeInTheDocument();
      expect(screen.getByText(/17 machines added/)).toBeInTheDocument();
    });

    it('names a line it refused, and why, so the sheet can be fixed', async () => {
      hoisted.report = { ...empty, priced: 40, rejected: [
        { name: 'Cat 320', reason: 'No hourly rate. A rental day is a calendar day.' },
      ] };
      panel();
      await pick('equipment,hourly_rate\nCat 336,210\n');
      await userEvent.click(await screen.findByRole('button', { name: /^Import/ }));
      expect(await screen.findByText('1 not imported')).toBeInTheDocument();
      expect(screen.getByText('Cat 320')).toBeInTheDocument();
      expect(screen.getByText(/A rental day is a calendar day/)).toBeInTheDocument();
    });

    it('names a machine it had to create, and what the sheet did not say', async () => {
      hoisted.report = { ...empty, priced: 5, machinesCreated: 1, needsReview: [
        { name: 'Cat 336', why: 'New machine. The sheet did not say how much fuel it burns.' },
      ] };
      panel();
      await pick('equipment,hourly_rate\nCat 336,210\n');
      await userEvent.click(await screen.findByRole('button', { name: /^Import/ }));
      expect(await screen.findByText('1 imported, and worth a look')).toBeInTheDocument();
      expect(screen.getByText(/did not say how much fuel it burns/)).toBeInTheDocument();
    });

    it('shows no unit column, because a rate sheet has no units to be wrong about', async () => {
      hoisted.report = { ...empty, priced: 1, needsReview: [{ name: 'Cat 336', why: 'New machine.' }] };
      panel();
      await pick('equipment,hourly_rate\nCat 336,210\n');
      await userEvent.click(await screen.findByRole('button', { name: /^Import/ }));
      await screen.findByText('1 imported, and worth a look');
      expect(screen.queryByRole('columnheader', { name: 'Unit' })).not.toBeInTheDocument();
    });

    it('says when the rates landed pending because the importer cannot approve', async () => {
      hoisted.report = { ...empty, priced: 4, approved: false };
      panel();
      await pick('equipment,hourly_rate\nCat 336,210\n');
      await userEvent.click(await screen.findByRole('button', { name: /^Import/ }));
      expect(await screen.findByText(/Held pending/)).toBeInTheDocument();
    });

    it('re-reads the table only when something actually changed', async () => {
      hoisted.report = { ...empty };
      panel();
      await pick('equipment,hourly_rate\nCat 336,210\n');
      await userEvent.click(await screen.findByRole('button', { name: /^Import/ }));
      await waitFor(() => expect(hoisted.sent).toHaveLength(1));
      expect(onImported).not.toHaveBeenCalled();

      hoisted.report = { ...empty, priced: 1 };
      await pick('equipment,hourly_rate\nCat 320,180\n');
      await userEvent.click(await screen.findByRole('button', { name: /^Import/ }));
      await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    });

    it('shows what the database refused rather than a generic failure', async () => {
      hoisted.failWith = 'Importing equipment rates needs the libraries.write permission.';
      panel();
      await pick('equipment,hourly_rate\nCat 336,210\n');
      await userEvent.click(await screen.findByRole('button', { name: /^Import/ }));
      expect(await screen.findByText(
        'Importing equipment rates needs the libraries.write permission.')).toBeInTheDocument();
    });
  });

  describe('who may do it', () => {
    it('will not offer the picker without the permission, and says why', () => {
      panel({ canWrite: false });
      expect(screen.getByRole('button', { name: /Bring in a rate sheet/ })).toBeDisabled();
      expect(screen.getByText(/needs the library-write permission/)).toBeInTheDocument();
    });

    it('will not offer it before a company is known', () => {
      panel({ companyId: null });
      expect(screen.getByRole('button', { name: /Bring in a rate sheet/ })).toBeDisabled();
    });
  });
});
