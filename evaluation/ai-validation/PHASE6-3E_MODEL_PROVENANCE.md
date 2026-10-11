# Phase 6.3E: Gemini 3.6 Flash and response provenance

Implementation only. No live provider request, model API probe, campaign execution,
or scoring of Phase 6.3D is authorized by this document. The proposed new run is
`phase6-3e-gemini36-v1`; its real result directory has not been created.

## Frozen campaign and configuration

The base is `develop` at `91288ffd5b4438d9439507a41a784a4057654367`;
fetch found no newer develop commit. Work belongs to
`feat/phase6-3e-gemini36-provenance`.

`src/phase6-3e-campaign.ts` defines the explicit proposed configuration. At that
run ID, checkpoint storage rejects any different requested model, expected
response version, dataset bytes, prompt version, fail-fast setting or execution
settings before creating the directory or acquiring a lock.

| Setting | Value |
| --- | --- |
| AI_PROVIDER | gemini |
| GEMINI_MODEL | gemini-3.6-flash |
| Expected response modelVersion | gemini-3.6-flash |
| AI_PROMPT_VERSION | semantic-cobol-java-v1 |
| Dataset | datasets/cobol-java-semantic-v1/manifest.json |
| Dataset SHA256 (CRLF) | bf51ea1f968a877c2b6393103c2a558d704d6e998f73d23de5086eab703c513e |
| Dataset SHA256 (LF) | 9fc4e66e83fd87c1f932b97eb5c5c5520f85dab0d1774b38dcc36820a4196a7a |
| AI_MAX_RETRIES | 2 |
| AI_TIMEOUT_MS | 60000 |
| AI_MAX_FINDINGS | 50 |
| GEMINI_MIN_REQUEST_INTERVAL_MS | 13000 |
| AI_MAX_FILES | 50 |
| AI_MAX_FILE_CHARS | 200000 |
| AI_MAX_TOTAL_CHARS | 500000 |
| failFast | false |

Only these two verified checkout encodings pass the campaign guard. Each run
retains the SHA256 of its exact dataset bytes; changing line endings when resuming
still fails checkpoint identity validation. No runtime normalization is performed.

Production environment defaults, dataset/labels, prompt text, matcher, scoring
equations, retry policy, pacing implementation, safety handling and HTTP request
format are unchanged. Session size is operational and may be one case for a pilot.

## Versioned contract and exact verification

The adapter attaches a non-enumerable symbol, `AI_RESPONSE_METADATA`, to each
result or parsed-output error. It contains only the request model and, if safe,
the response's `modelVersion`. It is response-scoped, including concurrent calls;
there is no shared “last model” cache. JSON serialization remains `{ findings }`.
Internal metadata is lost on JSON/structured cloning by design; the live runner
reads it directly before persisting the deliberately separate benchmark fields.
Production findings, persistence, human review and public DTOs are unchanged.

Accepted reported identifiers are at most 128 characters and match
`^gemini-[a-z0-9]+(?:[.-][a-z0-9]+)*$`. Invalid values are omitted, not truncated,
trimmed, guessed or copied from the request. No response bodies, prompts, source,
headers, response IDs or credentials enter this metadata.

New provenance-enabled checkpoints have `checkpointSchemaVersion: 2` and an
immutable identity extension:

```json
"provenancePolicy": {
  "version": 1,
  "expectedModelVersion": "gemini-3.6-flash"
}
```

Every terminal result in such a checkpoint carries:

```json
"modelProvenance": {
  "version": 1,
  "requestedModel": "gemini-3.6-flash",
  "observedModelVersion": "gemini-3.6-flash",
  "status": "CONFIRMED"
}
```

`CONFIRMED` requires exact, case-sensitive equality to the separately pinned
expected response version and agreement between the per-response requested model
and the run's requested model. A different safe reported value is `MISMATCH`;
missing, malformed or unsafe values are `UNKNOWN` with no observed field. Request
configuration drift is retained as `MISMATCH`. Validators recompute these claims
and reject contradictory statuses, missing per-case evidence, or policy removal.

