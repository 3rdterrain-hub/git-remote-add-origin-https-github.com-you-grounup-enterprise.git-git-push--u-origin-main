# Validation Rules

| validation_id | field | rule | error_message | severity |
|---|---|---|---|---|
| GES-P05-VR-001 | Estimate.name | Required and 3-200 characters | Enter an estimate name. | Error |
| GES-P05-VR-002 | Estimate.currency | ISO 4217 code | Select a valid currency. | Error |
| GES-P05-VR-003 | EstimateLine.quantity | Numeric and not null | Enter a valid quantity. | Error |
| GES-P05-VR-004 | EstimateLine.unit | Active unit and dimension-compatible | Select a compatible unit. | Error |
| GES-P05-VR-005 | EstimateLine.unit_cost | Numeric; negative requires adjustment type | Enter a valid unit cost. | Error |
| GES-P05-VR-006 | ProductionRate.output | Greater than zero | Production output must be greater than zero. | Error |
| GES-P05-VR-007 | LaborRate.effective_from | Required date | Enter an effective date. | Error |
| GES-P05-VR-008 | EquipmentRate.rate_basis | Hourly, daily, weekly, monthly or unit | Select a valid rate basis. | Error |
| GES-P05-VR-009 | MaterialPrice.vendor_id | Required when source type is vendor | Select the vendor. | Error |
| GES-P05-VR-010 | TruckCycle.payload | Greater than zero and within vehicle limit | Enter a valid payload. | Error |
| GES-P05-VR-011 | TruckCycle.distance | Nonnegative | Distance cannot be negative. | Error |
| GES-P05-VR-012 | MarkupProfile.sequence | Unique positive integers | Correct markup sequence. | Error |
| GES-P05-VR-013 | RegionalFactor.factor | Within configured min/max | Regional factor is outside allowed range. | Error |
| GES-P05-VR-014 | AIRecommendation.confidence | 0-100 | Confidence must be 0 through 100. | Error |
| GES-P05-VR-015 | ApprovalStep.decision | Approved, Rejected, Returned or Pending | Select a valid decision. | Error |
| GES-P05-VR-016 | WhiteLabelConfiguration.domain | Unique verified domain when enabled | Verify and assign a unique domain. | Error |
| GES-P05-VR-017 | CustomFieldDefinition.data_type | Supported field type | Select a supported data type. | Error |
| GES-P05-VR-018 | ActualProductionRecord.work_date | Not future beyond policy | Enter a valid work date. | Error |
| GES-P05-VR-019 | EstimateVersion.version_no | Unique within estimate | Version number already exists. | Error |
| GES-P05-VR-020 | VendorQuote.expiration_date | On or after issue date | Quote expiration must follow issue date. | Error |