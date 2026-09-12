/**
 * Entity — one project, as the screen that opens it needs it.
 *
 * `project-detail.tsx` read `PROJECTS` from `@/data/operations` and showed
 * invented daily reports, invented change orders, invented RFIs and invented
 * submittals under a real project number. That is the billing-page defect one
 * screen over, and worse in one respect: a daily report is the contemporaneous
 * record of a day on site and is evidence in a claim.
 *
 * Nearly all of it was already in the schema and already governed. The reads
 * below use PostgREST embeds against the real tables, so row level security
 * decides what comes back and a renamed column fails here rather than emptying
 * a page about money. Two things needed a view — the people, because
 * `project_manager_id` points at `auth.users` and no tenant may read it, and
 * earned value, because `project_tasks` had no reader anywhere.
 *
 * One figure is deliberately absent. The fixture showed a cost performance
 * index of (budget x percent complete) / actual cost. The live percent complete
 * is cost-to-cost, so that formula reduces to actual cost over actual cost and
 * prints 1.00 on every project forever. CPI here comes from
 * `reporting_project_earned_value`, which weights each task's budget by that
 * task's own progress, and it is null where no task carries a budget.
 */
import { unwrap, type Query } from './query';
import { callFunction } from '@/lib/supabase';

type ForProject<T> = (projectId: string) => Query<T>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const maybe = (v: unknown): number | null =>
  (v === null || v === undefined ? null : Number(v));
const text = (v: unknown): string | null => (v as string | null) ?? null;
const rows = (v: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(v) ? v as Array<Record<string, unknown>> : []);

// ----------------------------------------------------------------- the header

export interface ProjectHeader {
  id: string;
  number: string;
  name: string;
  description: string | null;
  status: string;
  contractType: string | null;
  contractValue: number | null;
  originalBudget: number;
  approvedBudget: number;
  siteAddress: string | null;
  siteCity: string | null;
  siteState: string | null;
  latitude: number | null;
  longitude: number | null;
  plannedStart: string | null;
  plannedFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  retainagePercent: number;
  customerName: string | null;
  projectManager: string | null;
  superintendent: string | null;
  /** The priced version this job was awarded from, when it was awarded from one. */
  sourceEstimateNumber: string | null;
  sourceVersionNumber: number | null;
}

export const loadProject: ForProject<ProjectHeader | null> = (projectId) => async (client) => {
  const found = unwrap(await client
    .from('my_project')
    .select('id, number, name, description, status, contract_type, contract_value,'
      + ' original_budget, approved_budget, site_address, site_city, site_state,'
      + ' latitude, longitude, planned_start, planned_finish, actual_start, actual_finish,'
      + ' retainage_percent, customer_name, project_manager, superintendent,'
      + ' source_estimate_number, source_version_number')
    .eq('id', projectId)
    .maybeSingle()) as unknown as Record<string, unknown> | null;
  if (!found) return null;
  return {
    id: String(found.id),
    number: String(found.number),
    name: String(found.name),
    description: text(found.description),
    status: String(found.status),
    contractType: text(found.contract_type),
    contractValue: maybe(found.contract_value),
    originalBudget: num(found.original_budget),
    approvedBudget: num(found.approved_budget),
    siteAddress: text(found.site_address),
    siteCity: text(found.site_city),
    siteState: text(found.site_state),
    latitude: maybe(found.latitude),
    longitude: maybe(found.longitude),
    plannedStart: text(found.planned_start),
    plannedFinish: text(found.planned_finish),
    actualStart: text(found.actual_start),
    actualFinish: text(found.actual_finish),
    retainagePercent: num(found.retainage_percent),
    customerName: text(found.customer_name),
    projectManager: text(found.project_manager),
    superintendent: text(found.superintendent),
    sourceEstimateNumber: text(found.source_estimate_number),
    sourceVersionNumber: maybe(found.source_version_number),
  };
};

// ------------------------------------------------------------ money and worth

