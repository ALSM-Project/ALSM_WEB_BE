# ALSM Folder README Guidelines

Important folders should explain their ownership and boundaries so new developers do not infer architecture from filenames alone.

## 1. Which folders require README.md

Required/recommended README files:

```text
src/modules/README.md
src/modules/<important-business-module>/README.md
src/shared/README.md
src/worker/README.md
src/config/README.md
docs/engineering/adr/README.md
```

A tiny folder containing only one obvious file does not need a README.

## 2. Purpose of a folder README

A folder README should answer:

1. Why does this folder/module exist?
2. What business/technical responsibility does it own?
3. What does it explicitly NOT own?
4. What are its public entry points/contracts?
5. What dependencies may it use?
6. Which modules may depend on it?
7. Which data/collections does it own?
8. What important business invariants apply?
9. How is it tested?
10. Which ADR/SRS/use cases relate to it?

## 3. Standard module README template

````md
# <Module Name>

## Purpose

## Owns
- ...

## Does Not Own
- ...

## Public Contracts
- ...

## Architecture
```text
presentation -> application -> domain <- infrastructure
```

## Folder Structure
```text
...
```

## Main Use Cases
- ...

## Domain Invariants
- ...

## Persistence / Collections
- ...

## Events / Ports
- ...

## Authorization / Organization Scope
- ...

## Environment Variables
- ...

## Testing
- ...

## Related Documentation
- `RULE.md`
- ADR-...
- SRS UC-...

## Change Rules
- ...
````

## 4. Example: `projects/README.md`

```md
# Projects Module

## Purpose
Owns Project lifecycle and the immutable choice of conversion type at project creation.

## Owns
- project create/read/update/soft-delete
- project conversion type
- project organization ownership

## Does Not Own
- executing conversions
- validating generated output
- billing implementation
- actual Conversion Tool algorithms

## Public Contracts
- project repository/access port exposed to authorized modules

## Domain Invariants
- project must belong to one organization
- conversion type is selected before upload
- input must later match project conversion type
- normal deletion is soft delete

## Persistence
- `projects`

## Authorization
All operations are organization-scoped. A project from Organization A must not be accessible by Organization B.
```

## 5. Example: `conversions/README.md`

It should clearly explain:

- job execution status vs business conversion lifecycle;
- MongoDB is business source of truth;
- Redis/BullMQ is execution queue;
- Worker is separate runtime;
- queue payload contains references/IDs;
- actual BMS/DSPF/COBOL conversion implementation is external;
- `ConversionEnginePort` is the integration boundary;
- re-conversion preserves old versions;
- export is gated by `READY_FOR_EXPORT`.

## 6. Example: `shared/README.md`

Must contain a warning similar to:

> `shared/` is not a dumping ground. A component belongs here only when it is genuinely reusable technical infrastructure and does not belong to one business module.

List allowed categories and forbidden examples.

## 7. Example: `worker/README.md`

Document:

- worker entrypoint;
- queue name(s);
- enable flag;
- MongoDB/Redis dependencies;
- processing lifecycle;
- retry behavior;
- how to run locally;
- how to run in Docker;
- what happens while Conversion Tools are unavailable.

## 8. Example: `config/README.md`

Document:

- all config groups;
- startup validation;
- `.env.example` policy;
- secrets policy;
- Docker hostname differences;
- no `process.env` access scattered through modules.

## 9. README maintenance rule

A README is part of the code contract.

Update it when:

- folder ownership changes;
- a new public port is introduced;
- a collection is added/moved;
- environment requirements change;
- a major business invariant changes;
- an ADR changes the architecture.

Do not maintain a README that contradicts the current code/RULE/ADR.

## 10. Templates

Ready-to-copy templates are provided in:

```text
docs/engineering/folder-readme-templates/
```
