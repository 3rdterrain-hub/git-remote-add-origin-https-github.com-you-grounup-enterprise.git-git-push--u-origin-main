# Phase 01 API Specification

Base path: `/v1`

All endpoints require tenant context, authentication, permission evaluation, correlation ID, idempotency where mutating, validation, and audit logging.

- **API-P01-001** `GET /v1/tenants/{tenantId}` - Read tenant. Permission: `tenant.read`. Entity: Tenant.
- **API-P01-002** `POST /v1/tenants` - Provision tenant. Permission: `platform.tenant.create`. Entity: Tenant.
- **API-P01-003** `GET /v1/organization-units` - List organization units. Permission: `organization.read`. Entity: OrganizationUnit.
- **API-P01-004** `POST /v1/users/invitations` - Invite user. Permission: `user.invite`. Entity: UserIdentity.
- **API-P01-005** `POST /v1/role-assignments` - Assign role. Permission: `access.assign`. Entity: RoleAssignment.
- **API-P01-006** `DELETE /v1/role-assignments/{id}` - Revoke assignment. Permission: `access.revoke`. Entity: RoleAssignment.
- **API-P01-007** `GET /v1/effective-permissions` - Resolve effective permissions. Permission: `access.inspect`. Entity: Permission.
- **API-P01-008** `POST /v1/policies/{policyId}/versions` - Create policy version. Permission: `policy.manage`. Entity: PolicyVersion.
- **API-P01-009** `POST /v1/approval-requests` - Create approval request. Permission: `approval.request`. Entity: ApprovalRequest.
- **API-P01-010** `POST /v1/approval-requests/{id}/decisions` - Record approval decision. Permission: `approval.decide`. Entity: ApprovalDecision.
- **API-P01-011** `POST /v1/delegations` - Create delegation. Permission: `delegation.manage`. Entity: Delegation.
- **API-P01-012** `GET /v1/audit-events` - Search audit events. Permission: `audit.read`. Entity: AuditEvent.
- **API-P01-013** `POST /v1/legal-holds` - Create legal hold. Permission: `legalhold.manage`. Entity: LegalHold.
- **API-P01-014** `POST /v1/change-requests` - Submit change request. Permission: `change.request`. Entity: ChangeRequest.
- **API-P01-015** `POST /v1/emergency-access` - Request break-glass access. Permission: `emergency.request`. Entity: EmergencyAccessGrant.
- **API-P01-016** `POST /v1/ai-governance/proposals` - Submit AI proposal. Permission: `ai.proposal.submit`. Entity: AIActionProposal.