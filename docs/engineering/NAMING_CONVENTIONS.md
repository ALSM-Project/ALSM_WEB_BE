# ALSM Backend Naming Conventions

## 1. General rule

Use clear English names that reflect ALSM business language.

Prefer full words over abbreviations.

Bad:

```text
usrSvc
convMgr
pRepo
orgObj
```

Preferred:

```text
userService
conversionJob
projectRepository
organization
```

## 2. Summary table

| Item | Convention | Example |
|---|---|---|
| Folder | `kebab-case` | `conversion-jobs/` |
| TypeScript file | `kebab-case` | `create-project.service.ts` |
| Class | `PascalCase` | `CreateProjectService` |
| Interface | `PascalCase`, `I` allowed for repository contracts | `IProjectRepository` |
| Type alias | `PascalCase` | `ConversionEngineInput` |
| Enum | `PascalCase` | `ConversionJobStatus` |
| Enum member | `UPPER_SNAKE_CASE` | `READY_FOR_EXPORT` |
| Function | `camelCase` | `validateOrganizationAccess` |
| Variable | `camelCase` | `conversionJobId` |
| Constant | `UPPER_SNAKE_CASE` | `PROJECT_REPOSITORY` |
| Environment variable | `UPPER_SNAKE_CASE` | `MONGODB_URI` |
| REST resource | plural `kebab-case` | `/conversion-jobs` |
| MongoDB collection | plural `snake_case` | `conversion_jobs` |
| JSON/TypeScript field | `camelCase` | `organizationId` |
| Test file | `<source>.spec.ts` | `project.entity.spec.ts` |
| E2E test | `<area>.e2e-spec.ts` | `projects.e2e-spec.ts` |

## 3. Standard file suffixes

Use predictable suffixes:

```text
*.entity.ts
*.value-object.ts
*.repository.ts
*.port.ts
*.service.ts
*.event.ts
*.handler.ts
*.schema.ts
*.mapper.ts
*.controller.ts
*.presenter.ts
*.dto.ts
*.guard.ts
*.decorator.ts
*.config.ts
*.module.ts
*.spec.ts
*.e2e-spec.ts
```

Examples:

```text
project.entity.ts
project.repository.ts
mongo-project.repository.ts
project.schema.ts
project.mapper.ts
create-project.service.ts
projects.controller.ts
project.presenter.ts
conversion-engine.port.ts
conversion-completed.event.ts
```

## 4. Application service names

Use a verb + business object.

Preferred:

```text
CreateProjectService
UpdateProjectService
RetryConversionJobService
ReviewConversionFindingsService
ApproveConversionVersionService
ExportConversionVersionService
```

Avoid vague names:

```text
ProjectManager
ConversionHelper
ProcessService
CommonService
```

## 5. Repository naming

Interface:

```text
IProjectRepository
IConversionJobRepository
```

DI token:

```text
PROJECT_REPOSITORY
CONVERSION_JOB_REPOSITORY
```

Mongo implementation:

```text
MongoProjectRepository
MongoConversionJobRepository
```

File:

```text
project.repository.ts
mongo-project.repository.ts
```

## 6. Port naming

External/technical boundaries end with `Port`:

```text
ConversionEnginePort
ConversionQueuePort
AiValidatorPort
StoragePort
EmailPort
PaymentGatewayPort
WebhookPort
```

Adapter implementations end with `Adapter` when useful:

```text
BullMqConversionQueueAdapter
CassoPaymentGatewayAdapter
SmtpEmailAdapter
CobolJavaConversionAdapter
```

Do not include an external provider name in Domain types.

## 7. Entity naming

Domain classes use `<BusinessName>Entity` when the suffix avoids ambiguity:

```text
ProjectEntity
ConversionJobEntity
ConversionVersionEntity
FindingEntity
AuditLogEntity
```

Entity files:

```text
project.entity.ts
conversion-job.entity.ts
```

## 8. DTO naming

Request DTOs should describe the operation:

```text
CreateProjectRequestDto
UpdateProjectRequestDto
RetryConversionJobRequestDto
```

Application inputs may omit HTTP-oriented suffixes:

```text
CreateProjectInput
RetryConversionJobInput
```

Response mapping belongs to Presenters, not DTO dumping.

