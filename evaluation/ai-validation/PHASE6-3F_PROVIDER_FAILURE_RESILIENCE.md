# Phase 6.3F — provider failure resilience (offline implementation)

This change does not execute a benchmark or authorize a live pilot. No real Phase
6.3F campaign directory is created. Historical Phase 6.3D and 6.3E evidence remains
read-only, including ignored output and locks.

## Immutable campaign identity

The only supported reliability campaign is
`phase6-3f-gemini36-reliability-v1`. Its new checkpoint schema is v3, with
`providerFailurePolicy` on the immutable identity:

```json
{
  "version": 1,
  "mode": "CONTINUE_ON_TRANSIENT_PROVIDER_FAILURE",
  "runId": "phase6-3f-gemini36-reliability-v1"
}
```

The CLI requires explicit `--continue-on-transient-provider-failure`, together
with `--checkpoint`, `--all`, and `--expected-model-version gemini-3.6-flash`.
The existing two independent live opt-ins remain mandatory. The guard binds the
policy to the output run ID before creating a directory, lock or calling a
provider. Missing or altered policy and use under another run ID are rejected.

Frozen configuration: Gemini requested model and expected provider model version
are both `gemini-3.6-flash`; prompt is `semantic-cobol-java-v1`; retries 2;
timeout 60000 ms; maximum findings 50; minimum request interval 13000 ms;
maximum files 50; file characters 200000; total characters 500000; failFast false.
No adapter, retry, pacing, prompt, production DTO or matching change is made.

The manifest is read as bytes, never rewritten. Accepted SHA256 values:

| Encoding | SHA256 |
| --- | --- |
| CRLF | `bf51ea1f968a877c2b6393103c2a558d704d6e998f73d23de5086eab703c513e` |
| LF | `9fc4e66e83fd87c1f932b97eb5c5c5520f85dab0d1774b38dcc36820a4196a7a` |

Each checkpoint still pins its exact byte hash and parsed content hash. Even
equivalent JSON with extra whitespace, mixed line endings, or switching encodings
on resume is rejected. `storageFingerprint` and symlink checks remain in place.

## Decision matrix and precedence

| Terminal evidence | v3 action |
| --- | --- |
| `RATE_LIMITED` + `DAILY_QUOTA` | Existing quota branch runs first: pause, append one quota event, no terminal case and no index increment. Explicit new quota-window confirmation required to retry that case. |
| `SUCCESS` + exact `CONFIRMED` | Append and continue. |
| `PROVIDER_FAILED` + `UNKNOWN`, `SERVER_ERROR`, HTTP 500–599, original `AI_PROVIDER_UNAVAILABLE` | Append and continue only with complete safe diagnostics, exhausted retries and exactly 3 attempts. |
| `PROVIDER_FAILED` + `UNKNOWN`, `NETWORK_ERROR`, no HTTP status, `AI_PROVIDER_UNAVAILABLE` | Same exhausted-retry requirements; append and continue. |
| `PROVIDER_FAILED` + `UNKNOWN`, `TIMEOUT`, no HTTP status, `AI_PROVIDER_TIMEOUT` | Same exhausted-retry requirements; append and continue. |
| Short-window or unknown-scope HTTP 429 | Persist terminal failure, stop `PROVENANCE_REVIEW`; not allowlisted in policy version 1. |
| Successful response without model version; any mismatch | Persist original result, stop `PROVENANCE_REVIEW`. |
| Auth 401/403, rejected request, refused response, invalid output, validation failure, missing/invalid diagnostics | Persist sanitized terminal result, stop `PROVENANCE_REVIEW`. In v3 this also stops failed outputs with confirmed provenance. |
| Timeout after an HTTP status was observed, non-exhausted retry budget, contradictory code/class/status | Stop pending review; no inference of infrastructure eligibility. |

