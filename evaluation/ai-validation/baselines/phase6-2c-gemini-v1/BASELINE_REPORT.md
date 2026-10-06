PRELIMINARY ENGINEERING BASELINE.

THE SYNTHETIC GROUND-TRUTH LABELS STILL REQUIRE INDEPENDENT TEAM REVIEW
BEFORE THESE NUMBERS ARE USED AS FINAL PROJECT OR PRESENTATION METRICS.

# Phase 6.2C Gemini preliminary baseline

## 1. Scope

Exactly one frozen 40-case live-provider run was executed, without fail-fast. The exact persisted predictions were scored offline with the existing deterministic scorer. No case was rerun or selected for a better score. This is measurement only, not a final scientific or model-quality result.

## 2. Frozen dataset identity

Dataset: cobol-java-semantic-v1, version 1.0.0; synthetic curated; 40 cases (10 clean controls, 30 mutated cases).
Manifest: evaluation/ai-validation/datasets/cobol-java-semantic-v1/manifest.json
SHA-256: BF51EA1F968A877C2B6393103C2A558D704D6E998F73D23DE5086EAB703C513E

## 3. Git SHA

Baseline source commit: aa03b334845af8891e8bb3f4eaa4f09903c1600f
Branch: feature/ai-validation-phase6-2c-gemini-baseline. The subsequent evidence commit contains only this sanitized evidence directory.

## 4. Gemini provider/model

Provider: gemini; model: gemini-3.5-flash; prompt: semantic-cobol-java-v1.
Evaluator: 1.0.0; matching policy: 1.0.0; location tolerance: +/-2 lines.
Predictions generatedAt: 2026-10-06T10:54:05.304Z. API key presence was verified without printing or persisting its value.

## 5. Gemini compatibility fix context

PR #46 is included in the source commit. Gemini uses APPLICATION_JSON. Its transport helper deep-clones the canonical schema and removes only properties.findings.maxItems. The canonical schema retains maxItems, and validateAiValidationOutput still enforces maxFindings. No compatibility code was changed for this run.

## 6. Smoke gate

PHASE_6_2C_SMOKE_PASS: clean-01 and clean-02 previously succeeded, with zero provider failures. The smoke was not repeated, copied into this run, or scored as the baseline.

## 7. Execution reliability

All 40 expected case IDs occur exactly once, with no unknown or duplicate IDs. 18/40 succeeded (45.00%); 22 failed (55.00%); 0 missing.

| Status | Count |
| --- | ---: |
| SUCCESS | 18 |
| VALIDATION_FAILED | 0 |
| PROVIDER_FAILED | 22 |
| INVALID_OUTPUT | 0 |

## 8. Successful-case metrics

| Population | TP | FP | FN | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Successful cases | 5 | 16 | 4 | 23.81% | 55.56% | 33.33% |

Macro precision 54.17%, recall 54.17%, F1 50.95%.
Macro averages include only categories with expected support among successful executions: DATA_TYPE_MISMATCH, VARIABLE_MAPPING_MISMATCH, FILE_IO_MISMATCH, MISSING_OPERATION.
These metrics exclude 22 failed executions and are conditional on the 18 successes.

## 9. Conservative metrics

| Population | TP | FP | FN | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Conservative end-to-end | 5 | 16 | 25 | 23.81% | 16.67% | 19.61% |

Conservative macro precision 21.67%, recall 16.67%, F1 17.38% across all 10 categories.
Expected findings from failed cases count as missed; failed executions contribute no predicted findings. The 21 failed mutated cases add 21 false negatives.

## 10. Per-category summary

### Successful executions

| Category | Expected | Predicted | TP | FP | FN | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| DATA_TYPE_MISMATCH | 3 | 4 | 2 | 2 | 1 | 50.00% | 66.67% | 57.14% |
| VARIABLE_MAPPING_MISMATCH | 2 | 1 | 0 | 1 | 2 | 0.00% | 0.00% | 0.00% |
| LOGIC_MISMATCH | 0 | 6 | 0 | 6 | 0 | 0.00% | 0.00% | 0.00% |
| CONTROL_FLOW_MISMATCH | 0 | 1 | 0 | 1 | 0 | 0.00% | 0.00% | 0.00% |
| FILE_IO_MISMATCH | 2 | 3 | 2 | 1 | 0 | 66.67% | 100.00% | 80.00% |
| DATABASE_MISMATCH | 0 | 0 | 0 | 0 | 0 | 0.00% | 0.00% | 0.00% |
| ENCODING_MISMATCH | 0 | 0 | 0 | 0 | 0 | 0.00% | 0.00% | 0.00% |
| MISSING_OPERATION | 2 | 1 | 1 | 0 | 1 | 100.00% | 50.00% | 66.67% |
| UNSUPPORTED_CONSTRUCT | 0 | 0 | 0 | 0 | 0 | 0.00% | 0.00% | 0.00% |
| POTENTIAL_BEHAVIOR_CHANGE | 0 | 5 | 0 | 5 | 0 | 0.00% | 0.00% | 0.00% |

