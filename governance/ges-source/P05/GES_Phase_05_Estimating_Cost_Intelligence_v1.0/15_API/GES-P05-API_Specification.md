# API Specification

All APIs are tenant-scoped, versioned, authenticated, auditable and rate-limited. Write operations support idempotency where applicable.

| api_id | method | path | summary |
|---|---|---|---|
| GES-P05-API-001 | POST | /v1/estimates | Create estimate |
| GES-P05-API-002 | GET | /v1/estimates/{id} | Read estimate |
| GES-P05-API-003 | POST | /v1/estimates/{id}/versions | Create immutable version |
| GES-P05-API-004 | POST | /v1/estimates/{id}/calculate | Calculate estimate |
| GES-P05-API-005 | POST | /v1/estimates/{id}/validate | Validate estimate |
| GES-P05-API-006 | POST | /v1/estimates/{id}/submit | Submit for approval |
| GES-P05-API-007 | POST | /v1/estimates/{id}/approve | Approve estimate |
| GES-P05-API-008 | POST | /v1/estimates/{id}/scenarios | Create scenario |
| GES-P05-API-009 | POST | /v1/takeoff/documents | Upload takeoff document |
| GES-P05-API-010 | POST | /v1/takeoff/measurements | Create measurement |
| GES-P05-API-011 | POST | /v1/takeoff/revision-comparisons | Compare revisions |
| GES-P05-API-012 | GET | /v1/assemblies | List assemblies |
| GES-P05-API-013 | POST | /v1/production/calculate | Calculate production |
| GES-P05-API-014 | POST | /v1/haul/calculate | Calculate hauling |
| GES-P05-API-015 | POST | /v1/risk/simulations | Run risk simulation |
| GES-P05-API-016 | GET | /v1/calculations/{trace_id} | Read calculation trace |
| GES-P05-API-017 | POST | /v1/ai/recommendations/{id}/disposition | Disposition AI recommendation |
| GES-P05-API-018 | GET | /v1/configuration/tenant | Read tenant configuration |
| GES-P05-API-019 | PUT | /v1/configuration/white-label | Update white-label configuration |
| GES-P05-API-020 | POST | /v1/actuals | Post actual production |
| GES-P05-API-021 | POST | /v1/calibration/proposals | Create calibration proposal |
| GES-P05-API-022 | GET | /v1/reports/estimate-review/{id} | Generate review report |
| GES-P05-API-023 | POST | /v1/exports/estimate/{id} | Create export package |
| GES-P05-API-024 | POST | /v1/webhooks | Register webhook |