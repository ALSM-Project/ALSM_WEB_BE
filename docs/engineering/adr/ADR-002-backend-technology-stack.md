# ADR-002: Standardize Backend on Node.js/NestJS, MongoDB, Redis/BullMQ, Docker

- **Status:** Accepted
- **Date:** 2026-08-27
- **Decision owners:** ALSM project team

## Context

ALSM needs a shared backend for three portals, persistent organization-scoped business data, asynchronous conversion jobs, session/auth support, and reproducible local environments.

Some earlier project documents contain older or mixed technology assumptions. The backend engineering standard needs one current implementation baseline.

## Decision

Use:

```text
Backend: Node.js + TypeScript + NestJS
Database: MongoDB + Mongoose
Queue: Redis + BullMQ
API: REST + JSON
Containerization: Docker + Docker Compose
Package manager: npm
```

MongoDB is the business source of truth.

Redis/BullMQ is used for execution scheduling/queue coordination, not as the primary business database.

## Consequences

### Positive

- one strongly typed backend language/runtime;
- NestJS provides modules, DI, guards, validation, and API structure;
- MongoDB matches the document-oriented organization/project/conversion data model;
- BullMQ is straightforward for Node.js background jobs;
- Docker reduces environment differences.

### Negative / Trade-offs

- team must learn NestJS dependency injection and module boundaries;
- queue durability depends on correct Redis configuration;
- MongoDB consistency rules must be designed deliberately;
- old documents mentioning alternative backend stacks must be updated to avoid confusion.

## Alternatives Considered

### Java/Spring Boot

A valid backend stack, but not the current official backend implementation choice.

### RabbitMQ

More broker-oriented features, but higher operational complexity than required for current ALSM job execution needs.

### Relational database as primary store

Not selected for the current implementation baseline.

## Compliance / Implementation Notes

- real secrets only through environment variables;
- `.env.example` must document required variables;
- Docker services use `mongodb` and `redis` hostnames internally;
- API and Worker use the same codebase but separate runtime processes.

## Related Documents

- `/RULE.md`
- `DEVELOPER_HANDBOOK.md`
