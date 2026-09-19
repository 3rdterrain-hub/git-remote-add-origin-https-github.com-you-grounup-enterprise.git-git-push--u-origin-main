# Phase 01 Validation Rules

- **GES-P01-VAL-000001 Tenant.tenant_key:** Required, unique, lowercase slug; 3-50 characters. Severity: Error. Message: Enter a unique tenant key.
- **GES-P01-VAL-000002 Organization Unit.parent_unit_id:** Parent must belong to the same tenant and cannot create a hierarchy cycle. Severity: Error. Message: Select a valid parent in the same tenant.
- **GES-P01-VAL-000003 User.email:** Required and normalized; uniqueness is evaluated by identity-provider policy. Severity: Error. Message: Enter a valid authorized email address.
- **GES-P01-VAL-000004 Role.role_key:** Required and unique within tenant; system role keys are reserved. Severity: Error. Message: Enter a unique non-reserved role key.
- **GES-P01-VAL-000005 Permission Grant.scope_id:** Scope type and identifier must match and belong to the grant tenant. Severity: Error. Message: Select a valid authorized scope.
- **GES-P01-VAL-000006 Delegation.effective_to:** Must be after effective_from and within policy maximum duration. Severity: Error. Message: Enter a valid delegation period.
- **GES-P01-VAL-000007 Policy Version.effective_from/effective_to:** Active periods cannot overlap for the same policy and scope. Severity: Error. Message: Resolve the overlapping policy period.
- **GES-P01-VAL-000008 Approval Request.approver_id:** Approver must satisfy role, scope, amount, independence, and active-user requirements. Severity: Error. Message: Select an eligible independent approver.
- **GES-P01-VAL-000009 Retention Schedule.duration:** Duration and trigger must be specified for each governed record class. Severity: Error. Message: Define trigger and retention duration.
- **GES-P01-VAL-000010 Legal Hold.matter_reference:** Required; release requires authorized decision and release date. Severity: Error. Message: Enter the legal matter reference.
- **GES-P01-VAL-000011 Configuration Value.value:** Must match declared data type, allowed values, range, and layer authorization. Severity: Error. Message: Enter a valid permitted configuration value.
- **GES-P01-VAL-000012 Emergency Access.justification:** Required, minimum 20 characters, with approver and expiration. Severity: Error. Message: Provide sufficient justification, approval, and expiration.
- **GES-P01-VAL-000013 AI Action Proposal.evidence:** Material proposals require source evidence, agent version, confidence, and target diff. Severity: Error. Message: Add the required AI evidence and proposed change.
- **GES-P01-VAL-000014 Change Request.impact_analysis:** Locked-object changes require affected records, risks, migration, rollback, and tests. Severity: Error. Message: Complete the required impact analysis.
- **GES-P01-VAL-000015 Audit Event.occurred_at:** Must be immutable, UTC, and accompanied by actor/action/object/correlation identifiers. Severity: Error. Message: Audit event payload is incomplete.