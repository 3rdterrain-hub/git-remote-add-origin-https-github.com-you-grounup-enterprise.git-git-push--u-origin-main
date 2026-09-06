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
  | 'equipment_class';

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

/** Every category, for a screen that manages the lists rather than picks from one. */
export const loadAllCategories: Query<CategoryOption[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_library_categories')
    .select('id, kind, name, description, sort_order, is_own')
    .order('kind')
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
