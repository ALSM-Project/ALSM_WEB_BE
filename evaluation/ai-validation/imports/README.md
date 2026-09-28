# External Evaluation Candidate Imports

This directory is a staging layer for public external evidence. Its `candidates.json` files are not
Phase 6 datasets, are not accepted as ground truth, and must not be passed to the scorer.

The workflow is deliberately one-way:

```text
Pinned external source
  -> unscorable imported candidate
  -> explicit review by at least two team members
  -> guarded promotion
  -> Phase 6 EvaluationCase
```

Each source directory contains pinned upstream metadata, exact license snapshots, a candidate
manifest, and a pending review template. AWS also preserves its upstream NOTICE. Candidate source
and target strings are stored exactly as read from the pinned Git checkout and hashed as UTF-8.

`COBOL_JAVATRANS` candidates include upstream COBOL/Java pairs and test evidence. The Phase 6.1A
audit records the COBOL-Coder, HumanEval, and HumanEval-X license/provenance chain for the exact
audited dataset blob, so its license status is `RECORDED`. This status is revision-specific and
means only that engineering evidence is recorded; the upstream validation claim remains quality
evidence, and every candidate remains unscorable pending ALSM human review.

`AWS_CARDDEMO` candidates contain only COBOL programs and repository-resolved copybooks. They have
no Java target and cannot be promoted until Java provenance and behavioral verification are
explicitly recorded by human reviewers.

Do not edit pending templates to imply approval. Create a separate reviewed decision file and use
the promotion command described in the parent README.
