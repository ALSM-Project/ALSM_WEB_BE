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
- authenticated asynchronous AI validation trigger and dedicated BullMQ worker;
- active-run, queue-job, and finding retry idempotency;
- partial result-persistence reconciliation;
- authoritative human review of validation findings;
- tenant-scoped optimistic concurrency and review audit trails;
- future deterministic rule validation;

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

Phase 4 retains these GET endpoints for polling and adds one authenticated asynchronous trigger.

## Phase 5A Human Review Workflow

Human review is authoritative. AI and provider adapters can create advisory findings in `PENDING`
state, but they cannot select or change a human-review status.

```text
AI Finding
    ↓
PENDING
    ↓
Human Reviewer
    ↓
Needs Correction / Manual Review / Not Applicable / Resolved
    ↓
Reviewer Metadata
    ↓
Audit Trail
```

The authenticated review endpoint is:

```text
PATCH /api/v1/projects/:projectId/validation-runs/:validationRunId/findings/:findingId/review
```

The request accepts only `status` and optional `reviewNote`. `reviewedBy` is always the
authenticated user ID, and `reviewedAt` is always the server time. `NOT_APPLICABLE` requires a
trimmed, non-empty note. All notes are limited to 1000 characters. The endpoint uses the same
project-write role policy as conversion actions: `OWNER`, `ADMIN`, and `MEMBER` may review;
`VIEWER` remains read-only.

Allowed transitions are explicit:

```text
PENDING          -> NEEDS_CORRECTION | MANUAL_REVIEW | NOT_APPLICABLE
NEEDS_CORRECTION -> RESOLVED | MANUAL_REVIEW
MANUAL_REVIEW    -> NEEDS_CORRECTION | NOT_APPLICABLE | RESOLVED
NOT_APPLICABLE   -> MANUAL_REVIEW
RESOLVED         -> MANUAL_REVIEW
```

`PENDING` is never an allowed review target. `MANUAL_REVIEW` is the safe reopening state for an
already reviewed finding.

Review persistence uses compare-and-set on finding ID, validation run ID, project ID,
organization ID, and the status read by the reviewer. If another reviewer changes the finding
first, the stale update receives `409 Conflict` and cannot silently overwrite the winning review.
If no finding exists within the complete tenant/project/run scope, the endpoint returns `404`
without revealing whether the identifier exists for another tenant.

Every successful transition appends `VALIDATION_FINDING_REVIEWED` for resource type
`validation_finding`. Audit metadata contains only relationship IDs, previous/new status, and
whether a note was provided. It never includes the note text, finding explanation, source code,
generated Java, prompts, or provider responses. Consistent with existing ALSM mutation services,
the persistence mutation occurs before the synchronous audit append; an audit failure propagates
and is not silently ignored.

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

## Phase 4 Asynchronous Orchestration

AI validation is explicitly triggered only. Conversion completion does not automatically start
AI validation, and the HTTP request never waits for the model:

```text
POST validation-runs
    -> organization membership and write-role authorization
    -> project and conversion tenant checks
    -> completed COBOL_TO_JAVA eligibility check
    -> enabled OpenAI runtime guard
    -> atomic active-run claim
    -> ValidationRun QUEUED
    -> dedicated ai-validation BullMQ queue
    -> HTTP 202 Accepted

ValidationWorkerRunner
    -> reload tenant-scoped run from MongoDB
    -> QUEUED -> PROCESSING compare-and-set
    -> secure Phase 3 context preparation and provider invocation
    -> idempotent finding persistence
    -> result-persistence marker
    -> COMPLETED or final FAILED
```

The trigger endpoint is:

```text
POST /api/v1/projects/:projectId/conversions/:conversionJobId/validation-runs
```

It is protected by the JWT guard and organization context. `OWNER`, `ADMIN`, and `MEMBER` roles
may trigger validation; `VIEWER` remains read-only. A successful request returns `202 Accepted`
with the queued run. If the conversion already has an active AI run, the same run is returned
instead of creating or enqueueing a second application job. Clients poll the existing Phase 2 run
and finding endpoints using the returned run ID.

User-triggered execution requires `AI_VALIDATION_ENABLED=true`, `AI_PROVIDER=openai`, and an
OpenAI-backed resolved adapter at both the trigger and execution boundaries. The fake adapter is
still available for isolated tests and disabled wiring, but it can never represent a successful
user-triggered run. A configuration change after queueing is detected before provider execution;
disabled, fake, unsupported, or changed runtime configuration fails the run safely.

### Active-run and queue idempotency

An internal SHA-256 `activeExecutionKey` represents organization, project, conversion job, and
validator type `AI`. It exists only while a run is `QUEUED` or `PROCESSING`. A unique sparse MongoDB
index makes the claim atomic across concurrent HTTP requests. Duplicate-key races are translated
to the existing active run. `COMPLETED` and `FAILED` transitions unset the key so a future explicit
validation can create a new run. The internal key is not mapped into API records.

The dedicated BullMQ queue is named `ai-validation`. Its job payload contains only:

