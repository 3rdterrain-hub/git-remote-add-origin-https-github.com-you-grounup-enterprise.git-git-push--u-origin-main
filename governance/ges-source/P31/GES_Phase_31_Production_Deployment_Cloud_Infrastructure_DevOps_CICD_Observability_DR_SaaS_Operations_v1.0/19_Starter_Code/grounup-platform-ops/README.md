# GrounUp Platform Operations - Phase 31

Vendor-neutral production operations scaffold.

This repository intentionally avoids declaring a cloud, container orchestrator, CI/CD vendor, observability vendor or database vendor approved.
Use approved ADRs to bind these interfaces to actual provider implementations.

Non-negotiable:
- immutable artifacts
- IaC-managed production infrastructure
- environment/credential isolation
- release evidence
- tested rollback
- observability + SLO ownership
- restore validation + DR exercises
