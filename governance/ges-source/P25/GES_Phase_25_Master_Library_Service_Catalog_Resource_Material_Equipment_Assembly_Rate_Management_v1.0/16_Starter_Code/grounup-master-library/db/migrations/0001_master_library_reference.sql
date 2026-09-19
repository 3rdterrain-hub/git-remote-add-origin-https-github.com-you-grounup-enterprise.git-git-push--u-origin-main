-- REFERENCE ONLY. Adapt to the approved database technology.
CREATE TABLE library_record (
  library_record_id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64),
  library_type VARCHAR(64) NOT NULL,
  record_code VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  version INTEGER NOT NULL,
  status VARCHAR(32) NOT NULL,
  effective_from TIMESTAMP NOT NULL,
  effective_to TIMESTAMP,
  source_id VARCHAR(128),
  payload_json TEXT NOT NULL,
  source_requirement_ids TEXT NOT NULL,
  PRIMARY KEY (library_record_id, version)
);
CREATE INDEX idx_library_lookup ON library_record(tenant_id, library_type, record_code, status, effective_from);

CREATE TABLE library_snapshot (
  snapshot_id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  snapshot_json TEXT NOT NULL,
  source_requirement_ids TEXT NOT NULL
);
