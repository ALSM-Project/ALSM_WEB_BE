# Projects Module

## Purpose

Owns organization-scoped project lifecycle and conversion-type selection.

## Responsibilities / Non-Responsibilities

Creates, lists, updates, and soft-deletes projects. It does not run conversion
algorithms or own conversion job execution.

## Architecture and Data Ownership

Uses all four layers and owns project persistence. Repository access is scoped
by `organizationId`; project rules stay in domain/application rather than
controllers.

## Main Use Cases

Create, list, retrieve, update, and soft-delete an organization project.

## Related Documentation

[`RULE.md`](../../../RULE.md) · [Project Structure](../../../docs/engineering/PROJECT_STRUCTURE_GUIDELINES.md) · [ADR-005](../../../docs/engineering/adr/ADR-005-business-module-first-folder-structure.md)
