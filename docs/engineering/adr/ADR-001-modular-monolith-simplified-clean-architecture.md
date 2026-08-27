# ADR-001: Use Modular Monolith + Simplified Clean Architecture

- **Status:** Accepted
- **Date:** 2026-08-27
- **Decision owners:** ALSM project team

## Context

ALSM serves multiple functional areas: identity, organizations, projects, conversion orchestration, validation, review/correction, versioning, billing, CRM, support, admin, and audit. Three portals share one backend platform.

The project needs strong module boundaries and testability without the operational overhead of distributed microservices.

The team is a capstone team, so architecture must remain understandable and deliverable.

## Decision

Use one backend deployable application organized as a **Modular Monolith**.

Inside significant business modules use **Simplified Clean Architecture**:

```text
presentation -> application -> domain <- infrastructure
```

Rules:

- business modules are the first-level ownership boundary;
- Domain is framework/persistence independent;
- Application orchestrates use cases through ports;
- Infrastructure implements MongoDB/Redis/BullMQ/external adapters;
- Presentation handles HTTP only;
- cross-module communication uses exported contracts/ports/events, not another module's infrastructure implementation.

## Consequences

### Positive

- one deployable backend is easier to run and debug;
- clear module ownership;
- domain logic is testable without infrastructure;
- easier future extraction if a real scaling boundary appears;
- avoids duplicated backend logic across the three portals.

### Negative / Trade-offs

- discipline is required to prevent modules from importing each other's internals;
- a large monolith can still become tightly coupled if rules are ignored;
- some use cases require explicit ports/mappers/presenters, adding moderate structure.

## Alternatives Considered

### Traditional layered monolith

Rejected as the primary pattern because a global controller/service/repository structure makes business boundaries less explicit as ALSM grows.

### Microservices

Rejected for the current project because deployment, observability, distributed consistency, messaging, and operational overhead are not justified by current scale.

### Full/strict Clean Architecture everywhere

Not selected because excessive abstraction would slow a capstone team. ALSM uses a simplified version and creates only layers/artifacts that serve a real purpose.

## Compliance / Implementation Notes

Architecture checks should ensure:

- Domain does not import NestJS/Mongoose/Redis/BullMQ;
- Application does not import Mongoose models;
- Presentation does not query DB/queue directly;
- cross-module infrastructure imports are reviewed/blocked.

## Related Documents

- `/RULE.md`
- `PROJECT_STRUCTURE_GUIDELINES.md`
- `CODING_STANDARDS.md`
