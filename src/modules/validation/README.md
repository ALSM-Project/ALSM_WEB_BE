# Validation Module

## Purpose

Validation owns rule-based and AI-assisted validation of conversion results. It is a separate
business capability from conversion execution, and all AI output remains advisory until a human
reviews it.

## Responsibilities

- validation run and finding domain contracts;
- validation run persistence;
- validation finding persistence;
- on-demand validation context construction from conversion artifacts;
- tenant-safe validation metadata and finding read queries;
- AI validator provider abstraction;
- future deterministic rule validation;
- future AI semantic validation;
- future human review workflow integration.

The intended relationship is:

```text
Project
  -> ConversionJob
      -> ValidationRun
          -> ValidationFinding
```

A Conversion Job may have multiple Validation Runs. Findings belong to their Validation Run and
must not be mixed with conversion-tool `error_logs` or attached directly to the Conversion Job
record.

## Non-Responsibilities

- does not convert COBOL to Java;
- does not convert BMS/DSPF;
- does not own parsers;
- does not own code generators;
- does not automatically modify generated code;
- does not automatically accept AI findings;
- does not replace human review.

Model confidence is advisory metadata only. It is not a correctness score, migration quality
score, deterministic proof, or final human decision.

## Phase 2 Context Foundation

`BuildValidationContextService` reconstructs deterministic validation input for a completed
conversion from:

```text
ConversionJob.inputReference
    -> StoragePort.readFiles(...)
    -> sourceFiles

ConversionJob.resultReference
    -> StoragePort.readFiles(...)
    -> targetFiles
```

The service preserves relative paths, decodes file buffers as UTF-8, and includes conversion
metadata such as conversion type, screen ID, and tool version when available. It is an internal
application service. No HTTP endpoint exposes the raw `ValidationContext`.

Source and target file contents remain in storage and are read on demand. They are **not**
duplicated into `validation_runs` or `validation_findings` documents.

## Persistence and Read Model

`validation_runs` stores tenant-scoped run metadata linked to a Conversion Job. A Conversion Job
may have multiple Validation Runs; `conversionJobId` is intentionally not unique.

`validation_findings` stores tenant-scoped finding metadata linked to one Validation Run while
retaining `conversionJobId`, `projectId`, and `organizationId` for traceability and defense in
depth.

Read operations resolve the authenticated user's organization, verify project access, validate
conversion/run relationships, and use repository predicates scoped by organization and project.

Phase 2 exposes only:

```text
GET /projects/:projectId/conversions/:conversionJobId/validation-runs
GET /projects/:projectId/validation-runs/:validationRunId
GET /projects/:projectId/validation-runs/:validationRunId/findings
```

## Conceptual Flow

```text
Conversion Completed
    ↓
Build Validation Context
    ↓
ValidationRun
    ↓
Future Validators
    ↓
ValidationFinding
    ↓
Human Review
```

Phase 2 provides the persistence, context, and tenant-safe read foundations only. It does not
automatically create or execute Validation Runs.

## Delivery Phases

Phase 1 defines only the validation domain contracts, the provider-neutral AI validator port, and
an inert fake adapter that always returns an empty findings list.

Phase 2 adds repository contracts, MongoDB schemas and repositories, internal context
construction, and read-only APIs.

The following remain future work:

- validation queue;
- validation worker;
- deterministic rule validation;
- real AI providers;
- Secure Validation Gateway;
- retrieval-augmented generation (RAG);
- frontend integration;
- evaluation;
- fine-tuning.