Eligible failures require an absent observation and a requested model matching
the immutable identity; they must have no rate-limit scope. Error-body model
versions are not trusted. The policy never changes `UNKNOWN` to `CONFIRMED`,
never changes `PROVIDER_FAILED` to `SUCCESS`, and never fabricates observations.
Allowlisted diagnostics contain only failure class, status, attempts, exhaustion,
latency and rate-limit scope. Arbitrary provider payloads are not retained.

The same decision function is used for append, resume, final materialization and
CLI reporting. A disallowed result is a permanent automatic-resume blocker. At
case 40 it is durably saved as READY, index 40, `PROVENANCE_REVIEW`; no predictions
file is created. Validation rejects continuation past a v3 review boundary.

`--max-new-cases` counts newly appended terminal cases, including eligible provider
failures, not successful cases or HTTP attempts. For a cap of 2, success on case 1
and exhausted 503 on case 2 consume the session; the next session starts at case
3. Daily quota consumes no terminal slot. Terminal results and closed sessions
remain append-only. Between-case recovery closes the interrupted session;
IN_PROGRESS and stale locks still refuse automatic takeover or replay.

## Compatibility and reporting

Legacy v1 has no provenance policy. v2 has the original model provenance policy.
Both retain their serialized prediction identity and original behavior, with no
backfill or automatic migration. Neither can accept a reliability policy while
resuming; v3 cannot remove it or change schema. Both historical run IDs are
explicitly denied by the store before filesystem writes, including resume.

Only v3 predictions carry the additional strict, versioned provider failure
policy; legacy prediction payloads remain accepted. The strict model verifier is
unchanged. Forty terminal cases including an eligible failure may materialize a
reliability evaluation, but do not establish a verified 40-case model cohort.

Final prediction validation and report provenance summarization also apply the
shared policy classifier directly, using the frozen campaign retry settings.
Manually supplied v3 predictions cannot bypass the allowlist. Checkpoint evidence
validation remains separate: blocked terminal results still round-trip unchanged
for review. In particular, case 40 with INVALID_OUTPUT + CONFIRMED is persisted
as READY / PROVENANCE_REVIEW, cannot materialize predictions or resume, and cannot
make the CLI print a verified final cohort. For v3 the CLI requires COMPLETE state,
a COMPLETE session stop reason, no policy blocker, and all 40 confirmed cases.

Reports distinguish terminal coverage, SUCCESS count, provider failure rate over
terminal cases, failure counts by sanitized class and HTTP status, per-case
attempts, and confirmed/unknown/mismatch counts. The cohort is verified only if
all 40 observations are confirmed. CLI prints `NO — UNVERIFIED` for a completed
mixed cohort and distinguishes continuable `PROVIDER_FAILED UNKNOWN` from review
blockers. COMPLETE means execution coverage, not successful validation or model
identity. Reporting missing cases remains explicit for partial evidence.

Successful-only and conservative semantic equations and matching are unchanged;
tests compare both metric sets with the same outcomes stripped of provenance.
Provider availability, model identity evidence and semantic quality must be
interpreted separately. Model versions are provider self-reports, not attestation.

## Offline verification

`test/ai-evaluation-provider-resilience.spec.ts` uses mocked Gemini HTTP and
mkdtemp-owned stores. No real provider credentials or network requests are used.
Test transport pacing is disabled only in its local adapter fixture while the
identity retains frozen settings. Legacy test processes can override inherited
`GEMINI_MIN_REQUEST_INTERVAL_MS=0` using try/finally; runtime settings remain 13000.

Coverage includes exhausted 503 with next-case continuation and session caps,
network/timeout, quota pause/resume, unapproved error classes, absent/mismatched
model versions, complete mixed and fully confirmed cohorts, the 40th result,
final-output replay prevention, identity/result tampering, legacy round-trips,
protected temporary path fixtures, interrupted sessions, stale locks, strict CLI
opt-in and actual CLI reporting through a mocked validator factory.

Validation commands: targeted Jest suites, full `npm test -- --runInBand`,
`npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check`.
Validated on 2026-10-12:

