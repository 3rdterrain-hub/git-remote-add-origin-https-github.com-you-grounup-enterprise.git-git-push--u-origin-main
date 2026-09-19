# Phase 01 Governance Engines

## Permission Resolution Engine
Inputs: actor, tenant, roles, grants, denials, scope, action, resource, session risk, emergency grant.
Output: allow/deny, matched rules, effective scope, reason, correlation ID.

## Configuration Resolution Engine
Inputs: key, platform default, tenant, company, office, project, user layers, effective date.
Output: effective value, source layer, source record, validation result.

## Approval Routing Engine
Inputs: object type, amount, risk, requester, scope, policy, delegations, conflicts.
Output: stages, eligible approvers, independence flags, due dates, escalation.

## Retention Eligibility Engine
Inputs: record class, trigger date, retention schedule, legal holds, investigations, exceptions.
Output: eligible/suppressed, disposition action, reason, required approval.

## Governance Risk Scoring Engine
Inputs: permission risk, sensitive data, emergency access, failed attempts, unusual scope, policy violations.
Output: risk score, severity, required challenge or review.
