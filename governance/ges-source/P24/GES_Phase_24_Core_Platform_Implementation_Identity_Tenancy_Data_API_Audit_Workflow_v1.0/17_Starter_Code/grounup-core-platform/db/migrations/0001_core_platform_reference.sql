-- REFERENCE SCHEMA ONLY. Adapt to the approved database technology.
CREATE TABLE tenant (
  tenant_id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
CREATE TABLE audit_event (
  audit_event_id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  actor_id VARCHAR(64),
  action VARCHAR(128) NOT NULL,
  resource_type VARCHAR(128) NOT NULL,
  resource_id VARCHAR(128),
  correlation_id VARCHAR(128) NOT NULL,
  occurred_at TIMESTAMP NOT NULL,
  source_requirement_ids TEXT NOT NULL,
  evidence_json TEXT
);
CREATE INDEX idx_audit_tenant_time ON audit_event(tenant_id, occurred_at);
