# AI Validation Evaluation

Phase 6 provides repeatable, offline-first evaluation of ALSM's advisory COBOL-to-Java AI
validator. It does not change the production prompt, model, validation status, HTTP API, MongoDB
records, or BullMQ jobs. Nothing in this directory is registered in `AppModule` or executed by
`npm start` or `npm run worker`.

## Benchmark and ground truth

The initial dataset is `cobol-java-semantic-v1` version `1.0.0`, a **synthetic curated evaluation
set** created specifically for ALSM engineering. It contains 40 small fictional cases: 10 clean
controls and 30 Java-side mutations. Each of the ten evaluated semantic categories has three
mutations. The set contains no customer code, real personal data, production database details, or
credentials.

Every case declares source and target files, difficulty, tags, expected findings, and clean/mutated
state. Each mutation documents its operator, injected change, and observable impact. Expected
findings declare a primary category, severity, source/target location, and mutation ID. A small
number of intrinsically cross-cutting findings declare a justified `acceptedCategories` alias;
the primary category still owns reporting support.

Ground truth created by one implementer is not infallible. At least two team members should review
every expected label, severity, location, mutation description, and accepted alias before scores
are used in a report or presentation. Record disagreements and their resolution outside generated
results. Do not use the evaluated LLM as the final ground-truth judge.

## File formats

The dataset manifest records `datasetId`, semantic version, type, methodology, limitations, declared
case count, and cases. The prediction file records dataset identity, evaluator version, timestamp,
provider, model, prompt version, location tolerance, matching-policy version, and one result per
case. A result is either `SUCCESS` with findings or one of `VALIDATION_FAILED`, `PROVIDER_FAILED`,
or `INVALID_OUTPUT` with a sanitized failure. Failures are never represented as successful empty
finding lists.

The committed `samples/sample-predictions.json` is deliberately constructed test data containing
known TP, FP, FN, severity disagreement, and provider-failure behavior. It is not an AI result and
must never be reported as model quality.

## Deterministic matching

Matching never compares finding title or explanation text. A candidate pair requires:

1. an exact primary category or explicitly accepted category alias;
2. every ground-truth source/target file to match after slash, leading `./`, and case normalization;
3. line ranges to overlap or have a gap no larger than the configured tolerance (default ±2 lines).

If only source or target ground truth exists, only that side is required. Category-only matching is
allowed only when `allowCategoryOnly` is explicit and no expected location is present. Severity is
not part of identity.

The matcher uses a deterministic augmenting-path bipartite algorithm. It processes predictions with
the fewest candidates first, sorts candidate edges by exact category then exact/tolerant source and
target location strength, and uses stable input indexes for final ties. Augmenting paths guarantee
maximum cardinality: one prediction and one expected finding can each participate in at most one TP.

After matching, unmatched predictions are FP and unmatched expected findings are FN. Alias matches
are attributed to the expected primary category for detection metrics; primary-category agreement
is reported separately.

## Metrics

The primary micro metrics aggregate findings:

- `precision = TP / (TP + FP)`;
- `recall = TP / (TP + FN)`;
- `F1 = 2 × precision × recall / (precision + recall)`.

A zero denominator produces `0`, never `NaN`. Per-category metrics include expected count, attributed
predicted count, TP, FP, FN, precision, recall, and F1 in a stable category order. Macro averages
include categories with expected support and list exactly which categories were included.

The scorer reports both:

- successful-case metrics, which exclude failed/missing executions; and
- conservative end-to-end metrics, where every expected finding in a failed/missing case is an FN.

It also reports clean cases with any prediction / successfully evaluated clean cases, total findings
on clean cases, mutated cases with at least one matched mutation finding, per-mutation detection,
primary-versus-accepted category agreement, exact severity agreement with a confusion matrix, and
exact/tolerant source and target location agreement. Severity mismatch remains a TP and is measured
only among matched pairs. Case-level output contains counts, matched IDs/indexes, unmatched IDs/indexes,
status, and optional latency—but never full source code.

