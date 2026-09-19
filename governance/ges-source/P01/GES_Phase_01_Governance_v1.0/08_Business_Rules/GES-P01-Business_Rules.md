# Phase 01 Business Rules

## GES-P01-BR-000001 - Tenant isolation
A user, integration, or AI agent may access only records belonging to an authorized tenant.

**Condition:** actor tenant scope contains record tenant

**Action:** Allow evaluation to continue

**Exception:** Break-glass policy

## GES-P01-BR-000002 - Permission deny precedence
An explicit deny overrides any allow at the same or broader applicable scope.

**Condition:** matching explicit deny exists

**Action:** Deny action

**Exception:** Emergency access policy

## GES-P01-BR-000003 - Least privilege default
New users receive no business permissions until assigned an approved role.

**Condition:** user activated with no role

**Action:** Permit sign-in only to onboarding or access-request surfaces

**Exception:** Tenant template may add approved baseline role

## GES-P01-BR-000004 - One active policy version
Only one policy version may be active for the same policy key, scope, and effective period.

**Condition:** overlapping active periods detected

**Action:** Block activation

**Exception:** Explicit replacement transaction

## GES-P01-BR-000005 - Approval independence
A requester cannot approve their own request when dual control is required.

**Condition:** dual control and same actor

**Action:** Block approval

**Exception:** No exception

## GES-P01-BR-000006 - Delegation boundary
Delegated authority cannot exceed the delegator's permissions, amount, scope, or expiration.

**Condition:** delegation exceeds authority

**Action:** Block creation

**Exception:** No exception

## GES-P01-BR-000007 - Suspension effect
Suspending a user revokes active sessions and prevents new authentication.

**Condition:** state changes to suspended

**Action:** Terminate sessions and disable credentials

**Exception:** Service account handling policy

## GES-P01-BR-000008 - Legal hold precedence
An active legal hold prevents purge regardless of ordinary retention expiration.

**Condition:** active legal hold exists

**Action:** Suppress purge and record exception

**Exception:** Court-authorized release

## GES-P01-BR-000009 - Configuration precedence
Effective configuration resolves from user, project, office, company, tenant, platform, using only override-enabled keys.

**Condition:** multiple values exist

**Action:** Use highest authorized active layer

**Exception:** Locked keys ignore lower overrides

## GES-P01-BR-000010 - Audit immutability
Audit events cannot be edited or deleted through ordinary application workflows.

**Condition:** update or delete requested

**Action:** Reject action

**Exception:** Governed archival only

## GES-P01-BR-000011 - Break-glass duration
Emergency access expires at the earlier of policy maximum or approved expiration.

**Condition:** grant active

**Action:** Auto-expire and revoke

**Exception:** Renewal requires new approval

## GES-P01-BR-000012 - AI proposal writeback
AI output affecting governed records is stored as a proposal until required approval succeeds.

**Condition:** writeback not explicitly authorized

**Action:** Create proposal

**Exception:** Approved low-risk automation

## GES-P01-BR-000013 - Locked baseline protection
A locked record version cannot be modified in place.

**Condition:** status equals locked

**Action:** Create change request and successor version

**Exception:** No direct exception

## GES-P01-BR-000014 - External sharing minimum
External users receive only explicitly shared objects and approved portal actions.

**Condition:** request is external

**Action:** Evaluate explicit share and portal permission

**Exception:** No inherited internal access

## GES-P01-BR-000015 - Entitlement enforcement
A disabled or expired entitlement blocks new use but retains governed historical data.

**Condition:** entitlement inactive

**Action:** Block capability initiation

**Exception:** Read-only history may remain
