# Enterprise Data Workflows

## WF-P03-001 - Master Record Creation
Actors: Data Steward; Requester; Validator

States: Draft; Validating; Duplicate Review; Approved; Active; Rejected

Core steps: Capture; validate; duplicate check; steward review; assign identifiers; activate; audit

## WF-P03-002 - Master Record Merge
Actors: Data Steward; System

States: Proposed; Impact Review; Approved; Merging; Completed; Reversed

Core steps: Select survivor; preserve aliases; move relationships; write lineage; audit; notify

## WF-P03-003 - Schema Change
Actors: Data Owner; Architect; Engineering; QA

States: Proposed; Impact Analysis; Approved; Implementing; Migrating; Validating; Released

Core steps: Assess compatibility; version schema; migrate; reconcile; certify; publish

## WF-P03-004 - Data Import
Actors: User; Import Engine; Data Steward

States: Uploaded; Mapped; Validating; Exception Review; Approved; Committing; Completed; Failed

Core steps: Stage; map; validate; deduplicate; preview; approve; commit; reconcile; archive evidence

## WF-P03-005 - Data Quality Exception
Actors: Rule Engine; Data Steward; Owner

States: Open; Assigned; Investigating; Correcting; Validating; Closed; Accepted Risk

Core steps: Create exception; assign; analyze lineage; correct or waive; revalidate; record outcome

## WF-P03-006 - Record Archive and Restore
Actors: Record Owner; Records Admin

States: Requested; Eligibility Review; Approved; Archived; Restored; Denied

Core steps: Check retention, hold, dependencies; approve; archive or restore; audit

## WF-P03-007 - AI Recommendation Writeback
Actors: AI Agent; User; Approver; Domain Service

States: Generated; Reviewed; Approved; Rejected; Committing; Committed; Failed

Core steps: Attach evidence; compare current version; authorize; approve; validate; commit; audit; feedback

## WF-P03-008 - Data Export
Actors: Requester; Export Service; Security

States: Requested; Authorizing; Extracting; Validating; Packaging; Available; Expired

Core steps: Authorize scope; extract canonical data; include lineage; checksum; package; expire
