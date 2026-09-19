# GES Phase 25 - Master Library, Service Catalog, Resource/Material/Equipment, Assembly & Rate Management

Version: 1.0.0
Status: Implementation-ready specification

Phase 25 implements the governed master-data layer that the GrounUp estimator and downstream project systems will use.

Controlled package:
- 400 requirements
- 400 mapped tests
- 24 implementation modules
- 34 canonical entities
- 27 API contracts
- 15 event contracts
- 18 business rules
- 12 security controls
- 12 quality gates
- example service/material/equipment/assembly seed files
- vendor-neutral starter code

Key behaviors:
- all authorized tenant services/libraries are editable through governed versioning
- estimator-created services can be approved into the service catalog
- AI writeback is proposal-first and never directly publishes
- published versions are immutable
- estimator snapshots preserve historical pricing/production reproducibility
- tenant overrides preserve base-library provenance
- rates/prices preserve source, effective date, region, unit and currency
