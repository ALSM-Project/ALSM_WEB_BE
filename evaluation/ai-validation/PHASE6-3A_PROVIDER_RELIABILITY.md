# Phase 6.3A: Gemini provider reliability diagnostics

## Base and scope

Base develop: `9f1bc6893b706ebae1ac97ee74aa904e9aefa5e0` (local HEAD and
origin/develop matched after fetch and fast-forward pull).
Branch: `feature/ai-validation-phase6-3a-provider-reliability`.
The starting working tree was clean. Source audit was completed before implementation.

Phase 6.2C remains 18 SUCCESS, 22 PROVIDER_FAILED, 0 VALIDATION_FAILED,
0 INVALID_OUTPUT across 40 cases. Its evidence does not distinguish the 22 causes
or record their attempt counts. Do not infer that they were all rate limits.
The committed baseline and frozen dataset were not edited or rerun.

## Source audit before changes

Inspected GeminiAiValidatorAdapter, AiValidatorError, OpenAiValidatorAdapter,
live-runner, live-run.cli, evaluation types/validator/scorer, environment validation,
live-validator.factory, and ExecuteAiValidationService.
GitNexus search had missing full-text indexes and could not resolve the adapter;
direct source inspection supplied the audit evidence.

| Cause | Gemini public code | Retry? | Live evaluation status |
| --- | --- | --- | --- |
| HTTP 401 / 403 | AI_PROVIDER_AUTHENTICATION_FAILED | No | PROVIDER_FAILED |
| HTTP 400 / other non-transient rejection | AI_PROVIDER_REQUEST_REJECTED | No | PROVIDER_FAILED |
| HTTP 429 | AI_PROVIDER_UNAVAILABLE | Yes | PROVIDER_FAILED |
| HTTP 5xx | AI_PROVIDER_UNAVAILABLE | Yes | PROVIDER_FAILED |
| AbortController timeout, including response body read | AI_PROVIDER_TIMEOUT | Yes | PROVIDER_FAILED |
| Fetch exception without controller timeout | AI_PROVIDER_UNAVAILABLE | Yes | PROVIDER_FAILED |
| Prompt block or SAFETY / BLOCKLIST / PROHIBITED_CONTENT finish | AI_PROVIDER_REFUSED | No | PROVIDER_FAILED |
| Provider envelope JSON parse failure | AI_PROVIDER_RESPONSE_INVALID | No | INVALID_OUTPUT |
| Candidate text is invalid JSON | AI_PROVIDER_RESPONSE_INVALID | No | INVALID_OUTPUT |
| Invalid ALSM structured output | AI_PROVIDER_RESPONSE_INVALID | No | INVALID_OUTPUT |

The original HTTP retry condition is literally `status === 429 || status >= 500`.
A non-abort body-reader rejection also enters the envelope-invalid path, rather
than the fetch/network path. These existing decisions are unchanged.
Unexpected non-AiValidatorError exceptions reaching the live runner are sanitized
to AI_PROVIDER_UNAVAILABLE / PROVIDER_FAILED. For example, a JSON-null envelope
can cause a TypeError in the existing extraction code; runtime output validation
was deliberately not changed in this observability phase.

AiValidatorError previously retained only code, message, name, and the normal
Error stack. The runner persisted code/message plus whole-case latency, with no
cause, HTTP status, attempt count, or exhaustion metadata. The CLI serializes
that prediction object to predictions.json. The scorer uses case status and
findings, not the failure message. Product execution reads code/message and its
existing timeout/unavailable retryability flag.

OpenAI has the same bounded retry loop, delays, HTTP/authentication mappings,
timeout and network mappings. Its response extraction recognizes refusal parts
and requires a completed response. OpenAI implementation and behavior are unchanged.

## Retry policy audit (unchanged)

- Runtime environment and live factory default AI_MAX_RETRIES to 2. The runtime
  schema allows 0 through 5; the adapter independently clamps to that interval.
- Attempts are numbered internally from 0 through maxRetries, inclusive:
  one initial request plus up to maxRetries additional requests. Default maximum
  is 3 attempts; hard maximum is 6. Permanent failures stop immediately; success
  can stop earlier. Historical exact attempts cannot be reconstructed.
- Before each retry, wait `min(50 * 2 ** attempt, 500)` milliseconds:
  50, 100, 200, 400, 500. Default total wait is 150 ms; hard-maximum total is 1250 ms.
  There is no jitter, no wait after the terminal attempt, and no Retry-After parsing.
