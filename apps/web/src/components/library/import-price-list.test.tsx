/**
 * Bringing in a price list.
 *
 * `import_materials` was reachable only from a command line tool that asks for
 * the project's database password — which an estimator does not have and should
 * never be asked for. This is the door.
 *
 * The screen decides nothing; every judgment stays in the database function
 * where it was tested. What it is responsible for is that the report gets read.
 * "247 imported" on its own hides the two things that matter — what was refused
 * and what was taken that somebody has to look at — and the moment to see those
 * is now rather than at bid time.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MaterialImportReport } from '@/lib/data/library';
import { ImportPriceList } from './import-price-list';

const hoisted = vi.hoisted(() => ({
  sent: [] as Array<{ companyId: string; rows: Record<string, string>[] }>,
  report: null as MaterialImportReport | null,
  failWith: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));

vi.mock('@/lib/data/library', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/library')>('@/lib/data/library');
  return {
    ...actual,
    importMaterials: async (
      _c: unknown, companyId: string, rows: Record<string, string>[],
    ) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.sent.push({ companyId, rows });
      return hoisted.report!;
    },
  };
});

const empty: MaterialImportReport = {
  imported: 0, alreadyThere: 0, categoriesAdded: 0,
  rejected: [], needsReview: [], approved: true,
};

const onImported = vi.fn();

beforeEach(() => {
  hoisted.sent = [];
  hoisted.report = { ...empty };
  hoisted.failWith = null;
  onImported.mockClear();
});

const panel = (over: Partial<React.ComponentProps<typeof ImportPriceList>> = {}) =>
  render(<ImportPriceList companyId="co-1" canWrite onImported={onImported} {...over} />);

/** A CSV, as a file the input will accept. */
const csv = (text: string) =>
  new File([text], 'prices.csv', { type: 'text/csv' });

const pick = async (text: string) => {
  const input = screen.getByLabelText('Price list CSV');
  await userEvent.upload(input, csv(text));
};