- Targeted four suites after final-validation review fixes: 166 passed, zero skipped or failed.
- Full offline Jest after review fixes: 78 suites passed, one suite skipped; 803 tests passed,
  44 skipped, zero failed. The existing MongoDB integration suite is opt-in via
  `LEGACY_VALIDATION_TEST_MONGODB_URI` and was not enabled.
- Lint, TypeScript `--noEmit`, Nest build and `git diff --check`: passed.
- Post-test checkpoint hashes match the table below; their states remain READY,
  with nextIndex/results 27/27 and 2/2 respectively, both with zero quota events.
- Real `results/multiday/phase6-3f-gemini36-reliability-v1` remains absent.
- Frozen manifest bytes still have the CRLF hash above.

The existing live-runner regression test now compares all earlier scoring fields
unchanged while separately asserting newly reported reliability diagnostics.
No production `src/` file is modified. All provider requests in these tests are
mocked; no pilot or real benchmark was run.

## Changed-file inventory and local delivery

New files:

- `evaluation/ai-validation/src/provider-failure-policy.ts`
- `evaluation/ai-validation/src/phase6-3f-campaign.ts`
- `test/ai-evaluation-provider-resilience.spec.ts`
- `evaluation/ai-validation/PHASE6-3F_PROVIDER_FAILURE_RESILIENCE.md`

Modified files:

- `evaluation/ai-validation/src/multiday-checkpoint.ts`
- `evaluation/ai-validation/src/multiday-runner.ts`
- `evaluation/ai-validation/src/multiday-store.ts`
- `evaluation/ai-validation/src/model-provenance.ts`
- `evaluation/ai-validation/src/live-run.cli.ts`
- `evaluation/ai-validation/src/evaluation.types.ts`
- `evaluation/ai-validation/src/evaluation.validator.ts`
- `evaluation/ai-validation/src/evaluation.scorer.ts`
- `evaluation/ai-validation/src/evaluation.report.ts`
- `test/ai-evaluation-live-runner.spec.ts`

Branch: `feat/phase6-3f-provider-failure-resilience`, based on synchronized develop
`35e0d6fcbb819a268fe969a257d557576484c3be`. Delivery is a local commit only;
no push, PR, merge, tag or Jira action.

With explicit user authorization, the sole untracked implementation prompt was
moved with PowerShell `Move-Item` to
`E:\ALSM\ALSM_Phase6_3F_Codex_Implementation_Prompt.md` before creating the branch.
The destination did not exist and was not overwritten. Its SHA256 before and
after the move, and again after testing, is
`19D206D49EC8DB3656EC9B7EECCD75792885A948A3582952875C0661AE92A7B0`.
Git was clean before branch creation. The prompt is not included in the commit.

Protected checkpoint SHA256 values checked before implementation and after tests:

| Checkpoint | SHA256 |
| --- | --- |
| 6.3D | `C2C350591F351C73A0672B730340A87F8075AA3429BC4961C7E4112E0C00C3E4` |
| 6.3E | `6BC6EAB24A8CC5D47F43AAEA71AACD86703B913E2FF034ED630C1434E3632209` |

## Future one-case pilot proposal — not executed

After independent review and explicit live-run authorization, recheck Git,
protected hashes, absent/new output directory, frozen manifest and configuration.
Propose a single invocation for the new run ID with `--all --max-new-cases 1`,
the explicit policy flag, expected model version, and both existing live opt-ins.
Inspect the resulting checkpoint, original status, safe diagnostics, provenance,
and session stop reason before separately authorizing more cases. Never resume
or modify either historical campaign. A quota pause still needs a separately
confirmed quota window. This proposal grants no permission to execute it.

Residual limits: policy v1 intentionally stops short-window 429 and ambiguous
timeouts; transient cases remain terminal and are not retried in later sessions;
unverified outcomes limit model attribution. Offline mocks cannot establish
actual provider availability or version-reporting behavior. Windows retains the
existing file-fsync/atomic-rename design without portable directory fsync.
