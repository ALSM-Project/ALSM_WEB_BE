# Application AI integration delivery — 2026-11-09

Implemented locally under explicit application-only owner authorization. No live
AI calls, real credential access, pushes, merges, rebases or PRs were performed.
Safe template defaults remain `AI_VALIDATION_ENABLED=false`, `AI_PROVIDER=fake`
and `AI_EVAL_ALLOW_LIVE_PROVIDER=false`. Normal application AI remains independently
configurable with each developer's private backend key; research activation is
neither needed nor authorized.

## Branches and reviewed extraction

Remote refs were refreshed with `git fetch --no-tags origin` in both repositories.
Separate worktrees leave the original checkouts intact:

| Repository | Local branch / worktree | Refreshed base |
| --- | --- | --- |
| Backend | `feat/application-ai-local-development`, `E:\ALSM\ALSM_WEB_BE_APP_AI` | `origin/develop` `8bdd5845e19da54396d48e9f7767bca5c22d1f9d` |
| FE1 | `feat/application-ai-outcome-display`, `E:\ALSM\ALSM_WEB_FE_1_APP_AI` | `origin/develop` `e0a75402d281ae4bd755e528ede7293f2f158f15` |

Application-only historical commits were reviewed and cherry-picked with source
attribution, without merging the D3K branch:

- `e0847cd` → `cb1bd1d`: isolate COBOL prompt selection, including the existing OpenAI adapter.
- `51b9639` → `8f02121`: shared redaction/limits/line numbering, safe paths and strict BMS output validation.
- `d605a03` → `b6622de`: persist execution provenance; label BMS fallback and RULE findings accurately.
- `60a27a2d439343020371da79ad94722f53bda8c8`: application Gemini transport, bounded retries and replay prevention.
- FE1 `ef43718fee7c4044be02daa68f23cd1fc2607630`: outcome rendering and save-before-validation.

This report and the setup/template updates form a separate backend documentation
commit. Use `git log --oneline origin/develop..HEAD` in each worktree for the exact
review series. Neither branch has been published; maintainers must separately
review/integrate them before developers can pull these changes from GitHub.

## Backend behavior

- `GeminiJsonClient` contains the existing Gemini retry/classification/schema
  transport, reused by both semantic validators. NestJS supplies one shared client
  for process-local request-start pacing. There is no new runtime or research dependency.
- `GEMINI_MODEL` selects exactly one model. `GEMINI_ALLOWED_MODELS` is the reviewed,
  comma-separated allowlist, defaulting to the template's `gemini-3.5-flash`.
  Invalid/unapproved selections fail before HTTP. Hidden alternate models and
  automatic `latest` substitution were removed from BMS.
- Both validators honor `AI_TIMEOUT_MS` per HTTP attempt, `AI_MAX_RETRIES` (0–5
  additional attempts), and `GEMINI_MIN_REQUEST_INTERVAL_MS`. Header authentication
  keeps the key out of URLs. Raw provider errors/bodies are not logged or persisted.
- A known daily quota produces `AI_PROVIDER_DAILY_QUOTA_EXCEEDED` and one request.
  Other provider failures retain safe classification. Adapter provider errors are
  nonretryable at the queue boundary, so BullMQ cannot multiply adapter budgets.
- `claimProviderExecution` atomically sets `providerExecutionStartedAt`, scoped by
  run/project/organization/status, with majority+journal acknowledgment before
  adapter execution. Redelivery after an uncertain result write fails closed with
  `VALIDATION_PROVIDER_EXECUTION_UNCONFIRMED`; stored results reconcile without
  dispatch. Active-run uniqueness and BullMQ job-ID deduplication remain unchanged.
- BMS keeps heuristic fallback and stores its outcome/failure code. COBOL keeps
  failed-run behavior. Successful accepted output persists provider/model/version
  provenance. Existing COBOL adapter result shape/wait behavior was preserved.
- The legacy Phase 6.3E fake-HTTP provenance test adds only an explicit allowlist
  for its two existing synthetic selections, preserving its drift assertion. No
  evaluation implementation, prompt, dataset, result or D3 test was changed.

