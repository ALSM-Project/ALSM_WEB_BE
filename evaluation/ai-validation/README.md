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
`PrepareAiValidationContextService`, secret redaction/limits, `AiValidatorPort`, and
`OpenAiValidatorAdapter`; it never creates validation runs/findings and never uses MongoDB or BullMQ.
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

`OPENAI_API_KEY` and `OPENAI_MODEL` must also be present. Use exactly one scope option:
`--case <caseId>`, `--limit <N>`, or explicit `--all`. There is no implicit full-dataset run.
Provider/context/structured-output failures receive distinct failure statuses and execution continues;
add `--fail-fast` to stop after the first failure. LLM output may vary because the provider exposes
no deterministic guarantee for this workflow.

Automated install, lint, test, build, and e2e commands never execute this runner. Unit tests inject a
mock validator and perform no network call. `AI_VALIDATION_ENABLED=true` is not live-evaluation
consent and cannot replace either Phase 6 opt-in.

## Privacy, limitations, and comparisons

Reports exclude full COBOL and Java source. Keep result directories local and review findings before
sharing because model text can still repeat fragments of submitted synthetic fixtures. Never replace
this dataset with customer source without a separately approved privacy and data-handling process.

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
