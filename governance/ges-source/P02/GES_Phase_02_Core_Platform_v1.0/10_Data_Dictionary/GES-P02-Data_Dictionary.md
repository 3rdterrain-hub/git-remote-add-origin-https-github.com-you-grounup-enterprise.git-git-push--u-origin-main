# Phase 02 Data Dictionary

All timestamps are UTC, identifiers are immutable, tenant context is mandatory, and structured source files are authoritative.

## ENT-P02-001 - PlatformRequest
Normalized inbound request context

Attributes: request_id; tenant_id; actor_id; channel; locale; timezone; correlation_id

Lifecycle: received; processing; completed; failed

## ENT-P02-002 - Session
Authenticated interactive or service session

Attributes: session_id; actor_id; issued_at; expires_at; risk; device_id; status

Lifecycle: active; challenged; revoked; expired

## ENT-P02-003 - Device
Registered client device

Attributes: device_id; actor_id; platform; trust_state; last_seen; key_reference

Lifecycle: new; trusted; restricted; revoked

## ENT-P02-004 - AuthorizationDecision
Explainable access decision

Attributes: decision_id; actor; action; resource; scope; result; policy_refs; decided_at

Lifecycle: recorded

## ENT-P02-005 - ServiceIdentity
Non-human platform identity

Attributes: service_identity_id; owner; type; scopes; credential_ref; status

Lifecycle: draft; active; suspended; retired

## ENT-P02-006 - MetadataDefinition
Governed extension field definition

Attributes: metadata_definition_id; entity_type; key; data_type; rules; scope

Lifecycle: draft; active; deprecated

## ENT-P02-007 - MetadataValue
Value attached to governed object

Attributes: metadata_value_id; definition_id; object_ref; value; version

Lifecycle: active; superseded

## ENT-P02-008 - TagDefinition
Governed tag definition

Attributes: tag_id; key; label; synonyms; owner; scope; status

Lifecycle: draft; active; retired

## ENT-P02-009 - TagAssignment
Tag applied to an object

Attributes: assignment_id; tag_id; object_ref; assigned_by; assigned_at

Lifecycle: active; removed

## ENT-P02-010 - FileObject
Logical file identity

Attributes: file_id; tenant_id; name; classification; owner; current_version_id

Lifecycle: active; archived; deleted

## ENT-P02-011 - FileVersion
Immutable content version

Attributes: file_version_id; file_id; version; checksum; size; mime; storage_ref; scan_status

Lifecycle: uploading; scanning; accepted; quarantined; rejected

## ENT-P02-012 - SearchDocument
Permission-aware indexed representation

Attributes: search_document_id; object_ref; index_version; fields; acl_tokens

Lifecycle: queued; indexed; stale; deleted

## ENT-P02-013 - Notification
Outbound communication instance

Attributes: notification_id; template_id; recipient; channel; payload_ref; status

Lifecycle: queued; sent; delivered; failed; cancelled

## ENT-P02-014 - NotificationTemplate
Versioned message template

Attributes: template_id; key; locale; channel; content; version; status

Lifecycle: draft; active; retired

## ENT-P02-015 - Schedule
One-time or recurring execution plan

Attributes: schedule_id; owner; expression; timezone; next_run; status

Lifecycle: draft; active; paused; completed; cancelled

## ENT-P02-016 - BackgroundJob
Durable asynchronous work item

Attributes: job_id; type; tenant_id; payload_ref; priority; attempts; status; progress

Lifecycle: queued; running; retry; succeeded; failed; cancelled; dead-lettered

## ENT-P02-017 - WorkflowInstance
Durable workflow execution

Attributes: workflow_instance_id; definition_id; version; object_ref; state; variables; status

Lifecycle: running; waiting; completed; failed; cancelled

## ENT-P02-018 - WorkflowDefinition
Versioned workflow graph

Attributes: workflow_definition_id; key; version; states; transitions; timers; status

Lifecycle: draft; approved; active; retired

## ENT-P02-019 - RuleDefinition
Versioned deterministic rule

Attributes: rule_definition_id; key; version; inputs; expression; output_schema; status

Lifecycle: draft; approved; active; retired

## ENT-P02-020 - RuleExecution
Recorded rule evaluation

Attributes: rule_execution_id; rule_version; input_hash; output; result; executed_at

Lifecycle: recorded

## ENT-P02-021 - DomainEvent
Versioned event envelope

Attributes: event_id; tenant_id; type; schema_version; producer; occurred_at; correlation; causation; payload_ref

Lifecycle: published; archived

## ENT-P02-022 - EventDelivery
Consumer delivery state

Attributes: delivery_id; event_id; consumer; attempt; status; error; next_attempt

Lifecycle: pending; delivered; retry; dead-lettered

## ENT-P02-023 - WebhookSubscription
Tenant outbound webhook configuration

Attributes: subscription_id; tenant_id; event_types; endpoint; secret_ref; status

Lifecycle: draft; active; paused; disabled

## ENT-P02-024 - WebhookDelivery
Signed delivery attempt

Attributes: delivery_id; subscription_id; event_id; attempt; status; response_code

Lifecycle: queued; delivered; retry; failed; dead-lettered

## ENT-P02-025 - ConnectorInstance
Configured external system connector

Attributes: connector_id; tenant_id; type; credential_ref; scopes; mapping_version; status

Lifecycle: draft; active; paused; error; retired

## ENT-P02-026 - ImportBatch
Governed import execution

Attributes: import_batch_id; tenant_id; source_file; mapping; counts; status

Lifecycle: uploaded; validating; preview; importing; completed; failed

## ENT-P02-027 - ExportPackage
Governed export artifact

Attributes: export_id; requester; criteria; format; checksum; expires_at; status

Lifecycle: requested; generating; available; expired; failed

## ENT-P02-028 - OfflinePack
Encrypted field data package

Attributes: offline_pack_id; user; device; scope; version; expires_at; status

Lifecycle: building; available; downloaded; expired; revoked

## ENT-P02-029 - SyncTransaction
Offline-originating change

Attributes: sync_transaction_id; device; actor; object_ref; operation; base_version; payload_ref; status

Lifecycle: queued; received; applied; rejected; conflict; review

## ENT-P02-030 - ConflictCase
Manual or governed sync conflict

Attributes: conflict_case_id; object_ref; local_version; server_version; policy; resolution; status

Lifecycle: open; resolved; rejected

## ENT-P02-031 - FeatureFlag
Versioned rollout control

Attributes: feature_flag_id; key; targeting; allocation; effective dates; status

Lifecycle: draft; active; paused; retired

## ENT-P02-032 - SecretReference
Reference to protected secret

Attributes: secret_ref_id; store; path_alias; owner; rotation_due; status

Lifecycle: active; rotation_due; revoked

## ENT-P02-033 - BackupSet
Encrypted recovery point

Attributes: backup_set_id; scope; created_at; checksum; location; retention; restore_test_status

Lifecycle: creating; available; expired; failed

## ENT-P02-034 - AIAgentDefinition
Registered AI agent version

Attributes: agent_id; version; owner; purpose; permissions; tools; prompt_refs; eval_status; status

Lifecycle: draft; review; approved; active; suspended; retired

## ENT-P02-035 - AIExecution
Governed AI request execution

Attributes: ai_execution_id; tenant; actor; agent_version; model; prompt_version; evidence_refs; result; cost

Lifecycle: queued; running; completed; failed; blocked

## ENT-P02-036 - AIToolInvocation
Permissioned AI tool call

Attributes: tool_invocation_id; execution_id; tool_version; permission_decision; input_ref; output_ref; status

Lifecycle: requested; authorized; executed; denied; failed
