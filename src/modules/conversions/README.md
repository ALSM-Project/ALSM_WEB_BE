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

A `ConversionJob` may optionally carry a `screenId` (a screen is an external,
opaque identifier — this module does not own a Screen entity). This lets a job
represent either a whole-project conversion (`screenId` unset, legacy shape)
or one legacy screen's conversion. `POST .../conversions/bulk` creates one job
per requested `screenId`; `GET .../screens/:screenId/conversions` lists a
screen's conversion history (most recent first) so a client can read the
current/last result for that screen.

## Persistence / Collections

- `conversion_jobs`
- `field_mappings` — `{ organizationId, projectId, screenId, mappings[], updatedBy }`,
  unique on `(organizationId, projectId, screenId)`.

## Security / Organization Isolation

Jobs, results, and field mappings are organization/project-scoped. Requests
must verify membership before read, create, retry, save, or other
state-changing operations.

## Queue execution and recovery

Queue entries use a deterministic job ID containing the persistent job ID and
`executionGeneration`. Duplicate submissions for one execution are deduplicated;
an authorized manual retry increments the generation, clears the previous failure,
and resets its attempt counter. `attemptCount` increments on an actual worker
claim. Project and screen ownership are checked before enqueueing, and reads do
not change operational status. An enqueue failure is persisted as FAILED.

Worker claims are atomic. Additive optional persistence fields
`processingToken` and `processingLeaseExpiresAt` fence completion and failure to
the current lease owner. The worker renews a 45-second lease every 10 seconds;
BullMQ uses a 60-second lock before stalled recovery. Nonfinal tool failures
release the claim to QUEUED for BullMQ's exponential retry. Terminal stalled
events fail only an expired lease belonging to the exact execution generation.
MongoDB remains the source of truth for job state.

The worker validates ObjectId-shaped job IDs and nonnegative integer execution
generations before persistence access. Missing records and malformed payloads fail
their BullMQ delivery visibly; stale generations and terminal jobs cannot invoke
the engine. Claims cannot exceed the persisted attempt budget. Calling `start()`
twice on one runner creates one consumer, and both runtime entry points register
Nest shutdown hooks to drain workers.

Every 30 seconds, each enabled worker inspects up to 100 recovery candidates,
paging by ID across successive scans so pending deliveries cannot starve later
records. QUEUED records older than 60 seconds whose exact BullMQ delivery is missing
or terminal become FAILED with `CONVERSION_QUEUE_DELIVERY_LOST`. An expired
PROCESSING record with missing or terminal delivery becomes FAILED with
`CONVERSION_WORKER_STALLED`. Pending deliveries remain under BullMQ's existing
stalled/retry policy. Updates compare status, generation and age/lease expiry;
Redis or MongoDB inspection failure never establishes that a delivery is missing.
Recovery requires an authorized manual retry and never automatically replays an
external tool. Legacy PROCESSING records without leases remain excluded.

Queue producers use one Redis request retry, a 3-second connection timeout and a
5-second command timeout; offline commands are disabled. Consumers retain Redis
reconnection. A rejected producer request is persisted as a queue failure; it must
not be presented as successfully scheduled. The screen FAILED hint is updated
only when MongoDB confirms that the current owner persisted the failure.

Existing documents require no backfill: a missing `executionGeneration` means
zero. Legacy PROCESSING documents without a lease are deliberately not reclaimed
automatically. They require explicit operator reconciliation after verifying that
the old worker has stopped; the queue screen must not guess that they timed out.

Execution has at-least-once semantics after a crash or lease expiry. Each adapter
attempt uses its own temporary directory, and stored results have unique storage
references, so a stale attempt cannot overwrite an accepted result. Only the
current lease can publish the persistent result. This does not guarantee that an
external tool with its own side effects runs exactly once.

The BMS/DSPF adapter accepts only files generated by the external converter. Empty
output or an unsuccessful process exit fails explicitly; the backend does not
parse source or synthesize replacement React components. A genuine successful
conversion still requires the separately supplied converter scripts or Java JAR.
Queue/worker plumbing tests using fixture output do not verify those algorithms.

`test/conversion-queue.real.integration-test.cjs` provides an opt-in native-process
integration harness. Build first, set `ALSM_QUEUE_REAL_TEST=owned-local-only`,
`ALSM_QUEUE_MONGOD` and `ALSM_QUEUE_REDIS` to absolute executable paths, then run
`node test/conversion-queue.real.integration-test.cjs`. It starts isolated loopback
Redis and MongoDB processes, uses a fixture engine, verifies competing workers,
an actual worker-process crash, retry generations and reconnect behavior, and
checks ownership before removing only its temporary data. Portable server
installation requires the owner's approval; the harness never installs services.

## Quality review and result availability

Quality-review reads, submissions, and result reads check the active project and
organization. Review submissions retain the existing OWNER/ADMIN/MEMBER policy,
persist the decision with compare-and-set conflict handling, and append audit.
Missing or unreadable generated files return `CONVERSION_RESULT_UNAVAILABLE`
(503), and cannot be accepted as a successful empty result or reviewed as if
output existed. Initial quality acceptance remains separate from official
export eligibility.

## Related Documentation

[`RULE.md`](../../../RULE.md) · [ADR-003](../../../docs/engineering/adr/ADR-003-external-conversion-tool-boundary.md) · [Worker template](../../../docs/engineering/folder-readme-templates/worker-README.md)