export interface ProjectMoney {
  contractValue: number;
  approvedChangeOrders: number;
  revisedContractValue: number;
  approvedBudget: number;
  actualCost: number;
  committedCost: number;
  laborCost: number;
  equipmentCost: number;
  materialCost: number;
  subcontractCost: number;
  billedToDate: number;
  retainageHeld: number;
  grossProfitToDate: number;
}

export const loadProjectMoney: ForProject<ProjectMoney | null> = (projectId) => async (client) => {
  const found = unwrap(await client
    .from('reporting_project_financials')
    .select('contract_value, approved_change_orders, revised_contract_value, approved_budget,'
      + ' actual_cost, committed_cost, labor_cost, equipment_cost, material_cost,'
      + ' subcontract_cost, billed_to_date, retainage_held, gross_profit_to_date')
    .eq('project_id', projectId)
    .maybeSingle()) as unknown as Record<string, unknown> | null;
  if (!found) return null;
  return {
    contractValue: num(found.contract_value),
    approvedChangeOrders: num(found.approved_change_orders),
    revisedContractValue: num(found.revised_contract_value),
    approvedBudget: num(found.approved_budget),
    actualCost: num(found.actual_cost),
    committedCost: num(found.committed_cost),
    laborCost: num(found.labor_cost),
    equipmentCost: num(found.equipment_cost),
    materialCost: num(found.material_cost),
    subcontractCost: num(found.subcontract_cost),
    billedToDate: num(found.billed_to_date),
    retainageHeld: num(found.retainage_held),
    grossProfitToDate: num(found.gross_profit_to_date),
  };
};

/**
 * What the job has earned, from its own tasks.
 *
 * Every ratio here can be null, and each null means the same thing: the
 * denominator is missing. A project nobody has broken down has not earned
 * nothing — it has earned an amount nobody can compute, and showing that as 0%
 * would put an unstarted job and an unplanned job in the same place.
 */
export interface ProjectProgress {
  tasks: number;
  tasksComplete: number;
  budgetedCost: number;
  budgetedHours: number;
  actualHours: number;
  earnedValue: number | null;
  percentComplete: number | null;
  costPerformanceIndex: number | null;
  hoursPerformanceIndex: number | null;
}

export const loadProjectProgress: ForProject<ProjectProgress | null> =
  (projectId) => async (client) => {
    const found = unwrap(await client
      .from('reporting_project_earned_value')
      .select('tasks, tasks_complete, budgeted_cost, budgeted_hours, actual_hours,'
        + ' earned_value, percent_complete, cost_performance_index, hours_performance_index')
      .eq('project_id', projectId)
      .maybeSingle()) as unknown as Record<string, unknown> | null;
    if (!found) return null;
    return {
      tasks: num(found.tasks),
      tasksComplete: num(found.tasks_complete),
      budgetedCost: num(found.budgeted_cost),
      budgetedHours: num(found.budgeted_hours),
      actualHours: num(found.actual_hours),
      earnedValue: maybe(found.earned_value),
      percentComplete: maybe(found.percent_complete),
      costPerformanceIndex: maybe(found.cost_performance_index),
      hoursPerformanceIndex: maybe(found.hours_performance_index),
    };
  };

// ---------------------------------------------------------------- field record

export interface LaborLine {
  classification: string;
  headcount: number;
  straightHours: number;
  overtimeHours: number;
}

export interface EquipmentLine {
  description: string;
  units: number;
  operatingHours: number;
  idleHours: number;
  downHours: number;
  fuelGallons: number;
}

export interface ProductionLine {
  id: string;
  workDate: string;
  quantity: number;
  unit: string;
  crewHours: number;
  crewSize: number | null;
  /** Generated by the database, so it cannot disagree with its own inputs. */
  actualPerHour: number | null;
  notes: string | null;
  /** The catalog rate the work was priced at, when one was recorded. */
  estimatedPerHour: number | null;
  estimatedRateCode: string | null;
  /** How it was assumed to be done — the method the catalog rate is for. */
  estimatedMethod: string | null;
  task: string | null;
}

