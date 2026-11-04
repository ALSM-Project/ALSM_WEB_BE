# Audit Module

## Purpose

Owns append-only audit records for important backend actions.

## Responsibilities / Non-Responsibilities

It records approved audit events and persistence; it does not become a general
business workflow or expose sensitive values.

## Architecture and Data Ownership

Uses `domain/` and `infrastructure/` and owns audit-log persistence. Records
must avoid passwords, tokens, secrets, card data, and full sensitive legacy
source.

## Business Rules & Compliance
- **Immutable and Append-Only**: Audit logs cannot be updated or deleted by any operational role.
- **7-Year Minimum Retention**: Required by compliance policies, automatically enforced through MongoDB TTL index on `expiresAt` (`expireAfterSeconds: 0`). Pre-save hooks automatically calculate 7 years from creation.
- **Client IP Tracking**: Inbound client IP addresses are captured via `RequestIpMiddleware` into AsyncLocalStorage (`requestIpStorage`) and persisted on each append.

## Related Documentation

[`RULE.md`](../../../RULE.md) · [Coding Standards](../../../docs/engineering/CODING_STANDARDS.md) · [ADR-001](../../../docs/engineering/adr/ADR-001-modular-monolith-simplified-clean-architecture.md)
