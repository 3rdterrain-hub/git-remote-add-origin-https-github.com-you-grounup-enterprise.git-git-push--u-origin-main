/**
 * The things being measured on an estimate. LIBRARY.
 *
 * A site plan is not forty estimate lines. It is eight or ten things — six-inch
 * sidewalk, curb and gutter, light-duty pavement — each traced in several
 * places. Picking the thing first is not a preference: the condition owns the
 * color that keeps forty overlapping traces legible, and the depth that turns a
 * traced polygon into cubic yards. Asking for either afterwards means asking
 * once per shape.
 */
import { unwrap, type Query } from './query';

export const CONDITION_STYLES = ['count', 'linear', 'area', 'volume', 'basin'] as const;
export type ConditionStyle = (typeof CONDITION_STYLES)[number];

/** The unit a style can sensibly report in — the same lists the tools offer. */
export const UNITS_FOR_STYLE: Record<ConditionStyle, string[]> = {
  count: ['EA'],
  linear: ['LF'],
  area: ['SF', 'SY', 'ACRE'],
  volume: ['CY'],
  basin: ['CY', 'SY', 'SF', 'ACRE', 'GAL'],
};

export interface ConditionRow {
  id: string;
  companyId: string;
  estimateVersionId: string | null;
  lineItemId: string | null;
  name: string;
  style: ConditionStyle;
  unit: string;
  /** What it looks like on the sheet. The only thing keeping a busy sheet readable. */
  color: string;
  depthFeet: number | null;
  widthFeet: number | null;
  countPer: number;
  multiplier: number;
  serviceId: string | null;
  costCodeId: string | null;
  trade: string | null;
  notes: string | null;
  sortOrder: number;
  inLibrary: boolean;
  /** How many shapes have been traced for it. Zero means somebody meant to. */
  traced: number;
  quantity: number;
  sheets: number;
  totalPrice: number | null;
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

const num = (v: unknown): number | null => (v == null ? null : Number(v));

/** What is being measured on one estimate, in the order it was set up. */
export const loadConditions = (versionId: string): Query<ConditionRow[]> =>
  async (client) => {
    const rows = unwrap(await client
      .from('my_takeoff_conditions')
      .select('id, company_id, estimate_version_id, line_item_id, name, style, unit, color, depth_feet, width_feet, count_per, multiplier, service_id, cost_code_id, trade, notes, sort_order, in_library, traced, quantity, sheets, total_price')
      .eq('estimate_version_id', versionId)
      .order('sort_order')) as Array<Record<string, unknown>>;

    return rows.map((c) => ({
      id: String(c.id),
      companyId: String(c.company_id),
      estimateVersionId: (c.estimate_version_id as string | null) ?? null,
      lineItemId: (c.line_item_id as string | null) ?? null,
      name: String(c.name),
      style: c.style as ConditionStyle,
      unit: String(c.unit),
      color: String(c.color ?? '#7C3AED'),
      depthFeet: num(c.depth_feet),
      widthFeet: num(c.width_feet),
      countPer: Number(c.count_per ?? 1),
      multiplier: Number(c.multiplier ?? 1),
      serviceId: (c.service_id as string | null) ?? null,
      costCodeId: (c.cost_code_id as string | null) ?? null,
      trade: (c.trade as string | null) ?? null,
      notes: (c.notes as string | null) ?? null,
      sortOrder: Number(c.sort_order ?? 0),
      inLibrary: Boolean(c.in_library),
      traced: Number(c.traced ?? 0),
      quantity: Number(c.quantity ?? 0),
      sheets: Number(c.sheets ?? 0),
      totalPrice: num(c.total_price),
    }));
  };

export interface NewCondition {
  versionId: string;
  name: string;
  style: ConditionStyle;
  unit: string;
  color?: string | null;
  depthFeet?: number | null;
  widthFeet?: number | null;
  serviceId?: string | null;
  costCodeId?: string | null;
  countPer?: number;
  multiplier?: number;
}

/** Create one, and the line it prices on. */
export async function createCondition(
  client: RpcCapable, input: NewCondition,
): Promise<string> {
  return rpc<string>(client, 'create_takeoff_condition', {
    p_version: input.versionId,
    p_name: input.name.trim(),
    p_style: input.style,
    p_unit: input.unit,
    p_color: input.color ?? null,
    p_depth_feet: input.depthFeet ?? null,
    p_width_feet: input.widthFeet ?? null,
    p_service: input.serviceId ?? null,
    p_cost_code: input.costCodeId ?? null,
    p_count_per: input.countPer ?? 1,
    p_multiplier: input.multiplier ?? 1,
  });
}

/** Change one. Undefined leaves a field where it was. */
export async function updateCondition(
  client: RpcCapable, conditionId: string,
  edit: {
    name?: string; color?: string; depthFeet?: number | null; widthFeet?: number | null;
    countPer?: number; multiplier?: number; trade?: string | null; notes?: string | null;
  },
): Promise<void> {
  await rpc(client, 'update_takeoff_condition', {
    p_condition: conditionId,
    p_name: edit.name?.trim() || null,
    p_color: edit.color ?? null,
    p_depth_feet: edit.depthFeet ?? null,
    p_width_feet: edit.widthFeet ?? null,
    p_count_per: edit.countPer ?? null,
    p_multiplier: edit.multiplier ?? null,
    p_trade: edit.trade ?? null,
    p_notes: edit.notes ?? null,
  });
}

/** File a traced shape under the thing it measures, and onto that thing's line. */
export async function recordConditionTakeoff(
  client: RpcCapable, conditionId: string, measurementId: string,
  quantity: number, engineVersion: string,
): Promise<void> {
  await rpc(client, 'record_condition_takeoff', {
    p_condition: conditionId,
    p_measurement: measurementId,
    p_quantity: quantity,
    p_engine_version: engineVersion,
  });
}

/** Move a shape to a different thing. The correction path, not the flow. */
export async function reassignMeasurement(
  client: RpcCapable, measurementId: string, conditionId: string,
  quantity: number, engineVersion: string,
): Promise<void> {
  await rpc(client, 'reassign_measurement', {
    p_measurement: measurementId,
    p_condition: conditionId,
    p_quantity: quantity,
    p_engine_version: engineVersion,
  });
}