export interface DailyReportRow {
  id: string;
  reportDate: string;
  weatherSummary: string | null;
  temperatureF: number | null;
  precipitationIn: number | null;
  workPerformed: string | null;
  delays: string | null;
  delayHours: number;
  visitors: string | null;
  safetyNotes: string | null;
  crewCount: number;
  submittedAt: string | null;
  labor: LaborLine[];
  equipment: EquipmentLine[];
  production: ProductionLine[];
}

/**
 * The days on site, newest first.
 *
 * The production rows come back embedded on the report they were recorded
 * under, and each carries the catalog rate it was estimated at — which is what
 * makes the variance column a comparison rather than a number with nothing
 * behind it. A row with no rate recorded shows an em dash, never a computed
 * "0% variance" against a rate nobody chose.
 */
export const loadDailyReports: ForProject<DailyReportRow[]> = (projectId) => async (client) => {
  const found = unwrap(await client
    .from('daily_reports')
    .select('id, report_date, weather_summary, temperature_f, precipitation_in,'
      + ' work_performed, delays, delay_hours, visitors, safety_notes, crew_count, submitted_at,'
      + ' daily_report_labor(classification, headcount, straight_hours, overtime_hours),'
      + ' daily_report_equipment(description, units, operating_hours, idle_hours, down_hours, fuel_gallons),'
      + ' production_actuals(id, work_date, quantity_installed, unit, crew_hours, crew_size,'
      + ' actual_per_hour, notes, project_tasks(name),'
      + ' production_rates(code, method_code, rate_per_hour, utilization_factor))')
    .eq('project_id', projectId)
    .order('report_date', { ascending: false })
    .limit(60)) as unknown as Array<Record<string, unknown>>;

  return found.map((r) => ({
    id: String(r.id),
    reportDate: String(r.report_date),
    weatherSummary: text(r.weather_summary),
    temperatureF: maybe(r.temperature_f),
    precipitationIn: maybe(r.precipitation_in),
    workPerformed: text(r.work_performed),
    delays: text(r.delays),
    delayHours: num(r.delay_hours),
    visitors: text(r.visitors),
    safetyNotes: text(r.safety_notes),
    crewCount: num(r.crew_count),
    submittedAt: text(r.submitted_at),
    labor: rows(r.daily_report_labor).map((l) => ({
      classification: String(l.classification),
      headcount: num(l.headcount),
      straightHours: num(l.straight_hours),
      overtimeHours: num(l.overtime_hours),
    })),
    equipment: rows(r.daily_report_equipment).map((e) => ({
      description: String(e.description),
      units: num(e.units),
      operatingHours: num(e.operating_hours),
      idleHours: num(e.idle_hours),
      downHours: num(e.down_hours),
      fuelGallons: num(e.fuel_gallons),
    })),
    production: rows(r.production_actuals).map((p) => {
      const rate = (Array.isArray(p.production_rates)
        ? (p.production_rates as Array<Record<string, unknown>>)[0]
        : p.production_rates) as Record<string, unknown> | null;
      const task = (Array.isArray(p.project_tasks)
        ? (p.project_tasks as Array<Record<string, unknown>>)[0]
        : p.project_tasks) as Record<string, unknown> | null;
      /*
       * The catalog rate as it prices: the published rate multiplied by its own
       * utilization factor, which is how the estimate used it. Comparing an
       * achieved rate against an unadjusted catalog figure would make every
       * crew look slow.
       */
      const estimated = rate
        ? num(rate.rate_per_hour) * (rate.utilization_factor === null
          || rate.utilization_factor === undefined ? 1 : Number(rate.utilization_factor))
        : null;
      return {
        id: String(p.id),
        workDate: String(p.work_date),
        quantity: num(p.quantity_installed),
        unit: String(p.unit),
        crewHours: num(p.crew_hours),
        crewSize: maybe(p.crew_size),
        actualPerHour: maybe(p.actual_per_hour),
        notes: text(p.notes),
        estimatedPerHour: estimated,
        estimatedRateCode: rate ? String(rate.code) : null,
        estimatedMethod: rate && rate.method_code ? String(rate.method_code) : null,
        task: task ? String(task.name) : null,
      };
    }),
  }));
};