## 9. Controller naming

Use plural resource controller names where they represent REST resources:

```text
ProjectsController
ConversionsController
OrganizationsController
```

File:

```text
projects.controller.ts
```

## 10. Event naming

Past tense for events that already happened:

```text
ConversionCompletedEvent
ConversionVersionApprovedEvent
OrganizationMemberInvitedEvent
```

Event name string, if used:

```text
conversion.completed
conversion-version.approved
organization-member.invited
```

Keep one convention within the chosen event mechanism.

## 11. Status and enum naming

Enum type:

```ts
export enum ConversionJobStatus {
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  DEAD = 'DEAD',
  CANCELLED = 'CANCELLED',
}
```

Do not mix job operational status with business conversion lifecycle status.

## 12. Boolean naming

Boolean names should read naturally:

```text
isActive
isPlatformAdmin
isLocked
hasCobolConversion
canExport
shouldRetry
```

Avoid:

```text
activeFlag
adminCheck
statusBool
```

## 13. Collection and persistence naming

MongoDB collection names are plural `snake_case`, matching the project data model style:

```text
users
organizations
org_memberships
projects
conversion_jobs
conversion_versions
conversion_findings
user_sessions
audit_logs
```

Inside TypeScript use camelCase:

```text
organizationId
conversionVersionId
createdAt
```

Schema/Mapper code handles persistence differences.

## 14. API route naming

Use nouns and plural resources:

```text
GET  /api/v1/projects
GET  /api/v1/projects/:projectId
POST /api/v1/projects/:projectId/conversions
GET  /api/v1/conversions/:conversionId
POST /api/v1/conversions/:conversionId/retry
```

Commands that are real domain actions may use action endpoints where REST CRUD is not a good fit:

```text
POST /api/v1/conversion-versions/:versionId/approve
POST /api/v1/conversion-versions/:versionId/export
```

Avoid noisy routes such as:

```text
/api/v1/doCreateProject
/api/v1/getAllProjectList
```

## 15. Error codes

Use stable `UPPER_SNAKE_CASE`:

```text
VALIDATION_ERROR
INVALID_CREDENTIALS
ORGANIZATION_ACCESS_DENIED
PROJECT_NOT_FOUND
CONVERSION_JOB_NOT_RETRYABLE
CONVERSION_VERSION_NOT_EXPORTABLE
```

## 16. Environment variables

Use `UPPER_SNAKE_CASE` with a clear subsystem prefix when useful:

```text
PORT
MONGODB_URI
REDIS_HOST
REDIS_PORT
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
CONVERSION_WORKER_ENABLED
```

## 17. Git branch naming

For the backend repository, use small task-focused branches from the current integration branch.

Recommended canonical format:

```text
feature/<ticket>-<short-scope>
fix/<ticket>-<short-scope>
refactor/<ticket>-<short-scope>
docs/<ticket>-<short-scope>
```

Examples:

```text
feature/ALSM-140-refresh-token
fix/ALSM-207-project-tenant-check
refactor/ALSM-231-conversion-repository
docs/ALSM-250-update-adr
```

If the team must preserve the older project-management naming format (`Feature_Function_Developer` / `Fix_Feature_Function_Developer`) for academic reporting, record the mapping in the PR. Do not mix multiple naming formats randomly within the same repository.

## 18. Commit message naming

Preferred format aligned with the project management convention:

```text
[Feature][ChangedPart]: Change summary
```

Examples:

```text
[Auth][Refresh]: Rotate hashed refresh tokens
[Project][Create]: Enforce organization membership
[Conversion][Queue]: Enqueue conversion job by ID
[Validation][Finding]: Add finding severity mapping
[Fix][Project]: Block cross-organization project access
[Docs][ADR]: Record conversion tool boundary
```

Avoid:

```text
fix bug
update
done
test
abc
```

## 19. Pull request titles

Recommended:

```text
[ALSM-140] Add refresh-token rotation
[ALSM-207] Fix project organization isolation
```

## 20. Naming review checklist

Before merge, verify:

- names use business vocabulary;
- no unclear abbreviations;
- files use standard suffixes;
- status names are not mixed across domains;
- collection/field casing is consistent;
- route names are resource-oriented;
- errors are stable codes;
- branch/commit names follow the repository standard.
