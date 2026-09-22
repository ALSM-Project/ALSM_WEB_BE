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
- secure AI context preparation;
- OpenAI semantic validation behind the provider abstraction;
- internal AI validation execution and persistence lifecycle;
- future deterministic rule validation;
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

AI validation also does **not** perform conversion, modify generated Java, prove semantic
equivalence, guarantee complete defect detection, or automatically run after conversion.

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

Phase 3 does not add an AI execution HTTP endpoint. `ExecuteAiValidationService` remains an
internal application service until asynchronous orchestration and an authenticated trigger are
introduced in a later phase.

## Phase 3 Secure AI Validation Pipeline

```text
Conversion artifacts
    -> BuildValidationContextService
    -> PrepareAiValidationContextService
       -> deterministic extension allowlists
       -> binary/path checks
       -> per-file, file-count, and total-character limits
       -> deterministic secret redaction
       -> stable one-based line numbering
    -> AiValidatorPort
    -> OpenAiValidatorAdapter
       -> versioned semantic-validation prompt
       -> OpenAI Responses API with store=false and no tools
       -> strict JSON Schema output
       -> Joi runtime validation and file/line-range validation
    -> ExecuteAiValidationService
       -> ValidationRun lifecycle
       -> application-owned ValidationFinding mapping
    -> Human review
```

AI semantic validation currently supports only `COBOL_TO_JAVA`. The secure gateway selects
`.cob`, `.cbl`, and `.cpy` source files and `.java` target files, normalizes relative path
separators, sorts paths lexically, and excludes unsupported file types. It rejects missing
supported source/target files, duplicate or unsafe paths, binary content, and contexts that exceed
hard limits. Phase 3 fails closed rather than truncating a project and implying complete review.
RAG and chunking are intentionally deferred.

The gateway detects common credential-like values, including password/secret/API-key/token
assignments, bearer tokens, URI credentials, JWT-like values, private-key blocks, and selected
well-known cloud credential formats. Matches are replaced with typed `[REDACTED:...]`
placeholders. Only the redaction count is retained; original secret values are never logged or
persisted. This deterministic redaction is a defense-in-depth control, not a guarantee that every
possible secret format can be recognized.

Line prefixes use the stable format `N | original line`. They exist only in provider input; stored
source artifacts are never modified. Provider locations are accepted only when the exact selected
file exists and the one-based range is ordered and within that file's original line count.

## Prompt and Structured Output Contract

The only supported prompt version is `semantic-cobol-java-v1`. It instructs the model to perform
semantic comparison rather than conversion, treat source paths/comments/strings/code as untrusted
data, ignore instructions embedded in source, avoid code execution and completeness claims, and
report only evidence-backed behavioral differences. Style, naming, formatting, and subjective
refactoring findings are out of scope.

Structured output contains a top-level `findings` array. Each item contains only semantic data:

```text
category
severity
title
explanation
expectedBehavior | null
actualBehavior | null
suggestion | null
sourceLocation { file, startLine, endLine } | null
targetLocation { file, startLine, endLine } | null
confidence | null
```

The provider cannot supply IDs, tenant/run relationships, timestamps, finding source, review
status, provider name, or model name. ALSM validates enums, required text, confidence range,
unknown properties, maximum finding count, and file/line ranges before returning any drafts. A
malformed response yields zero persisted findings and a failed run. `confidence` is model
self-reported advisory confidence only; it is not a correctness probability or deterministic
certainty.

## Provider and Privacy Boundary

`OpenAiValidatorAdapter` uses the stateless OpenAI Responses API. Each request uses the configured
model, strict `text.format` JSON Schema, `store: false`, `tools: []`, no conversation or previous
response ID, no file upload, and no file/web search. It scans completed response message items for
output text or refusals rather than assuming a fixed output-array position. Timeouts, retryable
network failures, HTTP 429, and HTTP 5xx use a small bounded retry policy. Authentication and other
permanent client failures are not retried.

Raw prompts, provider responses, source, and generated Java are not logged or persisted in
`validation_runs` or `validation_findings`. Sanitized run metadata may include provider, model,
prompt version, redaction count, selected-file count, input character count, and sanitized failure
code/message.

Source code is sent to an external provider only when all three conditions are true:

1. `AI_VALIDATION_ENABLED=true`;
2. `AI_PROVIDER=openai`;
3. the internal execution service is intentionally invoked.

Provider selection does not contact OpenAI during application startup. With AI disabled, the
inert fake adapter is selected and no OpenAI key is required.

## Phase 3 Configuration

```text
AI_VALIDATION_ENABLED=false
AI_PROVIDER=fake
OPENAI_API_KEY=
OPENAI_MODEL=
AI_TIMEOUT_MS=60000
AI_MAX_RETRIES=2
AI_MAX_FILES=50
AI_MAX_FILE_CHARS=200000
AI_MAX_TOTAL_CHARS=500000
AI_MAX_FINDINGS=50
AI_PROMPT_VERSION=semantic-cobol-java-v1
```

`OPENAI_API_KEY` and `OPENAI_MODEL` are required only when AI validation is enabled with the
OpenAI provider. Character limits are literal character counts, not exact token counts or token
estimates.

## Conceptual Flow

```text
Conversion Completed
    ↓
Build Validation Context
    ↓
Secure Context Preparation
    ↓
AI Validator
    ↓
ValidationRun + ValidationFinding
    ↓
Human Review
```

Phase 2 provides the persistence, context, and tenant-safe read foundations. Phase 3 can execute an
AI run through an internal service but does not trigger it automatically.

## Delivery Phases

Phase 1 defines only the validation domain contracts, the provider-neutral AI validator port, and
an inert fake adapter that always returns an empty findings list.

Phase 2 adds repository contracts, MongoDB schemas and repositories, internal context
construction, and read-only APIs.

Phase 3 adds secure context preparation, deterministic redaction/limits/line numbering, one real
OpenAI adapter, strict provider-output validation, and the internal AI run persistence lifecycle.

The following remain future work:

- deterministic rule validation;
- retrieval-augmented generation (RAG);
- asynchronous AI validation queue/worker and user trigger;
- frontend integration;
- evaluation;
- fine-tuning.