// --------------------------------------------------------------- change orders

export interface ChangeOrderItem {
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  costAmount: number;
  priceAmount: number;
}

export interface ChangeOrderRow {
  id: string;
  number: string;
  title: string;
  reason: string;
  origin: string;
  status: string;
  costImpact: number;
  priceImpact: number;
  scheduleImpactDays: number;
  submittedAt: string | null;
  decidedAt: string | null;
  executedAt: string | null;
  items: ChangeOrderItem[];
}

export const loadChangeOrders: ForProject<ChangeOrderRow[]> = (projectId) => async (client) => {
  const found = unwrap(await client
    .from('change_orders')
    .select('id, number, title, reason, origin, status, cost_impact, price_impact,'
      + ' schedule_impact_days, submitted_at, decided_at, executed_at,'
      + ' change_order_items(description, quantity, unit, unit_price, cost_amount, price_amount, sort_order)')
    .eq('project_id', projectId)
    .order('number', { ascending: true })) as unknown as Array<Record<string, unknown>>;

  return found.map((c) => ({
    id: String(c.id),
    number: String(c.number),
    title: String(c.title),
    reason: String(c.reason),
    origin: String(c.origin),
    status: String(c.status),
    costImpact: num(c.cost_impact),
    priceImpact: num(c.price_impact),
    scheduleImpactDays: num(c.schedule_impact_days),
    submittedAt: text(c.submitted_at),
    decidedAt: text(c.decided_at),
    executedAt: text(c.executed_at),
    items: rows(c.change_order_items)
      .sort((a, b) => num(a.sort_order) - num(b.sort_order))
      .map((i) => ({
        description: String(i.description),
        quantity: num(i.quantity),
        unit: text(i.unit),
        unitPrice: num(i.unit_price),
        costAmount: num(i.cost_amount),
        priceAmount: num(i.price_amount),
      })),
  }));
};

// ------------------------------------------------------------ open items

export interface RfiRow {
  id: string;
  number: string;
  title: string;
  discipline: string | null;
  priority: string;
  status: string;
  dueAt: string | null;
  costImpact: string | null;
  question: string;
  answer: string | null;
}

export const loadProjectRfis: ForProject<RfiRow[]> = (projectId) => async (client) => {
  const found = unwrap(await client
    .from('rfis')
    .select('id, number, title, discipline, priority, status, due_at, cost_impact, question, answer')
    .eq('project_id', projectId)
    .order('due_at', { ascending: true, nullsFirst: false })) as Array<Record<string, unknown>>;
  return found.map((r) => ({
    id: String(r.id),
    number: String(r.number),
    title: String(r.title),
    discipline: text(r.discipline),
    priority: String(r.priority),
    status: String(r.status),
    dueAt: text(r.due_at),
    costImpact: text(r.cost_impact),
    question: String(r.question),
    answer: text(r.answer),
  }));
};

export interface SubmittalRow {
  id: string;
  number: string;
  title: string;
  specSection: string | null;
  vendorName: string | null;
  ballInCourt: string;
  status: string;
  revision: number;
  requiredOnSite: string | null;
  leadTimeDays: number | null;
  reviewerComment: string | null;
}

export const loadProjectSubmittals: ForProject<SubmittalRow[]> = (projectId) => async (client) => {
  const found = unwrap(await client
    .from('submittals')
    .select('id, number, title, spec_section, ball_in_court, status, revision,'
      + ' required_on_site, lead_time_days, reviewer_comment, vendors(name)')
    .eq('project_id', projectId)
    .order('required_on_site', { ascending: true, nullsFirst: false })) as unknown as
    Array<Record<string, unknown>>;
  return found.map((s) => {
    const vendor = (Array.isArray(s.vendors)
      ? (s.vendors as Array<Record<string, unknown>>)[0]
      : s.vendors) as Record<string, unknown> | null;
    return {
      id: String(s.id),
      number: String(s.number),
      title: String(s.title),
      specSection: text(s.spec_section),
      vendorName: vendor ? String(vendor.name) : null,
      ballInCourt: String(s.ball_in_court),
      status: String(s.status),
      revision: num(s.revision),
      requiredOnSite: text(s.required_on_site),
      leadTimeDays: maybe(s.lead_time_days),
      reviewerComment: text(s.reviewer_comment),
    };
  });
};

