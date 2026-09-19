# Example - Estimate Approved Event

A domain service publishes a versioned estimate.approved event. Internal consumers update project controls and finance. The webhook service signs and delivers the tenant's subscribed event. Duplicate deliveries are handled through event IDs and idempotency.
