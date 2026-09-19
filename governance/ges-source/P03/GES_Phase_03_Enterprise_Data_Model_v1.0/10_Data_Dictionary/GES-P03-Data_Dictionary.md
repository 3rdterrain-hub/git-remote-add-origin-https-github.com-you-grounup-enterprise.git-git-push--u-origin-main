# Phase 03 Data Dictionary

All canonical records are tenant-aware, versioned where mutable, classified, auditable, and traceable.

## ENT-P03-001 - Tenant
Domain: Foundation

Purpose: Top-level data isolation and subscription boundary

Core attributes: tenant_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-002 - Organization
Domain: Foundation

Purpose: Operating organization within a tenant

Core attributes: organization_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-003 - LegalEntity
Domain: Foundation

Purpose: Registered company or legal business entity

Core attributes: legalentity_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-004 - BusinessUnit
Domain: Foundation

Purpose: Operational division, branch, or department

Core attributes: businessunit_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-005 - Location
Domain: Foundation

Purpose: Reusable physical or virtual location

Core attributes: location_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-006 - Project
Domain: Work & Delivery

Purpose: Primary unit of planned and executed work

Core attributes: project_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-007 - UserAccount
Domain: Foundation

Purpose: Interactive platform identity

Core attributes: useraccount_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-008 - Person
Domain: Party & Relationship

Purpose: Natural person record

Core attributes: person_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-009 - Team
Domain: Foundation

Purpose: Named working group

Core attributes: team_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-010 - RoleDefinition
Domain: Foundation

Purpose: Governed responsibility and permission role

Core attributes: roledefinition_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-011 - Party
Domain: Party & Relationship

Purpose: Common customer, vendor, employee, or organization identity

Core attributes: party_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-012 - OrganizationParty
Domain: Party & Relationship

Purpose: Organization represented as a party

Core attributes: organizationparty_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-013 - ContactPoint
Domain: Party & Relationship

Purpose: Email, phone, website, or messaging contact

Core attributes: contactpoint_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-014 - Address
Domain: Party & Relationship

Purpose: Postal and physical address

Core attributes: address_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-015 - PartyRelationship
Domain: Party & Relationship

Purpose: Typed relationship between parties

Core attributes: partyrelationship_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-016 - CustomerAccount
Domain: Party & Relationship

Purpose: Commercial customer account

Core attributes: customeraccount_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-017 - VendorAccount
Domain: Party & Relationship

Purpose: Supplier or subcontractor account

Core attributes: vendoraccount_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-018 - EmployeeProfile
Domain: Party & Relationship

Purpose: Employment profile linked to a person

Core attributes: employeeprofile_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-019 - Qualification
Domain: Safety & Quality

Purpose: Certification, license, training, or competency

Core attributes: qualification_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-020 - Opportunity
Domain: Work & Delivery

Purpose: Potential work or revenue pursuit

Core attributes: opportunity_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-021 - Estimate
Domain: Work & Delivery

Purpose: Versioned cost and price model

Core attributes: estimate_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-022 - EstimateVersion
Domain: Work & Delivery

Purpose: Immutable estimate revision

Core attributes: estimateversion_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: created; immutable; retained

## ENT-P03-023 - EstimateLine
Domain: Work & Delivery

Purpose: Detailed quantity, resource, cost, and price line

Core attributes: estimateline_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-024 - Proposal
Domain: Work & Delivery

Purpose: Customer-facing offer

Core attributes: proposal_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-025 - Contract
Domain: Work & Delivery

Purpose: Executed agreement governing work

Core attributes: contract_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-026 - WorkOrder
Domain: Work & Delivery

Purpose: Authorized work package

Core attributes: workorder_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-027 - Task
Domain: Work & Delivery

Purpose: Assignable unit of work

Core attributes: task_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-028 - ScheduleActivity
Domain: Work & Delivery

Purpose: Planned activity with dates, logic, and progress

Core attributes: scheduleactivity_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-029 - DailyReport
Domain: Work & Delivery

Purpose: Daily field production and condition record

Core attributes: dailyreport_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-030 - ApprovalRequest
Domain: Work & Delivery

Purpose: Governed approval case

Core attributes: approvalrequest_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-031 - ApprovalDecision
Domain: Work & Delivery

Purpose: Recorded approval outcome

Core attributes: approvaldecision_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-032 - LaborResource
Domain: Resources

Purpose: Labor classification or person capacity

Core attributes: laborresource_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-033 - Crew
Domain: Resources

Purpose: Reusable group of labor and equipment

Core attributes: crew_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-034 - CrewMember
Domain: Resources

Purpose: Crew membership with role and effective dates

Core attributes: crewmember_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-035 - EquipmentAsset
Domain: Resources

Purpose: Owned, leased, or rented equipment

Core attributes: equipmentasset_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-036 - FleetVehicle
Domain: Resources

Purpose: Road-licensed fleet vehicle

Core attributes: fleetvehicle_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-037 - MaterialItem
Domain: Resources

Purpose: Material catalog item

Core attributes: materialitem_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-038 - ServiceItem
Domain: Resources

Purpose: Service catalog item

Core attributes: serviceitem_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-039 - ResourceRate
Domain: Resources

Purpose: Effective labor, equipment, material, or service rate

Core attributes: resourcerate_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-040 - VendorQuote
Domain: Resources

Purpose: Vendor-specific quote and terms

Core attributes: vendorquote_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-041 - CostCode
Domain: Financial

