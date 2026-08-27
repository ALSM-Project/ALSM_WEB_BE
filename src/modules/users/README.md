# Users Module

## Purpose

Owns user account persistence and user-centric domain state.

## Responsibilities / Non-Responsibilities

It provides user repository contracts and persistence. Authentication/session
workflow belongs to auth; membership and organization authorization belong to
organizations.

## Architecture and Data Ownership

Uses `domain/` and `infrastructure/`; the module owns user persistence and must
not leak Mongoose documents beyond infrastructure.

## Related Documentation

[`RULE.md`](../../../RULE.md) · [Project Structure](../../../docs/engineering/PROJECT_STRUCTURE_GUIDELINES.md) · [ADR-001](../../../docs/engineering/adr/ADR-001-modular-monolith-simplified-clean-architecture.md)
