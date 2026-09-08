# ADR-005: Organize Source by Business Module First

- **Status:** Accepted
- **Date:** 2026-08-27
- **Decision owners:** ALSM project team

## Context

ALSM contains many distinct capabilities such as Authentication, Organizations, Projects, Conversion, Validation, Review/Correction, Versioning, Billing, CRM, Support, Admin, and Audit.

A global technical structure such as:

```text
controllers/
services/
repositories/
models/
```

would place unrelated business concerns together and make ownership harder to understand as the codebase grows.

The team also needs predictable folder/file names so multiple developers can work without creating competing structures.

## Decision

Organize source by **business module first**:

```text
src/modules/<business-module>/
```

Then organize a significant module by Clean Architecture responsibility:

```text
domain/
application/
infrastructure/
presentation/
```

Folder and file names use `kebab-case`.

Examples:

```text
src/modules/conversions/
src/modules/organizations/
create-conversion-job.service.ts
mongo-conversion-job.repository.ts
conversion-engine.port.ts
```

Important modules include a `README.md` describing ownership, public contracts, persistence, authorization/tenant rules, and related ADR/SRS references.

## Consequences

### Positive

- business ownership is visible from the path;
- developers can find all code for a capability in one place;
- cross-module coupling is easier to review;
- naming is predictable;
- folder README files communicate boundaries to new contributors.

### Negative / Trade-offs

- some technical concepts appear in multiple modules (for example, each module may have its own mapper/repository folder);
- developers must decide ownership before creating shared utilities;
- very small modules may not need all four layers, so judgment is required.

## Alternatives Considered

### Global technical folders

Rejected because they obscure business ownership and encourage giant shared services/repositories.

### Feature folders without layer boundaries

Simpler initially, but rejected as the default for significant backend modules because persistence/framework concerns can leak into business logic.

## Compliance / Implementation Notes

- Do not create empty folders only for visual symmetry.
- `shared/` is only for genuinely reusable technical concerns.
- Module-to-module imports must not target another module's Infrastructure implementation.
- Naming details are defined in `NAMING_CONVENTIONS.md`.

## Related Documents

- `/RULE.md`
- `PROJECT_STRUCTURE_GUIDELINES.md`
- `NAMING_CONVENTIONS.md`
- `FOLDER_README_GUIDELINES.md`
