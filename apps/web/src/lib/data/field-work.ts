/**
 * What a field employee signs in to see.
 *
 * Entity: their own assignments and the tasks on the jobs they were given, and
 * the question a phone asks on their behalf — which of these am I standing on.
 *
 * All three read views and a function that migration 0163 scoped to the
 * caller's own employee record rather than to an HR permission. Needing
 * `hr.read` to see where you are working tomorrow would be the wrong rule.
 */
import { unwrap, type Query } from './query';
import { supabase } from '@/lib/supabase';

export interface MyAssignment {
  assignmentId: string;
  projectId: string;
  projectNumber: string;
  projectName: string;
  siteAddress: string | null;
  siteCity: string | null;
  siteState: string | null;
  latitude: number | null;
  longitude: number | null;
  geofenceRadiusMeters: number | null;
  activityName: string | null;
  startsOn: string;
  endsOn: string;
  allocation: number;
  notes: string | null;
  /** Whether today falls inside the assignment. */
  today: boolean;
}

/** Where the signed-in person is assigned, soonest first. */
export const loadMyAssignments: Query<MyAssignment[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_assignments')
    .select('assignment_id, project_id, project_number, project_name, site_address, '
      + 'site_city, site_state, latitude, longitude, geofence_radius_meters, '
      + 'activity_name, starts_on, ends_on, allocation, notes, today')
    .order('starts_on')) as unknown as Array<Record<string, unknown>>;
  return rows.map((a) => ({
    assignmentId: String(a.assignment_id),
    projectId: String(a.project_id),
    projectNumber: String(a.project_number),
    projectName: String(a.project_name),
    siteAddress: (a.site_address as string | null) ?? null,
    siteCity: (a.site_city as string | null) ?? null,
    siteState: (a.site_state as string | null) ?? null,
    latitude: a.latitude == null ? null : Number(a.latitude),
    longitude: a.longitude == null ? null : Number(a.longitude),
    geofenceRadiusMeters: a.geofence_radius_meters == null
      ? null : Number(a.geofence_radius_meters),
    activityName: (a.activity_name as string | null) ?? null,
    startsOn: String(a.starts_on),
    endsOn: String(a.ends_on),
    allocation: Number(a.allocation ?? 1),
    notes: (a.notes as string | null) ?? null,
    today: Boolean(a.today),
  }));
};

export interface MyTask {
  taskId: string;
  projectId: string;
  projectNumber: string;
  name: string;
  unit: string | null;
  budgetedQuantity: number;
  status: string;
  sortOrder: number;
}

/**
 * The tasks on the jobs this person is assigned to.
 *
 * No money on it, by construction — the view does not select any. What a line
 * was priced at is not a foreman's business, and putting it on a phone in a
 * trench is how it ends up in a conversation with a customer.
 */
export const loadMyTasks: Query<MyTask[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_project_tasks')
    .select('task_id, project_id, project_number, name, unit, budgeted_quantity, '
      + 'status, sort_order')
    .order('project_number')
    .order('sort_order')) as unknown as Array<Record<string, unknown>>;
  return rows.map((t) => ({
    taskId: String(t.task_id),
    projectId: String(t.project_id),
    projectNumber: String(t.project_number),
    name: String(t.name),
    unit: (t.unit as string | null) ?? null,
    budgetedQuantity: Number(t.budgeted_quantity ?? 0),
    status: String(t.status),
    sortOrder: Number(t.sort_order ?? 0),
  }));
};

export interface NearbyJob {
  projectId: string;
  number: string;
  name: string;
  distanceMeters: number;
  geofenceRadiusMeters: number | null;
  /** Inside a fence somebody actually drew. Never true where none exists. */
  inside: boolean;
  assigned: boolean;
}

/**
 * Which jobs are near a position, nearest first.
 *
 * Reads only. It cannot punch anybody in, and the screen that calls it is
 * written so that a person taps — a phone crossing a fence is not a person
 * starting work.
 */
export async function jobsNearby(
  latitude: number, longitude: number, limit = 5,
): Promise<NearbyJob[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('my_jobs_nearby', {
    p_latitude: latitude, p_longitude: longitude, p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((j) => ({
    projectId: String(j.project_id),
    number: String(j.number),
    name: String(j.name),
    distanceMeters: Number(j.distance_meters ?? 0),
    geofenceRadiusMeters: j.geofence_radius_meters == null
      ? null : Number(j.geofence_radius_meters),
    inside: Boolean(j.inside),
    assigned: Boolean(j.assigned),
  }));
}

/** "220 m away" / "1.4 km away" — the unit a person would say out loud. */
export function howFar(meters: number): string {
  if (meters < 950) return `${Math.round(meters / 10) * 10} m away`;
  return `${(meters / 1000).toFixed(1)} km away`;
}

/**
 * Set a job's fence, or remove it.
 *
 * Null removes it, and a job with no fence is never suggested by distance —
 * which is the opt-in that stops an invented radius putting somebody on the
 * wrong job.
 */
export async function setProjectGeofence(
  projectId: string, radiusMeters: number | null,
): Promise<void> {
  if (!supabase) throw new Error('Not connected.');
  const { error } = await supabase.rpc('set_project_geofence', {
    p_project: projectId, p_radius_meters: radiusMeters,
  });
  if (error) throw new Error(error.message);
}
