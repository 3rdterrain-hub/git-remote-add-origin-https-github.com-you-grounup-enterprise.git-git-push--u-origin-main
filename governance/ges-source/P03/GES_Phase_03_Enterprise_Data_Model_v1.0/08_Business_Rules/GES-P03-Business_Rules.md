# Phase 03 Business Rules

## GES-P03-BR-000001 - Tenant boundary
A record may reference only records belonging to the same tenant unless an approved shared-master pattern applies.

**Condition:** Cross-tenant reference detected

**Action:** Reject write and audit

**Exception:** Approved global reference sets

## GES-P03-BR-000002 - Immutable primary key
Primary identifiers never change after record creation.

**Condition:** Identifier change attempted

**Action:** Reject

**Exception:** External alias may change

## GES-P03-BR-000003 - Version check
Updates require the current record version.

**Condition:** Submitted version is stale

**Action:** Reject with conflict

**Exception:** Administrative migration under maintenance control

## GES-P03-BR-000004 - Released version immutability
Released estimates, contracts, document versions, events, and audit events cannot be edited.

**Condition:** Record is released or immutable

**Action:** Create new version or amendment

**Exception:** None

## GES-P03-BR-000005 - Effective date integrity
Effective start must precede effective end and overlapping active records are prohibited where uniqueness applies.

**Condition:** Invalid or conflicting range

**Action:** Reject

**Exception:** Explicit overlap-enabled rule

## GES-P03-BR-000006 - Money context
A monetary amount must include currency.

**Condition:** Amount present without currency

**Action:** Reject

**Exception:** None

## GES-P03-BR-000007 - Quantity context
A quantity must include compatible unit and dimension.

**Condition:** Value present without valid unit

**Action:** Reject

**Exception:** Dimensionless ratios

## GES-P03-BR-000008 - Source preservation
Imported values preserve source system, external identifier, import batch, and original value where transformed.

**Condition:** Committed import

**Action:** Record lineage

**Exception:** Manual native entry

## GES-P03-BR-000009 - AI writeback approval
AI recommendations do not change authoritative records until the required approval is completed.

**Condition:** Material change proposed

**Action:** Create pending writeback

**Exception:** Pre-approved low-risk automation

## GES-P03-BR-000010 - Document checksum
Accepted document content must have a validated checksum.

**Condition:** Acceptance attempted without checksum

**Action:** Reject

**Exception:** None

## GES-P03-BR-000011 - Party master merge
A party merge preserves all source identifiers, relationships, addresses, contacts, and reversal evidence.

**Condition:** Duplicate approved for merge

**Action:** Create surviving master and merge history

**Exception:** None

## GES-P03-BR-000012 - No silent data correction
Failed quality or validation rules create explicit exceptions or rejected rows.

**Condition:** Rule failure

**Action:** Reject or create exception

**Exception:** Approved auto-normalization with lineage

## GES-P03-BR-000013 - Lifecycle integrity
Inactive or archived master data cannot be assigned to new work unless policy permits.

**Condition:** New reference to inactive record

**Action:** Reject

**Exception:** Historical references remain valid

## GES-P03-BR-000014 - Audit completeness
Material create, update, archive, merge, approve, import, and AI writeback actions create audit events.

**Condition:** Action completed

**Action:** Write immutable audit event

**Exception:** None

## GES-P03-BR-000015 - Retention inheritance
A record inherits retention from classification, entity type, and governing jurisdiction.

**Condition:** Record created or reclassified

**Action:** Resolve retention policy

**Exception:** Legal hold overrides expiration