/** Statuses that mean a submittal is no longer waiting on anybody. */
export const SUBMITTAL_SETTLED = ['approved', 'approved_as_noted', 'closed'];
/** Statuses that mean a change order has not been decided. */
export const CHANGE_UNDECIDED = ['potential', 'submitted'];
/** Statuses that mean a change order moved the contract. */
export const CHANGE_APPROVED = ['approved', 'executed'];

// -------------------------------------------------------- weather at the site

export interface SiteWeatherDay {
  day: string;
  highF: number | null;
  lowF: number | null;
  precipInches: number;
  precipChance: number | null;
  snowInches: number;
  windGustMph: number | null;
  summary: string | null;
  workable: boolean;
  lostReason: string | null;
  fetchedAt: string;
}

export interface WeatherNow {
  observedAt: string;
  fetchedAt: string;
  temperatureF: number | null;
  windMph: number | null;
  precipInches: number;
  summary: string | null;
}

/**
 * The forecast where the crew is standing.
 *
 * Migration 0105 keyed the forecast to the company and fetched it from the
 * company's own coordinates — the yard. A contractor in Toledo with a job in
 * Sandusky is sixty miles and one lake-effect band away from that number, and
 * `projects` has carried the site's own coordinates since 0007. 0143 gave the
 * cache a place to put them.
 */
export const loadSiteWeather: ForProject<SiteWeatherDay[]> = (projectId) => async (client) => {
  const found = unwrap(await client
    .from('my_site_weather')
    .select('day, high_f, low_f, precip_inches, precip_chance, snow_inches,'
      + ' wind_gust_mph, summary, workable, lost_reason, fetched_at')
    .eq('project_id', projectId)
    .limit(14)) as unknown as Array<Record<string, unknown>>;
  return found.map((w) => ({
    day: String(w.day),
    highF: maybe(w.high_f),
    lowF: maybe(w.low_f),
    precipInches: num(w.precip_inches),
    precipChance: maybe(w.precip_chance),
    snowInches: num(w.snow_inches),
    windGustMph: maybe(w.wind_gust_mph),
    summary: text(w.summary),
    workable: Boolean(w.workable),
    lostReason: text(w.lost_reason),
    fetchedAt: String(w.fetched_at),
  }));
};

/** What it is doing right now, which is a different question from the day's high. */
export const loadSiteWeatherNow: ForProject<WeatherNow | null> = (projectId) => async (client) => {
  const found = unwrap(await client
    .from('my_weather_now')
    .select('observed_at, fetched_at, temperature_f, wind_mph, precip_inches, summary')
    .eq('project_id', projectId)
    .maybeSingle()) as unknown as Record<string, unknown> | null;
  if (!found) return null;
  return {
    observedAt: String(found.observed_at),
    fetchedAt: String(found.fetched_at),
    temperatureF: maybe(found.temperature_f),
    windMph: maybe(found.wind_mph),
    precipInches: num(found.precip_inches),
    summary: text(found.summary),
  };
};

export interface WeatherRefresh {
  /** `site`, `yard_for_site` when the site could not be placed, or `yard`. */
  source?: 'site' | 'yard_for_site' | 'yard';
  refreshed: boolean;
  days?: number;
  workable?: number;
  efficiency?: number | null;
  reason?: string;
}

/**
 * Fetch the forecast for this site.
 *
 * The Edge Function holds the thresholds that decide whether a day can be
 * worked — a tenth of an inch of rain, freezing all day, a thirty mile gust —
 * so the verdict is applied once by the code that knows them rather than by
 * every screen that reads a row.
 */
