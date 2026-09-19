# Phase 01 Data Dictionary

The structured entity definition CSV/JSON is authoritative. All identifiers are permanent. Timestamps are stored in UTC. Effective-dated records use inclusive start and exclusive end semantics unless a later platform standard explicitly defines otherwise.

## ENT-P01-001 - Tenant
**Purpose:** Top-level security and commercial boundary

**Key attributes:** tenant_id; tenant_key; legal_name; status; region; default_currency; default_units

**Relationships:** OrganizationUnit, User, Role, Policy, Configuration

**Lifecycle:** provisioning; active; suspended; closed

**Owner:** Platform Administration

**Classification:** Restricted

## ENT-P01-002 - OrganizationUnit
**Purpose:** Hierarchical company, office, department, or division

**Key attributes:** organization_unit_id; tenant_id; type; name; parent_id; effective dates

**Relationships:** Tenant, Project Scope, User Assignment

**Lifecycle:** draft; active; inactive; superseded

**Owner:** Platform Administration

**Classification:** Internal

## ENT-P01-003 - UserIdentity
**Purpose:** Human or service identity

**Key attributes:** user_id; tenant_id; identity_type; email; status; provider; last_login

**Relationships:** RoleAssignment, Session, Device, AuditEvent

**Lifecycle:** invited; active; suspended; terminated

**Owner:** Identity Administration

**Classification:** Restricted

## ENT-P01-004 - Role
**Purpose:** Named collection of permission grants

**Key attributes:** role_id; tenant_id; role_key; name; type; status

**Relationships:** PermissionGrant, RoleAssignment

**Lifecycle:** draft; active; deprecated

**Owner:** Security Governance

**Classification:** Internal

## ENT-P01-005 - Permission
**Purpose:** Atomic allowed action

**Key attributes:** permission_id; resource; action; risk_level; system_owned

**Relationships:** PermissionGrant

**Lifecycle:** active; deprecated

**Owner:** Security Governance

**Classification:** Internal

## ENT-P01-006 - RoleAssignment
**Purpose:** Assignment of role to identity and scope

**Key attributes:** assignment_id; user_id; role_id; scope_type; scope_id; effective dates

**Relationships:** UserIdentity, Role, OrganizationUnit

**Lifecycle:** pending; active; expired; revoked

**Owner:** Security Governance

**Classification:** Restricted

## ENT-P01-007 - Policy
**Purpose:** Governed policy identity

**Key attributes:** policy_id; policy_key; owner; category; scope_type

**Relationships:** PolicyVersion

**Lifecycle:** draft; active; retired

**Owner:** Compliance Governance

**Classification:** Internal

## ENT-P01-008 - PolicyVersion
**Purpose:** Versioned policy content and applicability

**Key attributes:** policy_version_id; policy_id; version; effective dates; content_uri; acknowledgment_required

**Relationships:** Policy, PolicyAcknowledgment

**Lifecycle:** draft; review; approved; active; superseded

**Owner:** Compliance Governance

**Classification:** Confidential

## ENT-P01-009 - PolicyAcknowledgment
**Purpose:** User acknowledgment evidence

**Key attributes:** ack_id; policy_version_id; user_id; acknowledged_at; method

**Relationships:** PolicyVersion, UserIdentity

**Lifecycle:** recorded; revoked

**Owner:** Compliance Governance

**Classification:** Restricted

## ENT-P01-010 - ConfigurationDefinition
**Purpose:** Definition of a configurable key

**Key attributes:** config_definition_id; key; data_type; allowed_layers; default; validation

**Relationships:** ConfigurationValue

**Lifecycle:** draft; active; deprecated

**Owner:** Platform Administration

**Classification:** Internal

## ENT-P01-011 - ConfigurationValue
**Purpose:** Value at a particular scope and time

**Key attributes:** config_value_id; definition_id; layer; scope_id; value; effective dates

**Relationships:** ConfigurationDefinition

**Lifecycle:** draft; active; superseded

**Owner:** Platform Administration

**Classification:** Confidential

