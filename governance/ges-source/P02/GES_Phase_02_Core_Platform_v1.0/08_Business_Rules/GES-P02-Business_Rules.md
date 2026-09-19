# Phase 02 Business Rules

## GES-P02-BR-000001 - Verified tenant context
Every governed operation requires verified tenant context before data access.

**Condition:** tenant context missing or invalid

**Action:** Reject and audit

**Exception:** Public health endpoints

## GES-P02-BR-000002 - Deny by default
Authorization returns deny when no explicit allow applies.

**Condition:** no matching allow

**Action:** Deny

**Exception:** None

## GES-P02-BR-000003 - Idempotent mutation
Externally retried mutations require an idempotency key and stable result.

**Condition:** duplicate key and same payload

**Action:** Return original result

**Exception:** Non-repeatable admin commands

## GES-P02-BR-000004 - Immutable identifier
A governed record identifier cannot be changed after creation.

**Condition:** update attempts id change

**Action:** Reject

**Exception:** Migration mapping creates alias

## GES-P02-BR-000005 - Canonical UTC storage
System timestamps are stored in UTC.

**Condition:** persisting time

**Action:** Convert to UTC and retain source timezone where material

**Exception:** None

## GES-P02-BR-000006 - Permission-aware search
Search returns only documents authorized at query time.

**Condition:** result not authorized

**Action:** Suppress result and snippet

**Exception:** None

## GES-P02-BR-000007 - File version immutability
Uploaded file versions are immutable after acceptance.

**Condition:** content replacement requested

**Action:** Create new version

**Exception:** Quarantine metadata may change

## GES-P02-BR-000008 - At-least-once event handling
Consumers must tolerate duplicate event delivery.

**Condition:** event previously processed

**Action:** Return prior outcome

**Exception:** None

## GES-P02-BR-000009 - Dead-letter preservation
Permanently failed events and jobs move to a dead-letter store with evidence.

**Condition:** retry policy exhausted

**Action:** Dead-letter and alert

**Exception:** Authorized replay

## GES-P02-BR-000010 - Feature flag safety
Disabling a feature cannot destroy governed data.

**Condition:** flag becomes disabled

**Action:** Block new use and preserve history

**Exception:** Migration plan

## GES-P02-BR-000011 - Offline scope minimum
Offline packs contain only required records and fields for assigned work.

**Condition:** pack requested

**Action:** Generate least-privilege pack

**Exception:** Emergency approved expansion

## GES-P02-BR-000012 - Deterministic conflict policy
Sync conflicts use declared field or entity policy.

**Condition:** concurrent update

**Action:** Apply configured merge/reject/review policy

**Exception:** Manual review

## GES-P02-BR-000013 - No secrets in logs
Secrets, tokens, and prohibited fields must be redacted before logging.

**Condition:** sensitive pattern or classified field

**Action:** Redact or drop

**Exception:** Security incident evidence vault

## GES-P02-BR-000014 - Explicit unit conversion
Cross-unit arithmetic requires a governed conversion.

**Condition:** units differ

**Action:** Convert using registered conversion and precision

**Exception:** None

## GES-P02-BR-000015 - Explicit currency conversion
Cross-currency arithmetic requires rate, source, and effective date.

**Condition:** currencies differ

**Action:** Convert and preserve provenance

**Exception:** None

## GES-P02-BR-000016 - AI gateway enforcement
Production AI calls may not bypass the model gateway.

**Condition:** direct provider route

**Action:** Block

**Exception:** Approved isolated test harness

## GES-P02-BR-000017 - Registered agent only
Only active evaluated agents may execute production tools.

**Condition:** agent missing, disabled, or unapproved

**Action:** Block execution

**Exception:** None

## GES-P02-BR-000018 - Tool permission inheritance
AI tool permissions cannot exceed the invoking context and agent grants.

**Condition:** requested action exceeds intersection

**Action:** Deny

**Exception:** Break-glass not allowed for autonomous action

## GES-P02-BR-000019 - Evidence required for material AI output
Material AI recommendations require source evidence and model/prompt version.

**Condition:** material decision support

**Action:** Attach evidence or mark incomplete

**Exception:** Human-authored note may proceed separately

## GES-P02-BR-000020 - Restore verification
A backup is not considered valid until a restoration test succeeds.

**Condition:** backup completed

**Action:** Schedule or record restore test

**Exception:** Emergency snapshot
