/**
 * The category lists, and the four things you can do to one.
 *
 * What these hold down is not that the buttons work — it is what the screen
 * refuses. A removal cannot be confirmed without saying where the items go, a
 * shipped category offers no rename or remove at all, and a count that came
 * back is something you can open. Each of those is a rule from the database
 * that the screen has to state rather than let somebody discover.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  CategoryOption, CategoryUsage, CategoryKindInfo, CategoryMember,
} from '@/lib/data/categories';

const hoisted = vi.hoisted(() => ({
  configured: true,
  kinds: [] as CategoryKindInfo[],
  options: [] as CategoryOption[],
  usage: [] as CategoryUsage[],
  members: [] as CategoryMember[],
  renamed: [] as Array<Record<string, unknown>>,
  deleted: [] as Array<Record<string, unknown>>,
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
    loadCategoryKinds: async () => hoisted.kinds,
    loadCategories: () => async () => hoisted.options,
    loadCategoryUsage: () => async () => hoisted.usage,
    loadCategoryMembers: () => async () => hoisted.members,
    addCategory: async (_c: unknown, input: Record<string, unknown>) => {
      hoisted.added.push(input); return 'cat-new';
    },
    renameCategory: async (_c: unknown, input: Record<string, unknown>) => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      hoisted.renamed.push(input); return 3;
    },
    deleteCategory: async (_c: unknown, input: Record<string, unknown>) => {
      hoisted.deleted.push(input); return 5;
    },
  };
});

const { CategoryManager } = await import('./category-manager');

const kind = (over: Partial<CategoryKindInfo> = {}): CategoryKindInfo => ({
  kind: 'material_category', tableName: 'materials', columnName: 'category',
  label: 'Material category', labelColumn: 'name', ...over,
});
const option = (over: Partial<CategoryOption> = {}): CategoryOption => ({
  id: 'cat-1', kind: 'material_category', name: 'Compaction',
  description: null, sortOrder: 10, isOwn: true, ...over,
});

beforeEach(() => {
  hoisted.configured = true;
  hoisted.kinds = [
    kind(),
    /* `lead_source` governs two tables and is one list, which is the case a
       naive tab-per-row would render twice. */
    kind({ kind: 'lead_source', tableName: 'leads', columnName: 'source', label: 'Lead source' }),
    kind({ kind: 'lead_source', tableName: 'lead_intake_forms',
           columnName: 'source_label', label: 'Lead source' }),
  ];
  hoisted.options = [
    option(),
    option({ id: 'cat-2', name: 'Compactors' }),
    option({ id: 'cat-3', name: 'Aggregate', isOwn: false }),
  ];
  hoisted.usage = [
    { name: 'Compaction', inUse: 5, mine: 5 },
    { name: 'Compactors', inUse: 2, mine: 2 },
    { name: 'Aggregate', inUse: 900, mine: 0 },
  ];
  hoisted.members = [
    { sourceTable: 'materials', id: 'm-1', label: 'Crushed stone 3/4"', isMine: true },
    { sourceTable: 'materials', id: 'm-2', label: 'Pit run', isMine: true },
  ];
  hoisted.renamed = []; hoisted.deleted = []; hoisted.added = [];
  hoisted.fail = null;
});

const shown = () => render(<CategoryManager companyId="co-1" canEdit />);

describe('the lists', () => {
  it('shows one tab per list, not one per column', async () => {
    shown();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Material category' })).toBeTruthy());
    expect(screen.getAllByRole('tab', { name: 'Lead source' })).toHaveLength(1);
  });

  it('reads the lists from the database rather than a copy of them', async () => {
    /*
     * A tenth categorized column is a row in `app.categorized_columns()`. It
     * has to turn up here without a change to this file, which is the whole
     * reason that list is in one place.
     */
    hoisted.kinds = [kind({ kind: 'crew_discipline', label: 'Crew discipline' })];
    shown();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Crew discipline' })).toBeTruthy());
  });

  it('says what is filed under each', async () => {
    shown();
    await waitFor(() => expect(screen.getByText('Compaction')).toBeTruthy());
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('900')).toBeTruthy();
  });
});

describe('opening one', () => {
  it('shows the rows behind the count', async () => {
    const user = userEvent.setup();
    shown();
    await waitFor(() => expect(screen.getByText('Compaction')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /what is filed under Compaction/i }));
    await waitFor(() => expect(screen.getByText('Crushed stone 3/4"')).toBeTruthy());
  });

  it('says so plainly when nothing is filed under it', async () => {
    const user = userEvent.setup();
    hoisted.members = [];
    shown();
    await waitFor(() => expect(screen.getByText('Compaction')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /what is filed under Compaction/i }));
    await waitFor(() => expect(screen.getByText(/Nothing is filed under this/)).toBeTruthy());
  });
});

