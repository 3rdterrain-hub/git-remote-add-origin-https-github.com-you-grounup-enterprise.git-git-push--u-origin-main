# GES v1.0 MASTER AI / DEVELOPER IMPLEMENTATION INSTRUCTIONS

## Authority hierarchy
1. `01_Source_Phase_Packages` contains immutable governed source ZIPs.
2. `02_Expanded_Governed_Phases` is navigation convenience; never edit it as the source of truth.
3. Phase 22 is the final reconciliation/enterprise-lock package; Phase 23+ supplies implementation, security, analytics, commercial, production and acceptance controls.
4. Preserve requirement/test/API/event/security/quality IDs in traceability.
5. If governed sources conflict, stop the affected path and create a controlled decision/change. Never silently choose.

## Mandatory implementation loop
For every change: locate requirement IDs -> read governing tests/dependencies -> identify data/API/security/audit/observability impacts -> implement the smallest coherent vertical slice -> add automated tests -> run required test/security/tenant suites -> record traceability -> update docs/ADR -> pass quality gate.

## Non-negotiables
- Default deny; explicit tenant scope.
- Phase 25 published library versions/snapshots are governed and immutable.
- Phase 26 deterministic estimate math is authoritative.
- Phase 27 AI is evidence-grounded and human-gated for protected actions.
- Phase 28 security applies everywhere.
- Phase 29 analytics is not a transaction authority.
- Phase 30 commercial entitlement never overrides security authorization.
- Phase 31 promotes immutable tested artifacts and requires recovery evidence.
- Phase 32 certification requires real executed evidence and authorized signoff.
- Secrets never belong in source.
- Schema changes are versioned/migration-tested.
- Protected mutations create audit evidence.
- Provider-neutral boundaries stay provider-neutral until an ADR approves a binding.

## Coding-agent completion report
Every coding agent returns: requirement IDs; files changed; migrations/config; tests and exact results; tenant/security impact; API/event compatibility; observability/runbook impact; traceability/evidence; blockers; explicit gate PASS/FAIL.

Never hide a failing test, weaken a control to make a test pass, invent missing requirements, edit locked source packages, or claim future evidence as completed.
