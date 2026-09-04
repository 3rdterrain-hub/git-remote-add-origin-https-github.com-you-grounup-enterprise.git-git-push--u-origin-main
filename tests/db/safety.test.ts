import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/** Safety, quality and connector controls (migration 0021). */
describe('safety, quality and connectors', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let project = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test')`, [owner]);
    company = (await h.asUser(owner, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','business') as id`)))[0]!.id;
    project = (await h.asUser(owner, () =>
      h.sql<{ id: string }>(
        `insert into projects (company_id, number, name) values ($1,'PRJ-1','Test') returning id`, [company])))[0]!.id;
  });

  afterAll(async () => { await h?.db.close(); });

  describe('safety incidents', () => {
    let incident = '';
    it('records an incident', async () => {
      const [i] = await h.asUser(owner, () =>
        h.sql<{ id: string }>(
          `insert into safety_incidents (company_id, project_id, number, occurred_at, incident_type, severity, description)
           values ($1,$2,'INC-1', now() - interval '1 hour','near_miss','high','Trench wall sloughed')
           returning id`, [company, project]));
      incident = i!.id;
      expect(incident).toBeTruthy();
    });

    it('refuses a report dated before the incident happened', async () => {
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into safety_incidents (company_id, number, occurred_at, reported_at, incident_type, description)
                 values ($1,'INC-X', now(), now() - interval '2 days','first_aid','x')`, [company])),
      ).rejects.toThrow(/safety_incidents_reported_after/);
    });

    it('requires an OSHA case number on a recordable incident', async () => {
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into safety_incidents (company_id, number, occurred_at, incident_type, description, is_osha_recordable)
                 values ($1,'INC-Y', now(),'lost_time','x',true)`, [company])),
      ).rejects.toThrow(/safety_incidents_recordable/);
    });

    it('refuses to close an investigation with no root cause or corrective action', async () => {
      // An incident filed without either has been recorded, not investigated.
      await expect(
        h.asUser(owner, () =>
          h.sql(`update safety_incidents set investigation_state='closed', closed_at=now() where id=$1`, [incident])),
      ).rejects.toThrow(/safety_incidents_closed/);
    });

    it('closes when the investigation is actually complete', async () => {
      await h.asUser(owner, () =>
        h.sql(`update safety_incidents set investigation_state='closed', closed_at=now(),
               root_cause='Spoil stored within 2 ft of the edge',
               corrective_action='Spoil relocated to 6 ft minimum; added to the pre-task plan'
               where id=$1`, [incident]));
      const [i] = await h.sql<{ investigation_state: string }>(
        `select investigation_state from safety_incidents where id=$1`, [incident]);
      expect(i!.investigation_state).toBe('closed');
    });
  });

  describe('safety observations', () => {
    it('refuses an unsafe observation with no resolution', async () => {
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into safety_observations (company_id, category, is_positive, description)
                 values ($1,'ppe',false,'No hi-vis near the haul route')`, [company])),
      ).rejects.toThrow(/safety_observations_unsafe/);
    });

    it('accepts one corrected on the spot', async () => {
      const rows = await h.asUser(owner, () =>
        h.sql<{ id: string }>(
          `insert into safety_observations (company_id, category, is_positive, description, corrected_on_site)
           values ($1,'ppe',false,'No hi-vis',true) returning id`, [company]));
      expect(rows).toHaveLength(1);
    });

    it('accepts a positive observation with no action', async () => {
      const rows = await h.asUser(owner, () =>
        h.sql<{ id: string }>(
          `insert into safety_observations (company_id, category, is_positive, description)
           values ($1,'excavation',true,'Trench box set correctly') returning id`, [company]));
      expect(rows).toHaveLength(1);
    });
  });

  describe('inspections and punch list', () => {
    it('requires a note on a failed test', async () => {
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into inspections (company_id, project_id, number, inspection_type, title, result)
                 values ($1,$2,'QC-1','compaction','Backfill','fail')`, [company, project])),
      ).rejects.toThrow(/inspections_failed/);
    });

    it('accepts a failed test that records what happened next', async () => {
      const rows = await h.asUser(owner, () =>
        h.sql<{ id: string }>(
          `insert into inspections (company_id, project_id, number, inspection_type, title, result, notes)
           values ($1,$2,'QC-2','compaction','Backfill','fail','Removed to 3 ft, aerated and recompacted; retest passed')
           returning id`, [company, project]));
      expect(rows).toHaveLength(1);
    });

    it('refuses to close a punch item without a named verifier and a note', async () => {
      const [d] = await h.asUser(owner, () =>
        h.sql<{ id: string }>(
          `insert into deficiencies (company_id, project_id, number, description)
           values ($1,$2,'PL-1','Casting high') returning id`, [company, project]));
      await expect(
        h.asUser(owner, () =>
          h.sql(`update deficiencies set status='closed', closed_on=current_date where id=$1`, [d!.id])),
      ).rejects.toThrow(/deficiencies_closed/);

      await h.asUser(owner, () =>
        h.sql(`update deficiencies set status='closed', closed_on=current_date, closed_by=$1,
               verification_note='Re-set to grade and verified against C-501' where id=$2`, [owner, d!.id]));
      const [row] = await h.sql<{ status: string }>(`select status from deficiencies where id=$1`, [d!.id]);
      expect(row!.status).toBe('closed');
    });
  });

  describe('connector runtime', () => {
    let connector = '';
    it('refuses to enable a connector with no credential', async () => {
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into connectors (company_id, connector_type, provider, name, is_enabled)
                 values ($1,'accounting','Sage 300','Job cost export',true)`, [company])),
      ).rejects.toThrow(/connectors_enabled_needs_credential/);
    });

    it('enables one that has a credential handle', async () => {
      const [c] = await h.asUser(owner, () =>
        h.sql<{ id: string }>(
          `insert into connectors (company_id, connector_type, provider, name, is_enabled, credential_ref)
           values ($1,'accounting','Sage 300','Job cost export',true,'secret://sage/prod') returning id`, [company]));
      connector = c!.id;
      expect(connector).toBeTruthy();
    });

    it('marks a connector connected after a successful run', async () => {
      await h.asUser(owner, () =>
        h.sql(`insert into connector_runs (company_id, connector_id, status, finished_at, records_written)
               values ($1,$2,'succeeded', now(), 418)`, [company, connector]));
      const [c] = await h.sql<{ status: string; consecutive_failures: number }>(
        `select status, consecutive_failures from connectors where id=$1`, [connector]);
      expect(c!.status).toBe('connected');
      expect(c!.consecutive_failures).toBe(0);
    });

    it('degrades then fails a connector as failures accumulate', async () => {
      for (let i = 0; i < 2; i++) {
        await h.asUser(owner, () =>
          h.sql(`insert into connector_runs (company_id, connector_id, status, finished_at, error_message)
                 values ($1,$2,'failed', now(), 'Upstream 503')`, [company, connector]));
      }
      const [degraded] = await h.sql<{ status: string }>(`select status from connectors where id=$1`, [connector]);
      expect(degraded!.status).toBe('degraded');

      await h.asUser(owner, () =>
        h.sql(`insert into connector_runs (company_id, connector_id, status, finished_at, error_message)
               values ($1,$2,'failed', now(), 'Upstream 503')`, [company, connector]));
      const [failed] = await h.sql<{ status: string; consecutive_failures: number }>(
        `select status, consecutive_failures from connectors where id=$1`, [connector]);
      expect(failed!.status).toBe('failed');
      expect(failed!.consecutive_failures).toBe(3);
    });

    it('requires an error message on a failed run', async () => {
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into connector_runs (company_id, connector_id, status) values ($1,$2,'failed')`,
            [company, connector])),
      ).rejects.toThrow(/connector_runs_failed/);
    });

    it('refuses a duplicate run for the same idempotency key', async () => {
      // A rerun of the same window must not double-post into accounting.
      await h.asUser(owner, () =>
        h.sql(`insert into connector_runs (company_id, connector_id, status, finished_at, idempotency_key)
               values ($1,$2,'succeeded', now(), '2026-09-01')`, [company, connector]));
      await expect(
        h.asUser(owner, () =>
          h.sql(`insert into connector_runs (company_id, connector_id, status, finished_at, idempotency_key)
                 values ($1,$2,'succeeded', now(), '2026-09-01')`, [company, connector])),
      ).rejects.toThrow(/duplicate key/);
    });
  });
});
