# COBOL-JavaTrans Human Review Pilot Guide

This guide is for the Phase 6.2A pilot only. It covers 15 deterministically selected
COBOL-JavaTrans cases. AWS CardDemo is not part of this pilot.

Codex, ChatGPT, other LLMs, automated tests, static analyzers, and upstream authors cannot act as
ALSM reviewers. Reviewer identifiers and decisions must be entered manually by actual team members.

## Meaning of the decisions

`CLEAN` means:

> Based on the reviewed COBOL source, Java target, documented task, and available test evidence,
> the reviewer finds no known semantic behavior difference relevant to the task.

`CLEAN` does not mean formal proof of equivalence, bug-free code, coverage of all inputs,
production correctness, or AI-certified correctness.

Choose `NOT_CLEAN_OR_UNCERTAIN` whenever a relevant behavior difference is found or the reviewer
cannot confidently select `CLEAN`. Do not invent an expected finding or mutation. Phase 6.2A does
not promote non-clean, uncertain, or disputed cases.

## Files

- `selection.json` binds the 15 cases to the pinned candidate manifest and content hashes.
- `pilot-summary.md` is the case index and evidence summary. Full immutable source, target, task
  prompts, and upstream tests remain in
  `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`.
- `reviewer-a.template.json` and `reviewer-b.template.json` are identity-free decision templates.
- `finalization.template.json` requests human-authored title, description, and semantic review
  difficulty for cases that reconcile to `READY_CLEAN`.
- `promotion-metadata.template.json` supplies the clean-pilot dataset metadata.
- `automated-verification.json` records compiler availability and test execution separately from
  human decisions. Automated evidence never grants approval.
- `evaluation/ai-validation/reviews/work/` is git-ignored and is the preferred location for actual
  individual review files and generated reconciliation output.

## Review checklist

Use only the categories relevant to the selected simple task. Compare the documented task with both
implementations; do not search for a predetermined defect.

- Inputs: accepted values, fixed versus variable collection sizes, empty/boundary inputs, and input
  mutation.
- Outputs and return behavior: value, type/representation, ordering, default value, and early exits.
- Conditions: branch coverage, boolean grouping, comparison operators, inclusivity, and sign checks.
- Loops: starting index, ending condition, direction, step, nesting, and termination.
- Numeric semantics: integer versus decimal operations, truncation/rounding, overflow range, sign,
  and COBOL picture/COMP representation where relevant.
- Variable mapping: each input, working value, collection element, output, and COBOL linkage field
  maps to the intended Java value.
- Missing or extra operations: initialization, update, sort, accumulation, filtering, conversion,
  and return/write operations.
- Errors and exceptions: observable behavior for invalid or boundary values documented by the task.
- Observable side effects: input mutation, file/display output, persistent state, and call behavior
  when relevant.

Upstream structured tests and Java test source are evidence only. Passing tests cannot set `CLEAN`;
failing tests cannot create expected findings automatically.

## Independent workflow

Run commands from the repository root. This repository's npm version requires the extra `--`
separator shown below when passing named arguments.

1. Pull the latest `develop` and use a separate feature branch. Run the repository baseline before
   reviewing.

2. Inspect `selection.json`, `pilot-summary.md`, and each selected record in
   `evaluation/ai-validation/imports/cobol-javatrans/candidates.json`. Search by exact
   `candidateId`, then inspect `sourceFiles`, `targetFiles`, `upstreamEvidence`, and `provenance`.
   Do not modify the source or target.

3. Reviewer A creates a private working copy and fills every decision independently:

   ```powershell
   Copy-Item `
     evaluation/ai-validation/reviews/cobol-javatrans-pilot-v1/reviewer-a.template.json `
     evaluation/ai-validation/reviews/work/reviewer-a.json
   ```

   For each case, Reviewer A manually supplies their actual `reviewerId`, an ISO-8601 `reviewedAt`,
   `equivalenceDecision` (`CLEAN` or `NOT_CLEAN_OR_UNCERTAIN`), and optional factual `notes`.

