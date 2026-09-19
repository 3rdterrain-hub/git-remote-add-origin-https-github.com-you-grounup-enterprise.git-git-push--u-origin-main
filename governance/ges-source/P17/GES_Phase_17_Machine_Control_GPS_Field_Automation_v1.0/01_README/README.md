# GES Phase 17 - Machine Control, GPS & Field Automation

Version: 1.0.0  
Status: Review-ready  
Proposed lock: GES-P17-v1.0.0

Phase 17 establishes GrounUp's machine-control and field-automation operating layer. It receives governed survey/model handoff from Phase 16 and manages localization, models, machine job files, device/operator compatibility, in-cab guidance, automatic grade-control governance, telemetry, production/as-builts, revision control and field automation.

## Controlled counts
- Requirements: 380
- Entities: 175
- Fields: 280
- Business Rules: 75
- Validation Rules: 75
- Workflows: 51
- Engines: 55
- Api Resources: 68
- Ui Surfaces: 49
- Reports: 40
- Kpis: 51
- Tests: 380

## Non-negotiable controls
- Only approved model/localization revisions become authoritative machine job files.
- Model handoff preserves CRS/datum/geoid/units, checksums and Phase 16 lineage.
- Operator authorization, device compatibility and safety prerequisites are evaluated before controlled deployment/use.
- Design changes trigger withdrawal/reissue and operator acknowledgement.
- AI cannot autonomously enable machine control, override exclusion zones or certify model/localization accuracy.
- As-built and production records preserve exact machine/job/operator/model/localization session lineage.
