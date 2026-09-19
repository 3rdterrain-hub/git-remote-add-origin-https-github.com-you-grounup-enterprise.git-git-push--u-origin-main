# Phase 03 API Specification

- **API-P03-001** `GET /v1/data-model/entities` - List canonical entity definitions. Permission: `data_model.read`.
- **API-P03-002** `GET /v1/data-model/entities/{entityKey}` - Read entity definition and fields. Permission: `data_model.read`.
- **API-P03-003** `GET /v1/data-model/reference-sets` - List reference sets. Permission: `reference.read`.
- **API-P03-004** `POST /v1/data-model/reference-sets` - Create reference set. Permission: `reference.manage`.
- **API-P03-005** `POST /v1/master-data/parties` - Create party master. Permission: `party.create`.
- **API-P03-006** `POST /v1/master-data/parties/{partyId}/merge` - Merge party records. Permission: `party.merge`.
- **API-P03-007** `POST /v1/data-quality/evaluations` - Evaluate record quality. Permission: `data_quality.evaluate`.
- **API-P03-008** `GET /v1/data-quality/exceptions` - List quality exceptions. Permission: `data_quality.read`.
- **API-P03-009** `POST /v1/imports/{importId}/commit` - Commit validated import. Permission: `import.commit`.
- **API-P03-010** `POST /v1/exports` - Create canonical export. Permission: `export.create`.
- **API-P03-011** `GET /v1/lineage/{entityType}/{entityId}` - Read record lineage. Permission: `lineage.read`.
- **API-P03-012** `POST /v1/ai-writebacks/{writebackId}/commit` - Commit approved AI writeback. Permission: `ai_writeback.commit`.