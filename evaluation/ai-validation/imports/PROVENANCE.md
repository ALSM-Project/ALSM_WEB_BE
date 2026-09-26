# External Import Provenance

License metadata recorded for engineering review. This document does not make a legal approval or
license-compatibility conclusion.

## COBOL-Coder / COBOL-JavaTrans

- Repository: `COBOL-Coder/COBOL-Coder`
- Repository URL: <https://github.com/COBOL-Coder/COBOL-Coder>
- Pinned commit: `2b14b7bf7e55556205654c6f7657fa60e36251fa`
- Retrieved: `2026-09-25T15:13:35.476Z`
- Dataset path: `evaluation/data/COBOL-JavaTrans.jsonl`
- Dataset blob SHA: `b29ce552a209e6a12cb5b31e130188404ccf8958`
- Repository license: Apache-2.0, preserved as `cobol-javatrans/LICENSE.upstream.txt`
- Upstream NOTICE: none present at the pinned repository root
- License status: `RECORDED`

The upstream README states that COBOL-JavaTrans is derived from HumanEval, contains 143 pairs, and
was manually reviewed and validated for compilability and functional correctness. The official
paper further states that the Java solutions come from HumanEval-X. The pinned JSONL contains 143
records; all 143 Java prompts, complete solutions, and Java tests exactly match the recorded
HumanEval-X Java blob.

- HumanEval: `openai/human-eval@6d43fb980f9fee3c892a914eda09951f772ad10d`, MIT license and OpenAI
  copyright notice preserved in `cobol-javatrans/HUMANEVAL_LICENSE.upstream.txt` and
  `cobol-javatrans/humaneval-upstream.json`.
- HumanEval-X: `zai-org/CodeGeeX@2838420b7b4492cf3d16bce5320e26e65960c9e2`, Apache-2.0 license
  preserved in `cobol-javatrans/HUMANEVAL_X_LICENSE.upstream.txt` and
  `cobol-javatrans/humaneval-x-upstream.json`.
- Audit and attribution: `cobol-javatrans/LICENSE_AUDIT.md` and
  `cobol-javatrans/ATTRIBUTION.md`.

No separate dataset-specific license statement, extra usage term, or conflicting redistribution
restriction was found in the audited sources. `RECORDED` means the evidence chain is recorded for
engineering use; it is not legal approval. The derivation and upstream validation statements are
quality evidence only and do not create ALSM ground truth.

The importer extracts the actual `task_id`, canonical COBOL and Java solutions, language prompts,
structured tests, and Java test source when present. It hashes each exact extracted UTF-8 string
with SHA-256 and retains the JSONL blob SHA and case ID.

## AWS Mainframe Modernization CardDemo

- Repository: `aws-samples/aws-mainframe-modernization-carddemo`
- Repository URL: <https://github.com/aws-samples/aws-mainframe-modernization-carddemo>
- Pinned commit: `59cc6c2fd7ebd7ef7925cad552a01a4b8b6e4d5e`
- Retrieved: `2026-09-25T15:14:48.788Z`
- Repository license: Apache-2.0, preserved as `aws-carddemo/LICENSE.upstream.txt`
- Upstream NOTICE: preserved as `aws-carddemo/NOTICE.upstream.txt`
- License status: `RECORDED`

The importer inspects COBOL files only in repository directories named `cbl` under `app/` and
resolves `COPY` statements only against repository directories named `cpy` or `cpy-bms`. It never
reads or imports the repository's sample data directories. The deterministic selection favors
structural feature and size diversity, resolved dependencies, and lower similarity. Exact program
and copybook blob SHAs plus SHA-256 hashes of committed strings are recorded for every candidate.

## Integrity and normalization

- Git commits and blob IDs refer to exact pinned upstream objects.
- License SHA-256 values in the Phase 6.1A metadata hash the exact bytes of the upstream Git blobs.
- Source text is read as UTF-8 and embedded without intentional line-ending normalization.
- Local `contentSha256` values hash the exact strings represented in `candidates.json`.
- Candidate paths use normalized `/` separators; absolute paths, `..`, NUL, and normalized
  duplicates are rejected.
- Security scanning reports only path and pattern type. It does not emit matched values.
- Temporary Git checkouts are created outside the ALSM repository and removed after each import.
