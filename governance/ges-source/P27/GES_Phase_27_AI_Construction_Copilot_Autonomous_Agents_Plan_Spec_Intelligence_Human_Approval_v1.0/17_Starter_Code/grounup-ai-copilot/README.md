# GrounUp AI Construction Copilot - Phase 27

Vendor/model-provider-neutral reference scaffold.

Core invariants:
- authoritative estimate math is delegated to Phase 26 deterministic tools
- protected writes/approvals require configured human authorization
- all consequential outputs retain evidence plus model/prompt/tool versions
- retrieval/tool calls never exceed tenant/user permissions
- AI provider/model selection is replaceable and evaluation-gated
- background agents are bounded by scope, time, tool and approval policy