High precision means fewer false positives are shown to reviewers. High recall means fewer known
synthetic defects are missed. F1 balances precision and recall. Clean-case false-positive rate
measures how often intentionally equivalent code receives findings. Mutation detection rate measures
how many injected mutations receive at least one valid match. Severity agreement measures
classification consistency, not detection quality. No metric proves semantic equivalence.

## Offline commands

This repository's npm version needs a second argument separator so named CLI flags reach `ts-node`.
Run from the repository root:

```powershell
npm run eval:ai:validate -- -- --dataset evaluation/ai-validation/datasets/cobol-java-semantic-v1/manifest.json

npm run eval:ai:score -- -- `
  --dataset evaluation/ai-validation/datasets/cobol-java-semantic-v1/manifest.json `
  --predictions evaluation/ai-validation/samples/sample-predictions.json `
  --output evaluation/ai-validation/results/sample
```

Scoring requires no network, OpenAI, Redis, MongoDB, or HTTP server. It validates both inputs before
writing `metrics.json` and `report.md`. `evaluation/ai-validation/results/` is git-ignored because
provider-generated findings are local run artifacts.

## Manual live-provider runner

Live execution is optional, manual, synthetic-only, and can incur provider cost. It reuses
`PrepareAiValidationContextService`, secret redaction/limits, and `AiValidatorPort`, selecting either
`OpenAiValidatorAdapter` or `GeminiAiValidatorAdapter`; it never creates validation runs/findings and
never uses MongoDB or BullMQ.
It records only prediction metadata and findings, not fixture source.

Both opt-ins are mandatory:

```powershell
$env:AI_EVAL_ALLOW_LIVE_PROVIDER = 'true'
npm run eval:ai:run -- -- `
  --dataset evaluation/ai-validation/datasets/cobol-java-semantic-v1/manifest.json `
  --case mutation-01 `
  --output evaluation/ai-validation/results/live-smoke `
  --allow-live-provider
```

Set `AI_PROVIDER=openai` with `OPENAI_API_KEY` and `OPENAI_MODEL`, or
`AI_PROVIDER=gemini` with `GEMINI_API_KEY` and `GEMINI_MODEL`. For example, Gemini configuration is:

```powershell
$env:AI_PROVIDER = 'gemini'
$env:GEMINI_API_KEY = '<set-locally>'
$env:GEMINI_MODEL = 'gemini-3.5-flash'
$env:AI_EVAL_ALLOW_LIVE_PROVIDER = 'true'
```

Do not execute a live run without both opt-ins. Use exactly one scope option:
`--case <caseId>`, `--limit <N>`, or explicit `--all`. There is no implicit full-dataset run.
Provider/context/structured-output failures receive distinct failure statuses and execution continues;
add `--fail-fast` to stop after the first failure. LLM output may vary because the provider exposes
no deterministic guarantee for this workflow.

Automated install, lint, test, build, and e2e commands never execute this runner. Unit tests inject a
mock validator and perform no network call. `AI_VALIDATION_ENABLED=true` is not live-evaluation
consent and cannot replace either Phase 6 opt-in. Live mode does not default to OpenAI: an explicit
`AI_PROVIDER=openai` or `AI_PROVIDER=gemini` and that provider's credentials are required.

## Privacy, limitations, and comparisons

Reports exclude full COBOL and Java source. Keep result directories local and review findings before
sharing because model text can still repeat fragments of submitted synthetic fixtures. Never replace
this dataset with customer source without a separately approved privacy and data-handling process.

Gemini Developer API free-tier requests may be subject to Google's free-tier data-use terms. Synthetic
Phase 6 benchmark data is appropriate for initial engineering evaluation. Do not send customer source
code to Gemini free tier merely because this adapter exists. Production/customer use requires the
team's explicit provider and privacy decision and appropriate provider account/data terms. This is an
engineering data-handling warning, not legal approval.

This benchmark is small and synthetic, labels have subjective elements, location tolerance trades
strictness for robustness, and model results can be nondeterministic. Similar programming patterns
may have appeared in foundation-model training; this is not a scientifically independent hidden test
set. The benchmark cannot prove semantic equivalence across arbitrary programs.

Two result files may be compared descriptively using their precision, recall, F1, FP, FN, clean-case
false-positive rate, and mutation detection rate. The tooling does not select a winner or modify the
production prompt/model. Any such production change requires separate human review. Freeze a reviewed
Phase 6 baseline before Phase 7, then evaluate Phase 7 against the same frozen dataset.

Benchmark framework ready; no real-provider score produced.

**NO REAL PROVIDER BENCHMARK WAS RUN.**

## External data import

Phase 6.1 adds a separate staging layer under `imports/`. External evidence never becomes ground
truth merely because it was published, compiled, tested, or reviewed upstream:

```text
Pinned external source
  -> ImportedEvaluationCandidate (scorable: false)
  -> explicit review by at least two team members
  -> guarded promotion
  -> Phase 6 EvaluationCase
