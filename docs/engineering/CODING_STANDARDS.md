# ALSM Backend Coding Standards

**Status:** Mandatory engineering standard  
**Applies to:** ALSM backend repository  
**Authority:** Subordinate to root `RULE.md`

## 1. Goals

All backend code should be:

- correct for the approved business requirement;
- easy for another team member to understand;
- consistent across modules;
- testable;
- secure by default;
- organization-safe;
- explicit rather than clever;
- compatible with Modular Monolith + Simplified Clean Architecture.

## 2. Language and formatting

- Source code, identifiers, API field names, comments, commit summaries, and technical documentation use English.
- Use TypeScript, not plain JavaScript, for backend source.
- Use UTF-8.
- Use LF line endings in repository files where tooling supports it.
- Use Prettier as the formatter and ESLint as the linter.
- Recommended Prettier baseline:

```json
{
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

Do not manually fight the formatter.

## 3. TypeScript rules

- Enable strict TypeScript behavior where practical.
- Avoid `any`.
- Never use `as any` simply to silence the compiler.
- Avoid `@ts-ignore`; if unavoidable, document the reason next to it.
- Prefer explicit domain types over repeated string literals.
- Keep enums/unions centralized in their owning module.
- Prefer `readonly` for values that should not change.
- Do not expose mutable persistence objects to Domain/Application.
- Prefer small typed input objects over long positional parameter lists.

Bad:

```ts
async function createProject(a: string, b: string, c: string, d: boolean) {}
```

Preferred:

```ts
interface CreateProjectInput {
  organizationId: string;
  name: string;
  conversionType: ConversionType;
  createdBy: string;
}
```

## 4. Clean Architecture coding rules

### Domain

Domain code must not import NestJS, Mongoose, Redis, BullMQ, HTTP SDKs, schemas, controllers, or infrastructure implementations.

Put business invariants in Entities or pure Domain Services.

### Application

Application services orchestrate one main use case and expose one main `execute()` method.

Application code accesses persistence through repository ports and technical integrations through ports.

### Infrastructure

Infrastructure owns:

- Mongoose schemas/models;
- repository implementations;
- Redis/BullMQ integration;
- storage adapters;
- external service SDK adapters;
- AI Validator adapters;
- Conversion Tool adapters.

### Presentation

Controllers should only:

1. receive the request;
2. rely on DTO validation;
3. obtain authenticated/organization context;
4. call an Application service;
5. map the result with a Presenter/response object;
6. return an HTTP response.

A controller must not query MongoDB, manipulate queue clients, or call Conversion Tools directly.

## 5. Application service standard

Default pattern:

```ts
@Injectable()
export class CreateProjectService {
  constructor(
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: IProjectRepository,
  ) {}

  async execute(input: CreateProjectInput): Promise<ProjectEntity> {
    const project = ProjectEntity.createNew(input);
    return this.projectRepository.create(project);
  }
}
```

Avoid giant services with many unrelated public methods.

Do not split trivial behavior into unnecessary classes only to appear architectural.

## 6. Repository standard

Repository interfaces are domain-facing contracts.

```ts
export const PROJECT_REPOSITORY = Symbol('PROJECT_REPOSITORY');

export interface IProjectRepository {
  findById(id: string, organizationId: string): Promise<ProjectEntity | null>;
  create(project: ProjectEntity): Promise<ProjectEntity>;
  update(project: ProjectEntity): Promise<ProjectEntity>;
}
```

Rules:

- use `Symbol` DI tokens;
- return Domain Entities, not Mongoose documents;
- do not expose `FilterQuery`, `Model`, or Mongoose types in the interface;
- tenant-owned queries must enforce organization scope.

## 7. Mapper and Presenter standard

Persistence Mapper:

```text
Mongo document <-> Domain Entity
```

Presenter:

```text
Domain/Application result -> API response JSON
```

Do not return raw Mongo documents from controllers.

## 8. Error handling

- Use centralized exception/error mapping.
- Use stable machine-readable error codes.
- Do not expose stack traces in production.
- Do not expose raw Mongoose errors to clients.
- Expected business failures should be represented intentionally.

Example:

```json
{
  "statusCode": 403,
  "code": "ORGANIZATION_ACCESS_DENIED",
  "message": "You do not have access to this organization.",
  "details": []
}
```

Recommended error code style: `UPPER_SNAKE_CASE`.

## 9. Validation

All external input is untrusted.

Validate:

- body;
- route params;
- query params;
- enum values;
- ObjectId-shaped IDs where applicable;
- file metadata;
- pagination;
- sort/filter fields;
- URLs and callback inputs;
- webhook signatures.

Use NestJS DTOs with `class-validator` / `class-transformer` unless the architecture is intentionally changed.

## 10. Organization isolation

Every organization-owned use case must verify:

```text
Authenticated user
  -> organization membership/internal privilege
  -> role/permission
  -> resource belongs to allowed organization
