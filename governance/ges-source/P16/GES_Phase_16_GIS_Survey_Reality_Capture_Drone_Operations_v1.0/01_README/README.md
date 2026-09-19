# GES Phase 16 - GIS, Survey, Reality Capture & Drone Operations

Version: 1.0.0  
Status: Review-ready  
Proposed lock: GES-P16-v1.0.0

Phase 16 establishes GrounUp's governed geospatial, survey, drone and reality-capture operating layer. It manages coordinate systems, survey control, GNSS/total station/leveling, construction layout, GIS field data, drone missions, photogrammetry, LiDAR, point clouds, orthomosaics, surfaces, volumes, progress capture and machine-control handoff.

## Controlled counts
- Requirements: 360
- Entities: 165
- Fields: 260
- Business Rules: 70
- Validation Rules: 70
- Workflows: 48
- Engines: 49
- Api Resources: 60
- Ui Surfaces: 42
- Reports: 34
- Kpis: 48
- Tests: 360

## Non-negotiable controls
- Spatial reference system, horizontal/vertical datum, geoid and units must be explicit.
- Survey and reality-capture quality requires documented QA/QC evidence.
- Drone flight and authorization records are configurable by jurisdiction and retained as evidence.
- AI is advisory for accuracy certification, regulated flight authority and machine-control release.
- Spatial outputs preserve source lineage and processing versions.
- Phase 17 machine-control handoff requires explicit validation.