```

`ImportedEvaluationCandidate` intentionally has no `isClean` or `expectedFindings` fields. The
normal Phase 6 dataset validator remains strict, and `eval:ai:score` accepts only validated Phase 6
datasets. Passing a candidate manifest to the scorer therefore fails before scoring.

### Explicit imports

Imports are manual commands and are the only Phase 6.1 commands that contact the network. They clone
only their approved public repository into a temporary directory, resolve and check out the exact
`main` SHA, write the pinned provenance, and remove the temporary checkout. Normal install, test,
lint, build, and e2e commands do not download external repositories.

```powershell
npm run eval:ai:import:cobol-javatrans
npm run eval:ai:import:aws-carddemo
npm run eval:ai:import:validate
```

Use the optional `--output` argument only when intentionally regenerating into another directory.
This repository's npm version requires the extra separator used by the existing evaluation CLIs:

```powershell
npm run eval:ai:import:aws-carddemo -- -- --output path/to/staging
```

Every candidate records the repository owner/name and URL, pinned commit, upstream path and blob SHA,
local content SHA-256, retrieval time, license identifier/snapshot path, and NOTICE path when one
exists. Path normalization rejects absolute paths, `..`, NUL, and duplicates. Static credential
scanning excludes suspicious candidates by default and reports only path plus pattern type.

The COBOL-JavaTrans import preserves canonical COBOL/Java, prompts, and tests as evidence. Phase
6.1A records the exact COBOL-Coder, HumanEval, and HumanEval-X licenses, revisions, hashes, and
attribution for the audited dataset blob. Its license status is therefore `RECORDED` under the
engineering evidence policy. `RECORDED` is not legal approval and applies only to the pinned commit
and blob.

License evidence asks whether upstream terms and attribution have been recorded for retention and
redistribution. Dataset quality asks whether a pair is technically useful. Ground truth asks
whether ALSM human review has established a semantic label. None of these answers implies either
of the others. In particular, upstream manual review, compilation, and functional validation are
quality evidence only; every imported COBOL-JavaTrans candidate remains unscorable and pending ALSM
human review.

The AWS CardDemo import is source-only. It selects a deterministic 12-program subset for structural
diversity, includes only confidently resolved repository copybooks, and never reads sample business
data directories. No Java is generated, no converter is run, and every review entry begins with
`targetJavaStatus: "MISSING"`. Feature tags are objective structural keyword evidence, not business
semantics or defect labels.

### Human review and promotion

Copy the applicable `review-template.json` to a separate decision file. Do not treat the committed
template as an approval. Every entry starts with:

```json
{
  "reviewStatus": "PENDING",
  "reviewers": [],
  "title": null,
  "description": null,
  "difficulty": null,
  "isClean": null,
  "expectedFindings": null,
  "mutations": null,
  "notes": null
}
```

Promotion requires `APPROVED`, two distinct actual team-member identifiers, reviewed case metadata,
an explicit boolean `isClean`, and explicit `expectedFindings`. A clean case must explicitly supply
`[]`; a defective case must supply reviewed findings and matching mutation metadata. OpenAI,
ChatGPT, Codex, another LLM, automated analyzers, upstream authorship, and provider metadata cannot
count as human reviewers.

AWS additionally requires target Java, a SHA-256 for each target file, a declared generation source
(`ALSM_CONVERTER`, `HUMAN_IMPLEMENTATION`, or `OTHER_VERIFIED_SOURCE`), tool/version and source
commit, verification evidence, `verificationStatus: "VERIFIED"`, and two human target reviewers.
Phase 6.1 does not populate any of those future fields.

Create a promotion metadata file containing `datasetId`, semantic `version`, `description`,
`creationMethodology`, and non-empty `limitations`, then run:

```powershell
npm run eval:ai:import:promote -- -- `
  --candidates evaluation/ai-validation/imports/cobol-javatrans/candidates.json `
  --reviews path/to/human-reviewed-decisions.json `
  --metadata path/to/promotion-metadata.json `
  --output path/to/promoted-manifest.json

