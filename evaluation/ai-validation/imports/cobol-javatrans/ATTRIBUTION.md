# COBOL-JavaTrans Attribution

This file records source attribution for engineering provenance. It does not state legal approval,
transfer authorship to ALSM, or establish ALSM ground truth.

## COBOL-Coder / COBOL-JavaTrans

- Source: `COBOL-Coder/COBOL-Coder`, commit
  `2b14b7bf7e55556205654c6f7657fa60e36251fa`.
- Dataset: `evaluation/data/COBOL-JavaTrans.jsonl`, Git blob
  `b29ce552a209e6a12cb5b31e130188404ccf8958`.
- License evidence: Apache-2.0 text in `LICENSE.upstream.txt`; no upstream `NOTICE` file was present.
- Paper: Anh T. V. Dau, Shin Hwei Tan, Jinqiu Yang, Nghi D. Q. Bui, and Anh Tuan Nguyen,
  “COBOL-Coder: Domain-Adapted Large Language Models for COBOL Code Generation and Translation,”
  arXiv:2604.03986v1 (2026).

The paper describes COBOL programs as LLM-generated candidates refined through repeated prompting
and manual correction, then manually reviewed for compilability and functional consistency. It says
143 of 164 HumanEval tasks were retained. Individual authorship of each COBOL implementation is not
documented.

## HumanEval / OpenAI

- Source: `openai/human-eval`, resolved commit
  `6d43fb980f9fee3c892a914eda09951f772ad10d`.
- Dataset: `data/HumanEval.jsonl.gz`, Git blob
  `998d25196e17af24daf9b6cb3a975fe752528e46`.
- License evidence: MIT text in `HUMANEVAL_LICENSE.upstream.txt`.
- Copyright notice: `Copyright (c) OpenAI (https://openai.com)`.
- Citation: Mark Chen et al., “Evaluating Large Language Models Trained on Code,” arXiv:2107.03374
  (2021).

The exact MIT copyright and permission notice is preserved; it is not replaced by this summary.

## HumanEval-X / CodeGeeX

- Source: `zai-org/CodeGeeX` (historically `THUDM/CodeGeeX`), resolved commit
  `2838420b7b4492cf3d16bce5320e26e65960c9e2`.
- Java dataset: `codegeex/benchmark/humaneval-x/java/data/humaneval_java.jsonl.gz`, Git blob
  `f9b1d0a477feac75ccce1a9d6f765a600aceb8ba`.
- License evidence: Apache-2.0 text in `HUMANEVAL_X_LICENSE.upstream.txt`; no upstream `NOTICE`
  file was present.
- Citation: Qinkai Zheng et al., “CodeGeeX: A Pre-Trained Model for Code Generation with
  Multilingual Benchmarking on HumanEval-X,” KDD 2023.

The COBOL-Coder paper states that its Java solutions come from HumanEval-X. Artifact comparison
confirmed that all 143 imported Java prompts, complete solutions, and tests exactly match the
corresponding HumanEval-X Java records.

## ALSM copy

ALSM imported the upstream COBOL/Java pairs as unscorable review candidates. ALSM does not claim
authorship of the upstream code, prompts, tests, or benchmark design. License evidence, technical
quality evidence, and human-reviewed semantic ground truth remain separate decisions.
