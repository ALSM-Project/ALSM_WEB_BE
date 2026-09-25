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
- License status: `REVIEW_REQUIRED`

The upstream README states that COBOL-JavaTrans is derived from HumanEval, contains 143 pairs, and
was manually reviewed and validated for compilability and functional correctness. The pinned JSONL
also contains 143 records. No separate dataset-specific license statement was found. The derivation
and upstream validation statement are recorded as provenance/evidence; neither creates ALSM ground
truth or resolves the dataset-specific license question.

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
- Source text is read as UTF-8 and embedded without intentional line-ending normalization.
- Local `contentSha256` values hash the exact strings represented in `candidates.json`.
- Candidate paths use normalized `/` separators; absolute paths, `..`, NUL, and normalized
  duplicates are rejected.
- Security scanning reports only path and pattern type. It does not emit matched values.
- Temporary Git checkouts are created outside the ALSM repository and removed after each import.
