# Phase 02 AI Platform

The AI platform includes a model gateway, agent registry, tool execution service, prompt and policy registry, evidence service, evaluation framework, usage metering, and correlated audit.

Production AI execution must:
1. resolve an active registered agent version;
2. intersect user, tenant, agent, model, data, and tool permissions;
3. apply redaction and content policy;
4. use only registered prompts, models, and tools;
5. attach evidence for material outputs;
6. meter usage and cost;
7. preserve exact versions and correlation identifiers;
8. block unsafe, unauthorized, or unevaluated execution.
