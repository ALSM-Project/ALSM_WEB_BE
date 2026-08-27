# Organizations Module

## Purpose

Owns organizations, memberships, organization context, and authorization rules.

## Responsibilities

Resolve the active organization and verify membership/role access for
organization-owned resources. Other modules must use its public contracts
rather than implement their own membership queries.

## Data Ownership and Security

Owns organization and membership data. Organization isolation is mandatory for
all tenant-owned reads and writes.

## Architecture

Uses `application/`, `domain/`, and `infrastructure/`; technical persistence
remains in infrastructure.

## Related Documentation

[`RULE.md`](../../../RULE.md) · [Coding Standards](../../../docs/engineering/CODING_STANDARDS.md) · [ADR-004](../../../docs/engineering/adr/ADR-004-single-backend-multi-portal-organization-isolation.md)
