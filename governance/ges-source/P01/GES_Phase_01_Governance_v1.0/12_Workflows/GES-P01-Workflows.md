# Phase 01 Governance Workflows

## WF-P01-001 - Tenant Provisioning
**Actors:** Platform Admin; Tenant Owner

**States:** Requested; Validating; Provisioning; Verification; Active; Failed

**Trigger:** Provisioning request

**Core steps:** Validate template, region, entitlements, owner, defaults; create tenant; run checks

**Output:** Active tenant or remediation case

## WF-P01-002 - User Invitation and Activation
**Actors:** Admin; Invited User; Identity Provider

**States:** Draft; Sent; Accepted; Verified; Active; Expired; Cancelled

**Trigger:** User invitation

**Core steps:** Validate email and scope; send invitation; authenticate; accept terms; assign baseline access

**Output:** Active governed identity

## WF-P01-003 - Role and Permission Change
**Actors:** Requester; Security Admin; Approver

**States:** Draft; Submitted; Risk Review; Approved; Applied; Rejected; Revoked

**Trigger:** Access request

**Core steps:** Evaluate requested permissions, conflicts, scope, duration, approval, and audit

**Output:** Updated role assignment

## WF-P01-004 - Policy Publication
**Actors:** Policy Owner; Reviewer; Approver; Affected User

**States:** Draft; Review; Approved; Scheduled; Active; Superseded; Retired

**Trigger:** Policy version prepared

**Core steps:** Validate content, scope, dates, overlaps, approvals, publication, acknowledgment

**Output:** Active policy version

## WF-P01-005 - Approval Request
**Actors:** Requester; Routing Engine; Approver

**States:** Draft; Pending; In Review; Approved; Rejected; Cancelled; Expired

**Trigger:** Governed action submitted

**Core steps:** Resolve policy and approvers; enforce independence and delegation; record immutable decision

**Output:** Authorized or rejected action

## WF-P01-006 - Delegation
**Actors:** Delegator; Delegate; Approver

**States:** Draft; Submitted; Approved; Active; Expired; Revoked

**Trigger:** Delegation request

**Core steps:** Validate authority boundary, scope, duration, conflicts, and notice

**Output:** Active bounded delegation

## WF-P01-007 - Emergency Access
**Actors:** Requester; Security Approver; Reviewer

**States:** Requested; Approved; Active; Expired; Revoked; Under Review; Closed

**Trigger:** Break-glass request

**Core steps:** Capture justification; approve; elevate; log; notify; auto-expire; conduct review

**Output:** Closed emergency access case

## WF-P01-008 - Change Control
**Actors:** Author; Impact Reviewers; Change Control Board

**States:** Draft; Submitted; Impact Review; Approved; Rejected; Implementing; Verified; Closed

**Trigger:** Change request

**Core steps:** Assess business, data, security, AI, integration, migration, rollback, testing, and downstream impact

**Output:** Controlled successor version

## WF-P01-009 - Retention and Disposition
**Actors:** Records Manager; System; Legal Reviewer

**States:** Scheduled; Eligible; Hold Check; Approved; Disposed; Suppressed

**Trigger:** Retention trigger reached

**Core steps:** Evaluate schedule, holds, investigations, approvals; execute disposition; record evidence

**Output:** Disposed record or hold exception

## WF-P01-010 - AI Governance Proposal
**Actors:** User/Agent; Reviewer; Approver

**States:** Generated; Evidence Check; Submitted; Review; Approved; Rejected; Applied

**Trigger:** AI proposes governed change

**Core steps:** Validate permission, evidence, confidence, target diff, policy, approval, writeback, audit

**Output:** Approved writeback or rejected proposal
