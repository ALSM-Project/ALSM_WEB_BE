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

## Related Documentation

[`RULE.md`](../../../RULE.md) · [Coding Standards](../../../docs/engineering/CODING_STANDARDS.md) · [ADR-001](../../../docs/engineering/adr/ADR-001-modular-monolith-simplified-clean-architecture.md)
