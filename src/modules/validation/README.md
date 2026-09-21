# Validation Module

## Purpose

Validation owns rule-based and AI-assisted validation of conversion results. It is a separate
business capability from conversion execution, and all AI output remains advisory until a human
reviews it.

## Responsibilities

- future validation run orchestration;
- validation finding contracts;
- AI validator provider abstraction;
- future deterministic rule validation;
- future AI semantic validation;
- future human review workflow integration.

The intended relationship is:

```text
Project
  -> ConversionJob
      -> ValidationRun
          -> ValidationFinding
```

A Conversion Job may have multiple Validation Runs. Findings belong to their Validation Run and
must not be mixed with conversion-tool `error_logs` or attached directly to the Conversion Job
record.

## Non-Responsibilities

- does not convert COBOL to Java;
- does not convert BMS/DSPF;
- does not own parsers;
- does not own code generators;
- does not automatically modify generated code;
- does not automatically accept AI findings;
- does not replace human review.

Model confidence is advisory metadata only. It is not a correctness score, migration quality
score, deterministic proof, or final human decision.

## Future Flow

```text
Conversion Completed
    ↓
Validation Run
    ↓
Deterministic Validators
    ↓
AI Validator
    ↓
Validation Findings
    ↓
Human Review
```

## Phase 1 Scope

Phase 1 defines only the validation domain contracts, the provider-neutral AI validator port, and
an inert fake adapter that always returns an empty findings list.

Phase 1 does **not** include:

- persistence;
- queue;
- validation worker;
- controllers or APIs;
- real AI providers;
- retrieval-augmented generation (RAG);
- dataset processing;
- fine-tuning.