An interrupted execution can require review even if HTTP had not started. This
choice avoids automatic duplicate calls; it is not provider-side exactly-once
execution and cannot compensate for loss/restoration of database durable state.

## Frontend and setup

FE1 types include `executionOutcome`, `resultProvider`, `resultModel`,
`modelVersion`, and `providerFailureCode`. A shared notice in conversion and review
pages distinguishes provider success, heuristic fallback, heuristic-only runs,
failures and historical records without provenance. Configured provider/model
labels are distinguished from actual result metadata. Zero findings no longer
claim a passing semantic-equivalence check; heuristic suggestions are not labeled
as AI fixes.

Save-and-validate now requires a successful save, with an in-flight save guard.
A failed save requests no validation. Existing mutation retry=false and backend
deduplication are retained.

The [developer guide](local-ai-development.md) covers FE1, NestJS, single-consumer
workers, MongoDB replica set, Redis, both converter repos/JAR, backend-only keys,
origin-only `VITE_API_BASE_URL`, JWT/MFA, quota/error handling and smoke-test limits.
`.env.example` includes allowlist/pacing/retry documentation and the sibling Java
JAR path. Private `.env.*` variants are ignored with explicit example exceptions.

## Verification

| Check | Result |
| --- | --- |
| Backend full `npm run test:offline` | 165 suites / 1,993 tests passed; 6 suites / 206 tests skipped by existing gates |
| Provider/worker security matrix | 13 tests passed using closed fake HTTP and synthetic credentials |
| Backend `npm run lint` | Passed, zero warnings |
| Backend `tsc --noEmit` | Passed |
| Backend `npm run build` | Passed |
| FE1 full Vitest | 41 files / 246 tests passed |
| FE1 final focused UI checks | 3 files / 36 tests passed after final metadata-label refinement |
| FE1 lint / build (includes typecheck) | Passed; existing lint warnings and bundle-size warning remain |
| Diff whitespace checks | Passed in both repositories |
| Backend changed-file key/private-key pattern scan | No matches; provider template keys are empty |

The security matrix covers configured request limits for both adapters; approved
and rejected model selection; no key in URLs; header authentication; shared pacing;
daily quota; bounded timeout; sanitized errors; BMS fallback provenance; no queue
retry multiplication; and no redispatch after interrupted result writes. Existing
input-redaction, output-validation, queue-deduplication and compatibility suites
also pass. FE tests cover all outcome states and zero calls following failed saves.

The offline runner whitelists nonsecret OS environment fields, excludes inherited
private settings, fixes test pacing and blocks unmocked fetch/provider HTTP before
tests install fake transports. No private `.env` was opened or copied into either
worktree. The scan covers changed files, not the full repository history.

## Preservation and remaining prerequisites

- Original D3K checkout remains clean at
  `1f6d31b33bdfa733ea36f67bd2ffdc25a2f10cec`; its tracked evaluation tree is
  `d43c102050c792858dd2a4c6cf8fe9f1dda9bbfc`.
- Backend comparison against its application base shows no changes under
  `evaluation/`, to prompt source files, or to `test/cobol-gemini-*`. Historical
  datasets/results and the native research boundary were not modified or activated.
- Original FE1 checkout remains clean at `4480cf70d1db1d97cc97530866baba40b03393d1`.
- Real MongoDB/Redis/converter execution and a live application smoke test were not
  performed. Six gated backend suites remain skipped. On this host `python` is a
  nonworking Windows Store alias; converter checkout/default JAR paths are absent.
  Java/Maven/Docker commands are on PATH, but required versions/service readiness
  still need developer verification.
- Each developer must privately configure valid credentials, an available reviewed
  model, Google project quota/billing constraints and application authentication.
  Keys in one Google project share quota. No Free Tier entitlement was assumed or tested.
- Dependency installation reported existing audit findings: backend 31 (2 critical),
  FE1 8. No dependency upgrades or automatic audit fixes were made in this scope.

Before any real-provider smoke test, separately approve that test, review/integrate
both application branches, complete the local prerequisites, and agree on synthetic
inputs and a small request budget. Neither implementation approval nor these test
results grant provider execution, spending, Paid Tier, research activation, owner
trust/key administration or publication authority.
