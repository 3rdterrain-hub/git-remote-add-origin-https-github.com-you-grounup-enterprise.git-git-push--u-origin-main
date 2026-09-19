# Phase 01 Test Plan

Testing covers tenant isolation, authorization, lifecycle, policy effective dating, approval independence, delegation boundaries, audit immutability, retention/legal hold, change control, AI authorization, break-glass access, provisioning, entitlements, security, performance, and recovery.

- **TEST-P01-001** (GOV-000001): Cross-tenant isolation - Expected: Request denied and audit event recorded
- **TEST-P01-002** (GOV-000003): Permission grant - Expected: Authorized project action succeeds; other projects remain denied
- **TEST-P01-003** (GOV-000005): Segregation of duties - Expected: Approval blocked with conflict reason
- **TEST-P01-004** (GOV-000006): User suspension - Expected: All sessions revoked; sign-in blocked; history retained
- **TEST-P01-005** (GOV-000008): Policy overlap - Expected: Activation blocked until replacement transaction resolves overlap
- **TEST-P01-006** (GOV-000009): Configuration precedence - Expected: Highest authorized active layer returned with source lineage
- **TEST-P01-007** (GOV-000010): Approval routing - Expected: Correct stages and eligible approvers generated
- **TEST-P01-008** (GOV-000012): Audit completeness - Expected: Audit event includes actor, action, object, time, before/after reference, correlation
- **TEST-P01-009** (GOV-000014): Legal hold - Expected: Purge suppressed and exception logged
- **TEST-P01-010** (GOV-000016): Locked baseline change - Expected: Edit rejected; change request path offered
- **TEST-P01-011** (GOV-000017): AI authorization - Expected: Action denied and agent/tool audit event recorded
- **TEST-P01-012** (GOV-000018): AI proposal approval - Expected: Writeback occurs only after approval and preserves evidence
- **TEST-P01-013** (GOV-000020): Break-glass expiry - Expected: Access automatically revoked and review case opened
- **TEST-P01-014** (GOV-000022): Tenant provisioning - Expected: Tenant, owner, defaults, entitlements, and validation report created
- **TEST-P01-015** (GOV-000023): Entitlement expiration - Expected: New use blocked; historical records remain readable per policy