# ADR-004: Use One Backend for Three Portals with Organization Isolation

- **Status:** Accepted
- **Date:** 2026-08-27
- **Decision owners:** ALSM project team

## Context

ALSM exposes different experiences for Self-Service, Internal Staff, and Enterprise/Partner users, but the product shares platform data and business capabilities.

Creating three independent backends would duplicate authentication, project/conversion rules, billing/support data access, and audit behavior.

The system also needs strict separation between customer organizations.

## Decision

All three portals use one shared backend platform.

Portal differences are controlled by:

- authenticated identity;
- organization context;
- membership/role;
- internal/platform privileges;
- business policy.

Organization-owned data must be scoped by `organizationId` or an equivalent enforced ownership mechanism.

A client-provided organization identifier is not authorization proof.

Support impersonation must preserve the real actor and be audit logged; read-only is the safe default.

## Consequences

### Positive

- one implementation of core business rules;
- centralized audit/security;
- easier consistency across portals;
- shared project/conversion data model.

### Negative / Trade-offs

- authorization logic must be carefully centralized;
- internal privileged access needs explicit audit controls;
- every new tenant-owned resource requires isolation tests.

## Alternatives Considered

### Separate backend per portal

Rejected because it duplicates logic and increases consistency/maintenance risk.

### Trust organization ID sent by frontend

Rejected as insecure.

## Compliance / Implementation Notes

For organization-owned resources, tests should prove:

```text
Organization A cannot read Organization B resource
Organization A cannot modify Organization B resource
```

Internal/platform privileges must come from authenticated server-side identity, not request body fields.

## Related Documents

- `/RULE.md`
- `CODING_STANDARDS.md`