describe('bringing in a price list', () => {
  it('says how many rows it read, and which columns it will use', async () => {
    panel();
    await pick('name,unit,unit_cost,vendor_sku\nTopsoil,CY,18.50,TS-1\n');
    await waitFor(() =>
      expect(screen.getByText(/Reading/)).toBeInTheDocument());
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('name, unit, unit_cost')).toBeInTheDocument();
  });

  it('says which columns it is ignoring rather than dropping them silently', async () => {
    panel();
    await pick('name,unit,vendor_sku,last_ordered\nTopsoil,CY,TS-1,2026-01-02\n');
    await waitFor(() =>
      expect(screen.getByText('vendor_sku, last_ordered')).toBeInTheDocument());
  });

  it('refuses a file with no name column, and lists what it found', async () => {
    panel();
    await pick('material,unit\nTopsoil,CY\n');
    await waitFor(() =>
      expect(screen.getByText(/has no "name" column/)).toBeInTheDocument());
    expect(screen.getByText(/material, unit/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Import/ })).not.toBeInTheDocument();
  });

  it('refuses a file with nothing under its header', async () => {
    panel();
    await pick('name,unit\n');
    await waitFor(() =>
      expect(screen.getByText('That file has no rows under its header.')).toBeInTheDocument());
  });

  it('sends the rows as they were read, keyed by the lowercased header', async () => {
    panel();
    await pick('Name,Unit,Unit_Cost\n"Pipe, ductile 8 inch",LF,42.10\n');
    await userEvent.click(await screen.findByRole('button', { name: /^Import/ }));
    await waitFor(() => expect(hoisted.sent).toHaveLength(1));
    expect(hoisted.sent[0]).toEqual({
      companyId: 'co-1',
      rows: [{ name: 'Pipe, ductile 8 inch', unit: 'LF', unit_cost: '42.10' }],
    });
  });

  it('re-reads the table only when something actually changed', async () => {
    hoisted.report = { ...empty, imported: 0, alreadyThere: 3 };
    panel();
    await pick('name,unit\nTopsoil,CY\n');
    await userEvent.click(await screen.findByRole('button', { name: /^Import/ }));
    await waitFor(() => expect(hoisted.sent).toHaveLength(1));
    expect(onImported).not.toHaveBeenCalled();

    hoisted.report = { ...empty, imported: 1 };
    await pick('name,unit\nGravel,TON\n');
    await userEvent.click(await screen.findByRole('button', { name: /^Import/ }));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
  });

  describe('the report', () => {
    it('gives the three counts', async () => {
      hoisted.report = { ...empty, imported: 247, alreadyThere: 12, categoriesAdded: 8 };
      panel();
      await pick('name,unit\nTopsoil,CY\n');
      await userEvent.click(await screen.findByRole('button', { name: /^Import/ }));
      expect(await screen.findByText('247')).toBeInTheDocument();
      expect(screen.getByText(/12 already there/)).toBeInTheDocument();
      expect(screen.getByText(/8 categories added/)).toBeInTheDocument();
    });

    it('names what was refused, and why, so the file can be fixed', async () => {
      hoisted.report = { ...empty, imported: 2, rejected: [
        { name: 'Framing lumber', reason: 'MBF is not a unit this platform has.' },
      ] };
      panel();
      await pick('name,unit\nTopsoil,CY\n');
      await userEvent.click(await screen.findByRole('button', { name: /^Import/ }));
      expect(await screen.findByText('1 not imported')).toBeInTheDocument();
      expect(screen.getByText('Framing lumber')).toBeInTheDocument();
      expect(screen.getByText('MBF is not a unit this platform has.')).toBeInTheDocument();
    });

    it('names what it took that somebody should look at', async () => {
      hoisted.report = { ...empty, imported: 60, needsReview: [
        { name: 'Crushed stone', unit: 'EA', why: 'Filed as each. Normally bought by the ton.' },
      ] };
      panel();
      await pick('name,unit\nTopsoil,CY\n');
      await userEvent.click(await screen.findByRole('button', { name: /^Import/ }));
      expect(await screen.findByText('1 imported, and worth a look')).toBeInTheDocument();
      expect(screen.getByText('Filed as each. Normally bought by the ton.')).toBeInTheDocument();
    });

    it('says when the rows landed as drafts because the importer cannot approve', async () => {
      hoisted.report = { ...empty, imported: 4, approved: false };
      panel();
      await pick('name,unit\nTopsoil,CY\n');
      await userEvent.click(await screen.findByRole('button', { name: /^Import/ }));
      expect(await screen.findByText(/Saved as drafts/)).toBeInTheDocument();
    });

    it('says nothing about refusals when there were none', async () => {
      hoisted.report = { ...empty, imported: 4 };
      panel();
      await pick('name,unit\nTopsoil,CY\n');
      await userEvent.click(await screen.findByRole('button', { name: /^Import/ }));
      await screen.findByText('4');
      expect(screen.queryByText(/not imported/)).not.toBeInTheDocument();
      expect(screen.queryByText(/worth a look/)).not.toBeInTheDocument();
    });

    it('shows what the database refused rather than a generic failure', async () => {
      hoisted.failWith = 'Importing materials needs the libraries.write permission.';
      panel();
      await pick('name,unit\nTopsoil,CY\n');
      await userEvent.click(await screen.findByRole('button', { name: /^Import/ }));
      expect(await screen.findByText(
        'Importing materials needs the libraries.write permission.')).toBeInTheDocument();
    });
  });

  describe('who may do it', () => {
    it('will not offer the file picker without the permission, and says why', () => {
      panel({ canWrite: false });
      expect(screen.getByRole('button', { name: /Bring in a price list/ })).toBeDisabled();
      expect(screen.getByText(/needs the library-write permission/)).toBeInTheDocument();
    });

    it('will not offer it before a company is known', () => {
      panel({ companyId: null });
      expect(screen.getByRole('button', { name: /Bring in a price list/ })).toBeDisabled();
    });
  });
});
