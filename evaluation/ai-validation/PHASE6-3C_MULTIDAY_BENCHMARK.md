# Phase 6.3C: Multi-day quota-safe benchmark tooling

Base develop: `2991cb14f30a6ec59b4b93257b7fb117bfecbde9` (Phase 6.3B merged via PR #49).
Branch: `feature/ai-validation-phase6-3c-multiday-benchmark`.
This phase implements tooling and fake-provider tests only. NO LIVE GEMINI CALLS.
NO LIVE OPENAI CALLS. NO BENCHMARK EXECUTED. No new model metrics or baseline evidence.

## Audit before implementation

The existing live runner accumulates predictions in memory. The CLI writes predictions.json
only after the selected run finishes; there was no incremental durability or resume support.
Exactly one of --case, --limit, --all selects the run; fail-fast records the failure and stops.
The CLI requires AI_EVAL_ALLOW_LIVE_PROVIDER=true AND --allow-live-provider. The existing
prediction validator accepts partial selections; the scorer accounts for missing cases.
Neither is changed. Existing ordinary runs retain their selection/fail-fast behavior.

The new mode reuses runLiveBenchmark for each case, the existing context preparation,
Gemini adapter, runtime validation, safe diagnostics and final prediction schema. It is
restricted to Gemini and a full 40-case dataset. OpenAI and the ordinary runner are unchanged.
Only the reserved multiday output namespace is forbidden to ordinary non-checkpoint runs.

Existing .gitignore already excludes evaluation/ai-validation/results/. No new ignore rule,
package script, dependency, schema, prompt, model, label, matcher, scorer, Human Review,
RAG or fine-tuning change is needed. Phase 6.2C and 6.3A/6.3B historical documents are untouched.

The raw manifest SHA-256 was independently verified as:
BF51EA1F968A877C2B6393103C2A558D704D6E998F73D23DE5086EAB703C513E.
It matches the supplied reference. Byte fingerprints are strict, including line endings.

## Why multiple sessions are necessary

CURRENT ALSM project observations: 5 RPM, 250,000 input TPM, 20 RPD. These are not universal
Gemini constants. Forty cases requiring at least one request each cannot fit into a 20-RPD
quota day. Retries consume additional requests. Pacing cannot solve RPD exhaustion.
This tool does not count/reset daily quotas, infer provider reset time, or sleep until tomorrow.

## Identity and compatibility

Checkpoint schema version 1 contains an immutable identity:

- Dataset ID, version, raw manifest SHA-256, parsed-content SHA-256 and all 40 ordered case IDs.
- Provider, resolved model and promptVersion from adapter metadata; model name is not hardcoded.
- Evaluator version, matching-policy version and location tolerance from existing constants.
- Execution policy version gemini-multiday-v1 and failFast policy.
- AI_MAX_RETRIES, AI_TIMEOUT_MS, AI_MAX_FINDINGS, GEMINI_MIN_REQUEST_INTERVAL_MS,
  AI_MAX_FILES, AI_MAX_FILE_CHARS and AI_MAX_TOTAL_CHARS, validated against current application bounds.
- Storage fingerprint: SHA-256 of the resolved checkpoint location, without storing its path.

Resume rejects any mismatch. Changes to case contents, expected findings, count or order alter
the dataset fingerprints. A mismatch reports the safe field name, never its raw value.
Relevant future implementation changes must bump executionPolicyVersion; metadata versioning
must track any future prompt/schema/provider policy changes. This is local reproducibility
control, not a provider guarantee that an externally hosted model never changes.

Other checkpoint fields: createdAt, updatedAt, state, nextIndex, terminal result prefix,
session ledger and quota events. Unknown fields, malformed identity/diagnostics, duplicate
or out-of-order results, inconsistent indices/sessions, missing quota events and incomplete
COMPLETE states are rejected. There is no automatic corruption repair.

## State machine and immutable terminal results

READY -> IN_PROGRESS before executing the next manifest case.
IN_PROGRESS -> READY after a terminal result, or COMPLETE after the 40th result.
IN_PROGRESS -> PAUSED_DAILY_QUOTA when the exact daily boundary is observed.
PAUSED_DAILY_QUOTA -> IN_PROGRESS of the same case only in a new confirmed session.
Stale IN_PROGRESS -> AMBIGUOUS_INTERRUPTION refusal (the durable evidence is left intact).

Terminal results are SUCCESS, VALIDATION_FAILED, INVALID_OUTPUT and PROVIDER_FAILED except
the exact boundary below. Terminal results append once, in frozen order, and cannot be
replaced or automatically rerun by this tool. Failure messages in this new checkpoint mode
use a fixed safe message and allowlisted code; result status and scoring semantics are unchanged.

Only a PROVIDER_FAILED result with BOTH finalFailureClass=RATE_LIMITED AND
rateLimitScope=DAILY_QUOTA pauses. Its safe diagnostics are appended to quotaEvents, its
session closes, and nextIndex does not advance. It is not a final benchmark prediction.
No later case runs in that session. All other failures, including UNKNOWN/SHORT_WINDOW,
TIMEOUT (even if another scope is present), SERVER_ERROR and NETWORK_ERROR, remain terminal.

Resume after a quota pause requires --resume AND --confirm-new-quota-window. Confirmation
is recorded on that session. A second pause requires another confirmation. No timezone or
system-clock assumption proves a reset. Confirmation is rejected when there is no quota pause.

--max-new-cases N (integer 1..40) limits new case executions in one session, in order. It is
not a request quota limit: each case can trigger retries. It does not change total selection,
create missing-case failures or choose cases. This scheduling limit can differ per session.
--case and --limit are forbidden with --checkpoint; --all is mandatory. No recovery/replace/
force-rerun flags exist. A normal voluntary stop resumes at the next exact manifest case.

## Crash safety and local persistence

Location is restricted to:
evaluation/ai-validation/results/multiday/<run-id>/checkpoint.json
where run-id is a lowercase alphanumeric/hyphen name. --output must name the same directory.
Symlink directory aliases and symlink checkpoint/prediction files are refused. Moving a run
to a different location changes its storage fingerprint and is refused. Start in an empty
run directory; existing checkpoints require --resume and existing outputs are never adopted.

A .session.lock created exclusively with wx prevents cooperating CLI processes from running
the same checkpoint concurrently. An existing active/stale lock refuses execution; there is
no automatic lock takeover or removal. Handled exits remove only the lock they acquired.
Do not delete a stale lock to force a restart; interruption recovery needs a separate review.

Every replacement validates the complete checkpoint and legal transition, verifies the old
disk checkpoint still matches, writes a unique same-directory temporary file, fsyncs it,
then renames it over the official checkpoint. Temporary files are removed after handled
failures. POSIX also fsyncs the parent directory; Node has no portable Windows directory-fsync
guarantee. Filesystem/hardware durability still applies; this is not distributed exactly-once.

IN_PROGRESS is durably stored before context preparation or any provider validation. A crash
after request start but before terminal checkpoint commit is ambiguous. The tool refuses to
infer success/failure or rerun; doing so risks duplicates and benchmark bias. An unclosed
session at READY is safe to close as INTERRUPTED_BETWEEN_CASES and continue from its next case
when the session lock is available. The already-durable terminal prefix remains immutable.

Checkpoint immutability is enforced through tool operations, not cryptographic protection
against deliberate manual edits/deletion/rollback of local files. Operators must preserve the
authoritative checkpoint and ledger. There is no supported escape hatch to change outcomes.

## Final predictions and operational ledger

Only COMPLETE with exactly 40 terminal cases can materialize predictions.json in the locked
output directory. It uses the existing AiEvaluationPredictions shape and exact manifest order.
No quota pseudo-case is emitted. The unchanged scorer can consume it. Partial checkpoints
are not prediction files and cannot be materialized as official final predictions.

Materialization is atomic and repeatable after COMPLETE without another provider call. An
existing identical predictions file is accepted; a differing file is never overwritten.

The checkpoint remains alongside predictions as the operational ledger. Sessions record
sequence, start/end indices and times, stop reason and quota confirmation. Quota events retain
session, pending case ID/index, timestamp and sanitized diagnostics including attempts.
Terminal provider failures retain safe diagnostics when available. Success attempt telemetry
does not currently exist; do not infer successful transport counts or claim exact request totals.

Final semantic/evaluation metrics and operational execution history must be reported separately.
Completion after resuming daily quota pauses does NOT mean "40/40 provider reliability".
Phase 6.2C observed single-run execution behavior; this multi-session methodology is not directly
equivalent. Preserve its 40 total / 18 SUCCESS / 22 PROVIDER_FAILED baseline. Those historical
failures cannot be conclusively subclassified using diagnostics added later.

## Security

Checkpoint data includes run identity, approved settings, validated semantic findings and safe
operational metadata only. It does not copy input source files, generated Java files, prompt
payloads, API keys, request headers, raw provider error bodies/messages or environment dumps.
Semantic findings use the existing prediction fields; they are provider-generated evaluation
content, not raw response envelopes. Local results remain ignored and should not be published
without the existing evidence review. Exception messages in terminal failures are replaced by
a fixed message; invalid checkpoint errors do not echo untrusted input. Quota events contain
only the existing diagnostics primitives. No new provider request logic or logging was added.

## Future operator procedure

DO NOT EXECUTE DURING PHASE 6.3C IMPLEMENTATION.

Only after review/merge and separate live-execution approval, verify the intended project,
model, fixed prompt and safe settings. Configure the existing mandatory live environment
opt-in and credentials outside tracked files; for the observed tier consider 13000 ms pacing.
Choose an unused run-id and keep the same environment/settings, dataset and output on resume.
Examples below assume both the environment opt-in and operator approval already exist.

```text
npm run eval:ai:run -- --dataset evaluation/ai-validation/datasets/cobol-java-semantic-v1/manifest.json --all --checkpoint evaluation/ai-validation/results/multiday/approved-run/checkpoint.json --output evaluation/ai-validation/results/multiday/approved-run --max-new-cases 5 --allow-live-provider
```

After a normal voluntary stop, repeat with --resume. After PAUSED_DAILY_QUOTA, wait until an
operator independently confirms a new quota window, then add BOTH --resume and
--confirm-new-quota-window. Start with the same case determined by the checkpoint, never a
manual case selection. Session limits are not guarantees against daily budget exhaustion.
On AMBIGUOUS_INTERRUPTION or a stale lock, stop for review; do not alter files to force a rerun.

Once COMPLETE, use the existing eval:ai:score command against final predictions.json and retain
the operational ledger in any interpretation. Do not overwrite Phase 6.2C evidence.

## Validation

All new tests use mocked validators, with fetch blocked. Checks cover initial identity,
terminal progression, quota confirmation, configuration/dataset mismatches, illegal/corrupt
states, immutable prefixes, ambiguous interruption, full materialization/scorer compatibility,
session limits, security, exclusive locking, and failed writes/renames preserving prior state.
Validation results:

- npm ci: passed; existing 12 audit findings (4 moderate, 7 high, 1 critical).
  Dependencies unchanged; no audit fix was run.
- Focused multiday/live-run/Phase 6.3B tests: 5 suites, 164 tests passed.
- npm run lint: passed.
- npm run test: 74 suites, 663 tests passed, including 70 new multiday tests and
  all existing Phase 6.3B tests.
- npm run build: passed.
- npm run test:e2e: exit 0; no tests found (existing script permits this).
- Dataset validation: all 40 cases valid (10 clean / 30 mutated).
- Import validation: 143 COBOL_JAVATRANS + 12 AWS_CARDDEMO candidates valid.
- Seven tracked frozen baseline/dataset/Phase 6.3A/6.3B document files match the base
  checkout byte for byte, accounting for Git checkout line-ending filters.
- Historical predictions SHA-256 unchanged:
  d9cfaa3627c55c035814b4978e273dc2960255b39b71e33f6a1e9f10d937d02f.
- git check-ignore confirms the checkpoint namespace is ignored. No ignore-rule change.
- git diff --check and scoped security review passed; no live provider execution.

Recommended next step only: separately approved controlled Day-1 execution after this phase
is reviewed and merged. No such execution is part of this implementation.
