# Phase 02 API Specification

All mutating APIs require authentication, tenant context, authorization, validation, correlation, audit, and idempotency where retryable.

- **API-P02-001** `POST /v1/auth/sessions` - Create authenticated session. Permission: `public/identity policy`.
- **API-P02-002** `DELETE /v1/auth/sessions/{sessionId}` - Revoke session. Permission: `session.revoke`.
- **API-P02-003** `POST /v1/authorization/decisions` - Evaluate authorization. Permission: `authorization.evaluate`.
- **API-P02-004** `POST /v1/files/uploads` - Start file upload. Permission: `file.create`.
- **API-P02-005** `POST /v1/files/uploads/{uploadId}/complete` - Finalize file version. Permission: `file.create`.
- **API-P02-006** `GET /v1/search` - Permission-aware search. Permission: `search.execute`.
- **API-P02-007** `POST /v1/notifications` - Create notification. Permission: `notification.send`.
- **API-P02-008** `POST /v1/schedules` - Create schedule. Permission: `schedule.manage`.
- **API-P02-009** `POST /v1/jobs` - Submit background job. Permission: `job.submit`.
- **API-P02-010** `GET /v1/jobs/{jobId}` - Read job progress. Permission: `job.read`.
- **API-P02-011** `POST /v1/workflows/{definitionKey}/instances` - Start workflow. Permission: `workflow.start`.
- **API-P02-012** `POST /v1/rules/{ruleKey}/evaluate` - Evaluate rule. Permission: `rule.execute`.
- **API-P02-013** `POST /v1/webhook-subscriptions` - Create webhook subscription. Permission: `webhook.manage`.
- **API-P02-014** `POST /v1/connectors` - Create connector instance. Permission: `connector.manage`.
- **API-P02-015** `POST /v1/imports` - Create import batch. Permission: `import.create`.
- **API-P02-016** `POST /v1/exports` - Create export package. Permission: `export.create`.
- **API-P02-017** `POST /v1/mobile/offline-packs` - Build offline pack. Permission: `offlinepack.create`.
- **API-P02-018** `POST /v1/mobile/sync` - Submit sync transactions. Permission: `sync.execute`.
- **API-P02-019** `POST /v1/feature-flags` - Create feature flag. Permission: `featureflag.manage`.
- **API-P02-020** `GET /v1/platform/health` - Read platform health. Permission: `platform.health.read`.
- **API-P02-021** `POST /v1/ai/executions` - Execute registered agent. Permission: `ai.execute`.
- **API-P02-022** `POST /v1/ai/tools/{toolKey}/invoke` - Invoke AI tool. Permission: `ai.tool.invoke`.