describe('renaming one', () => {
  it('renames the category, and says how many items moved with it', async () => {
    const user = userEvent.setup();
    shown();
    await waitFor(() => expect(screen.getByText('Compaction')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Rename Compaction' }));
    const box = screen.getByRole('textbox', { name: /New name for Compaction/i });
    await user.clear(box);
    await user.type(box, 'Compactors and rollers{Enter}');

    await waitFor(() => expect(hoisted.renamed).toHaveLength(1));
    expect(hoisted.renamed[0]).toMatchObject({
      kind: 'material_category', from: 'Compaction', to: 'Compactors and rollers',
    });
    await waitFor(() => expect(screen.getByText(/3 items moved with it/)).toBeTruthy());
  });

  it('shows the refusal rather than pretending it worked', async () => {
    const user = userEvent.setup();
    hoisted.fail = 'There is already a category called Compactors';
    shown();
    await waitFor(() => expect(screen.getByText('Compaction')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Rename Compaction' }));
    const box = screen.getByRole('textbox', { name: /New name for Compaction/i });
    await user.clear(box);
    await user.type(box, 'Compactors{Enter}');
    await waitFor(() => expect(screen.getByText(/already a category called Compactors/)).toBeTruthy());
  });
});

describe('removing one', () => {
  it('will not remove it until you say where its items go', async () => {
    const user = userEvent.setup();
    shown();
    await waitFor(() => expect(screen.getByText('Compaction')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Remove Compaction' }));

    const confirm = screen.getByRole('button', { name: /Remove and move/i });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await user.click(confirm);
    expect(hoisted.deleted).toHaveLength(0);
  });

  it('offers every other category as the destination, and not itself', async () => {
    const user = userEvent.setup();
    shown();
    await waitFor(() => expect(screen.getByText('Compaction')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Remove Compaction' }));

    const select = screen.getByRole('combobox', { name: /Where the items in Compaction go/i });
    const names = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(names).toContain('Compactors');
    expect(names).not.toContain('Compaction');
  });

  it('moves them where you said, and says what happened', async () => {
    const user = userEvent.setup();
    shown();
    await waitFor(() => expect(screen.getByText('Compaction')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Remove Compaction' }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: /Where the items in Compaction go/i }), 'Compactors');
    await user.click(screen.getByRole('button', { name: /Remove and move/i }));

    await waitFor(() => expect(hoisted.deleted).toHaveLength(1));
    expect(hoisted.deleted[0]).toMatchObject({
      kind: 'material_category', name: 'Compaction', moveTo: 'Compactors',
    });
    await waitFor(() => expect(screen.getByText(/5 items moved to Compactors/)).toBeTruthy());
  });
});

describe('what the platform ships', () => {
  it('shows it, marked, and offers no way to change it', async () => {
    shown();
    await waitFor(() => expect(screen.getByText('Aggregate')).toBeTruthy());
    expect(screen.getByText('Shipped')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rename Aggregate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Aggregate' })).toBeNull();
  });

  it('still opens, because reading it is allowed', async () => {
    const user = userEvent.setup();
    shown();
    await waitFor(() => expect(screen.getByText('Aggregate')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /what is filed under Aggregate/i }));
    await waitFor(() => expect(screen.getByText('Crushed stone 3/4"')).toBeTruthy());
  });
});

describe('a name that rows carry and nothing offers', () => {
  it('is shown rather than hidden, with what to do about it', async () => {
    /*
     * The only place a person would ever find out. A category retired while
     * rows still pointed at it leaves those rows uneditable — the 0113 guard
     * refuses the value on the next save — and nothing else in the application
     * mentions it.
     */
    hoisted.usage = [...hoisted.usage, { name: 'Sitework', inUse: 12, mine: 12 }];
    shown();
    await waitFor(() => expect(screen.getByText('Sitework')).toBeTruthy());
    expect(screen.getByText('Not on the list')).toBeTruthy();
    expect(screen.getByText(/nothing offers it/)).toBeTruthy();
  });
});

describe('without permission to change the library', () => {
  it('shows the lists and none of the controls', async () => {
    render(<CategoryManager companyId="co-1" canEdit={false} />);
    await waitFor(() => expect(screen.getByText('Compaction')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Rename Compaction' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add a category/i })).toBeNull();
  });
});

describe('adding one', () => {
  it('files it against the company', async () => {
    const user = userEvent.setup();
    shown();
    await waitFor(() => expect(screen.getByText('Compaction')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /Add a category/i }));
    await user.type(screen.getByRole('textbox', { name: /New category name/i }), 'Shoring{Enter}');
    await waitFor(() => expect(hoisted.added).toHaveLength(1));
    expect(hoisted.added[0]).toMatchObject({ kind: 'material_category', name: 'Shoring', companyId: 'co-1' });
  });
});
