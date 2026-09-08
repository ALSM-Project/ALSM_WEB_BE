# ALSM Backend Developer Handbook

This handbook is the onboarding and daily-work guide for backend developers.

## 1. What ALSM is

ALSM is a Legacy Modernization Platform with three portals sharing one backend platform:

- Web 1 — Self-Service;
- Web 2 — Internal;
- Web 3 — Enterprise / Partner views.

The platform supports two conversion capabilities:

- BMS/DSPF to modern frontend output;
- COBOL to Java.

The backend manages platform workflow, security, organizations, projects, jobs, validation/review/versioning, billing/support/admin concerns, and integration boundaries.

The actual conversion algorithms are independent tools and must not be implemented directly inside the backend.

## 2. Official backend stack

```text
Node.js
TypeScript
NestJS
MongoDB + Mongoose
Redis + BullMQ
REST API
Docker + Docker Compose
npm
```

Architecture:

```text
Modular Monolith + Simplified Clean Architecture
```

## 3. Read this before coding

Required reading order:

1. `/RULE.md`
2. `docs/engineering/README.md`
3. `CODING_STANDARDS.md`
4. `PROJECT_STRUCTURE_GUIDELINES.md`
5. `NAMING_CONVENTIONS.md`
6. relevant ADRs
7. relevant module `README.md`
8. relevant tests/source code

## 4. First local setup

Typical first run:

```bash
cp .env.example .env
npm ci
docker compose up --build
```

Or, when infrastructure runs in Docker and Node runs locally:

```bash
npm ci
npm run start:dev
npm run worker:dev
```

Check the repository README for the actual current commands.

Expected development endpoints:

```text
API      http://localhost:3000/api/v1
Swagger  http://localhost:3000/api/docs
Health   http://localhost:3000/api/v1/health
```

## 5. Docker mental model

Core containers:

```text
backend
worker
mongodb
redis
```

Inside Docker, the backend uses service hostnames:

```text
mongodb
redis
```

not `localhost` for container-to-container calls.

The API and Worker are separate processes, not separate business microservices.

## 6. How to start a task

Before editing code:

1. Read the Jira/task requirement and relevant SRS use case.
2. Identify which business module owns the state/behavior.
3. Identify which layer must change.
4. Inspect existing implementation and tests.
5. Identify organization/role rules.
6. Identify repository or external ports.
7. Check whether the API contract changes.
8. Check whether `.env.example`, Swagger, README, or ADR needs updating.

Do not start by creating files based only on the task title.

## 7. Typical feature flow

Example: Add `Retry Conversion Job`.

```text
Requirement
  ↓
conversions module owns behavior
  ↓
Domain: retryable state rule
  ↓
Application: RetryConversionJobService.execute()
  ↓
Repository/Queue ports
  ↓
Infrastructure implementations
  ↓
Controller endpoint
  ↓
Presenter/error mapping
  ↓
Unit + E2E tests
  ↓
Audit entry
```

## 8. Organization isolation workflow

For every organization-owned resource ask:

```text
Who is authenticated?
Which organization context is active?
What membership/role does the actor have?
Does the resource belong to that organization?
Is an internal privilege being used?
Should the action be audited?
```

Never skip this because the UI hides a button.

## 9. Conversion workflow mental model

```text
Project selects conversion type
  ↓
Input validated against type
  ↓
Persistent Conversion Job created
  ↓
BullMQ receives small job ID
  ↓
Worker consumes job
  ↓
ConversionEnginePort selects external tool adapter
  ↓
Result/version persisted
  ↓
Rule validation + optional AI validation
  ↓
Human review/correction if needed
  ↓
Re-conversion creates a new version
  ↓
READY_FOR_EXPORT
  ↓
Export exact approved version
```

Do not mix `ConversionJobStatus` with the broader business lifecycle.

## 10. AI Validator mental model

AI:

```text
can suggest findings
can provide reason/confidence
cannot perform primary conversion
cannot overwrite result
cannot auto-approve
cannot bypass human review
```

## 11. Git workflow

The repository should have one stable branch and one integration branch. The exact branch names configured in GitHub are authoritative for the repository.

Recommended engineering flow:

```text
integration branch
  ↓
feature/fix branch
  ↓
commit small changes
  ↓
update from integration branch
  ↓
Push
  ↓
Pull Request
  ↓
Review + tests
  ↓
Merge to integration
  ↓
stable milestone -> main
```

One branch = one clear objective.

Do not bundle unrelated features into a single PR.

## 12. Commit convention

```text
[Feature][ChangedPart]: Change summary
```

Examples:

```text
[Project][Create]: Enforce conversion type at creation
[Conversion][Retry]: Requeue dead conversion jobs
[Validation][AI]: Add validator adapter timeout handling
[Fix][Auth]: Revoke old refresh session after rotation
```

## 13. Pull request minimum content

Every PR should contain:

- Summary
- Related ticket/use case
- Changed modules
- Architecture impact
- Security/tenant impact
- How to test
- Test evidence
- API/config/documentation changes
- Known limitations/TODOs

## 14. Definition of Done

Before requesting review:

```bash
npm run lint
npm run test
npm run build
```

Run when relevant:

```bash
npm run test:e2e
npm run architecture:check
docker compose config
```

Also verify:

- no secrets committed;
- no cross-organization data leak;
- no raw Mongoose document escapes Infrastructure;
- no controller business logic;
- no fake Conversion Tool;
- version history preserved;
- AI does not mutate/approve;
- Swagger updated if API changed;
- `.env.example` updated if config changed;
- README/ADR updated if architecture/setup changed.

## 15. Debugging checklist

When the backend cannot start:

1. Validate `.env`.
2. Run `docker compose config`.
3. Check MongoDB health.
4. Check Redis health.
5. Check container hostnames.
6. Check port collisions.
7. Check Mongoose connection URL.
8. Check Node/Nest build errors.
9. Check Worker enable flag.

When conversion jobs do not move:

1. Is `CONVERSION_WORKER_ENABLED` true?
2. Is Redis healthy?
3. Is the job in BullMQ?
4. Does MongoDB job state match queue state?
5. Does the Worker have the correct queue name?
6. Is a Conversion Tool adapter actually configured?
7. Is the job eligible for processing/retry?

## 16. Common mistakes to avoid

- Querying Mongoose from Controllers.
- Importing another module's schema.
- Using `organizationId` from request body as authorization.
- Making Redis the business source of truth.
- Passing source files in queue payloads.
- Implementing actual parser/generator logic in backend.
- Treating AI confidence as approval.
- Overwriting conversion versions.
- Exporting non-ready versions.
- Adding `forwardRef()` without reviewing boundaries.
- Making huge "update everything" branches.

## 17. When to create an ADR

Create or update an ADR when changing decisions such as:

- architecture pattern;
- database technology;
- queue/broker technology;
- module boundary;
- authentication model;
- organization isolation approach;
- Conversion Tool integration protocol;
- deployment topology;
- a major cross-module event strategy.

Do not create an ADR for small implementation details.

## 18. Where to ask for review

Architecture-impacting changes should be reviewed by the technical lead/team before implementation if they conflict with `RULE.md` or an accepted ADR.

Never silently change architecture to make one task easier.