- HTTP 429, HTTP 5xx, controller timeout, and fetch exceptions are retryable.
  HTTP 429 and 503 receive identical timing. Each attempt creates its own timeout;
  default AI_TIMEOUT_MS is 60000. There is no separate overall deadline.
- Phase 6.2C did not freeze retry configuration or attempt history, so configured
  defaults are not evidence of the actual setting used for every historical request.

Finding: Retry-After is ignored and the waits are very short. This is a concrete
policy limitation, demonstrated with synthetic Retry-After=120 responses, but
not proof of the cause of the historical failures. No retry-count/off-by-one bug
was found. This phase changes observability only: no retry behavior was changed.

## Diagnostic contract

An optional, immutable, non-enumerable AiValidatorError.diagnostics contains:

- finalFailureClass: RATE_LIMITED, SERVER_ERROR, TIMEOUT, NETWORK_ERROR,
  AUTHENTICATION_FAILED, REQUEST_REJECTED, REFUSED, or INVALID_OUTPUT.
- httpStatus: optional numeric integer 100..599 from the final response only.
  Omitted when no response was received. A timeout during body reading can carry 200.
- attempts: number of fetch attempts actually started (1..6).
- retriesExhausted: true if a retryable failure consumes the configured attempt
  budget, including a budget of zero retries. False for permanent failures, even
  when they occur on the last allowed attempt. Exhaustion is a separate boolean
  so it never hides the final cause behind a generic RETRY_EXHAUSTED class.
- totalLatencyMs: elapsed validation time, including attempts and backoff,
  clamped to zero if the wall clock moves backwards. Existing case latencyMs still
  includes context preparation and evaluation mapping as before.

Each call keeps its own attempt state. A later network exception does not retain
an earlier HTTP failure status. Refusal and invalid output after a successful
transport retain the number of attempts preceding that transport response.
Successful results retain the original AiValidatorPort result shape; this phase
does not add success-attempt telemetry or modify the port.

The runner explicitly copies safe metadata to optional failure.diagnostics.
Both the error constructor and runner copy allowlisted primitives, never spread
arbitrary diagnostic objects. Prediction validation rejects unknown diagnostic
fields, unknown classes, nonnumeric HTTP statuses, and invalid counts/latencies.
No keys, headers, request bodies, prompts, fixture source, generated Java,
provider bodies, or raw exception text are added to diagnostics or logs.
HTTP error bodies are not read. Existing successful finding serialization is unchanged.

## Compatibility and verification

Public error.code/error.message and product behavior are unchanged. Old two-argument
AiValidatorError calls still work; their serialized shape is unchanged.
OpenAI, Human Review, semantic prompts, model selection, Gemini schema compatibility,
canonical output schema, runtime output validator, matching, categories, labels,
expected findings, RAG, and fine-tuning are unchanged.

Optional prediction metadata permits historical files to validate and score.
Unit tests compare scoring with and without diagnostics and verify failures remain
failures. Deterministic fake-timer tests exercise HTTP 429/500/503, 400/401/403,
fetch and body timeouts, network exceptions, retry caps/exhaustion, final-cause
selection, refusal, malformed provider JSON, and invalid ALSM output.

Validation results:

- npm ci: passed; npm reported 12 dependency vulnerabilities (4 moderate, 7 high,
  1 critical). Dependencies were not changed and no audit fix was run.
- npm run lint: passed.
- npm run test: 72 suites, 524 tests passed.
- npm run build: passed.
- npm run test:e2e: exit 0; no e2e tests found (script permits this).
- Dataset validation: passed, all 40 cases (10 clean, 30 mutated).
- Import validation: passed, 143 COBOL_JAVATRANS and 12 AWS_CARDDEMO candidates.
- Git blob checks: all five tracked files across the frozen baseline and dataset
  directories match the base commit.
- Historical local predictions SHA-256 still matches frozen run metadata:
  d9cfaa3627c55c035814b4978e273dc2960255b39b71e33f6a1e9f10d937d02f.
- Read-only offline validation/recomputation from those historical predictions
  reproduced all frozen metrics snapshot sections, including counts and latency.
  No baseline output was written or replaced. No live request was made.

## Recommendation

Next phase: A, retry/backoff improvement, with a separately reviewed bounded
policy and diagnostic evidence before choosing waits. The 22/40 provider failures
make reliability the immediate constraint. This does not establish rate limiting
as their cause or justify automatically increasing retries. Semantic FP/FN
analysis can follow; no new model metrics were collected here.