### Conservative end-to-end

| Category | Expected | Predicted | TP | FP | FN | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| DATA_TYPE_MISMATCH | 3 | 4 | 2 | 2 | 1 | 50.00% | 66.67% | 57.14% |
| VARIABLE_MAPPING_MISMATCH | 3 | 1 | 0 | 1 | 3 | 0.00% | 0.00% | 0.00% |
| LOGIC_MISMATCH | 3 | 6 | 0 | 6 | 3 | 0.00% | 0.00% | 0.00% |
| CONTROL_FLOW_MISMATCH | 3 | 1 | 0 | 1 | 3 | 0.00% | 0.00% | 0.00% |
| FILE_IO_MISMATCH | 3 | 3 | 2 | 1 | 1 | 66.67% | 66.67% | 66.67% |
| DATABASE_MISMATCH | 3 | 0 | 0 | 0 | 3 | 0.00% | 0.00% | 0.00% |
| ENCODING_MISMATCH | 3 | 0 | 0 | 0 | 3 | 0.00% | 0.00% | 0.00% |
| MISSING_OPERATION | 3 | 1 | 1 | 0 | 2 | 100.00% | 33.33% | 50.00% |
| UNSUPPORTED_CONSTRUCT | 3 | 0 | 0 | 0 | 3 | 0.00% | 0.00% | 0.00% |
| POTENTIAL_BEHAVIOR_CHANGE | 3 | 5 | 0 | 5 | 3 | 0.00% | 0.00% | 0.00% |

Counts and metrics are copied from the existing scorer. Matched predictions are credited to the expected category; no accepted-category alias matches occurred in this run. Zero-support categories have zero-valued rates under the scorer convention and are excluded from successful-case macro averages.

## 11. Clean-case false-positive behavior

8/9 successful clean controls had findings: 88.89% false-positive rate, with 10 findings in total. One of the 10 clean controls failed execution and is excluded from that rate.

## 12. Mutation detection

Successful mutated cases: 5/9, 55.56%.
Conservative mutated cases: 5/30, 16.67%.
Individual mutations: 5/30, 16.67%. Detection requires a deterministic match to an expected finding.

## 13. Severity/category/location agreement

Primary-category exact: 5/5, 100.00%; accepted-category alias matches: 0.
Severity exact: 5/5, 100.00%.
Source location: exact 0/5 (0.00%); tolerant 5/5 (100.00%).
Target location: exact 3/5 (60.00%); tolerant 5/5 (100.00%).
Agreement is conditional on five matched findings. Tolerant location compatibility is required for matching, so 100% tolerant agreement does not establish localization accuracy across all predictions.

Severity confusion matrix (expected rows, predicted columns):

| Expected / predicted | LOW | MEDIUM | HIGH | CRITICAL |
| --- | ---: | ---: | ---: | ---: |
| LOW | 0 | 0 | 0 | 0 |
| MEDIUM | 0 | 0 | 0 | 0 |
| HIGH | 0 | 0 | 4 | 0 |
| CRITICAL | 0 | 0 | 0 | 1 |

No category confusion matrix is supplied by the scorer; its category agreement counts are preserved in metrics.snapshot.json.

## 14. Latency

Latency is runner-recorded elapsed time per case, including preparation, validation and any unchanged adapter retries. Values below are milliseconds.

| Population | n | Min | Max | Mean | Median | p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Successful | 18 | 4387 | 13365 | 7405.111 | 7306.5 | 13365 |
| All recorded | 40 | 767 | 13365 | 3781.675 | 868.5 | 9837 |

p95 uses deterministic nearest rank: sort ascending and select ceil(0.95 * n), using one-based indexing. The successful-case summary excludes failures; the all-recorded summary includes them.

## 15. Provider failures

All failures are retained. Sanitized codes do not distinguish underlying 429, 5xx, or transport causes; no specific HTTP cause is inferred.

