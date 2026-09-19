# GES Phase 26 - Estimating, Cost, Production, Crew/Equipment, Haul/Disposal, Markup & Execution Engine

Version: 1.0.0
Status: Implementation-ready specification

Phase 26 implements GrounUp's deterministic estimate execution engine on top of Phase 25 governed master libraries.

Controlled package:
- 450 requirements
- 450 mapped tests
- 30 implementation modules
- 40 estimate/calculation entities
- 30 API contracts
- 19 event contracts
- 25 business rules
- 20 formula registry entries
- 12 security controls
- 14 quality gates
- vendor-neutral starter calculation code

Core behaviors:
- estimate versions/scenarios are reproducible from immutable Phase 25 snapshots
- crew size, production, duration, labor, equipment, fuel, trucking and haul/disposal are integrated
- truck cycle and trip-based hauling are first-class calculations
- equipment hourly/daily/weekly/monthly rates follow governed selection policy
- direct cost, indirects, contingency, markup, O&P, tax and bond preserve calculation basis/order
- low/base/high outputs are explicit scenarios
- AI is advisory and cannot silently mutate authoritative estimate values
- approved new services can flow back to the Phase 25 Service Catalog