```

Never treat an `organizationId` supplied by the client as authorization proof.

Repositories should prefer organization-scoped access patterns such as:

```ts
findById(projectId, organizationId)
```

instead of unscoped lookup followed by ad-hoc checking.

## 11. Authentication and secrets

Never commit or log:

- passwords/password hashes;
- JWT secrets;
- access tokens;
- refresh tokens;
- API key plaintext;
- database passwords;
- external API secrets;
- full uploaded legacy source;
- sensitive generated source unless explicitly approved for secure debugging.

Refresh tokens are stored hashed.

Secrets come from environment variables.

## 12. Logging

Use structured logs.

Useful context fields:

- `requestId`
- `userId`
- `organizationId`
- `projectId`
- `conversionJobId`
- `conversionVersionId`

Messages should describe events, not dump objects indiscriminately.

Bad:

```ts
logger.debug(user);
```

Preferred:

```ts
logger.log('Project created', {
  requestId,
  userId,
  organizationId,
  projectId,
});
```

## 13. Async conversion rule

Conversion work must not block the original HTTP request.

Correct flow:

```text
HTTP -> create persistent job -> enqueue small job ID -> return
BullMQ Worker -> load job -> invoke ConversionEnginePort -> persist result
```

Queue payloads should be small, usually IDs/references.

Do not put full BMS/DSPF/COBOL source in Redis queue payloads.

## 14. AI Validator rule

AI is validation assistance only.

AI must not:

- perform the primary BMS/DSPF or COBOL conversion;
- overwrite Conversion Results;
- auto-approve a result;
- apply correction without human review.

AI adapters belong in Infrastructure behind a port.

## 15. Functions and classes

- One function should have one clear purpose.
- Prefer early validation/guard clauses to deeply nested code.
- Avoid boolean-parameter APIs that obscure meaning; prefer explicit input objects/enums.
- Do not create classes solely as namespaces for unrelated helpers.
- Keep public APIs small.
- Avoid circular dependencies and habitual `forwardRef()`.

## 16. Comments and documentation

Comments should explain **why**, constraints, or non-obvious trade-offs.

Do not comment obvious code.

Bad:

```ts
// Increase attempt count
attemptCount += 1;
```

Useful:

```ts
// Keep attempt count in MongoDB because Redis is execution state,
// while MongoDB is the business source of truth.
attemptCount += 1;
```

Public ports and non-obvious business rules should have concise TSDoc when it improves understanding.

## 17. Database coding rules

- Mongoose exists only in Infrastructure.
- Use reasonable indexes based on actual queries.
- Use soft delete for Projects.
- Use TTL for expiring session documents where applicable.
- Use camelCase inside TypeScript.
- Persistence naming differences are handled in schema/mapper code.
- Avoid embedding large generated files in queue messages.
- Do not duplicate state without a clear consistency reason.

## 18. Conversion versioning rules

- Re-conversion must not overwrite history.
- Findings must be linked to the applicable conversion version.
- Export must identify the exact exported version.
- `READY_FOR_EXPORT` gating must be enforced in business/application logic, not only hidden in UI.

## 19. Testing standard

Use the smallest useful test level:

- Domain unit tests for business rules.
- Application unit tests with mocked ports.
- Infrastructure integration tests for MongoDB/Redis behavior when useful.
- E2E tests for critical HTTP workflows.

Mandatory test attention areas:

- authentication;
- authorization;
- organization isolation;
- project CRUD/soft delete;
- conversion job creation;
- queue enqueue;
- retry/dead behavior;
- version/export eligibility;
- AI cannot mutate/approve;
- audit invariants.

Every new organization-owned feature should include a cross-organization denial test.

## 20. Test naming

Prefer behavior-oriented names:

```ts
it('rejects access when the project belongs to another organization', async () => {});
```

Avoid:

```ts
it('test project service', async () => {});
```

## 21. Required quality commands

Before reporting a meaningful task complete, run when applicable:

```bash
npm run lint
npm run test
npm run build
npm run test:e2e
npm run architecture:check
```

Never claim a command passed if it was not executed.

## 22. Definition of clean code for ALSM

A change is not considered clean merely because it compiles. It should also:

- preserve module ownership;
- preserve dependency direction;
- preserve tenant isolation;
- be understandable by another developer;
- have no fake converter implementation;
- avoid leaking secrets/source;
- preserve version/audit traceability;
- update tests/docs/config when the contract changes.
