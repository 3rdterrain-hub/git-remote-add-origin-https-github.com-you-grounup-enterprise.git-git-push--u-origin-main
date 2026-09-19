# GES Phase 18 - Enterprise Scheduling & Resource Planning

Version: 1.0.0  
Status: Review-ready  
Proposed lock: GES-P18-v1.0.0

Phase 18 establishes GrounUp's enterprise scheduling and resource-planning operating layer across projects, programs and portfolios. It includes CPM, WBS, calendars, baselines, schedule updates, look-ahead/Last Planner, pull planning, resource loading/leveling, crew/equipment/truck/material/subcontractor planning, risk/scenario analysis, recovery/acceleration, delay impact records and AI schedule intelligence.

## Controlled counts
- Requirements: 400
- Entities: 185
- Fields: 300
- Business Rules: 80
- Validation Rules: 80
- Workflows: 52
- Engines: 59
- Api Resources: 64
- Ui Surfaces: 49
- Reports: 42
- Kpis: 52
- Tests: 400

## Non-negotiable controls
- Approved baselines are immutable; rebaselining is governed and auditable.
- CPM calculations must be reproducible from versioned activities, logic, calendars and constraints.
- Resource planning is capacity-aware and integrated with workforce, fleet, procurement and subcontractor data.
- Contract milestones and committed dates require explicit change authority.
- AI is advisory for delay prediction, constraints, recovery and scenario recommendations.
- Delay-analysis artifacts preserve evidence and chronology without automatically making legal conclusions.