Purpose: Standard cost classification

Core attributes: costcode_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-042 - Budget
Domain: Financial

Purpose: Approved financial plan

Core attributes: budget_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-043 - BudgetLine
Domain: Financial

Purpose: Budget amount by cost, period, or work scope

Core attributes: budgetline_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-044 - Commitment
Domain: Financial

Purpose: Purchase order, subcontract, or committed cost

Core attributes: commitment_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-045 - Invoice
Domain: Financial

Purpose: Receivable or payable invoice

Core attributes: invoice_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-046 - Payment
Domain: Financial

Purpose: Money received or paid

Core attributes: payment_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-047 - CostTransaction
Domain: Financial

Purpose: Actual, accrued, committed, or forecast cost

Core attributes: costtransaction_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-048 - TaxDefinition
Domain: Financial

Purpose: Tax rule and jurisdiction

Core attributes: taxdefinition_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-049 - CurrencyRate
Domain: Financial

Purpose: Versioned exchange rate

Core attributes: currencyrate_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-050 - Document
Domain: Documents & Records

Purpose: Logical document record

Core attributes: document_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-051 - DocumentVersion
Domain: Documents & Records

Purpose: Immutable document content version

Core attributes: documentversion_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: created; immutable; retained

## ENT-P03-052 - AttachmentLink
Domain: Documents & Records

Purpose: Link between a document and business object

Core attributes: attachmentlink_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-053 - RecordClassification
Domain: Documents & Records

Purpose: Security, retention, and handling classification

Core attributes: recordclassification_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-054 - ElectronicSignature
Domain: Documents & Records

Purpose: Signature evidence and status

Core attributes: electronicsignature_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-055 - Site
Domain: Location & Spatial

Purpose: Project or customer site

Core attributes: site_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-056 - Parcel
Domain: Location & Spatial

Purpose: Property or land parcel reference

Core attributes: parcel_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-057 - SpatialReference
Domain: Location & Spatial

Purpose: Coordinate reference system

Core attributes: spatialreference_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-058 - GeometryReference
Domain: Location & Spatial

Purpose: Stored or linked geometry representation

Core attributes: geometryreference_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-059 - StationRange
Domain: Location & Spatial

Purpose: Linear stationing interval

Core attributes: stationrange_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-060 - Jurisdiction
Domain: Location & Spatial

Purpose: Governing geographic authority

Core attributes: jurisdiction_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-061 - SafetyIncident
Domain: Safety & Quality

Purpose: Safety or environmental incident

Core attributes: safetyincident_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-062 - Inspection
Domain: Safety & Quality

Purpose: Structured inspection event

Core attributes: inspection_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-063 - Observation
Domain: Safety & Quality

Purpose: Safety, quality, or field observation

Core attributes: observation_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-064 - CorrectiveAction
Domain: Safety & Quality

Purpose: Action to resolve a finding

Core attributes: correctiveaction_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-065 - Permit
Domain: Safety & Quality

Purpose: Permit, authorization, or compliance record

Core attributes: permit_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-066 - AIAgent
Domain: AI & Automation

Purpose: Governed AI agent definition

Core attributes: aiagent_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-067 - AIExecution
Domain: AI & Automation

Purpose: Single AI execution record

Core attributes: aiexecution_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-068 - AIRecommendation
Domain: AI & Automation

Purpose: Structured AI recommendation

Core attributes: airecommendation_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-069 - AIWriteback
Domain: AI & Automation

Purpose: Proposed or completed AI data change

Core attributes: aiwriteback_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-070 - FeedbackRecord
Domain: AI & Automation

Purpose: Human or outcome feedback on AI/system output

Core attributes: feedbackrecord_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-071 - ExternalIdentifier
Domain: Integration & Audit

Purpose: Identifier from another system

Core attributes: externalidentifier_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-072 - SourceSystem
Domain: Integration & Audit

Purpose: External or legacy system definition

Core attributes: sourcesystem_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-073 - DataMapping
Domain: Integration & Audit

Purpose: Field and value mapping specification

Core attributes: datamapping_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-074 - ImportBatch
Domain: Integration & Audit

Purpose: Governed data import

Core attributes: importbatch_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-075 - DomainEvent
Domain: Integration & Audit

Purpose: Versioned business or platform event

Core attributes: domainevent_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: created; immutable; retained

## ENT-P03-076 - DataLineage
Domain: Integration & Audit

Purpose: Origin and transformation lineage

Core attributes: datalineage_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-077 - ChangeRecord
Domain: Integration & Audit

Purpose: Versioned record change metadata

Core attributes: changerecord_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-078 - AuditEvent
Domain: Integration & Audit

Purpose: Immutable actor-action-object audit event

Core attributes: auditevent_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: created; immutable; retained

## ENT-P03-079 - ReferenceSet
Domain: Foundation

Purpose: Governed code and lookup collection

Core attributes: referenceset_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-080 - ReferenceValue
Domain: Foundation

Purpose: Effective-dated lookup value

Core attributes: referencevalue_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-081 - CustomFieldDefinition
Domain: Foundation

Purpose: Tenant-governed extensible field

Core attributes: customfielddefinition_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived

## ENT-P03-082 - CustomFieldValue
Domain: Foundation

Purpose: Typed custom field value

Core attributes: customfieldvalue_id; tenant_id; version; status; created_at; updated_at

Constraints: Tenant-scoped; effective-dated or versioned where applicable

Lifecycle: active; inactive; archived