```text
validationRunId
organizationId
projectId
conversionJobId
```

The BullMQ job ID is exactly `validationRunId`, preventing a second Redis job for the same run.
Source, generated Java, prompts, provider responses, authorization values, and API keys never enter
the queue payload. If initial enqueue fails, the newly created run is marked `FAILED` with the
sanitized `VALIDATION_QUEUE_ENQUEUE_FAILED` code and its active claim is released.

### Worker state and retry policy

The validation worker starts only when `VALIDATION_WORKER_ENABLED=true`. Disabled startup does not
contact OpenAI. It reloads every run with run, project, and organization scope and verifies the
conversion relationship instead of trusting Redis data. Terminal duplicate jobs are no-ops.
`QUEUED` is claimed atomically as `PROCESSING`; BullMQ retries continue that same `PROCESSING` run
and never create another run.

The OpenAI adapter retains its bounded request-level retry policy. Timeouts, network/unavailable
failures, HTTP 429, and HTTP 5xx are retryable at that layer. Phase 4 adds bounded job-level retries
for the sanitized `AI_PROVIDER_TIMEOUT`, `AI_PROVIDER_UNAVAILABLE`, and transient infrastructure
classifications. Invalid context, unsupported conversion/provider, disabled AI, authentication,
malformed structured output, changed configuration, and ambiguous persistence are non-retryable.
Non-retryable failures are marked `FAILED` immediately. Retryable failures remain `PROCESSING`
until the final BullMQ attempt; only then are they marked `FAILED`.

Maximum provider requests are explicitly bounded by:

```text
(AI_MAX_RETRIES + 1) * VALIDATION_JOB_ATTEMPTS
```

With defaults, at most `(2 + 1) * 2 = 6` provider HTTP attempts can occur for one run. Queue retries
can therefore increase provider cost even though the run identity remains stable.

### Finding idempotency and reconciliation

ALSM, not the provider, creates a SHA-256 finding fingerprint from normalized category, severity,
title, explanation, optional expected/actual behavior and suggestion, plus normalized source and
target file/range locations. IDs, timestamps, provider response IDs, and the run ID are excluded
from the hash; run identity is already part of the unique index scope. This identity is retry
protection, not proof that two findings are universally semantically equivalent.

Findings are upserted behind a unique sparse index scoped to organization, project, validation run,
and fingerprint. The fingerprint is not mapped into read responses. Replaying the same normalized
result therefore creates no duplicate rows.

After upserts, the run records non-sensitive `resultsPersistedAt` and `expectedFindingCount`
metadata before the terminal completion update. This marker explicitly represents successful
provider output even when the expected finding count is zero. If completion persistence fails,
the next worker attempt counts the tenant-scoped findings and retries only the `COMPLETED`
transition without calling OpenAI again. A marker/count mismatch fails closed as
`VALIDATION_RESULT_PERSISTENCE_AMBIGUOUS`. Findings without a marker are also treated as ambiguous
instead of silently reporting success. If zero findings were written but the marker write itself
failed, there is no durable evidence that the provider completed; a bounded retry may invoke the
provider again, but it still uses the same run and cannot duplicate findings.

### Phase 4 configuration

```text
VALIDATION_WORKER_ENABLED=false
VALIDATION_WORKER_CONCURRENCY=1
VALIDATION_JOB_ATTEMPTS=2
VALIDATION_JOB_BACKOFF_MS=5000
```

Concurrency is bounded to 1..10, attempts to 1..5, and backoff to 0..300000 milliseconds. No new
npm dependency is used; Phase 4 reuses the existing BullMQ and Redis configuration.

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
Explicit Authenticated Trigger
    ↓
AI/Provider + Conversion Eligibility Guards
    ↓
Atomic QUEUED Run Claim
    ↓
Dedicated BullMQ Queue / Validation Worker
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

Phase 2 provides the persistence, context, and tenant-safe read foundations. Phase 3 provides the
secure provider pipeline. Phase 4 exposes it only through the asynchronous, explicitly triggered
queue/worker lifecycle described above.

## Delivery Phases

Phase 1 defines only the validation domain contracts, the provider-neutral AI validator port, and
an inert fake adapter that always returns an empty findings list.

Phase 2 adds repository contracts, MongoDB schemas and repositories, internal context
construction, and read-only APIs.

Phase 3 adds secure context preparation, deterministic redaction/limits/line numbering, one real
OpenAI adapter, strict provider-output validation, and the internal AI run persistence lifecycle.

Phase 4 adds the authenticated asynchronous trigger, atomic active-run claim, dedicated validation
queue and worker, bounded same-run retries, idempotent finding persistence, and partial completion
reconciliation.

Phase 5A adds authenticated human finding decisions, a bounded generic review note, explicit
transition policy, tenant-scoped compare-and-set persistence, server-owned reviewer metadata, and
a safe audit trail. It does not alter AI prompts, provider behavior, or the Phase 4 queue/worker.

The following remain future work:

- deterministic rule validation;
- retrieval-augmented generation (RAG);
- frontend integration;
- evaluation;
- fine-tuning.
