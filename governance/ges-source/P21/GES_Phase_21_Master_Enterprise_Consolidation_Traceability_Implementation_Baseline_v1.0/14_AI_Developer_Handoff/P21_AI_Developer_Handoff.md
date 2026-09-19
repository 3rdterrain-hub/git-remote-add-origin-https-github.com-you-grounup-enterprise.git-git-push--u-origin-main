# AI / Developer Handoff Protocol

1. Read Phase 00/01 governance and the Phase 21 master registers before generating code.
2. Implement by approved dependency wave, not by arbitrary screen order.
3. Every work item must reference requirement IDs, source phase, data entities, API/event contracts, UI surface and test IDs where available.
4. Do not invent missing business rules, rates, formulas, permissions, legal/compliance behavior or data semantics. Raise a governed gap.
5. Preserve tenant isolation, auditability, versioning, approvals, evidence lineage and human-governed AI controls.
6. Generate tests with implementation; no requirement is complete without mapped acceptance evidence.
7. Treat approved schemas/contracts as compatibility boundaries. Breaking changes require versioning and change approval.
8. Update traceability and release evidence with every accepted implementation change.
9. Use feature flags and controlled migrations for incomplete or staged capabilities.
10. A build is not production-ready until Phase 20 gates pass and Phase 21 baseline/exception rules are satisfied.
