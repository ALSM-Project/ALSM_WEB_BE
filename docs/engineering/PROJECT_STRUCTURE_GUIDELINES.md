# ALSM Backend Project Structure Guidelines

**Architecture:** Modular Monolith + Simplified Clean Architecture  
**Backend:** Node.js + TypeScript + NestJS  
**Persistence:** MongoDB + Mongoose  
**Queue:** Redis + BullMQ

## 1. Root structure

Recommended repository structure:

```text
/
├── RULE.md
├── README.md
├── package.json
├── package-lock.json
├── nest-cli.json
├── tsconfig.json
├── tsconfig.build.json
├── .env.example
├── .gitignore
├── .dockerignore
├── Dockerfile
├── docker-compose.yml
├── docs/
│   └── engineering/
├── src/
│   ├── modules/
│   ├── shared/
│   ├── config/
│   ├── worker/
│   ├── app.module.ts
│   └── main.ts
└── test/
```

Do not create root-level global business folders such as `controllers/`, `services/`, `repositories/`, and `models/` for all modules.

## 2. Business-module-first organization

Business ownership is the first grouping dimension.

```text
src/modules/
├── auth/
├── users/
├── organizations/
├── projects/
├── conversions/
├── validation/
├── reviews/
├── versioning/
├── collaboration/
├── billing/
├── crm/
├── support/
├── admin/
└── audit/
```

Only create a module when it owns meaningful behavior/state. Avoid placeholder modules containing fake endpoints.

## 3. Standard module structure

For a significant business module:

```text
src/modules/projects/
├── domain/
│   ├── entities/
│   ├── value-objects/
│   ├── services/
│   ├── events/
│   └── interfaces/
├── application/
│   ├── dto/
│   ├── services/
│   ├── ports/
│   └── events/
├── infrastructure/
│   ├── schemas/
│   ├── persistence/
│   ├── mapper/
│   ├── queue/
│   └── adapters/
├── presentation/
│   ├── controller/
│   └── response/
├── projects.module.ts
└── README.md
```

Do not create empty subfolders only to satisfy the diagram. Create folders when code actually belongs there.

## 4. Layer responsibilities

### `domain/`

Owns business language and invariants.

Examples:

```text
ProjectEntity
ConversionJobEntity
ConversionVersionEntity
FindingEntity
ConversionType
ProjectStatus
IProjectRepository
```

Forbidden here:

```text
NestJS controller/decorator
Mongoose model/schema
Redis/BullMQ
HTTP SDK
Infrastructure adapter
```

### `application/`

Owns use-case orchestration.

Examples:

```text
CreateProjectService
RetryConversionJobService
ApproveConversionVersionService
ExportConversionVersionService
```

Ports may exist here for technical dependencies such as storage, AI validation, notifications, or queue operations when they are application-facing rather than domain concepts.

### `infrastructure/`

Owns technical implementations.

Examples:

```text
MongoProjectRepository
ProjectSchema
ProjectMapper
BullMqConversionQueueAdapter
ExternalStorageAdapter
AiValidatorAdapter
CobolJavaConversionAdapter
```

### `presentation/`

Owns HTTP details.

Examples:

```text
ProjectsController
CreateProjectRequestDto
ProjectPresenter
```

## 5. Worker structure

The API and Worker share the same codebase but run as separate processes/containers.

Recommended:

```text
src/worker/
├── worker.main.ts
├── worker.module.ts
└── README.md
```

Queue-specific adapters should stay near their owning business module or in a truly shared queue technical package when reusable.

The Worker must not become a second business architecture. It invokes Application/port boundaries and uses the same domain rules.

## 6. Shared folder

Allowed:

```text
src/shared/
├── database/
├── queue/
├── errors/
├── logging/
├── security/
├── decorators/
└── types/
```

A shared artifact must satisfy both:

1. it is genuinely reused by multiple modules;
2. it is not business logic owned by one module.

If it describes Projects, Conversion, Billing, CRM, or another business concept, it usually belongs in that module.

## 7. Config folder

Recommended:

```text
src/config/
├── app.config.ts
├── database.config.ts
├── redis.config.ts
├── auth.config.ts
├── validation.schema.ts
└── README.md
```

Rules:

- environment parsing/validation is centralized;
- no raw `process.env` scattered throughout business code;
- every required variable is documented in `.env.example`.

## 8. Persistence layout

Example:

```text
projects/infrastructure/
├── schemas/
│   └── project.schema.ts
├── persistence/
│   └── mongo-project.repository.ts
└── mapper/
    └── project.mapper.ts
```

The Repository port remains in an inner layer:

```text
projects/domain/interfaces/project.repository.ts
```

## 9. Conversion structure

Recommended conceptual structure:

```text
conversions/
├── domain/
│   ├── entities/
│   │   ├── conversion-job.entity.ts
│   │   └── conversion-version.entity.ts
│   └── interfaces/
├── application/
│   ├── services/
│   │   ├── create-conversion-job.service.ts
│   │   ├── retry-conversion-job.service.ts
│   │   └── export-conversion-version.service.ts
│   └── ports/
│       ├── conversion-engine.port.ts
│       └── conversion-queue.port.ts
└── infrastructure/
    ├── persistence/
    ├── queue/
    └── adapters/
        ├── bms-dspf-conversion.adapter.ts
        └── cobol-java-conversion.adapter.ts
```

Actual parser/mapping/generator implementation belongs to independent Conversion Tool code, not to this backend repository.

## 10. Validation / review / versioning ownership

Keep concepts separated:

```text
conversions/ -> conversion execution orchestration/job/result
validation/  -> validation policy/findings generation
reviews/     -> human decisions/correction workflow
versioning/  -> immutable conversion version history
```

Do not collapse every post-conversion behavior into one oversized `ConversionService`.

## 11. Cross-module communication

A module may use another module only through an explicitly exported contract/port/service.

Forbidden:

```text
conversions -> projects/infrastructure/project.schema
billing -> organizations/infrastructure/mongo-organization.repository
```

Preferred:

```text
conversions -> exported Project access port
billing -> exported Organization access port
```

Side effects such as notification/activity can use events where they are genuinely independent.

## 12. Tests structure

Unit tests may live next to the code:

```text
create-project.service.spec.ts
project.entity.spec.ts
```

E2E tests live under:

```text
test/
├── auth.e2e-spec.ts
├── projects.e2e-spec.ts
└── conversions.e2e-spec.ts
```

Avoid creating a mirrored mega test tree unless it improves navigation.

## 13. Documentation structure

Recommended:

```text
docs/
├── engineering/
│   ├── README.md
│   ├── CODING_STANDARDS.md
│   ├── PROJECT_STRUCTURE_GUIDELINES.md
│   ├── NAMING_CONVENTIONS.md
│   ├── DEVELOPER_HANDBOOK.md
│   ├── CONTRIBUTING.md
│   ├── FOLDER_README_GUIDELINES.md
│   └── adr/
└── api/
```

`RULE.md` stays at repository root because every contributor must see it before coding.

## 14. New module checklist

Before creating a module:

- identify the business owner/state;
- confirm it is not already owned by an existing module;
- define its public contract;
- create only the layers needed;
- define repository ports before infrastructure implementation;
- plan organization scoping;
- add README when the module is important/non-trivial;
- add tests for business invariants;
- avoid circular imports.

## 15. What not to do

Do not create:

```text
src/common/business-logic/
src/helpers/everything.ts
src/services/project-and-conversion.service.ts
src/models/all.schemas.ts
```

Do not let `shared/` become a dumping ground.

Do not move code to a folder merely to satisfy naming; ownership and dependency direction matter more than folder cosmetics.
