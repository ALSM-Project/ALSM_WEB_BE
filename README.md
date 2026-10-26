# ALSM Backend

ALSM (Automating Legacy System Modernization) is the shared NestJS backend for the Self-Service, Internal, and Enterprise React portals. It manages platform workflow around legacy conversion jobs; it does **not** implement BMS/DSPF-to-Frontend or COBOL-to-Java conversion tools.

## ⚠️ Backend Development Rules

Before creating, modifying, refactoring, reviewing, or deleting backend code, every developer, contributor, or AI coding agent MUST read [RULE.md](./RULE.md).

`RULE.md` is the authoritative engineering governance document for the ALSM backend. All backend changes and pull requests are expected to comply with it.

## Engineering Documentation

| Document                                                                           | Purpose                                               |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [RULE.md](./RULE.md)                                                               | Mandatory backend engineering rules                   |
| [Coding Standards](./docs/engineering/CODING_STANDARDS.md)                         | Coding conventions and implementation standards       |
| [Project Structure Guidelines](./docs/engineering/PROJECT_STRUCTURE_GUIDELINES.md) | Folder, module, and layer structure                   |
| [Naming Conventions](./docs/engineering/NAMING_CONVENTIONS.md)                     | Naming rules for files, types, APIs, and Git branches |
| [Architecture Decisions](./docs/engineering/ADR_INDEX.md)                          | Approved architecture decisions and rationale         |
| [Developer Handbook](./docs/engineering/DEVELOPER_HANDBOOK.md)                     | Developer onboarding and daily workflow               |
| [Contribution Guidelines](./docs/engineering/CONTRIBUTING.md)                      | Git, branch, pull-request, and review workflow        |
| [Folder README Guidelines](./docs/engineering/FOLDER_README_GUIDELINES.md)         | Documentation requirements for important folders      |

## Architecture and stack

One Node.js/TypeScript/NestJS **Modular Monolith** applies simplified clean architecture inside business modules: presentation → application → domain, with MongoDB/Mongoose, Redis/BullMQ, Docker Compose, REST/JSON, and external conversion-tool adapters. Modules include auth, users, organizations, projects, conversions, audit, and health. Future validation, reviews, versioning, collaboration, billing, CRM, support, and admin modules are deliberately not scaffolded with fake APIs.

MongoDB is the business source of truth. Redis/BullMQ carries compact conversion queue jobs only (`{ conversionJobId }`). The API and worker are separate runtimes from the same repository; the worker is disabled by default.

## Quick start with Docker

```sh
cp .env.example .env
docker compose up --build
```

The API is at `http://localhost:3000/api/v1`; Swagger is at `http://localhost:3000/api/docs`; health is at `http://localhost:3000/api/v1/health`.

Docker services are `backend`, `worker`, `mongodb`, and `redis`. Service-to-service hostnames are `mongodb` and `redis`.

## Local development

Provide reachable MongoDB/Redis values and a Base64-encoded 32-byte `MFA_ENCRYPTION_KEY` in `.env` (use `localhost` only when Node runs outside Docker), then run:

```sh
npm install
npm run start:dev
# separate terminal, after an external engine adapter exists:
npm run worker
```

Important commands: `npm run build`, `npm run lint`, `npm run test`, `npm run test:e2e`, `npm run format`, `npm run start:prod`, and `npm run worker:prod`.

Startup initializes RBAC roles/permissions only and never creates demo accounts or
resets existing users, even in development/test. Seed flags do not enable accounts.
The legacy actor script is retired. See [RBAC startup and legacy account response](./docs/security/RBAC_BOOTSTRAP.md)
for developer setup, isolated fixtures and authorized incident-response steps.

## Continuous integration

GitHub Actions validates pushes to `feature/**`, `fix/**`, `chore/**`, `refactor/**`, and `develop`, plus pull requests targeting `develop`. Checks cover linting, Jest tests, TypeScript type checking, the NestJS build, and a Docker image build.

## Environment

Copy `.env.example`. Required values include `MONGODB_URI`, `REDIS_HOST`, `REDIS_PORT`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `MFA_ENCRYPTION_KEY`, `CORS_ORIGINS`, and `CONVERSION_WORKER_ENABLED`. `MFA_ENCRYPTION_KEY` must be a stable Base64-encoded 32-byte key; changing it makes existing encrypted MFA secrets undecryptable. Use long random JWT secrets; never commit `.env`. The defaults use Docker hostnames and intentionally marked development placeholders.

## APIs and behavior

- `GET /health`
- Auth: register, login, refresh, logout, `me`, and TOTP 2FA enrollment (`POST /auth/2fa/setup`, then `POST /auth/2fa/confirm`).
- Organization-scoped Projects: create, list, get, update, soft-delete.
- Conversion jobs: create/list per project, get, retry.

Protected project/conversion requests can send `x-organization-id`; it is checked against the authenticated user’s membership and defaults to their first organization. IDs from request bodies are never used as organization authorization proof.

Registration creates a SELF_SERVICE organization with the registrant as OWNER. Refresh JWTs are rotated and their hashes are stored in `user_sessions`. Important events append to `audit_logs`.

Protected routes require a verified JWT and organization role checks in every
environment. Organization lookups never create a workspace or fall back to a
different organization: missing membership returns `ORGANIZATION_ACCESS_DENIED`
(403). Accounts without membership need explicit authorized provisioning.

Project reads never create data. An empty project list returns `[]`; a missing,
deleted, or inaccessible project returns `PROJECT_NOT_FOUND` (404). Use the
authorized `POST /projects` operation to create a project before using its
screens, conversions, validation, or exports. Project ID and name lookups remain
scoped to the resolved organization.

## Future conversion tool integration

Implement an approved adapter for [`ConversionEnginePort`](src/modules/conversions/domain/conversion-job.types.ts) and replace the deliberately failing [`UnconfiguredConversionEngineAdapter`](src/modules/conversions/infrastructure/unconfigured-conversion-engine.adapter.ts). Then set `CONVERSION_WORKER_ENABLED=true`. No conversion parser, mapping rule, generator, or fake result belongs in this bootstrap.