The [Google response contract](https://ai.google.dev/api/generate-content#GenerateContentResponse)
defines `modelVersion` as the version used to generate the response. Google's
[model-name documentation](https://ai.google.dev/gemini-api/docs/models#model-versions)
describes stable, preview, latest and experimental formats. Those descriptions do
not guarantee that an alias and a reported version are identical. Consequently,
no prefix matching, suffix stripping or inferred equivalence is used here.
For example, `gemini-3.6-flash-001` is a mismatch under the proposed policy, even
if it might later be established as an intended serving version. A separately
identified run can pin a different explicit version; this campaign's pinned
policy cannot be changed after execution starts. The initial exact value is a
conservative expectation, not a claim that it was observed or that the model is
available to this account. Documentation was inspected; model APIs were not.

## Fail-closed execution and interpretation

- Findings validation and model verification are separate. An actual valid
  findings response retains the existing `SUCCESS` status to preserve semantic
  scoring methodology. No failed or malformed response is converted to SUCCESS.
  `UNKNOWN` never becomes a verified model success, even when findings are valid.
- Unknown/mismatched evidence is saved durably, then the session ends with
  `PROVENANCE_REVIEW` in the existing READY state. The CLI reports the confirmed
  count and exits with an error. Automatic resume refuses such immutable evidence
  before starting another session or making a request. There is no repair flag,
  backfill, automatic retry of terminal cases, or automatic model substitution.
- If the fortieth result is unverified, COMPLETE still means forty terminal
  results, not a successful model cohort. The checkpoint remains valid and
  durable; final predictions materialization throws and subsequent resume is
  refused. There is no new checkpoint state or synthetic terminal SUCCESS state.
- Provider failures retain their existing failure classification and are UNKNOWN
  unless a valid HTTP response supplied a safe version before output validation
  failed. Error bodies on non-2xx responses are not provenance evidence. Retry
  provenance comes only from the final response, never an earlier failed attempt.
- Daily quota remains a pause/event, not a completed case, and thus creates no
  invented case result. Existing quota confirmation and ambiguous-IN_PROGRESS
  recovery protections remain intact.
- Reports and metrics include per-case requested/observed versions and counts of
  confirmed, unknown (including missing cases), and mismatched cases. A verified
  single-model cohort requires all dataset cases to be present and confirmed.
  Legacy and partial data are explicitly UNVERIFIED. Semantic metric equations
  are unchanged; confirmed identity does not imply correct findings or even
  successful output validation.

The tradeoff is deliberate: even an ordinary terminal provider failure without
identity evidence stops the new campaign. A version alias changing mid-run can
make the cohort unusable without permission to start an independently identified
campaign. Provider self-report is not cryptographic proof of weights, serving
configuration or routing; an unchanged alias can hide underlying provider changes.
Unexpected identifier syntax is conservatively UNKNOWN. Attempt-level identity
for unsuccessful HTTP calls is not recorded. Supporting additional formats or
different expected identities requires review and a new policy/run, never edits
to historical results.

## Legacy evidence and output isolation

Checkpoint v1 remains supported unchanged. Runs without a provenance policy keep
their original identity and v1 serialization. Old results are never backfilled;
new reports label their provenance UNKNOWN. A policy cannot be added to a v1
resume, removed from a v2 resume, or changed during transitions. The original
execution policy version remains unchanged because retries/pacing are unchanged;
the provenance policy and checkpoint versions identify the added contract.

The protected path is
`results/multiday/phase6-3d-gemini-v1/checkpoint.json`. Store acquisition now refuses
that campaign for either new execution or resume, before lock creation. Existing
canonical-path, symlink, empty-directory, identity and immutable-output guards
remain in place. Legacy non-checkpoint output cannot target multiday directories.
Tests exercise protected-named temporary checkpoint and output files and prove
both remain byte-identical. They never write into repository results.

Read-only inspection of the real v1 checkpoint successfully parsed it without
changing the parsed content or file bytes: READY, nextIndex 27, 27 results,
0 quotaEvents. Before and after implementation its SHA256 was:

```text
C2C350591F351C73A0672B730340A87F8075AA3429BC4961C7E4112E0C00C3E4
```

It was not resumed, scored, regenerated, migrated or otherwise modified.

## Changed-file rationale

- `src/modules/validation/domain/ai-response-metadata.ts`, `ai-validator.port.ts`
  and `infrastructure/gemini-ai-validator.adapter.ts`: sanitized internal
  response-scoped metadata and safe handling of null/malformed response envelopes.
- `evaluation/ai-validation/src/model-provenance.ts`, `evaluation.types.ts` and
  `evaluation.validator.ts`: versioned policy, evidence validation and cohort rules.
- `live-runner.ts`, `live-run.cli.ts`, `multiday-checkpoint.ts`,
  `multiday-runner.ts`, `multiday-store.ts`, `phase6-3e-campaign.ts`: opt-in capture,
  immutable v2 identity, fail-closed continuation, explicit campaign configuration
  and protected storage.
- `evaluation.scorer.ts`, `evaluation.report.ts`: provenance annotation alongside
  unchanged semantic calculations and clear unverified-cohort reporting.
- `test/ai-evaluation-model-provenance.spec.ts`: mocked-HTTP contract, sanitization,
  absence, redirects, request drift, malformed output, failures, retry, concurrency,
  quota, recovery, v1 compatibility, scoring equivalence and output isolation.

## Offline validation results

Validated on 2026-10-11:

- Initial targeted Jest run: 5 suites / 135 tests passed (adapter, new provenance,
  multiday recovery/storage, live runner and reporting).
- Final full `npm test -- --silent`: 77 suites passed, 1 suite skipped; 748 tests
  passed and 44 skipped. This includes all 35 new provenance tests. Existing
  skipped tests were not enabled or represented as passing.
- `npm run lint`: passed, zero warnings.
- `npm run build`: passed.
- `npx --no-install tsc --noEmit --incremental false`: passed during implementation.
- `git diff --check`: passed.
- Protected checkpoint SHA256 and state verified unchanged; read-only v1 parsing
  passed; real Phase 6.3E output directory absent.
- No diffs in the dataset, prompt, matcher, retry policy or production configuration.

Offline Jest processes explicitly set `GEMINI_MIN_REQUEST_INTERVAL_MS=0` inside
PowerShell `try/finally`, restoring the inherited value afterward. Individual
mocked pacing-policy tests retain their intentional test settings. Provider HTTP
responses are mocked; no live Gemini/OpenAI execution or API probes occurred.
No push, PR, merge, tag or Jira mutation was performed.

## Future LIVE PILOT proposal — not executed

Only after separate explicit live authorization: verify the protected hash and
that the new directory is absent, review provider availability/version information,
and prepare a process-local environment with the exact table above. Load the API
key through the existing secret mechanism without printing or storing it. Set
`AI_EVAL_ALLOW_LIVE_PROVIDER=true` only for that approved process. Restore all
prior environment values afterward. Proposed command from repository root:

```powershell
npm run eval:ai:run -- --dataset evaluation/ai-validation/datasets/cobol-java-semantic-v1/manifest.json --output evaluation/ai-validation/results/multiday/phase6-3e-gemini36-v1 --checkpoint evaluation/ai-validation/results/multiday/phase6-3e-gemini36-v1/checkpoint.json --all --expected-model-version gemini-3.6-flash --max-new-cases 1 --allow-live-provider
```

This is the first case of the independent 40-case campaign, not a rerun of any
Phase 6.3D case result. Inspect the durable per-case request and observed version,
finding status, diagnostics and protected hash. No final scoring is appropriate
for a one-case checkpoint. Missing/mismatched identity stops here; preserve the
evidence, review the format/routing and propose a separately identified campaign
if necessary. A confirmed pilot can be continued with explicit `--resume` after
review; quota pauses still require genuine new-window confirmation. No directory
or checkpoint is pre-created by this proposal.