## ENT-P01-012 - ApprovalPolicy
**Purpose:** Rules for approval routing

**Key attributes:** approval_policy_id; object_type; conditions; stages; required roles

**Relationships:** ApprovalRequest

**Lifecycle:** draft; active; retired

**Owner:** Workflow Governance

**Classification:** Confidential

## ENT-P01-013 - ApprovalRequest
**Purpose:** Instance requiring governed decision

**Key attributes:** approval_request_id; object_ref; requester; status; amount; risk

**Relationships:** ApprovalDecision, Delegation

**Lifecycle:** pending; approved; rejected; cancelled; expired

**Owner:** Workflow Governance

**Classification:** Confidential

## ENT-P01-014 - ApprovalDecision
**Purpose:** Immutable approval action

**Key attributes:** decision_id; request_id; approver; decision; comments; decided_at

**Relationships:** ApprovalRequest

**Lifecycle:** approved; rejected; abstained

**Owner:** Workflow Governance

**Classification:** Confidential

## ENT-P01-015 - Delegation
**Purpose:** Temporary authority delegation

**Key attributes:** delegation_id; delegator; delegate; scope; limits; effective dates

**Relationships:** UserIdentity, ApprovalRequest

**Lifecycle:** draft; active; expired; revoked

**Owner:** Workflow Governance

**Classification:** Restricted

## ENT-P01-016 - AuditEvent
**Purpose:** Immutable governance event

**Key attributes:** audit_event_id; tenant_id; actor; action; object; occurred_at; correlation_id; payload_hash

**Relationships:** All governed entities

**Lifecycle:** recorded; archived

**Owner:** Audit Governance

**Classification:** Restricted

## ENT-P01-017 - DataClassification
**Purpose:** Governed classification and handling rules

**Key attributes:** classification_id; name; rank; handling_policy

**Relationships:** Entity/Field metadata

**Lifecycle:** draft; active; retired

**Owner:** Data Governance

**Classification:** Internal

## ENT-P01-018 - RetentionSchedule
**Purpose:** Retention trigger and duration by record class

**Key attributes:** retention_schedule_id; record_class; trigger; duration; disposition

**Relationships:** LegalHold, governed record

**Lifecycle:** draft; active; retired

**Owner:** Records Governance

**Classification:** Confidential

## ENT-P01-019 - LegalHold
**Purpose:** Matter-based preservation requirement

**Key attributes:** legal_hold_id; matter_reference; scope; issued_at; released_at

**Relationships:** RetentionSchedule, governed record

**Lifecycle:** active; released

**Owner:** Records Governance

**Classification:** Highly Confidential

## ENT-P01-020 - ChangeRequest
**Purpose:** Controlled change to locked or governed artifacts

**Key attributes:** change_request_id; object_ref; reason; impact; migration; rollback; status

**Relationships:** ApprovalRequest, AuditEvent

**Lifecycle:** draft; submitted; approved; rejected; implemented; closed

**Owner:** Change Control Board

**Classification:** Confidential

## ENT-P01-021 - EmergencyAccessGrant
**Purpose:** Time-limited elevated access

**Key attributes:** grant_id; user_id; reason; approved_by; effective dates; scope

**Relationships:** UserIdentity, AuditEvent

**Lifecycle:** requested; approved; active; expired; revoked; reviewed

**Owner:** Security Governance

**Classification:** Highly Confidential

## ENT-P01-022 - Entitlement
**Purpose:** Tenant capability entitlement

**Key attributes:** entitlement_id; tenant_id; feature_key; limits; effective dates; status

**Relationships:** Tenant

**Lifecycle:** pending; active; suspended; expired

**Owner:** Commercial Operations

**Classification:** Confidential

## ENT-P01-023 - AdministrativeCase
**Purpose:** Governance exception or review case

**Key attributes:** case_id; type; severity; owner; related_refs; status

**Relationships:** AuditEvent, UserIdentity

**Lifecycle:** open; investigating; remediated; closed

**Owner:** Risk and Compliance

**Classification:** Confidential