| Case | Status | Sanitized code |
| --- | --- | --- |
| clean-07 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-06 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-07 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-08 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-09 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-10 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-11 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-12 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-15 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-16 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-17 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-18 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-19 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-20 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-21 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-22 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-25 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-26 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-27 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-28 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-29 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |
| mutation-30 | PROVIDER_FAILED | AI_PROVIDER_UNAVAILABLE |

## 16. Largest observed weaknesses

- Execution reliability: 22/40 provider failures, including 21 mutated cases, limits coverage and reduces conservative recall to 16.67%.
- Clean controls: 8/9 successful clean cases received 10 findings (88.89% case-level false-positive rate).
- False positives: LOGIC_MISMATCH has 6 and POTENTIAL_BEHAVIOR_CHANGE has 5 of the 16 total false positives, the two largest category counts.
- Successful-case misses: VARIABLE_MAPPING_MISMATCH has 2 FN; DATA_TYPE_MISMATCH and MISSING_OPERATION each have 1 FN. These sum to the 4 FN among successful executions.
- Conservative FN is 3 each in VARIABLE_MAPPING_MISMATCH, LOGIC_MISMATCH, CONTROL_FLOW_MISMATCH, DATABASE_MISMATCH, ENCODING_MISMATCH, UNSUPPORTED_CONSTRUCT and POTENTIAL_BEHAVIOR_CHANGE. These include failed executions and cannot be attributed entirely to detection behavior.
- Exact source localization is 0/5 matched findings; exact target localization is 3/5. Severity and primary-category agreement are 5/5 but cover only those five matches.

## 17. Benchmark limitations

This dataset is synthetic curated evaluation data, not training data or customer code. Its 40 cases do not represent all production COBOL systems. Labels still require independent team review and may contain judgment calls. External COBOL-JavaTrans/AWS candidates were NOT used as ground truth. No RAG or fine-tuning was performed. No production Human Review status was modified.
A single run provides no repeatability estimate or final scientific/model-quality claim. Models may be nondeterministic; no claim is made that similar patterns were absent from model training. Passing fixtures does not prove semantic equivalence for arbitrary programs. Execution failures leave only nine successful mutated cases and four categories with expected support in successful-case macro metrics.

## 18. Security/privacy handling

Raw predictions passed checks for the current API key and sensitive environment values, credential/header markers, unexpected response fields, complete submitted COBOL/Java files, and noncanonical failure messages. Only normalized prediction fields and static sanitized failures are present. No raw request headers or complete raw provider response objects were persisted.
Raw output remains gitignored and uncommitted at evaluation/ai-validation/results/phase6-2c-gemini-baseline-v1. Only BASELINE_REPORT.md, metrics.snapshot.json and run-metadata.json are included as evidence. These contain no raw findings, explanations, code, environment dump or secrets.
Predictions SHA-256 (unchanged across scoring): d9cfaa3627c55c035814b4978e273dc2960255b39b71e33f6a1e9f10d937d02f.

## 19. Reproducibility commands

The live command below records what was executed exactly once; it is not an instruction to rerun or overwrite this baseline. The scorer command used the exact resulting predictions.

```powershell
npm run eval:ai:run -- -- --dataset evaluation/ai-validation/datasets/cobol-java-semantic-v1/manifest.json --all --output evaluation/ai-validation/results/phase6-2c-gemini-baseline-v1 --allow-live-provider
npm run eval:ai:score -- -- --dataset evaluation/ai-validation/datasets/cobol-java-semantic-v1/manifest.json --predictions evaluation/ai-validation/results/phase6-2c-gemini-baseline-v1/predictions.json --output evaluation/ai-validation/results/phase6-2c-gemini-baseline-v1
npm run eval:ai:validate -- -- --dataset evaluation/ai-validation/datasets/cobol-java-semantic-v1/manifest.json
npm run eval:ai:import:validate
git check-ignore evaluation/ai-validation/results/phase6-2c-gemini-baseline-v1/predictions.json
```

The source state matched the smoke gate, so the prior passing regression (71 suites / 505 tests, lint and build; e2e exit 0 with no tests) was not repeated solely for elapsed time. Dataset and import validation were rerun and both passed before the evidence commit.

## 20. No tuning during baseline

No tuning occurred. Model, prompt text, retries, Gemini schema compatibility behavior, matching tolerance, accepted categories, labels, expected findings, mutations, severity, locations and benchmark code remained unchanged. No smoke repeat, individual-case retry, rerun or cherry-picking occurred. Existing adapter retry behavior was left intact. No RAG, fine-tuning, Human Review feedback or production Human Review status changes were used.
