# Core Platform Workflows

## WF-P02-001 - Authenticated Request
Actors: Client; Gateway; Identity; Authorization; Service

States: Received; Authenticated; Authorized; Processing; Completed; Failed

Core steps: Validate transport; authenticate; resolve tenant; authorize; execute; audit; respond

## WF-P02-002 - File Upload and Acceptance
Actors: User; File Service; Scanner; Classifier

States: Initiated; Uploading; Checksumming; Scanning; Accepted; Quarantined; Rejected

Core steps: Create upload session; stream chunks; verify checksum; scan; classify; create immutable version; index

## WF-P02-003 - Search Indexing
Actors: Domain Service; Event Bus; Search Indexer

States: Queued; Reading; Transforming; ACL Build; Indexed; Failed

Core steps: Read source; create permission tokens; transform fields; index; mark version

## WF-P02-004 - Background Job Execution
Actors: Producer; Job Service; Worker

States: Queued; Claimed; Running; Retry; Succeeded; Failed; Dead-lettered

Core steps: Validate payload; claim lease; execute; checkpoint; retry; dead-letter; notify

## WF-P02-005 - Durable Workflow Execution
Actors: Workflow Engine; Domain Services; Approvers

States: Created; Running; Waiting; Compensating; Completed; Failed; Cancelled

Core steps: Load definition; execute steps; persist state; wait timers/events; retry or compensate

## WF-P02-006 - Webhook Delivery
Actors: Event Bus; Webhook Service; Consumer

States: Queued; Signed; Sending; Delivered; Retry; Failed; Dead-lettered

Core steps: Build payload; sign; deliver; capture response; backoff; dead-letter; notify

## WF-P02-007 - Import Batch
Actors: User; Import Engine; Validator; Domain Services

States: Uploaded; Mapping; Validating; Preview; Importing; Completed; Failed

Core steps: Parse; map; validate rows; preview; approve; write idempotently; report errors

## WF-P02-008 - Offline Synchronization
Actors: Mobile Client; Sync Service; Domain Service

States: Prepared; Uploading; Evaluating; Applying; Conflict; Completed; Failed

Core steps: Authenticate device; upload queue; validate base versions; apply or resolve; download deltas; confirm

## WF-P02-009 - Feature Rollout
Actors: Product Owner; Release Manager; Flag Service

States: Draft; Review; Active; Paused; Expanded; Rolled Back; Retired

Core steps: Define targeting; approve; enable small cohort; monitor; expand or rollback

## WF-P02-010 - Secret Rotation
Actors: Owner; Secret Manager; Dependent Service

States: Scheduled; Creating; Updating; Verifying; Revoking Old; Completed; Failed

Core steps: Create new secret; update references; verify; revoke old; audit

## WF-P02-011 - Backup and Restore Verification
Actors: Backup Service; Operator; Verification Environment

States: Scheduled; Backing Up; Available; Restoring; Verifying; Passed; Failed

Core steps: Create encrypted backup; verify checksum; restore isolated; run validation; record evidence

## WF-P02-012 - AI Execution
Actors: User/Workflow; AI Gateway; Agent Runtime; Tool Service

States: Requested; Policy Check; Running; Tool Await; Evidence Check; Completed; Blocked; Failed

Core steps: Resolve agent/version; authorize; redact; call model; execute tools; attach evidence; meter; audit