4. Reviewer B independently creates and completes a separate file without viewing Reviewer A's
   decisions where practical:

   ```powershell
   Copy-Item `
     evaluation/ai-validation/reviews/cobol-javatrans-pilot-v1/reviewer-b.template.json `
     evaluation/ai-validation/reviews/work/reviewer-b.json
   ```

5. After both reviewers finish, validate the files in complete mode:

   ```powershell
   npm run eval:ai:review:validate -- -- `
     --mode complete `
     --review-a evaluation/ai-validation/reviews/work/reviewer-a.json `
     --review-b evaluation/ai-validation/reviews/work/reviewer-b.json
   ```

   Validation rejects duplicate or unknown cases, the wrong pilot or selection hash, stale source
   or target hashes, missing fields, invalid decisions, AI/automation reviewer identifiers, and
   other structural errors. The comparison step additionally rejects the same reviewer in both
   roles.

6. Compare the two valid review files:

   ```powershell
   npm run eval:ai:review:compare -- -- `
     --selection evaluation/ai-validation/reviews/cobol-javatrans-pilot-v1/selection.json `
     --review-a evaluation/ai-validation/reviews/work/reviewer-a.json `
     --review-b evaluation/ai-validation/reviews/work/reviewer-b.json `
     --output evaluation/ai-validation/reviews/work/pilot-comparison.json
   ```

   Reconciliation states are:

   - `READY_CLEAN`: both complete, distinct human reviewers selected `CLEAN`.
   - `DISAGREEMENT`: the two complete decisions differ.
   - `NOT_CLEAN_OR_UNCERTAIN`: both selected that decision.
   - `NEEDS_REVIEW`: either decision is absent or incomplete.

7. Humans may discuss disagreements, but this tooling does not select a winner or rewrite either
   review. `DISAGREEMENT` and `NOT_CLEAN_OR_UNCERTAIN` remain outside this clean-control pilot and
   require a later, separately defined adjudication process.

8. Copy `finalization.template.json` into `reviews/work/finalization.json`. For every
   `READY_CLEAN` case, a human supplies a concise `title`, `description`, and `difficulty` of
   `EASY`, `MEDIUM`, or `HARD`. Difficulty is semantic review complexity; never map SMALL, MEDIUM,
   or LARGE size strata to difficulty. Non-ready entries may remain null.

9. Generate the ordinary Phase 6 imported review manifest. The command revalidates the pinned
   candidate manifest, license status, selection hash, content hashes, both human decisions, and
   final metadata. With no `READY_CLEAN` cases it succeeds with zero and writes no manifest.

   ```powershell
   npm run eval:ai:review:finalize -- -- `
     --review-a evaluation/ai-validation/reviews/work/reviewer-a.json `
     --review-b evaluation/ai-validation/reviews/work/reviewer-b.json `
     --finalization evaluation/ai-validation/reviews/work/finalization.json `
     --output evaluation/ai-validation/reviews/work/finalized-review-manifest.json
   ```

10. If and only if a non-empty finalized manifest was written, run the existing promotion gate:

    ```powershell
    npm run eval:ai:import:promote -- -- `
      --candidates evaluation/ai-validation/imports/cobol-javatrans/candidates.json `
      --reviews evaluation/ai-validation/reviews/work/finalized-review-manifest.json `
      --metadata evaluation/ai-validation/reviews/cobol-javatrans-pilot-v1/promotion-metadata.template.json `
      --output evaluation/ai-validation/reviews/work/cobol-java-external-clean-pilot.json

    npm run eval:ai:validate -- -- `
      --dataset evaluation/ai-validation/reviews/work/cobol-java-external-clean-pilot.json
    ```

11. Scoring is a later activity, after humans approve and the promoted dataset is frozen. Do not run
    `eval:ai:run` as part of this review workflow.

Completed personal review files should remain under the git-ignored `reviews/work/` directory unless
the team explicitly chooses otherwise. A later commit may contain a reconciled human-reviewed
manifest; unfinished personal files should not be committed by default.
