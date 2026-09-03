# Conversions Module

## Purpose

Owns conversion job orchestration, not conversion algorithms.

## Responsibilities

- conversion job management, status, retries, and dead-job handling;
- BullMQ queue orchestration;
- conversion-tool integration boundary;
- conversion result and version-workflow integration.

## Non-Responsibilities

The backend does **not** own BMS, DSPF, or COBOL parsers; field-mapping or
COBOL-to-Java algorithms; frontend or Java code generators. These are external
Conversion Tools.

## Architecture / Public Contracts

The module uses `application/`, `domain/`, `infrastructure/`, and
`presentation/`. The worker selects an infrastructure adapter implementing the
domain/application-facing `ConversionEnginePort`. Queue payloads stay compact;
MongoDB is the business source of truth.

A `ConversionJob` may optionally carry a `screenId` (a screen is an external,
opaque identifier — this module does not own a Screen entity). This lets a job
represent either a whole-project conversion (`screenId` unset, legacy shape)
or one legacy screen's conversion. `POST .../conversions/bulk` creates one job
per requested `screenId`; `GET .../screens/:screenId/conversions` lists a
screen's conversion history (most recent first) so a client can read the
current/last result for that screen.

## Security / Organization Isolation

Jobs and results are organization/project-scoped. Requests must verify
membership before read, create, retry, or other state-changing operations.

## Related Documentation

[`RULE.md`](../../../RULE.md) · [ADR-003](../../../docs/engineering/adr/ADR-003-external-conversion-tool-boundary.md) · [Worker template](../../../docs/engineering/folder-readme-templates/worker-README.md)
