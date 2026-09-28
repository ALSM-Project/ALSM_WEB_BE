# COBOL-JavaTrans License and Provenance Audit

Audit date: 2026-09-26. Outcome: `EVIDENCE_COMPLETE` under ALSM engineering policy.

This is an engineering evidence record, not legal advice or a guarantee of rights or risk.
`RECORDED` means license/provenance evidence is recorded for engineering use. It is not legal
approval.

## License chain matrix

| Layer | Artifact | License evidence | Attribution evidence | Engineering status |
| --- | --- | --- | --- | --- |
| HumanEval | `openai/human-eval` benchmark | MIT `LICENSE` at resolved commit; exact snapshot and hashes retained | OpenAI copyright notice and official paper citation retained | `VERIFIED` |
| HumanEval-X | Java HumanEval-X records | Apache-2.0 root `LICENSE`; README says repository code uses Apache-2.0; no benchmark-specific override or `NOTICE` found | CodeGeeX/HumanEval-X KDD 2023 citation retained | `VERIFIED` |
| COBOL-JavaTrans | 143 derived COBOL/Java pairs | Contained in Apache-2.0 COBOL-Coder repository; no dataset-specific override or additional terms found | README and paper identify HumanEval and HumanEval-X derivation; exact upstream artifact comparisons recorded | `VERIFIED` |
| COBOL-Coder | Repository at pinned commit | Apache-2.0 root `LICENSE`; no `NOTICE` found | Paper authors and immutable repository revision retained | `VERIFIED` |
| ALSM copy | Imported candidate payload | All three exact license texts/provenance records retained; only the audited commit/blob maps to `RECORDED` | `ATTRIBUTION.md` and immutable hashes retained | `EVIDENCE_COMPLETE` |

## COBOL-Coder evidence at the pinned commit

- Repository: `COBOL-Coder/COBOL-Coder`.
- Commit: `2b14b7bf7e55556205654c6f7657fa60e36251fa`.
- Dataset path: `evaluation/data/COBOL-JavaTrans.jsonl`.
- Dataset Git blob: `b29ce552a209e6a12cb5b31e130188404ccf8958`.
- Root `LICENSE`: Apache License 2.0; exact text retained as `LICENSE.upstream.txt`.
- `NOTICE`: not present anywhere in the pinned tree.
- Dataset-specific license, notice, usage terms, or redistribution restriction: not found in
  `evaluation/data/`, `README.md`, `docs/codebase.md`, `CITATION.cff`, or other repository
  documentation searched for license/copyright/attribution/derived/benchmark/dataset terms.
- `README.md:203-213` states that COBOL-JavaTrans is derived from HumanEval, contains 143 of 164
  HumanEval tasks with COBOL and Java implementations and tests, and was manually reviewed and
  validated for compilability and functional correctness.
- `docs/codebase.md:25-26,82-88` identifies the 143-pair dataset and describes compile-and-test
  evaluation with `javac` and GnuCOBOL.
- `CITATION.cff` describes LlamaFactory rather than COBOL-Coder and was not used as attribution or
  license evidence. The COBOL-Coder citation was taken from `README.md:246-256` and the official
  arXiv record.

## Derivation and construction evidence

The official paper, arXiv:2604.03986v1 section 3.1.4, states that:

- COBOL-JavaTrans is derived from HumanEval;
- COBOL programs were generated for HumanEval tasks through an LLM-assisted workflow, refined by
  repeated prompting and manual correction;
- all produced programs were manually reviewed for compilability and functional consistency;
- 143 of 164 tasks were retained after compilation and test execution;
- Java solutions came from HumanEval-X; and
- task specifications were adapted for COBOL compatibility.

Artifact comparison adds the following reproducible facts:

- all 143 COBOL-JavaTrans task IDs map to records in both HumanEval and HumanEval-X;
- 141 of 143 `entry_point` values exactly match the HumanEval records; and
- all 143 Java prompts, complete solutions, and Java tests exactly match HumanEval-X records at the
  recorded Git blob.

Required non-inferences:

- Whether COBOL tests were adapted directly from HumanEval tests: **NOT DOCUMENTED**.
- Individual authorship of each COBOL implementation: **NOT DOCUMENTED**.
- COBOL-Coder authorship of Java implementations: not claimed; the paper identifies HumanEval-X as
  their source.
- Individual authorship of each HumanEval-X Java implementation: **NOT DOCUMENTED** in the
  COBOL-Coder sources; HumanEval-X describes the benchmark samples as human-crafted.
- Whether the dataset contains “substantial HumanEval material” as a legal characterization:
  **NOT DOCUMENTED**. Exact task-ID and HumanEval-X Java-content correspondences are recorded
  instead.

## HumanEval evidence

- Authoritative repository: `openai/human-eval`.
- Resolved immutable revision: `6d43fb980f9fee3c892a914eda09951f772ad10d`.
- License: MIT, with exact copyright and permission text retained in
  `HUMANEVAL_LICENSE.upstream.txt`.
- Dataset: 164 records in `data/HumanEval.jsonl.gz`; exact Git blob and SHA-256 are recorded in
  `humaneval-upstream.json`.
- Separate dataset terms or `NOTICE`: not found.
- Official README citation: Mark Chen et al., “Evaluating Large Language Models Trained on Code,”
  arXiv:2107.03374 (2021).

## HumanEval-X evidence

- Authoritative repository used for verification: `zai-org/CodeGeeX`, historically linked as
  `THUDM/CodeGeeX`.
- Resolved immutable revision: `2838420b7b4492cf3d16bce5320e26e65960c9e2`.
- License: Apache-2.0 root `LICENSE`; exact text retained in
  `HUMANEVAL_X_LICENSE.upstream.txt`.
- README scope evidence: repository code is Apache-2.0 licensed, HumanEval-X is documented under
  `codegeex/benchmark`, and the model has a separate model license. No HumanEval-X-specific
  override, extra usage term, or `NOTICE` was found.
- Exact Java dataset Git blob and comparison counts are recorded in `humaneval-x-upstream.json`.

## Notices and redistribution evidence recorded

The retained Apache-2.0 texts state, in section 4, requirements including providing a copy of the
license, marking modified files, retaining applicable notices, and reproducing an upstream NOTICE
when one is distributed. The audited COBOL-Coder and CodeGeeX trees contain no `NOTICE` file. ALSM
retains both exact Apache-2.0 license snapshots and attribution instead.

The retained MIT text requires its copyright and permission notice to be included in copies or
substantial portions. ALSM retains the exact HumanEval MIT text and OpenAI copyright notice.

## Engineering outcome

`OUTCOME A — EVIDENCE COMPLETE`

The repository licenses are identified, no conflicting dataset-specific terms were found,
HumanEval and HumanEval-X source licenses are recorded, the derivation is explicit, required texts
and attribution are preservable, immutable source revisions and blobs are recorded, and no audited
source states a redistribution restriction conflicting with the intended repository copy. The 143
candidate payloads therefore remain tracked and the audited manifest moves from `REVIEW_REQUIRED`
to `RECORDED` under ALSM engineering policy.

This outcome changes only license/provenance evidence. Every candidate remains `scorable: false`,
`humanReviewRequired: true`, and `groundTruthStatus: PENDING_ALSM_REVIEW`. It creates no clean or
defective label, expected finding, reviewer approval, or other ground truth.
