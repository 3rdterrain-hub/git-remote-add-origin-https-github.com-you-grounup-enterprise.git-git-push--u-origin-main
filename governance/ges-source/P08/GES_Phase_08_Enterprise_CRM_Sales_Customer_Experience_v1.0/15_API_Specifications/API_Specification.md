# API Specification

All APIs are tenant-scoped, versioned, authenticated, authorized, rate-limited, auditable, and idempotent where state creation or outbound communication occurs.

| ID | Method | Path | Purpose |
|---|---|---|---|
| GES-P08-API-001 | POST | /v1/leads | Create lead |
| GES-P08-API-002 | GET | /v1/leads/{leadId} | Retrieve lead |
| GES-P08-API-003 | POST | /v1/leads/{leadId}/qualify | Qualify or disqualify lead |
| GES-P08-API-004 | POST | /v1/leads/{leadId}/assign | Assign lead |
| GES-P08-API-005 | POST | /v1/accounts | Create account |
| GES-P08-API-006 | GET | /v1/accounts/{accountId}/360 | Retrieve customer 360 |
| GES-P08-API-007 | POST | /v1/contacts | Create contact |
| GES-P08-API-008 | POST | /v1/opportunities | Create opportunity |
| GES-P08-API-009 | PATCH | /v1/opportunities/{opportunityId}/stage | Advance opportunity stage |
| GES-P08-API-010 | POST | /v1/opportunities/{opportunityId}/estimate-links | Link estimate |
| GES-P08-API-011 | POST | /v1/proposals | Generate proposal |
| GES-P08-API-012 | POST | /v1/proposals/{proposalId}/issue | Issue proposal |
| GES-P08-API-013 | POST | /v1/proposals/{proposalId}/signature-requests | Create signature request |
| GES-P08-API-014 | POST | /v1/signature-events/webhook | Receive signature event |
| GES-P08-API-015 | POST | /v1/opportunities/{opportunityId}/handoff | Create project handoff |
| GES-P08-API-016 | POST | /v1/automations/{automationId}/enrollments | Enroll customer |
| GES-P08-API-017 | POST | /v1/communications | Send governed communication |
| GES-P08-API-018 | GET | /v1/communications/threads/{threadId} | Retrieve thread |
| GES-P08-API-019 | POST | /v1/portal/invitations | Invite portal user |
| GES-P08-API-020 | POST | /v1/review-requests | Create review request |
| GES-P08-API-021 | POST | /v1/referrals | Create referral |
| GES-P08-API-022 | POST | /v1/warranty-requests | Create warranty request |
| GES-P08-API-023 | GET | /v1/forecasts | Retrieve revenue forecast |
| GES-P08-API-024 | GET | /v1/ai/next-best-actions | Retrieve AI recommendations |
