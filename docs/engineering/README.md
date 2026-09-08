# ALSM Engineering Governance

This directory contains the engineering standards that complement the root `RULE.md` for the ALSM backend.

## Authority order

1. Latest approved Business Requirements / SRS — what the system must do.
2. Root `RULE.md` — mandatory backend architecture and engineering invariants.
3. ADRs — accepted architectural decisions and their rationale.
4. Engineering guides in this directory — detailed implementation conventions.
5. Existing code — must be brought into compliance when touched; legacy code is not automatically a standard.

## Documents

| Document | Purpose |
|---|---|
| `CODING_STANDARDS.md` | TypeScript/NestJS coding rules, quality, security, error handling, logging, testing |
| `PROJECT_STRUCTURE_GUIDELINES.md` | Folder/module/layer organization for the ALSM backend |
| `NAMING_CONVENTIONS.md` | Naming rules for folders, files, symbols, APIs, MongoDB, env vars, tests, Git |
| `adr/` | Architecture Decision Records |
| `DEVELOPER_HANDBOOK.md` | Onboarding and day-to-day development workflow |
| `CONTRIBUTING.md` | Pull request and contribution workflow |
| `FOLDER_README_GUIDELINES.md` | Rules and templates for README files in important folders |

## Scope

These documents primarily govern the ALSM backend: Node.js + TypeScript + NestJS, MongoDB/Mongoose, Redis/BullMQ, Docker, REST API, using Modular Monolith + Simplified Clean Architecture.

The React frontend and independent Conversion Tool repositories should have their own technology-specific standards. Shared project-level rules such as Git review, security, traceability, and documentation discipline may be reused, but backend-specific layer rules must not be copied blindly into other repositories.

## Mandatory reading order for a new backend developer

1. `/RULE.md`
2. `docs/engineering/README.md`
3. `CODING_STANDARDS.md`
4. `PROJECT_STRUCTURE_GUIDELINES.md`
5. `NAMING_CONVENTIONS.md`
6. Relevant ADRs
7. Relevant module `README.md`
8. Existing tests and implementation for the feature being change
