# Phase 6.3B: Gemini quota-aware reliability

Base: develop `659e99de3c3b98b7f4cb1a8b146710675583403d` (Phase 6.3A / PR #48).
Branch: `feature/ai-validation-phase6-3b-gemini-quota-aware-reliability`.

## Audit completed before implementation

Inspected the Gemini adapter, diagnostics sanitizer, AiValidatorError, Joi environment
validation, live evaluation factory, runner, CLI, and Phase 6.3A tests. Defaults were
AI_MAX_RETRIES=2 (3 attempts), capped at 5 retries (6 attempts). Both 429 and 5xx used
50/100/200/400/500 ms delays without jitter. Retry-After was ignored; HTTP error bodies
were not read. 429 was RATE_LIMITED. Final status, attempts, exhaustion, and total
latency were already safely retained. The live factory builds ConfigService directly,
so the new pacing setting is validated there as well as in application configuration.
The runner uses one adapter sequentially; the product uses a singleton adapter.

## Provider contract and limits

The user manually verified the CURRENT ALSM AI Studio project/tier for gemini-3.5-flash:
5 RPM, 250,000 input TPM, 20 RPD. These are observations, not universal Gemini constants.
No model or quota numbers are hardcoded into the generic adapter.

Sources audited on 2026-10-06:

- [Google rate limits](https://ai.google.dev/gemini-api/docs/rate-limits): project-level
  RPM/TPM/RPD, varying by model/tier; a 429 alone cannot identify the exhausted limit.
- [Google RPC error details contract](https://github.com/googleapis/googleapis/blob/master/google/rpc/error_details.proto):
  typed QuotaFailure violations carry quota identifiers, independently of message text.
- [First-hand REST error evidence in Google's kubectl-ai repository](https://github.com/GoogleCloudPlatform/kubectl-ai/issues/332):
  reported machine-readable quotaId values for daily requests, daily input tokens,
  minute requests and minute input tokens. This is observed provider evidence, not
  a promise that all future Gemini errors will contain these fields or identifiers.
- [Google troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting):
  transient failures warrant exponential backoff.
- [RFC 9110 Retry-After](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after):
  delta seconds or HTTP date. No official guarantee was found that Gemini always
  returns this header. No ALSM live call was made to inspect headers.

Only HTTP 429 bodies are parsed in memory. Classification requires error.status
RESOURCE_EXHAUSTED and a type.googleapis.com/google.rpc.QuotaFailure detail.
The exact quotaId allowlist is:

| Identifier | Scope |
| --- | --- |
| GenerateRequestsPerDayPerProjectPerModel-FreeTier | DAILY_QUOTA |
| GenerateRequestsPerDayPerProjectPerModel | DAILY_QUOTA |
| GenerateContentInputTokensPerModelPerDay-FreeTier | DAILY_QUOTA |
| GenerateRequestsPerMinutePerProjectPerModel-FreeTier | SHORT_WINDOW |
| GenerateContentInputTokensPerModelPerMinute-FreeTier | SHORT_WINDOW |

A recognized daily violation wins over simultaneous minute violations. SHORT_WINDOW
requires all reported quota violations to be recognized minute identifiers. Missing,
malformed, unrecognized, or unreadable evidence yields UNKNOWN. No substring matching,
provider message parsing, quota-value inference, or assumption based only on 429.
New provider IDs require explicit review; paid tiers are not assumed to use these IDs.
RetryInfo text/durations are not used as a substitute for quota scope or Retry-After.

## Retry policy

- Retry count is unchanged: default 2, hard maximum 5 (3/6 total attempts).
- 429 SHORT_WINDOW and UNKNOWN, HTTP 5xx, timeout, and transient fetch errors remain
  retryable. A known DAILY_QUOTA stops immediately, even with a short Retry-After.
- 400, 401, 403, other nonretryable HTTP responses, refusal, and invalid structured
  output are not transport-retried. Public codes and sanitized messages are unchanged.
- Fallback: floor(1000 * 2^retryIndex * (1 + random * 0.25)), capped at 8000 ms.
  Ranges are 1000–1250, 2000–2500, 4000–5000, 8000, 8000 ms (upper jitter endpoint
  approached with Math.random). Randomness and timers are mocked in deterministic tests.
- Valid Retry-After overrides fallback on retryable HTTP errors. Integer seconds and
  all three HTTP-date formats are accepted. Negative/past, malformed, nonfinite,
  impossible dates and non-HTTP date strings are rejected. No raw header is retained.
- Cumulative explicit retry-delay budget: 30,000 ms per validate call. A valid provider
  wait larger than the remaining budget ends the cycle; it is never shortened.
  No next-day wait. retriesExhausted remains the Phase 6.3A *attempt-count* indicator:
  false for an early daily-quota or wait-budget stop; true only when a retryable failure
  consumes the configured attempts. No new diagnostic field is needed for wait values.
- Pacing and request execution time are separate from the retry-delay budget. Each
  HTTP attempt retains AI_TIMEOUT_MS; it starts only after pacing admission. Total
  latency includes queueing, pacing, retry delays and HTTP execution.

## Optional pacing

GEMINI_MIN_REQUEST_INTERVAL_MS is an integer 0..60000, default 0 (disabled), in both
application environment validation and evaluation live factory. For the currently
observed ALSM 5 RPM tier recommend 13000 ms, above the mathematical 12000 ms boundary.
Setting it does not authorize a live run or alter existing live CLI opt-in safeguards.

An adapter-level promise queue serializes actual HTTP starts, including retries and
concurrent validate calls, while responses may overlap. The next start is based on the
previous actual start using a monotonic clock, not pre-reserved slots that could collapse
after event-loop delay. Timer rounding is checked again before admission.
Concurrent callers queue; queue latency grows with caller count. Keep evaluation
sequential as it is today. A singleton adapter shares this gate in one application
process. Independent adapter instances, other Gemini clients and multiple processes
do not share it. There is no distributed/global quota guarantee or TPM limiter. No
Redis limiter was added; the existing Redis integration is queue infrastructure.

## Daily request budget

A 40-case benchmark cannot complete in one quota day on a 20-RPD tier when every case
requires at least one provider request. Retries consume additional requests and make
the budget worse. Pacing cannot repair daily quota exhaustion. This phase does not
track daily usage, persist cooldowns, resume across days, or suppress later independent
validation calls. Existing worker job retry policy is unchanged; daily classification
terminates this adapter invocation's transport attempts only. Operators should stop
evaluation on failure using the existing fail-fast option and plan the daily budget.

## Security and compatibility

Only optional rateLimitScope (SHORT_WINDOW / DAILY_QUOTA / UNKNOWN) extends diagnostics.
All Phase 6.3A fields remain; old predictions are accepted, scoring is identical, and
the public result/error serialization is unchanged. The sanitizer copies only closed
enum/numeric/boolean primitives. Provider bodies, messages, quota dimensions, keys,
headers, prompts, source, and generated Java are never retained in diagnostics/logs.
The temporary parsed error body is discarded after classification; no raw error fixture
or provider payload is stored. Test payloads use synthetic markers.

OpenAI, Gemini model, prompt, structured-output compatibility (maxItems), canonical
schema, runtime validation, labels, scorer, matching tolerance, Product Human Review,
RAG and fine-tuning are unchanged. The frozen Phase 6.2C baseline stays 40 total,
18 SUCCESS / 22 PROVIDER_FAILED. This phase does not claim those failures were all 429.

## Verification

NO LIVE GEMINI CALLS. No benchmark rerun. Deterministic mocked HTTP tests cover header
forms/rejection, allowlisted scope, budgets, delays/jitter, attempt exhaustion, server
failures, network/timeouts, permanent failures, concurrency, disabled pacing, and leakage.
Final validation results:

- npm ci: passed; 12 existing audit findings (4 moderate, 7 high, 1 critical).
  No dependencies changed; no audit fix command was run.
- npm run lint: passed.
- npm run test: 73 suites, 580 tests passed.
- npm run build: passed.
- npm run test:e2e: exit 0; no e2e tests found (script permits this).
- Dataset validation: all 40 cases valid (10 clean, 30 mutated), no provider execution.
- Import validation: 143 COBOL_JAVATRANS and 12 AWS_CARDDEMO candidates valid.
- All five tracked frozen baseline/dataset files match the base checkout byte for byte
  (Git checkout filters applied for the repository's CRLF convention).
- Historical predictions SHA-256 remains
  d9cfaa3627c55c035814b4978e273dc2960255b39b71e33f6a1e9f10d937d02f.
- Read-only validation/scoring of existing predictions reproduces every frozen metrics
  snapshot section. No baseline output was written or replaced.
- Security diff review: no secret values, raw provider payloads, prompts, source fixture
  contents, generated Java, or environment dumps introduced. No new runtime logging.

Next separate phase recommended: A. Multi-day quota-safe benchmark execution.
Not started in Phase 6.3B.