export async function refreshSiteWeather(
  companyId: string, projectId: string, force = false,
): Promise<WeatherRefresh> {
  return callFunction<WeatherRefresh>('refresh-weather', { companyId, projectId, force });
}

export interface WorkableDays {
  total: number;
  workable: number;
  /** Workable over total, or null when there is no forecast to divide. */
  efficiency: number | null;
  /** `site` when the site has its own forecast, `yard` when it borrowed one. */
  source: 'site' | 'yard';
}

/**
 * How much of the window can be worked, answered by the database.
 *
 * The card could count workable days in JavaScript, and the first version did.
 * It should not: `app.workable_days_at` already decides which forecast applies
 * — the site's own, or the yard's where the site has none — and `source` is the
 * only honest label for the number, because an efficiency taken sixty miles
 * away is a different claim from one taken at the site. Counting the rows a
 * screen happens to have loaded would answer a question nobody asked and would
 * silently drop the distinction.
 */
export function loadWorkableDays(
  companyId: string | null, projectId: string, days = 7,
): Query<WorkableDays | null> {
  return async (client) => {
    if (!companyId) return null;
    const data = unwrap(await client.rpc('workable_days_at', {
      p_company: companyId, p_project: projectId, p_days: days,
    })) as unknown as Array<Record<string, unknown>> | Record<string, unknown> | null;
    const row = (Array.isArray(data) ? data[0] : data) ?? null;
    if (!row) return null;
    return {
      total: num(row.total),
      workable: num(row.workable),
      efficiency: maybe(row.efficiency),
      source: row.source === 'site' ? 'site' : 'yard',
    };
  };
}

// ---------------------------------------------------------------------------
// The three things a project manager does on a live job
//
// `project-detail` shipped with three buttons that did nothing. The tables
// behind them are fully governed — a submitted daily report freezes its date, an
// executed change order refuses edits, an answered RFI must carry its answer —
// and none of them had a writer, so a live project could be read in detail and
// never actually worked. Migration 0157 is the writer; these are the doors.
//
// Each one takes the project and nothing about the company: the function reads
// the owner off the project, because a browser that can name the company on a
// write can name a company that is not its own.
// ---------------------------------------------------------------------------

type RpcCapable = {
  rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const call = async (client: RpcCapable, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return String(data);
};

/**
 * Start the daily report for a date. Unsubmitted, because submitting is what
 * freezes it — and a report created already frozen could never be filled in.
 */
export async function createDailyReport(
  client: RpcCapable,
  input: { projectId: string; date: string; workPerformed?: string | null },
): Promise<string> {
  return call(client, 'create_daily_report', {
    p_project: input.projectId,
    p_date: input.date,
    p_work_performed: input.workPerformed?.trim() || null,
  });
}

/**
 * Raise a potential change order.
 *
 * No cost or schedule impact is sent. Those come from pricing the change, and a
 * number typed into this dialog would be a number nobody can reproduce.
 */
export async function createChangeOrder(
  client: RpcCapable,
  input: {
    projectId: string; title: string; reason: string;
    origin?: string; description?: string | null;
  },
): Promise<string> {
  return call(client, 'create_change_order', {
    p_project: input.projectId,
    p_title: input.title.trim(),
    p_reason: input.reason.trim(),
    p_origin: input.origin ?? 'owner_request',
    p_description: input.description?.trim() || null,
  });
}

/** Raise an RFI, in draft: issuing one starts a clock, which is a second decision. */
export async function createRfi(
  client: RpcCapable,
  input: {
    projectId: string; title: string; question: string;
    discipline?: string | null; priority?: string; drawingReference?: string | null;
  },
): Promise<string> {
  return call(client, 'create_rfi', {
    p_project: input.projectId,
    p_title: input.title.trim(),
    p_question: input.question.trim(),
    p_discipline: input.discipline?.trim() || null,
    p_priority: input.priority ?? 'normal',
    p_drawing_reference: input.drawingReference?.trim() || null,
  });
}
