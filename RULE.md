# ALSM Backend Engineering Rules

> **IMPORTANT**  
> This file defines the mandatory engineering rules for the ALSM backend. Every developer, contributor, or AI coding agent **MUST** read this file before creating, modifying, refactoring, or deleting backend code. Backend code must comply unless an architectural change is explicitly reviewed and approved by the team.

## Technology and architecture

- Frontend: ReactJS. Backend: Node.js, TypeScript, NestJS. API: REST/JSON.
- Architecture: one **Modular Monolith** using Simplified Clean Architecture; never one backend per portal.
- Persistence: MongoDB with Mongoose. Queue: Redis with BullMQ. Containers: Docker and Docker Compose.
- BMS/DSPF-to-Frontend and COBOL-to-Java algorithms are independent external tools. This backend must never contain parsers, conversion rules, generators, fake results, or AI conversion code.
- Do not introduce microservices, Kubernetes, Kafka, RabbitMQ, GraphQL, CQRS frameworks, event sourcing, service mesh, or multiple primary databases without approved architecture change.

## Modules and dependencies

Business code belongs in `src/modules/<module>`, not global controller/service/repository folders. Significant modules use `presentation`, `application`, `domain`, and `infrastructure`.

`presentation → application → domain`; infrastructure implements domain/application ports. Domain must not import Mongoose, MongoDB, Redis, BullMQ, or Docker. Controllers validate, get authenticated context, call a use case, and return a response. They never query MongoDB or hold business logic. Application code depends on repository/queue ports, not Mongoose models. Use explicit use cases for complex workflows; avoid needless abstractions for trivial work.

`shared` is only for reusable technical concerns (errors, logging, security, database, queue), never a business dumping ground.

## Data, security, and tenancy

- MongoDB is the business source of truth; Redis/BullMQ is only execution infrastructure. Queue payloads stay small—normally `{ conversionJobId }`.
- Organization-owned resources must be queried with authorization scope, normally `organizationId`. Never trust an organization id from a client. Organization A must not read or mutate Organization B data.
- Initial roles are `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`; platform administration is separate. Centralize authorization in guards, policies, decorators, or equivalent.
- Authentication uses JWT access/refresh tokens and `user_sessions`. Hash passwords and refresh tokens; never store plaintext credentials/tokens.
- Secrets are environment variables. Never commit secrets, connection credentials, OAuth/Stripe/API/AI keys, or `.env`.
- Projects are soft deleted (`deletedAt`); normal reads exclude deleted records.

## Conversions and worker

Conversion jobs support `BMS_DSPF_TO_FRONTEND` and `COBOL_TO_JAVA`. Long work never executes in an HTTP request: persist a `QUEUED` job, enqueue it, and return immediately. The API and worker are separate processes/containers. The worker loads a job and coordinates an external `ConversionEnginePort`; it remains disabled by default until a real adapter is approved. Do not put source files in queue payloads.

## API, errors, audit, quality

- Validate DTOs globally and reject unknown fields. Use centralized, stack-trace-free error responses with meaningful codes (for example `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `PROJECT_NOT_FOUND`).
- Important operations are append-only audit events. Never audit passwords, tokens, secrets, payment data, or full source code.
- Use strict TypeScript. Files are kebab-case; types/classes PascalCase; variables/functions camelCase; constants UPPER_SNAKE_CASE. Avoid `any`, giant files, circular dependencies, and `forwardRef`.
- Use Helmet, environment-configured CORS, request IDs where practical, Swagger, and structured non-sensitive logs.
- Before meaningful work, run applicable `npm run lint`, `npm run test`, and `npm run build`; report only commands actually run.

## Docker and workflow

`docker compose up --build` provides `backend`, `worker`, `mongodb`, and `redis`. Containers use service hostnames `mongodb` and `redis`, never `localhost`. Redis queue data must not be treated as disposable.

Before any change: (1) read this file; (2) identify module/layer; (3) inspect code/tests; (4) check authentication, authorization, and organization isolation; (5) decide if a port/adapter is needed; (6) implement and verify. Update this document, README, architecture docs, and implementation consistently only for approved project-wide decisions.
