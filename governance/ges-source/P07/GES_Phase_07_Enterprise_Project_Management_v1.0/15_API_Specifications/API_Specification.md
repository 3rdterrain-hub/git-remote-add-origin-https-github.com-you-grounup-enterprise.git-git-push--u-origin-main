# API Specification

| ID | Method | Path | Purpose | Security | Format | Version |
| --- | --- | --- | --- | --- | --- | --- |
| P07-API-001 | GET | /projects | List authorized projects | OAuth2 + project authorization | JSON | v1 |
| P07-API-002 | POST | /projects | Create project | OAuth2 + project authorization | JSON | v1 |
| P07-API-003 | GET | /projects/{projectId} | Read project command-center summary | OAuth2 + project authorization | JSON | v1 |
| P07-API-004 | PATCH | /projects/{projectId} | Update permitted project fields | OAuth2 + project authorization | JSON | v1 |
| P07-API-005 | POST | /projects/{projectId}/transitions | Request lifecycle transition | OAuth2 + project authorization | JSON | v1 |
| P07-API-006 | GET | /projects/{projectId}/digital-twin | Read digital twin snapshot | OAuth2 + project authorization | JSON | v1 |
| P07-API-007 | GET | /projects/{projectId}/schedule | Read current schedule | OAuth2 + project authorization | JSON | v1 |
| P07-API-008 | POST | /projects/{projectId}/schedule/updates | Submit schedule update | OAuth2 + project authorization | JSON | v1 |
| P07-API-009 | POST | /projects/{projectId}/daily-reports | Create daily report | OAuth2 + project authorization | JSON | v1 |
| P07-API-010 | POST | /projects/{projectId}/daily-reports/{id}/submit | Submit daily report | OAuth2 + project authorization | JSON | v1 |
| P07-API-011 | GET | /projects/{projectId}/documents | Search project documents | OAuth2 + project authorization | JSON | v1 |
| P07-API-012 | POST | /projects/{projectId}/documents | Register controlled document | OAuth2 + project authorization | JSON | v1 |
| P07-API-013 | POST | /projects/{projectId}/rfis | Create RFI | OAuth2 + project authorization | JSON | v1 |
| P07-API-014 | POST | /projects/{projectId}/submittals | Create submittal | OAuth2 + project authorization | JSON | v1 |
| P07-API-015 | POST | /projects/{projectId}/change-events | Create change event | OAuth2 + project authorization | JSON | v1 |
| P07-API-016 | POST | /projects/{projectId}/change-orders | Create change order | OAuth2 + project authorization | JSON | v1 |
| P07-API-017 | GET | /projects/{projectId}/cost-control | Read budget/commitment/actual/forecast view | OAuth2 + project authorization | JSON | v1 |
| P07-API-018 | POST | /projects/{projectId}/commitments | Create commitment | OAuth2 + project authorization | JSON | v1 |
| P07-API-019 | POST | /projects/{projectId}/invoices | Create invoice | OAuth2 + project authorization | JSON | v1 |
| P07-API-020 | POST | /projects/{projectId}/inspections | Create inspection | OAuth2 + project authorization | JSON | v1 |
| P07-API-021 | POST | /projects/{projectId}/incidents | Report incident | OAuth2 + project authorization | JSON | v1 |
| P07-API-022 | GET | /projects/{projectId}/alerts | List project alerts | OAuth2 + project authorization | JSON | v1 |
| P07-API-023 | POST | /projects/{projectId}/offline-packages | Create offline sync package | OAuth2 + project authorization | JSON | v1 |
| P07-API-024 | POST | /projects/{projectId}/offline-packages/{id}/sync | Synchronize offline changes | OAuth2 + project authorization | JSON | v1 |

All endpoints require tenant isolation, project-level authorization, idempotency where applicable, version checks for writes, audit logging, and standard validation error responses.