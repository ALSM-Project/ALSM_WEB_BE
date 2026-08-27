# Contributing to ALSM Backend

This document explains how contributors should make backend changes safely and consistently.

## 1. Before contributing

Read:

1. `/RULE.md`
2. `docs/engineering/CODING_STANDARDS.md`
3. `docs/engineering/PROJECT_STRUCTURE_GUIDELINES.md`
4. `docs/engineering/NAMING_CONVENTIONS.md`
5. relevant ADR(s)
6. relevant module `README.md`

Do not submit changes that knowingly violate these documents without an approved architecture decision.

## 2. Task scope

A contribution should have one clear purpose.

Good:

```text
Add refresh-token rotation
Fix project organization isolation
Implement retry for DEAD conversion jobs
Add ConversionEnginePort adapter contract
```

Bad:

```text
Big backend update
Refactor everything
Fix bugs and add billing and change database
```

## 3. Branches

Create a branch from the repository's current integration branch.

Recommended naming:

```text
feature/<ticket>-<short-scope>
fix/<ticket>-<short-scope>
refactor/<ticket>-<short-scope>
docs/<ticket>-<short-scope>
```

Example:

```text
feature/ALSM-140-two-factor-auth
fix/ALSM-207-tenant-isolation
```

If the repository is still using the older academic naming style documented in the Project Management Plan, keep that format consistently until the team formally migrates it. Do not mix conventions ad hoc.

## 4. Commit messages

Use:

```text
[Feature][ChangedPart]: Change summary
```

Examples:

```text
[Auth][Login]: Add account lock check
[Project][Create]: Validate organization membership
[Conversion][Queue]: Enqueue conversion job by ID
[Fix][Validation]: Preserve finding decision during reload
```

Commits should be small enough to review.

## 5. Keep your branch current

Before opening/updating a PR:

```bash
git fetch origin
git checkout <your-branch>
git merge origin/<integration-branch>
```

or use the team's agreed rebase workflow.

Resolve conflicts intentionally. Do not delete another contributor's code merely to make the merge pass.

## 6. Pull request template

Use the following body:

```md
## Summary

## Related Ticket / Use Case

## Changed Modules

## What Changed

## Architecture / Layer Impact

## Organization & Authorization Impact

## API / Database / Queue Impact

## How to Test

## Test Results
- [ ] npm run lint
- [ ] npm run test
- [ ] npm run build
- [ ] npm run test:e2e (if relevant)
- [ ] npm run architecture:check (if available)

## Documentation / Config Updated
- [ ] Swagger
- [ ] .env.example
- [ ] README
- [ ] ADR

## Known Limitations / TODOs
```

## 7. PR review rules

Do not merge if:

- build fails;
- required tests fail;
- unresolved conflicts exist;
- tenant isolation is not verified;
- authorization is bypassed;
- Controller accesses DB/queue directly;
- Domain depends on infrastructure/framework code;
- the PR contains unrelated changes;
- real secrets are present;
- Conversion Tool logic was embedded in backend;
- conversion history can be overwritten;
- non-ready versions can be exported;
- documentation/config required by the change is missing.

## 8. Review checklist

Reviewer checks:

### Requirement

- Does the behavior match the latest approved requirement?
- Are edge cases covered?

### Architecture

- Correct module ownership?
- Correct layer?
- Repository/port boundary respected?
- Cross-module access through public contract?

### Security

- Authentication required where needed?
- Correct role/permission?
- Organization isolation enforced?
- Sensitive data excluded from logs/audit?

### Conversion-specific

- Async job pattern preserved?
- Queue payload small?
- Correct conversion type strategy?
- No fake converter?
- Versioning preserved?
- AI only advisory?

### Quality

- Tests meaningful?
- Naming clear?
- No dead code?
- Swagger/config/docs updated?

## 9. Database changes

A schema change must review:

- existing data compatibility;
- indexes;
- organization ownership;
- defaults;
- enum changes;
- version/audit impact;
- migration/backfill needs.

Do not casually rename persisted fields without a compatibility plan.

## 10. API changes

For existing endpoints:

- preserve backward compatibility where possible;
- update Swagger;
- document changed error codes/response fields;
- coordinate frontend changes;
- avoid changing contracts merely to simplify one implementation.

## 11. Configuration changes

When adding a config variable:

- validate it at startup;
- add it to `.env.example`;
- document purpose/default behavior;
- never commit real secret values.

## 12. Architecture changes

Do not implement a major architecture change inside a normal feature PR.

First create/update an ADR covering:

- context/problem;
- decision;
- alternatives;
- trade-offs;
- migration impact;
- approval status.

Then update `RULE.md`, README/SDD, and implementation consistently after approval.

## 13. Branch cleanup

After merge:

- delete the merged feature/fix branch unless the team has a reason to retain it;
- tag demo/release milestones when required;
- do not keep abandoned long-lived branches as unofficial backups.

Git history is the source of version history; do not keep duplicate "final_final_v2" source folders.
