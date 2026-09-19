# Enterprise Data Engines

## ENG-P03-001 - Identifier Engine
Inputs: entity type; tenant; source context

Outputs: immutable global identifier; alias mapping

Core rule: Identifiers are stable and non-guessable

## ENG-P03-002 - Reference Resolution Engine
Inputs: entity reference; tenant; effective date

Outputs: resolved active record or validation error

Core rule: Tenant, lifecycle, and effective dates must be compatible

## ENG-P03-003 - Master Data Matching Engine
Inputs: party or resource attributes; aliases; external IDs

Outputs: candidate duplicates; confidence; match reasons

Core rule: No automatic merge above configured risk threshold

## ENG-P03-004 - Effective Dating Engine
Inputs: records; key dimensions; start/end dates

Outputs: active version; overlap result; timeline

Core rule: Enforce non-overlap where declared

## ENG-P03-005 - Data Quality Engine
Inputs: entity data; quality rules; thresholds

Outputs: scores; failed rules; exceptions

Core rule: Never silently change source values

## ENG-P03-006 - Lineage Engine
Inputs: source values; transformations; rules; AI execution

Outputs: lineage graph; provenance references

Core rule: Every derived value is traceable to inputs and logic

## ENG-P03-007 - Schema Compatibility Engine
Inputs: old schema; new schema; consumers

Outputs: breaking-change assessment; migration requirements

Core rule: Published contracts require declared compatibility

## ENG-P03-008 - Retention Resolution Engine
Inputs: entity; classification; jurisdiction; hold

Outputs: retention schedule; disposition eligibility

Core rule: Legal hold overrides expiration

## ENG-P03-009 - Unit and Currency Context Engine
Inputs: value; unit/currency; effective conversion

Outputs: normalized value; display value; provenance

Core rule: No implicit cross-context arithmetic

## ENG-P03-010 - AI Writeback Guard Engine
Inputs: recommendation; actor; record version; approval; policy

Outputs: allow/deny; required review; writeback payload

Core rule: AI cannot exceed caller or agent authority
