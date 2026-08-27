# Reviews Module

## Purpose
Human review, correction decision, and approval workflow.

## Owns
- finding decisions, correction workflow, approval policy

## Does Not Own
- AI model implementation and converter implementation

## Architecture
```text
presentation -> application -> domain <- infrastructure
```

## Public Contracts
Document exported ports/services here. Do not expose Infrastructure implementations.

## Organization / Authorization
Document tenant scope, roles, and privileged access before adding endpoints. Organization-owned resources must enforce server-side isolation.

## Persistence
Document collections owned by this module once implemented.

## Testing
Add business-rule, authorization, tenant-isolation, and API tests as applicable.

## Related Documentation
- `/RULE.md`
- `docs/engineering/PROJECT_STRUCTURE_GUIDELINES.md`
- `docs/engineering/NAMING_CONVENTIONS.md`
- relevant SRS use cases and ADRs
