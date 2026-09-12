/**
 * The categories the libraries group by.
 *
 * Nine columns across the master libraries were free text: a service's
 * industry, category and subcategory, a task's category, a material's, a
 * condition modifier's, a labor group, a crew's discipline, an equipment class.
 * "Site Work", "Sitework" and "Site work" were three categories to the database
 * and one to a person, and any report grouping by category quietly split.
 *
 * Migration 0113 made them records, and a trigger now refuses a value that is
 * not one — so this module is not a convenience over free text, it is the only
 * way a category reaches a row.
 */
import { unwrap, type Query } from './query';

/** The lists the platform keeps. The database holds the same set. */
export type CategoryKind =
  | 'industry'
  | 'service_category'
  | 'service_subcategory'
  | 'task_category'
  | 'material_category'
  | 'modifier_category'
  | 'labor_group'
  | 'crew_discipline'
  | 'equipment_class'
  /* One kind, two columns: a lead's source and an intake form's label are the
     same fact written twice (migration 0124). */
  | 'lead_source';

export interface CategoryOption {
  id: string;
  kind: CategoryKind;
  name: string;
  description: string | null;
  sortOrder: number;
  /** Whether this is the company's own, and so whether it may be retired. */
  isOwn: boolean;
}

type RpcCapable = {
  rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const rpc = async <T,>(client: RpcCapable, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
};

/**
 * Every category a picker may offer for one list, the platform's and the
 * company's own together.
 *
 * Sorted the way a person reads a list: the explicit order first, then by name,
 * so two categories sharing a sort order do not swap places between loads.
 */
export const loadCategories = (kind: CategoryKind): Query<CategoryOption[]> =>
  async (client) => {
    const rows = unwrap(await client
      .from('my_library_categories')
      .select('id, kind, name, description, sort_order, is_own')
      .eq('kind', kind)
      .order('sort_order')
      .order('name')) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      kind: r.kind as CategoryKind,
      name: String(r.name),
      description: (r.description as string | null) ?? null,
      sortOrder: Number(r.sort_order ?? 100),
      isOwn: r.is_own === true,
    }));
  };

/**
 * Add a category to one of the lists.
 *
 * Returns the existing one when the name is taken, by the company or the
 * platform. Somebody typing a category that already exists means to use it.
 */
export async function addCategory(
  client: RpcCapable,
  input: { kind: CategoryKind; name: string; description?: string | null;
           companyId?: string | null },
): Promise<string> {
  return rpc<string>(client, 'add_library_category', {
    p_kind: input.kind,
    p_name: input.name.trim(),
    p_description: input.description?.trim() || null,
    p_company: input.companyId ?? null,
  });
}

/** Stop offering one of your own. The platform's cannot be retired. */
export async function retireCategory(
  client: RpcCapable, categoryId: string,
): Promise<void> {
  await rpc(client, 'retire_library_category', { p_category: categoryId });
}

/** What a category kind governs, for a screen that manages the lists. */
export interface CategoryKindInfo {
  kind: CategoryKind;
  /** The table the categories file rows in — `materials`, `services`, … */
  tableName: string;
  columnName: string;
  /** What to call the list on screen — "Material category". */
  label: string;
  /** What names a row in that table: a labor rate's is `classification`. */
  labelColumn: string;
}

/**
 * Which lists exist, read from the database rather than repeated here.
 *
 * A tenth categorized column is a row in `app.categorized_columns()` and turns
 * up on this screen without an edit — which is the reason 0113 put the list in
 * one place and the reason not to hard-code it a second time in TypeScript.
 */
export const loadCategoryKinds: Query<CategoryKindInfo[]> = async (client) => {
  const rows = unwrap(await client
    .from('library_category_columns')
    .select('kind, table_name, column_name, label, label_column')
    .order('label')) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    kind: r.kind as CategoryKind,
    tableName: String(r.table_name),
    columnName: String(r.column_name),
    label: String(r.label),
    labelColumn: String(r.label_column),
  }));
};

export interface CategoryUsage {
  name: string;
  /** Everything visible under this name, the catalog's rows included. */
  inUse: number;
  /** This company's own — the rows a rename moves and a removal re-files. */
  mine: number;
}

/**
 * How many rows carry each category of one list.
 *
 * Counted from the rows, so it cannot drift from what is actually filed. The
 * two numbers are different questions: `inUse` is what a person sees in the
 * library, `mine` is what a rename would actually move — a shipped category
 * with five hundred catalog rows and none of yours moves nothing.
 */
export const loadCategoryUsage = (
  kind: CategoryKind, companyId?: string | null,
): Query<CategoryUsage[]> => async (client) => {
  const data = await rpc<Array<Record<string, unknown>> | null>(
    client as unknown as RpcCapable, 'library_category_counts',
    { p_kind: kind, p_company: companyId ?? null });

  return (data ?? []).map((r) => ({
    name: String(r.name),
    inUse: Number(r.in_use ?? 0),
    mine: Number(r.mine ?? 0),
  }));
};

/**
 * Rename one of your own categories, and everything filed under it.
 *
 * Returns how many rows moved. The rows move with the name because a rename
 * that changed only the list would leave them pointing at a name no longer on
 * it — a second category with the old name, which is the disease.
 */
export async function renameCategory(
  client: RpcCapable,
  input: { kind: CategoryKind; from: string; to: string; companyId?: string | null },
): Promise<number> {
  return Number(await rpc<number>(client, 'rename_library_category', {
    p_kind: input.kind,
    p_from: input.from,
    p_to: input.to.trim(),
    p_company: input.companyId ?? null,
  }));
}

/**
 * Remove one of your own categories, moving what was in it somewhere stated.
 *
 * `moveTo` is required, here as in the database. Removing a category is a
 * tidying decision; losing how three hundred materials were grouped is not, and
 * the two must not be the same click. It is also how two categories become one.
 */
export async function deleteCategory(
  client: RpcCapable,
  input: { kind: CategoryKind; name: string; moveTo: string; companyId?: string | null },
): Promise<number> {
  return Number(await rpc<number>(client, 'delete_library_category', {
    p_kind: input.kind,
    p_name: input.name,
    p_move_to: input.moveTo,
    p_company: input.companyId ?? null,
  }));
}

export interface CategoryMember {
  /** Which table it came from — one kind can govern more than one. */
  sourceTable: string;
  id: string;
  label: string;
  /** Whether it is this company's own, and so whether a rename would move it. */
  isMine: boolean;
}

/**
 * What is actually filed under one category.
 *
 * A count on a list is a question. This is the answer, which is why the count
 * is a button rather than a figure: "Compaction (5)" that cannot be opened
 * leaves a person hunting through the library for the five.
 */
export const loadCategoryMembers = (
  kind: CategoryKind, name: string, companyId?: string | null, limit = 200,
): Query<CategoryMember[]> => async (client) => {
  const data = await rpc<Array<Record<string, unknown>> | null>(
    client as unknown as RpcCapable, 'library_category_members',
    { p_kind: kind, p_name: name, p_company: companyId ?? null, p_limit: limit });

  return (data ?? []).map((r) => ({
    sourceTable: String(r.source_table),
    id: String(r.id),
    label: String(r.label ?? ''),
    isMine: r.is_mine === true,
  }));
};
