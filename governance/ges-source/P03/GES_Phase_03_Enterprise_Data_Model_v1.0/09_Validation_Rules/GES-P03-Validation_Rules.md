# Phase 03 Validation Rules

- **GES-P03-VAL-000001 All Tenant Entities.tenant_id:** Required and must equal the authenticated tenant context. Severity: Error.
- **GES-P03-VAL-000002 All Entities.id:** Required immutable UUID/ULID. Severity: Error.
- **GES-P03-VAL-000003 All Mutable Entities.version:** Positive integer and must equal current persisted version on update. Severity: Error.
- **GES-P03-VAL-000004 Effective-Dated Entity.effective_start/effective_end:** Start required; end must be later than start. Severity: Error.
- **GES-P03-VAL-000005 Money.currency_code:** Required active ISO currency code. Severity: Error.
- **GES-P03-VAL-000006 Quantity.unit_code:** Required and compatible with declared dimension. Severity: Error.
- **GES-P03-VAL-000007 ExternalIdentifier.source_system_id + external_id:** Unique within tenant, source system, entity type, and active status. Severity: Error.
- **GES-P03-VAL-000008 DocumentVersion.checksum:** Required SHA-256 and must match stored bytes. Severity: Error.
- **GES-P03-VAL-000009 EstimateVersion.status:** Released version cannot return to draft. Severity: Error.
- **GES-P03-VAL-000010 AIWriteback.approval_status:** Material change requires approved status before commit. Severity: Error.
- **GES-P03-VAL-000011 Spatial Entity.spatial_reference_id:** Required whenever geometry is present. Severity: Error.
- **GES-P03-VAL-000012 StationRange.start_station/end_station:** End must be greater than or equal to start and unit required. Severity: Error.
- **GES-P03-VAL-000013 Qualification.issued_at/expires_at:** Expiration cannot precede issue date. Severity: Error.
- **GES-P03-VAL-000014 PartyRelationship.from_party/to_party/type:** Parties must differ unless the relationship type explicitly permits self-reference. Severity: Error.
- **GES-P03-VAL-000015 ReferenceValue.code:** Unique within active reference set and effective period. Severity: Error.