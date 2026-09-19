# GES v1.0 DEPLOYMENT ROADMAP
This is an execution roadmap, not evidence that deployment has occurred.

## Wave 0 - Governed baseline
Load Phases 01-22 read-only. Reconcile requirements and create ADR/change backlog.

## Wave 1 - Engineering foundation
Implement Phase 23 repository/architecture and Phase 24 core platform contracts.

## Wave 2 - Security from day one
Apply Phase 28 controls during every implementation wave: tenant isolation, default deny, secrets, secure SDLC, audit, threat modeling and privileged access.

## Wave 3 - Libraries and estimator
Implement Phase 25 master libraries and Phase 26 deterministic estimator with golden production/cost/haul/markup/snapshot tests.

## Wave 4 - Operational domains
Implement Phases 07-19 on shared Phase 24 platform contracts, using the Phase 02-06 foundational specifications.

## Wave 5 - AI construction intelligence
Implement Phase 27 only over governed retrieval and deterministic Phase 26 tools. Require evidence, evaluations and human approval.

## Wave 6 - Enterprise analytics
Implement Phase 29 quality/reconciliation/lineage/semantic metrics/reporting and point-in-time AI features.

## Wave 7 - SaaS commercialization
Implement Phase 30 billing/usage/entitlements/onboarding/support/partners/white-label. Security authorization remains authoritative.

## Wave 8 - Production infrastructure
Bind Phase 31 to approved ADRs. Implement IaC, isolated environments, immutable CI/CD promotion, observability, backup/restore, DR, runbooks/on-call and FinOps.

## Wave 9 - Validation/certification
Execute Phase 32 with real UAT, pilot tenants, migration dry runs, cutover, GO/NO-GO, production verification, hypercare and signoff.

Promotion path: Local -> Development -> Integration/Test -> Staging/UAT -> Pilot -> Production Candidate -> Production -> Hypercare -> Steady State.

Stop promotion on any unaccepted blocking security, tenant-isolation, data-integrity, migration, deterministic-calculation, recovery or final-acceptance gate.
