# Conversions Module

## Purpose

Owns conversion job orchestration, not conversion algorithms.

## Responsibilities

- conversion job management, status, retries, and dead-job handling;
- BullMQ queue orchestration;
- conversion-tool integration boundary;
- conversion result and version-workflow integration;
- persistence of human-authored field-mapping overrides per project/screen
  (storage only — see Non-Responsibilities).

## Non-Responsibilities

The backend does **not** own BMS, DSPF, or COBOL parsers; the automatic
field-mapping *algorithm* (deriving mappings from legacy source); COBOL-to-Java
algorithms; frontend or Java code generators. These are external Conversion
Tools. The module only stores whatever mapping a human operator manually
enters or edits for a screen — it does not compute or infer mappings itself.

## Architecture / Public Contracts

The module uses `application/`, `domain/`, `infrastructure/`, and
`presentation/`. The worker selects an infrastructure adapter implementing the
domain/application-facing `ConversionEnginePort`. Queue payloads stay compact;
MongoDB is the business source of truth.

`FieldMappingRepository` (`FIELD_MAPPING_REPOSITORY` token) is a second public
port: one field-mapping document per `(organizationId, projectId, screenId)`,
upserted wholesale on every manual edit (no per-entry versioning yet).

## Persistence / Collections

- `conversion_jobs`
- `field_mappings` — `{ organizationId, projectId, screenId, mappings[], updatedBy }`,
  unique on `(organizationId, projectId, screenId)`.

## Security / Organization Isolation

Jobs, results, and field mappings are organization/project-scoped. Requests
must verify membership before read, create, retry, save, or other
state-changing operations.

## Related Documentation

[`RULE.md`](../../../RULE.md) · [ADR-003](../../../docs/engineering/adr/ADR-003-external-conversion-tool-boundary.md) · [Worker template](../../../docs/engineering/folder-readme-templates/worker-README.md)