npm run eval:ai:validate -- -- `
  --dataset path/to/promoted-manifest.json
```

Promotion re-runs the existing Phase 6 validator. A source with `licenseStatus: "REVIEW_REQUIRED"`,
a pending/rejected review, insufficient human reviewers, missing decisions, or incomplete AWS Java
verification fails closed. Only the promoted manifest may be supplied to the scorer.

## Human Review Pilot

Phase 6.2A establishes a clean-control pilot for exactly 15 COBOL-JavaTrans candidates. AWS
CardDemo remains out of scope. Preparation validates the pinned import and content hashes, orders
eligible candidates by combined COBOL-plus-Java character count, divides that order into approximate
size thirds, and chooses five SMALL, five MEDIUM, and five LARGE candidates using an evidence-first
stable SHA-256 rank. Size strata are not semantic difficulty labels.

```powershell
npm run eval:ai:review:prepare
npm run eval:ai:review:validate
npm run eval:ai:review:compare
npm run eval:ai:review:finalize
```

The committed Reviewer A and Reviewer B templates contain null identities, timestamps, and
decisions. Actual reviewers copy them to the git-ignored `evaluation/ai-validation/reviews/work/`
directory. The default validator accepts incomplete templates so preparation can be verified; use
`--mode complete` with the actual review paths before reconciliation and promotion.

Each reviewer independently chooses `CLEAN` or `NOT_CLEAN_OR_UNCERTAIN`. `CLEAN` means the reviewer
finds no known task-relevant semantic behavior difference after inspecting both implementations,
the task, and available evidence. It is not formal proof, exhaustive testing, a bug-free guarantee,
production certification, or an automated conclusion. Codex/LLM output cannot count as reviewer
approval.

Comparison yields `READY_CLEAN` only for matching CLEAN decisions by two distinct human reviewers.
Different decisions yield `DISAGREEMENT`; matching non-clean/uncertain decisions yield
`NOT_CLEAN_OR_UNCERTAIN`; missing or incomplete input yields `NEEDS_REVIEW`. The tool never resolves
a disagreement. Phase 6.2A promotes only `READY_CLEAN` controls; non-clean and disputed cases await a
separate human adjudication process, so no natural-defect findings or mutations are fabricated.

Human finalization supplies title, description, and semantic review difficulty without deriving it
from size. Clean finalization then produces an ordinary `ImportedReviewManifest` with `APPROVED`, the
two human IDs, `isClean: true`, `expectedFindings: []`, `mutations: null`, and
`targetJavaStatus: "UPSTREAM_PRESENT"`. The existing import promotion command still performs its
normal strict checks and emits a `human-reviewed-external` Phase 6 dataset.

The pilot selection hash binds reviewer files to the exact selected candidate IDs, source/target
hashes, pinned candidate-manifest hash, and selection algorithm. Any source, target, selection, or
upstream manifest change invalidates the review and requires humans to review the changed material
again. Automated compiler/test evidence is recorded separately and never changes a human decision.

See
`evaluation/ai-validation/reviews/cobol-javatrans-pilot-v1/REVIEW_GUIDE.md` for the exact independent
review, comparison, finalization, promotion, and dataset-validation workflow.
