# Core Platform Engines

## ENG-P02-001 - Authorization Decision Engine
Inputs: actor; tenant; action; resource; scope; policy; session risk

Outputs: allow/deny; reason; matched policy; effective scope; decision_id

Core rule: Deterministic and side-effect free

## ENG-P02-002 - Configuration Resolution Engine
Inputs: configuration key; environment; tenant; company; project; user; date

Outputs: effective value; source layer; version; validation

Core rule: Highest authorized active override wins

## ENG-P02-003 - Workflow Orchestration Engine
Inputs: workflow definition; object; variables; events; timers

Outputs: durable state; step history; outcome

Core rule: Persist before external side effects

## ENG-P02-004 - Rules Evaluation Engine
Inputs: rule version; typed inputs

Outputs: typed output; result; explanation; execution_id

Core rule: Same inputs and version yield same result

## ENG-P02-005 - Job Dispatch Engine
Inputs: job type; priority; tenant; capacity; retry policy

Outputs: worker lease; execution schedule; retry/dead-letter outcome

Core rule: At-least-once processing

## ENG-P02-006 - Search Indexing Engine
Inputs: source object; schema; ACL; analyzer configuration

Outputs: versioned search document

Core rule: Authorization filtered at query time

## ENG-P02-007 - Notification Routing Engine
Inputs: event; recipient; preference; template; urgency

Outputs: channel deliveries; deduplication key; escalation

Core rule: Honor mandatory notifications over opt-out

## ENG-P02-008 - Synchronization Engine
Inputs: offline transactions; server versions; conflict policies

Outputs: applied changes; conflicts; receipt; deltas

Core rule: Deterministic conflict resolution

## ENG-P02-009 - Unit Conversion Engine
Inputs: value; source unit; target unit; precision

Outputs: converted value; formula/version; rounding

Core rule: Dimension compatibility required

## ENG-P02-010 - Currency Conversion Engine
Inputs: amount; source currency; target currency; rate source/date

Outputs: converted amount; rate; provenance

Core rule: No implicit conversion

## ENG-P02-011 - AI Policy Engine
Inputs: actor; tenant; agent; model; prompt; data classes; tool request

Outputs: allow/block; restrictions; evidence requirements

Core rule: Intersection of user, agent, tenant, and tool policy

## ENG-P02-012 - AI Cost Metering Engine
Inputs: model usage; tokens; tools; tenant pricing profile

Outputs: usage record; estimated cost; allocation dimensions

Core rule: Reconcile to gateway execution
