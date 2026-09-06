/**
 * Picking a category, and adding one without leaving the form.
 *
 * The two properties are opposites and the design is wrong without both. A
 * picker that could only pick would leave a contractor whose word for the work
 * is not in the shipped catalog unable to file it at all. A free text box lets
 * "Site Work", "Sitework" and "Site work" become three categories that every
 * report has to reconcile. So: choose from the list, and add to the list.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CategoryOption } from '@/lib/data/categories';

const hoisted = vi.hoisted(() => ({
  configured: true,
  options: [] as CategoryOption[],
  added: [] as Array<Record<string, unknown>>,
  fail: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/categories', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/categories')>(
    '@/lib/data/categories');
  return {
    ...actual,
    loadCategories: () => async () => hoisted.options,
    addCategory: async (_c: unknown, input: Record<string, unknown>) => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      hoisted.added.push(input);
      hoisted.options = [...hoisted.options, {
        id: 'cat-new', kind: input.kind as CategoryOption['kind'],
        name: String(input.name), description: null, sortOrder: 100, isOwn: true,
      }];
      return 'cat-new';
    },
  };
});

const { CategorySelect } = await import('./category-select');

const option = (over: Partial<CategoryOption> = {}): CategoryOption => ({
  id: 'cat-1', kind: 'service_category', name: 'Earthwork',
  description: null, sortOrder: 10, isOwn: false, ...over,
});

beforeEach(() => {
  hoisted.configured = true;
  hoisted.options = [option(), option({ id: 'cat-2', name: 'Concrete' })];
  hoisted.added = [];
  hoisted.fail = null;
});

describe('choosing a category', () => {
  it('offers what the list holds', async () => {
    render(<CategorySelect kind="service_category" value="" onChange={() => {}} label="category" />);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Earthwork' })).toBeInTheDocument());
    expect(screen.getByRole('option', { name: 'Concrete' })).toBeInTheDocument();
  });

  it("marks the company's own, so it is clear which are yours", async () => {
    hoisted.options = [option({ isOwn: true, name: 'Marine works' })];
    render(<CategorySelect kind="service_category" value="" onChange={() => {}} label="category" />);
    expect(await screen.findByRole('option', { name: /Marine works · yours/ })).toBeInTheDocument();
  });

  it('hands back the name, which is what the column stores', async () => {
    const seen: string[] = [];
    render(<CategorySelect kind="service_category" value="" onChange={(v) => seen.push(v)}
      label="category" />);
    await screen.findByRole('option', { name: 'Concrete' });
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Concrete');
    expect(seen).toEqual(['Concrete']);
  });

  it('still shows a value the list no longer has, rather than losing it', async () => {
    /*
     * A row filed under a category that has since been retired should say what
     * it says. Dropping it silently would change the row by rendering it.
     */
    render(<CategorySelect kind="service_category" value="Retired trade"
      onChange={() => {}} label="category" />);
    expect(await screen.findByRole('option', { name: /Retired trade \(no longer offered\)/ }))
      .toBeInTheDocument();
  });

  it('offers no empty choice when the caller says a category is required', async () => {
    render(<CategorySelect kind="service_category" value="Earthwork" onChange={() => {}}
      allowEmpty={false} label="category" />);
    await screen.findByRole('option', { name: 'Earthwork' });
    expect(screen.queryByRole('option', { name: '—' })).not.toBeInTheDocument();
  });
});

describe('adding one', () => {
  it('files it and selects it, without leaving the form', async () => {
    const seen: string[] = [];
    render(<CategorySelect kind="service_category" value="" onChange={(v) => seen.push(v)}
      label="category" />);
    await userEvent.click(await screen.findByRole('button', { name: /add a category/i }));
    await userEvent.type(screen.getByRole('textbox'), 'Marine works');
    await userEvent.click(screen.getByRole('button', { name: /add this category/i }));

    await waitFor(() => expect(hoisted.added).toHaveLength(1));
    expect(hoisted.added[0]).toEqual({ kind: 'service_category', name: 'Marine works' });
    expect(seen).toEqual(['Marine works']);
  });

  it('takes Enter, because that is what a person types', async () => {
    render(<CategorySelect kind="service_category" value="" onChange={() => {}} label="category" />);
    await userEvent.click(await screen.findByRole('button', { name: /add a category/i }));
    await userEvent.type(screen.getByRole('textbox'), 'Marine works{Enter}');
    await waitFor(() => expect(hoisted.added).toHaveLength(1));
  });

  it('will not file a category with no name', async () => {
    render(<CategorySelect kind="service_category" value="" onChange={() => {}} label="category" />);
    await userEvent.click(await screen.findByRole('button', { name: /add a category/i }));
    expect(screen.getByRole('button', { name: /add this category/i })).toBeDisabled();
  });

  it('says what went wrong rather than closing the field', async () => {
    hoisted.fail = 'You do not have permission to change the libraries';
    render(<CategorySelect kind="service_category" value="" onChange={() => {}} label="category" />);
    await userEvent.click(await screen.findByRole('button', { name: /add a category/i }));
    await userEvent.type(screen.getByRole('textbox'), 'Marine works{Enter}');
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('goes back on Escape without filing anything', async () => {
    render(<CategorySelect kind="service_category" value="" onChange={() => {}} label="category" />);
    await userEvent.click(await screen.findByRole('button', { name: /add a category/i }));
    await userEvent.type(screen.getByRole('textbox'), 'Marine works{Escape}');
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    expect(hoisted.added).toEqual([]);
  });

  it('offers no add where the caller says the person may not write', async () => {
    render(<CategorySelect kind="service_category" value="" onChange={() => {}}
      canAdd={false} label="category" />);
    await screen.findByRole('option', { name: 'Earthwork' });
    expect(screen.queryByRole('button', { name: /add a category/i })).not.toBeInTheDocument();
  });
});
