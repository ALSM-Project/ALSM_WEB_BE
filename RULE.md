# ALSM Backend — RULE.md

> **BẮT BUỘC ĐỌC TRƯỚC KHI CODE**
>
> File này là **quy chuẩn kỹ thuật chính thức** của backend dự án **ALSM – Automating Legacy System Modernization / Legacy Modernization Platform**.
>
> Mọi developer, reviewer, contributor và AI coding agent **PHẢI đọc toàn bộ `RULE.md` trước khi tạo, sửa, refactor, review hoặc xoá code backend**.
>
> Mọi thay đổi backend phải tuân thủ file này. Nếu task/requirement mới xung đột với `RULE.md`, **không được tự ý phá rule để code cho chạy**; phải nêu xung đột và xin quyết định kiến trúc trước.
>
> `RULE.md` quy định **CÁCH backend được tổ chức và triển khai**. SRS/Business Requirements quy định **HỆ THỐNG phải làm gì**.

---

## ENGINEERING DOCUMENTATION MAP

`RULE.md` is the highest-level backend engineering governance document. Detailed standards are maintained under `docs/engineering/`:

- `CODING_STANDARDS.md` — coding style, quality, security, testing, error/logging rules.
- `PROJECT_STRUCTURE_GUIDELINES.md` — module/folder/layer organization.
- `NAMING_CONVENTIONS.md` — naming for files, folders, classes, routes, collections, branches, commits.
- `adr/` — accepted Architecture Decision Records and rationale.
- `DEVELOPER_HANDBOOK.md` — onboarding and day-to-day workflow.
- `CONTRIBUTING.md` — branch/PR/review/contribution rules.
- `FOLDER_README_GUIDELINES.md` — required README content for important folders/modules.

If a detailed guide conflicts with this `RULE.md`, `RULE.md` wins until the conflict is formally resolved.

---

# 0. NORTH STAR — ĐÍCH KIẾN TRÚC DUY NHẤT

Backend ALSM sử dụng:

**Modular Monolith + Simplified Clean Architecture**

Dependency Rule bắt buộc:

```text
presentation  →  application  →  domain  ←  infrastructure
    HTTP           use-case       core          adapters
```

Ngoài ra, các technical ports phục vụ orchestration có thể nằm ở `application/ports/`:

```text
presentation
     ↓
application ─────────────→ application ports
     ↓                          ↑
domain                    infrastructure
                               implements
```

## 0.1 Luật vàng

Vi phạm các luật dưới đây được xem là **sai kiến trúc**:

1. `domain/` **KHÔNG** import `@nestjs/*`, `mongoose`, Redis, BullMQ, HTTP client, Mongoose model/schema, `application/`, `infrastructure/` hoặc `presentation/`.
2. `application/` **KHÔNG** truy cập MongoDB bằng Mongoose model trực tiếp.
3. `application/` chỉ làm việc với persistence thông qua repository port/interface.
4. `infrastructure/` là nơi duy nhất được triển khai MongoDB/Mongoose, Redis/BullMQ và external adapters.
5. `presentation/` phải mỏng: validate → auth context → gọi application use-case → presenter/response.
6. Controller **KHÔNG** chứa business rule.
7. Repository implementation **KHÔNG** trả raw Mongoose document ra ngoài infrastructure.
8. Business rule phải ưu tiên nằm trong Domain Entity / Domain Service.
9. Cross-module **KHÔNG** import model/repository implementation/service nội bộ của module khác.
10. Conversion Tool thực tế **KHÔNG** được viết trực tiếp vào backend.
11. Conversion phải xử lý bất đồng bộ qua Queue/Worker.
12. Mọi dữ liệu business theo organization phải được kiểm tra organization isolation.
13. AI Validator chỉ là advisory component; **không được tự sửa hoặc ghi đè Conversion Result**.
14. Version cũ của conversion **không được mất** chỉ vì tạo version mới.
15. Chỉ version đủ điều kiện theo workflow mới được export chính thức.

---

# 1. SOURCE OF TRUTH — THỨ TỰ ƯU TIÊN

Khi có nhiều tài liệu hoặc code cũ không thống nhất, dùng thứ tự:

1. **Requirement/SRS/Business Rule đã được team phê duyệt mới nhất** → quyết định hệ thống phải làm gì.
2. **`RULE.md`** → quyết định backend phải code như thế nào.
3. **SDD/ADR/Architecture Decision đã được team phê duyệt** → quyết định kỹ thuật chi tiết.
4. **README / API docs / code hiện tại** → phải được cập nhật để khớp các nguồn phía trên.
5. Tài liệu cũ hoặc implementation cũ **không tự động trở thành chuẩn** nếu mâu thuẫn với quyết định mới.

Nếu phát hiện xung đột:

- Không tự đoán.
- Không âm thầm chọn một phía.
- Ghi rõ xung đột.
- Dừng thay đổi kiến trúc liên quan.
- Yêu cầu technical lead/team xác nhận.

---

# 2. OFFICIAL TECHNOLOGY STACK

Đây là stack chính thức của backend ALSM cho tới khi có quyết định kiến trúc mới được phê duyệt:

```text
Frontend:
ReactJS
(Frontend nằm ngoài backend repository)

Backend:
Node.js
TypeScript
NestJS

Architecture:
Modular Monolith
+
Simplified Clean Architecture

Database:
MongoDB

ODM:
Mongoose

Queue:
Redis + BullMQ

API:
REST + JSON

Containerization:
Docker + Docker Compose

Package Manager:
npm

Conversion Algorithms:
Independent External Conversion Tools
```

Không tự ý thay bằng:

- Java/Spring Boot
- PostgreSQL
- MySQL
- RabbitMQ
- Kafka
- Microservices
- GraphQL

nếu chưa có quyết định kiến trúc mới được phê duyệt.

---

# 3. SYSTEM BOUNDARY — MỘT BACKEND CHO BA PORTAL

ALSM có ba portal:

```text
Web 1 — Self-Service
Web 2 — Internal
Web 3 — Enterprise
```

Cả ba portal sử dụng cùng một backend platform:

```text
Web 1 ─┐
Web 2 ─┼──→ ALSM Node.js Backend ──→ MongoDB
Web 3 ─┘
```

## 3.1 Bắt buộc

- Không tạo backend riêng cho từng portal.
- Không copy cùng business logic thành ba bộ khác nhau.
- Khác biệt giữa portal phải được xử lý bằng:
  - authentication context;
  - organization context;
  - roles/permissions;
  - business policy;
  - feature/module access.

---

# 4. ALSM BUSINESS BOUNDARIES

Các business area chính của ALSM gồm:

```text
Identity & Access
Organizations
Projects
Conversion
Validation
Review & Correction
Versioning
Collaboration
Billing
CRM
Support
Admin
Audit
```

Hai conversion capability cốt lõi:

```text
BMS_DSPF_TO_FRONTEND
COBOL_TO_JAVA
```

Hai loại conversion là **hai strategy/tool khác nhau**, nhưng dùng chung platform workflow:

```text
Project
  ↓
Input
  ↓
Conversion Job
  ↓
Worker
  ↓
Conversion Tool
  ↓
Conversion Result / Version
  ↓
Validation
  ↓
Review
  ↓
Correction / Re-conversion
  ↓
Ready for Export
  ↓
Export
```

---

# 5. CẤU TRÚC MODULE BẮT BUỘC

Backend phải tổ chức **theo business module trước**, không tổ chức toàn hệ thống theo technical folder.

Preferred structure:

```text
src/
├── modules/
│   ├── auth/
│   ├── users/
│   ├── organizations/
│   ├── projects/
│   ├── conversions/
│   ├── validation/
│   ├── reviews/
│   ├── versioning/
│   ├── collaboration/
│   ├── billing/
│   ├── crm/
│   ├── support/
│   ├── admin/
│   └── audit/
│
├── shared/
├── config/
├── worker/
├── app.module.ts
└── main.ts
```

## 5.1 CẤM

Không tổ chức toàn project theo kiểu:

```text
controllers/
services/
repositories/
models/
```

vì cách này làm business modules bị trộn vào nhau.

---

# 6. TEMPLATE 4 TẦNG CHO MỖI MODULE

Một module business đáng kể phải theo skeleton:

```text
modules/<module>/
├── domain/
│   ├── entities/
│   ├── value-objects/
│   ├── services/
│   ├── events/
│   └── interfaces/
│
├── application/
│   ├── dto/
│   ├── services/
│   ├── ports/
│   └── events/
│
├── infrastructure/
│   ├── persistence/
│   ├── schemas/
│   ├── mapper/
│   ├── queue/
│   └── adapters/
│
└── presentation/
    ├── controller/
    └── response/
```

Không bắt buộc tạo folder rỗng nếu module chưa cần.

Nguyên tắc:

> Tạo đúng thứ cần dùng, nhưng code đã tạo phải đúng tầng.

---

# 7. TRÁCH NHIỆM TỪNG TẦNG

## 7.1 `domain/` — lõi nghiệp vụ

Được chứa:

- Entity
- Value Object
- Domain enum/type
- Business rule
- Domain Service thuần
- Domain Event
- Repository interface
- Domain-specific interface

Không được chứa:

- NestJS decorator
- Controller
- Mongoose
- MongoDB query
- Redis
- BullMQ
- HTTP request
- external SDK
- DTO phụ thuộc HTTP
- infrastructure implementation

Domain phải có khả năng đọc và test mà không cần MongoDB/Redis/NestJS runtime.

---

## 7.2 `application/` — use-case orchestration

Được chứa:

- Use-case service
- DTO dùng cho application
- orchestration
- permission/business workflow coordination
- application ports
- event handlers
- transaction coordination hợp lý

Application service:

- nhận input đã validate;
- load Entity qua port;
- gọi method/domain rule;
- gọi repository;
- gọi external/queue/storage port nếu cần;
- trả Entity hoặc application result.

Application **không** được chứa Mongoose query.

---

## 7.3 `infrastructure/` — adapter kỹ thuật

Đây là nơi được phép chứa:

- Mongoose schema/model
- MongoDB repository implementation
- Redis
- BullMQ
- Storage adapters
- Conversion Tool adapters
- Email adapters
- Payment adapters
- AI Validator adapters
- external SDK
- mapper persistence

Infrastructure phải implement các port/interface từ inner layer.

---

## 7.4 `presentation/` — HTTP boundary

Được chứa:

- Controller
- request DTO binding
- auth/role decorator usage
- response presenter
- Swagger decorator
- HTTP status mapping

Controller không được:

- gọi Mongoose model;
- gọi Redis/BullMQ trực tiếp;
- chứa business `if` phức tạp;
- tự decode JWT;
- tự kiểm tra organization membership bằng query DB trực tiếp;
- gọi conversion tool.

---

# 8. IMPORT MATRIX

| Tầng | ĐƯỢC import | CẤM import |
|---|---|---|
| `domain/` | domain cùng module, shared domain primitives/errors | `@nestjs/*`, `mongoose`, BullMQ, Redis client, `*.schema`, `*.model`, application, infrastructure, presentation |
| `application/` | domain, application DTO/ports, shared, `@nestjs/common` DI | Mongoose model/schema, infrastructure implementation, controller |
| `infrastructure/` | domain/application ports, Mongoose, Redis, BullMQ, SDK ngoài | presentation controller, application use-case để bypass boundary |
| `presentation/` | application service, DTO, presenter, guards/decorators | Mongoose, Redis/BullMQ client, repository implementation, external SDK |

---

# 9. ENTITY RULE

Entity là nơi ưu tiên chứa business invariant.

Recommended pattern:

```ts
export interface ProjectProps {
  id: string;
  organizationId: string;
  name: string;
  conversionType: ConversionType;
  status: ProjectStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export class ProjectEntity {
  private constructor(private props: ProjectProps) {}

  static createNew(input: CreateProjectInput): ProjectEntity {
    // validate business invariants
    // set defaults
    // return entity
  }

  static fromPersistence(props: ProjectProps): ProjectEntity {
    return new ProjectEntity(props);
  }

  archive(): void {
    // business rule
  }

  softDelete(now: Date): void {
    // business rule
  }

  toProps(): ProjectProps {
    return { ...this.props };
  }
}
```

## 9.1 Quy tắc

- Entity không được biết Mongoose.
- Entity không nhận `Document`, `FilterQuery`, `ObjectId` của Mongoose làm API chính.
- Mapper chịu trách nhiệm convert persistence type → domain type.
- Business rule quan trọng không được duplicate giữa controller/service/repository.

---

# 10. DOMAIN SERVICE RULE

Chỉ dùng Domain Service khi logic:

- thực sự là business logic;
- không hợp lý để thuộc về một Entity riêng lẻ;
- không có I/O.

Ví dụ hợp lý:

```text
ConversionEligibilityDomainService
ExportEligibilityDomainService
FindingSeverityDomainService
```

Domain Service **KHÔNG** gọi database/API/queue.

---

# 11. REPOSITORY PORT RULE

Repository port phải nói bằng ngôn ngữ domain.

Ví dụ:

```ts
export interface IProjectRepository {
  findById(
    id: string,
    organizationId: string,
  ): Promise<ProjectEntity | null>;

  create(project: ProjectEntity): Promise<ProjectEntity>;

  update(project: ProjectEntity): Promise<ProjectEntity>;
}

export const PROJECT_REPOSITORY =
  Symbol('PROJECT_REPOSITORY');
```

## 11.1 Bắt buộc

- Dùng `Symbol` làm DI token.
- Repository trả Entity/domain type.
- Repository không trả Mongoose document.
- Repository interface không nhận `FilterQuery`.
- Repository interface không import schema/model.
- Organization-owned repository query phải scope bằng `organizationId` hoặc mechanism tương đương bảo đảm isolation.

---

# 12. APPLICATION SERVICE — 1 USE CASE = 1 `execute()`

Rule mặc định:

> Một application service đại diện cho một use case chính và có một public method `execute()`.

Ví dụ:

```text
RegisterUserService
LoginUserService
CreateProjectService
UpdateProjectService
DeleteProjectService
CreateConversionJobService
RetryConversionJobService
ApproveConversionVersionService
ExportConversionVersionService
```

Pattern:

```ts
@Injectable()
export class CreateProjectService {
  constructor(
    @Inject(PROJECT_REPOSITORY)
    private readonly projects: IProjectRepository,
  ) {}

  async execute(input: CreateProjectInput): Promise<ProjectEntity> {
    const project = ProjectEntity.createNew(input);
    return this.projects.create(project);
  }
}
```

## 12.1 Không làm giant service

CẤM kiểu:

```text
ProjectService
  create()
  update()
  delete()
  restore()
  approve()
  convert()
  export()
  bill()
  notify()
```

nếu các method đại diện cho nhiều use case độc lập.

## 12.2 Không over-engineer

Không cần tạo 10 class cho một thao tác CRUD đơn giản không có business rule.

Mục tiêu:

**rõ ràng > hình thức.**

---

# 13. MONGODB / MONGOOSE RULE

MongoDB là **persistent business database** của ALSM.

Mongoose chỉ được sử dụng trong infrastructure.

Recommended:

```text
projects/
└── infrastructure/
    ├── schemas/
    │   └── project.schema.ts
    ├── persistence/
    │   └── mongo-project.repository.ts
    └── mapper/
        └── project.mapper.ts
```

## 13.1 Naming

Trong TypeScript/domain code dùng:

```text
organizationId
projectId
conversionJobId
createdAt
```

Nếu persistence schema hoặc tài liệu cũ dùng snake_case như:

```text
organization_id
created_at
```

thì mapping phải được xử lý tập trung ở persistence mapper/schema.

Không trộn camelCase và snake_case ngẫu nhiên khắp codebase.

---

# 14. MAPPER RULE

Mapper là cầu nối:

```text
Mongo Document
      ↕
Domain Entity
```

Ví dụ:

```ts
export class ProjectMapper {
  static toEntity(doc: ProjectDocument): ProjectEntity {
    return ProjectEntity.fromPersistence({
      id: String(doc._id),
      organizationId: String(doc.organizationId),
      name: doc.name,
      conversionType: doc.conversionType,
      status: doc.status,
      createdBy: String(doc.createdBy),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      deletedAt: doc.deletedAt ?? null,
    });
  }

  static toPersistence(
    entity: ProjectEntity,
  ): Record<string, unknown> {
    const props = entity.toProps();

    return {
      organizationId: props.organizationId,
      name: props.name,
      conversionType: props.conversionType,
      status: props.status,
      createdBy: props.createdBy,
      deletedAt: props.deletedAt,
    };
  }
}
```

## 14.1 Bắt buộc

- Mongoose-specific shape dừng ở infrastructure.
- Không đưa raw document ra controller.
- Không để Entity tự serialize MongoDB.

---

# 15. PRESENTER RULE

Presenter chuyển:

```text
Domain/Application Result
       ↓
API JSON
```

Ví dụ:

```ts
export class ProjectPresenter {
  static toResponse(project: ProjectEntity) {
    const p = project.toProps();

    return {
      id: p.id,
      organizationId: p.organizationId,
      name: p.name,
      conversionType: p.conversionType,
      status: p.status,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
```

Controller không tự mapping response phức tạp ở nhiều chỗ.

---

# 16. CONTROLLER RULE

Controller phải mỏng.

Pattern:

```ts
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly createProject: CreateProjectService,
  ) {}

  @Post()
  async create(
    @Body() body: CreateProjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const project = await this.createProject.execute({
      ...body,
      userId: user.id,
    });

    return ProjectPresenter.toResponse(project);
  }
}
```

## 16.1 Controller được phép

- DTO validation
- Swagger decorator
- `@UseGuards`
- `@Roles`
- `@CurrentUser`
- gọi 1 application service chính
- gọi presenter
- map HTTP status

## 16.2 Controller bị cấm

```ts
ProjectModel.find(...)
redis.get(...)
conversionQueue.add(...)
jwtService.verify(...)
if (businessRule...) ...
```

---

# 17. MODULE DI BINDING

Repository port → adapter:

```ts
@Module({
  providers: [
    MongoProjectRepository,
    {
      provide: PROJECT_REPOSITORY,
      useExisting: MongoProjectRepository,
    },
    CreateProjectService,
  ],
  exports: [PROJECT_REPOSITORY],
})
export class ProjectsModule {}
```

## 17.1 Export rule

Ưu tiên export:

- port/token;
- facade/application API được thiết kế rõ;

không export tùy tiện:

- Mongoose model;
- repository implementation;
- service nội bộ;
- infrastructure details.

---

# 18. CROSS-MODULE RULE

Cross-module chỉ được qua public contract.

ĐÚNG:

```text
ConversionsModule
      ↓
IProjectAccess / PROJECT_REPOSITORY
      ↓
ProjectsModule public contract
```

SAI:

```ts
import { ProjectModel }
  from '../projects/infrastructure/schemas/project.schema';

import { MongoProjectRepository }
  from '../projects/infrastructure/persistence/...';
```

## 18.1 Nguyên tắc

- Không import model module khác.
- Không import repository implementation module khác.
- Không bypass public module contract.
- Không dùng `forwardRef()` như cách mặc định để chữa coupling kém.
- Nếu dependency vòng xuất hiện, xem lại module boundary.

---

# 19. SHARED FOLDER RULE

`shared/` chỉ dành cho technical primitive thực sự dùng chung.

Ví dụ:

```text
shared/
├── errors/
├── logging/
├── security/
├── database/
├── queue/
├── decorators/
└── types/
```

Không đưa business logic như:

```text
ProjectPolicy
ConversionRule
BillingRule
OrganizationPermission
```

vào `shared/` chỉ vì nhiều nơi dùng.

Business logic phải thuộc module sở hữu nghiệp vụ.

---

# 20. ORGANIZATION ISOLATION — RULE TỐI QUAN TRỌNG

ALSM là platform nhiều organization.

Dữ liệu business phải được scope theo organization phù hợp.

## 20.1 Bắt buộc

Một user của Organization A:

```text
KHÔNG được đọc dữ liệu Organization B
KHÔNG được sửa dữ liệu Organization B
KHÔNG được tạo conversion trên project Organization B
KHÔNG được retry/export version Organization B
```

## 20.2 Không tin client

Không xem `organizationId` từ:

- body;
- query;
- route;
- header;

là bằng chứng authorization.

Phải kiểm tra:

```text
Authenticated User
      ↓
Organization Membership / Internal Privilege
      ↓
Role/Permission
      ↓
Resource ownership
```

## 20.3 Query rule

SAI:

```ts
findById(projectId)
```

cho resource tenant-owned.

ĐÚNG:

```ts
findById(projectId, organizationId)
```

hoặc một implementation khác chứng minh được tenant scope.

---

# 21. INTERNAL STAFF / PLATFORM ADMIN ACCESS

Internal access không được biến thành bypass vô điều kiện.

## 21.1 Platform Admin

`isPlatformAdmin` hoặc internal permission:

- phải được resolve từ authenticated identity;
- không được nhận từ request body;
- mọi privileged action quan trọng phải audit.

## 21.2 Support impersonation

Khi có chức năng "View As Customer":

- mặc định read-only;
- phải audit;
- phải biết actor thật là ai;
- không được giả mạo actor thành customer trong audit log.

## 21.3 Managed Conversion

Các invariant nghiệp vụ:

- Partner trong Managed Conversion là read-only.
- Conversion Staff chỉ thao tác project được phân công.
- Thay đổi staff assignment phải audit.
- Quota/contract thuộc customer/contract, không thuộc quota cá nhân staff.

---

# 22. AUTHENTICATION RULE

Backend authentication foundation:

```text
JWT Access Token
+
Refresh Token
+
user_sessions
```

## 22.1 Password

- Không lưu plaintext.
- Dùng password hashing an toàn.
- Không log password.
- Không trả passwordHash ra API.

## 22.2 Refresh token

- Không lưu plaintext refresh token.
- Lưu hash.
- Có expiry.
- Logout/revoke phải invalidate session tương ứng.
- Refresh rotation được ưu tiên nếu implementation giữ được tính đơn giản và an toàn.

## 22.3 JWT

Không:

- hardcode secret;
- tự decode JWT thủ công trong controller;
- log token.

Dùng Guard/Strategy/decorator.

---

# 23. AUTHORIZATION / RBAC RULE

Organization role chuẩn:

```text
OWNER
ADMIN
MEMBER
VIEWER
```

Quyền business phải dựa trên role/policy.

Ví dụ theo requirement:

```text
OWNER
  manage organization
  manage billing
  manage members
  create/delete project

ADMIN
  manage organization
  manage members
  manage billing
  create/delete project

MEMBER
  create/use project
  run conversion
  collaborate
  export theo policy

VIEWER
  read-only
```

Không rải:

```ts
if (user.role === 'ADMIN')
```

khắp controller/service.

Ưu tiên:

- Guard
- Policy
- Permission service
- domain/application authorization rule

---

# 24. PROJECT DOMAIN RULE

Project phải xác định conversion type trước khi input/conversion.

Supported type:

```text
BMS_DSPF_TO_FRONTEND
COBOL_TO_JAVA
```

Một project phải có chính xác strategy phù hợp với conversion type.

Project tenant-owned phải luôn có:

```text
organizationId
```

Project delete sử dụng soft delete.

Normal query không trả project đã soft-delete trừ use case đặc biệt.

---

# 25. PHÂN BIỆT PROJECT STATUS / JOB STATUS / BUSINESS LIFECYCLE

Không được trộn ba khái niệm thành một enum khổng lồ.

## 25.1 Project status

Ví dụ:

```text
DRAFT
ACTIVE
ARCHIVED
```

## 25.2 Conversion Job operational status

```text
QUEUED
PROCESSING
COMPLETED
FAILED
DEAD
CANCELLED
```

## 25.3 Conversion business lifecycle

Business workflow có thể gồm:

```text
DRAFT
UPLOADED
PROCESSING
VALIDATION
REVIEW_REQUIRED
CORRECTION_REQUIRED
RE_PROCESSING
READY_FOR_EXPORT
EXPORTED
FAILED
CANCELLED
```

Job status mô tả **worker execution**.

Business lifecycle mô tả **trạng thái nghiệp vụ của conversion/version**.

Không dùng Job status để thay toàn bộ review/version/export workflow.

---

# 26. CONVERSION JOB RULE

Conversion Job tối thiểu phải trace được:

```text
id
organizationId
projectId
conversionType
status
priority
attemptCount
maxAttempts
inputReference
resultReference
errorCode
errorMessage
toolVersion
createdBy
createdAt
updatedAt
startedAt
completedAt
```

Không bắt buộc mọi field phải tồn tại ngay từ phase đầu nếu use case chưa cần, nhưng domain design không được chặn khả năng traceability.

---

# 27. REDIS + BULLMQ RULE

Redis/BullMQ chỉ là **execution queue**.

MongoDB là **business source of truth**.

```text
MongoDB
=
persistent business state

Redis / BullMQ
=
job scheduling + execution coordination
```

## 27.1 Queue payload

Payload phải nhỏ.

Chuẩn ưu tiên:

```json
{
  "conversionJobId": "..."
}
```

Không nhét:

- full COBOL source;
- full BMS/DSPF source;
- generated project;
- secrets;
- large metadata;

vào BullMQ payload.

---

# 28. QUEUE PRIORITY RULE

Business priority:

```text
HIGH
NORMAL
LOW
```

BullMQ numeric priority mapping phải tập trung tại một nơi.

Không rải magic number:

```text
1
2
3
```

khắp codebase.

---

# 29. RETRY / DEAD JOB RULE

Default conversion execution:

```text
maxAttempts = 3
```

Dùng exponential backoff trừ khi requirement mới quy định khác.

Khi retry tự động hết:

```text
FAILED / DEAD
```

phải được phản ánh rõ trong persistent state.

Manual retry:

- chỉ role được phép;
- chỉ retry state hợp lệ;
- reset state hợp lý;
- re-enqueue;
- audit action.

Không retry vô hạn.

---

# 30. WORKER RULE

Worker chạy process/container riêng so với HTTP API.

```text
API runtime
  ├── HTTP
  ├── auth
  ├── business workflow
  ├── persistence
  └── enqueue

Worker runtime
  ├── consume BullMQ
  ├── load persistent job
  ├── mark PROCESSING
  ├── select conversion strategy
  ├── invoke ConversionEnginePort
  └── update persistent result/status
```

API và Worker:

- cùng repository;
- cùng domain/application code;
- khác runtime entrypoint;
- không phải hai microservice business độc lập.

---

# 31. CONVERSION TOOL BOUNDARY — TUYỆT ĐỐI KHÔNG VIẾT TOOL TRONG BACKEND

Backend không được chứa actual algorithm:

```text
BMS Parser
DSPF Parser
COBOL Parser
Mapping Engine
COBOL → Java Translator
React/Angular/Vue Generator
Java Generator
```

Backend chỉ khai báo port:

```ts
export interface ConversionEnginePort {
  execute(
    input: ConversionEngineInput,
  ): Promise<ConversionEngineOutput>;
}
```

Infrastructure adapter chịu trách nhiệm map backend contract tới tool thực tế.

Ví dụ future:

```text
conversions/
└── infrastructure/
    └── adapters/
        ├── bms-dspf-conversion.adapter.ts
        └── cobol-java-conversion.adapter.ts
```

Tool có thể viết bằng Python, Java, Node.js hoặc ngôn ngữ khác.

Domain không được phụ thuộc ngôn ngữ của tool.

---

# 32. CONVERSION STRATEGY RULE

Chỉ algorithm phù hợp với `conversionType` mới được xử lý job.

Concept:

```text
BMS_DSPF_TO_FRONTEND
        ↓
BmsDspfConversionAdapter

COBOL_TO_JAVA
        ↓
CobolJavaConversionAdapter
```

Không dùng:

```ts
if (...) { huge BMS logic }
else { huge COBOL logic }
```

trong Worker/Application service.

Strategy selection phải rõ và test được.

---

# 33. INPUT / STORAGE RULE

Input legacy có thể chứa dữ liệu nhạy cảm.

Không:

- log full source;
- đưa source vào audit metadata;
- đưa full source vào queue payload;
- gửi source cho external AI nếu chưa có policy cho phép.

Input/output lớn nên đi qua storage abstraction.

Ví dụ:

```ts
export interface StoragePort {
  put(...): Promise<StorageReference>;
  get(...): Promise<StoredObject>;
}
```

Domain/Application dùng `inputReference`/`resultReference`, không phụ thuộc local path hoặc cloud SDK cụ thể.

---

# 34. VALIDATION RULE

Validation là bước nghiệp vụ riêng sau conversion.

Có thể gồm:

```text
Rule-based Validator
+
Optional AI-assisted Validator
```

Finding cần có khả năng trace về Conversion Version tương ứng.

Warning không mặc định là hard failure.

Severity/policy phải quyết định workflow tiếp theo.

---

# 35. AI VALIDATOR RULE — BẮT BUỘC

AI không phải conversion engine chính.

AI Validator:

- chỉ hỗ trợ phát hiện anomaly/mismatch;
- trả finding/reason/confidence/risk;
- không trực tiếp sửa generated result;
- không trực tiếp ghi đè DB result;
- không auto-approve;
- confidence cao không tương đương approval;
- finding phải được authorized human review trước correction;
- dữ liệu gửi ra model phải theo security/data policy.

Nếu requirement chưa chốt model/provider:

**không hardcode domain vào một AI vendor cụ thể.**

Dùng port/adapter.

---

# 36. REVIEW / CORRECTION / RE-CONVERSION RULE

Luồng sai sót chuẩn:

```text
Detect
  ↓
Review
  ↓
Decide
  ↓
Correction
  ↓
Re-conversion
  ↓
New Version
  ↓
Re-review
  ↓
Export
```

## 36.1 Bắt buộc

- Correction phải audit.
- Re-conversion không được overwrite version trước.
- Business ambiguity không được AI/backend tự suy đoán thành "correct".
- Unsupported construct phải có đường Manual Review / Technical Escalation.

---

# 37. VERSIONING RULE

Mỗi conversion/re-conversion phải truy vết được version.

Version phải có khả năng lưu/trace:

```text
conversionId
versionNumber
inputReference
resultReference
toolVersion
status
createdBy / createdAt
validation findings
review state
```

## 37.1 Cấm

- Update version cũ thành version mới để tiết kiệm collection.
- Xóa version cũ khi re-convert.
- Export mà không biết version nào được export.

---

# 38. EXPORT RULE

Chỉ version đạt điều kiện nghiệp vụ mới được export chính thức.

Business invariant:

```text
READY_FOR_EXPORT
      ↓
EXPORT
```

Export phải ghi nhận:

- version;
- actor;
- time;
- project/organization context;
- output reference/package;
- audit trail.

---

# 39. SIDE-EFFECT / EVENT RULE

Side-effect không phải core state transition nên ưu tiên domain/application event.

Ví dụ:

```text
conversion.completed
   ├── notification
   ├── audit enrichment
   └── validation trigger

conversion.version.approved
   ├── notification
   └── activity feed
```

Hoặc:

```text
member.invited
payment.succeeded
project.created
conversion.dead
```

## 39.1 Cấm coupling dây chuyền

Không để một use case core gọi thẳng hàng loạt:

```text
NotificationService
BillingService
ActivityFeedService
WebhookService
AuditService
```

nếu các thao tác đó là side-effect độc lập.

## 39.2 Ngoại lệ

Nếu một thao tác là **bắt buộc để bảo đảm consistency của chính use case**, application service có thể orchestration trực tiếp qua port.

Không dùng event chỉ vì "trông enterprise".

---

# 40. AUDIT RULE

`audit_logs` là append-only.

Audit entry nên trace:

```text
organizationId
actorUserId
action
targetType
targetId
metadata
createdAt
```

Các action quan trọng ví dụ:

```text
USER_REGISTERED
USER_LOGIN
ORGANIZATION_MEMBER_INVITED
ORGANIZATION_ROLE_CHANGED
PROJECT_CREATED
PROJECT_UPDATED
PROJECT_DELETED
CONVERSION_JOB_CREATED
CONVERSION_JOB_RETRIED
CONVERSION_CORRECTED
CONVERSION_VERSION_APPROVED
CONVERSION_EXPORTED
SUPPORT_IMPERSONATION_STARTED
CONVERSION_STAFF_ASSIGNED
```

## 40.1 Không audit secret

CẤM lưu:

- plaintext password;
- password hash;
- JWT;
- refresh token;
- API key plaintext;
- payment card data;
- full legacy source;
- external provider secret.

## 40.2 Immutability

Normal application code:

- không update audit record;
- không delete audit record.

Retention thực hiện theo approved retention policy, không tùy tiện.

---

# 41. API RULE

API prefix:

```text
/api/v1
```

Ưu tiên RESTful naming.

Ví dụ:

```text
POST   /api/v1/projects
GET    /api/v1/projects
GET    /api/v1/projects/:id
PATCH  /api/v1/projects/:id
DELETE /api/v1/projects/:id

POST   /api/v1/projects/:projectId/conversions
GET    /api/v1/projects/:projectId/conversions
GET    /api/v1/conversions/:id
POST   /api/v1/conversions/:id/retry
```

Không tạo action URL tùy tiện nếu resource-oriented endpoint diễn đạt được.

---

# 42. API RESPONSE RULE

Response shape phải nhất quán.

Recommended success envelope:

```json
{
  "success": true,
  "data": {},
  "meta": null
}
```

Recommended error:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": []
}
```

Nếu backend base đã chốt một response contract khác:

- giữ contract đó;
- document trong README/Swagger;
- không tạo nhiều shape khác nhau giữa module.

---

# 43. ERROR RULE

Dùng centralized exception/error handling.

Business error code phải có ý nghĩa:

```text
INVALID_CREDENTIALS
ORGANIZATION_ACCESS_DENIED
PROJECT_NOT_FOUND
PROJECT_NOT_ACCESSIBLE
INVALID_CONVERSION_TYPE
CONVERSION_JOB_NOT_FOUND
CONVERSION_JOB_NOT_RETRYABLE
CONVERSION_VERSION_NOT_EXPORTABLE
UNSUPPORTED_CONVERSION_INPUT
```

Không:

- trả raw stack trace production;
- trả Mongo/Mongoose exception raw cho client;
- dùng `"Something went wrong"` cho mọi lỗi.

---

# 44. DTO / VALIDATION RULE

External input phải validate.

NestJS standard:

```text
DTO
+
class-validator
+
class-transformer
+
global ValidationPipe
```

Validate:

- body;
- params;
- query;
- enums;
- file metadata;
- IDs;
- pagination;
- sort/filter allowlist.

Không trust input từ client.

---

# 45. SECURITY RULE

Bắt buộc:

- Helmet
- CORS config qua environment
- validation
- password hashing
- refresh-token hashing
- secrets qua env
- `.env` không commit
- `.env.example` có documented keys
- `.dockerignore`
- no secret in logs
- no secret in Swagger example

Không hardcode:

```text
JWT secret
MongoDB credential
Redis credential
OAuth secret
Stripe key
AI key
SMTP key
Storage key
```

---

# 46. LOGGING RULE

Dùng structured logging.

Context hữu ích:

```text
requestId
userId
organizationId
projectId
conversionJobId
conversionVersionId
```

Không log:

- password;
- token;
- secret;
- card data;
- full sensitive legacy source.

---

# 47. HEALTH RULE

Backend phải có health endpoint:

```text
GET /api/v1/health
```

Ít nhất kiểm tra:

```text
application
mongodb
redis
```

Health check không được thực thi conversion tool.

---

# 48. SWAGGER / OPENAPI RULE

API mới/chỉnh sửa phải cập nhật Swagger.

Development docs:

```text
/api/docs
```

Document:

- auth requirement;
- role requirement;
- DTO;
- response;
- error cases quan trọng.

Swagger không được chứa secret hoặc source code thật.

---

# 49. DOCKER RULE

Docker là chuẩn runtime packaging của backend.

Core services:

```text
backend
worker
mongodb
redis
```

Không thêm converter container trước khi actual tool tồn tại.

## 49.1 Container networking

Trong container:

```text
mongodb
redis
```

không dùng:

```text
localhost
```

để gọi container khác.

## 49.2 API / Worker

`backend` chạy HTTP API.

`worker` chạy worker entrypoint.

Cả hai có thể dùng cùng image/codebase.

Đây không phải microservices split.

---

# 50. REDIS PRODUCTION SAFETY

Redis được dùng cho queue nên không được cấu hình như cache disposable.

Production configuration phải cân nhắc:

- persistence;
- memory;
- no arbitrary queue-key eviction;
- health;
- restart policy.

Không giả định Redis mất dữ liệu là "không sao" chỉ vì MongoDB giữ business state.

MongoDB giúp recover business state, nhưng queue execution vẫn phải được vận hành an toàn.

---

# 51. ENVIRONMENT RULE

`.env.example` phải document tối thiểu:

```text
NODE_ENV
PORT

MONGODB_URI

REDIS_HOST
REDIS_PORT
REDIS_PASSWORD

JWT_ACCESS_SECRET
JWT_ACCESS_EXPIRES_IN

JWT_REFRESH_SECRET
JWT_REFRESH_EXPIRES_IN

CORS_ORIGINS

CONVERSION_WORKER_ENABLED
```

Nếu thêm config mới:

- thêm vào `.env.example`;
- validate startup config;
- update README nếu dev cần biết.

---

# 52. FILE / CLASS NAMING

Files:

```text
kebab-case
```

Ví dụ:

```text
create-project.service.ts
project.entity.ts
project.repository.ts
mongo-project.repository.ts
project.mapper.ts
project.presenter.ts
conversion-engine.port.ts
```

Class/type/interface:

```text
PascalCase
```

Variable/function:

```text
camelCase
```

Constants:

```text
UPPER_SNAKE_CASE
```

Không dùng abbreviation khó hiểu:

```text
usrSvc
convMgr
pRepo
```

---

# 53. TYPESCRIPT RULE

- Strict typing khi practical.
- Hạn chế `any`.
- Không dùng `as any` để che lỗi compiler.
- Không `@ts-ignore` nếu chưa có lý do documented.
- Prefer explicit domain type.
- Enum/string union phải centralize, không duplicate literal.

---

# 54. CIRCULAR DEPENDENCY RULE

CẤM dùng `forwardRef()` như giải pháp mặc định.

Khi xuất hiện dependency vòng:

1. xác định module ownership;
2. xem lại public port;
3. tách shared primitive nếu thật sự technical;
4. dùng event nếu là side-effect;
5. chỉ dùng `forwardRef()` khi có lý do rõ và review.

---

# 55. DATABASE INDEX RULE

Index phải dựa trên query/use case.

Ví dụ hợp lý:

```text
users.email unique

projects:
organizationId
organizationId + createdAt
organizationId + deletedAt

conversion_jobs:
organizationId
projectId
status
createdAt

user_sessions:
expiresAt TTL
```

Không tạo index "cho chắc" nếu không có query cần.

---

# 56. SOFT DELETE RULE

Project sử dụng soft delete.

Soft-deleted resource:

- không xuất hiện trong query normal;
- không truy cập bằng route normal trừ policy cho phép;
- không tự động hard-delete nếu chưa có retention rule.

Restore rule nếu được implement phải nằm trong domain/application, không nằm trong controller.

---

# 57. TRANSACTION / CONSISTENCY RULE

Không introduce distributed transaction framework.

MongoDB transaction chỉ dùng khi:

- nhiều write bắt buộc atomic;
- failure một phần gây inconsistency nghiêm trọng;
- transaction thực sự được Mongo deployment hỗ trợ.

Không dùng transaction cho mọi CRUD.

---

# 58. TEST RULE

Mọi business functionality quan trọng phải có test phù hợp.

Ít nhất các area sau cần được cover dần:

```text
authentication
session/refresh
authorization
organization isolation
project CRUD
soft delete
conversion job creation
queue enqueue
retry/dead state
conversion strategy selection
review/export eligibility
audit invariants
```

---

# 59. ORGANIZATION ISOLATION TEST — BẮT BUỘC

Mọi resource tenant-owned mới phải có test kiểu:

```text
Organization A
cannot read
Organization B resource
```

và khi có write:

```text
Organization A
cannot modify/delete/retry/export
Organization B resource
```

Không merge feature tenant-owned nếu không test isolation quan trọng.

---

# 60. CONVERSION TEST RULE

Backend test không cần test actual converter algorithm nếu tool nằm repo riêng.

Backend phải test:

- đúng job được tạo;
- đúng conversion type;
- đúng queue payload;
- đúng strategy/adapter được chọn;
- retry state;
- failure mapping;
- tool error → persistent error state;
- không fake success khi adapter chưa có.

Converter repo/tool riêng phải có test parser/mapping/generator của nó.

---

# 61. AI TEST RULE

Nếu AI Validator được implement:

- mock external model trong unit/integration test;
- test timeout/error;
- test AI finding không tự mutate result;
- test human review requirement;
- không dùng live API mặc định trong unit test.

---

# 62. EVENT TEST RULE

Event handler phải test độc lập khi chứa behavior quan trọng.

Core use-case test không nên fail chỉ vì notification/email provider unavailable nếu notification là side-effect async độc lập.

---

# 63. CODE QUALITY COMMANDS

Trước khi báo task hoàn thành, chạy phù hợp:

```bash
npm run lint
npm run test
npm run build
```

Nếu project có:

```bash
npm run test:e2e
npm run architecture:check
```

thì chạy khi task liên quan.

Không claim PASS nếu chưa chạy.

---

# 64. ARCHITECTURE SELF-CHECK

Khuyến nghị tạo script:

```text
npm run architecture:check
```

để enforce các rule import.

Cho tới khi script có, có thể dùng `rg`/grep tương đương.

## 64.1 Domain không được bẩn

```bash
rg -n \
"from ['\"](@nestjs|mongoose|bullmq|ioredis)|infrastructure/|presentation/|application/" \
src/modules/*/domain
```

Kết quả mong đợi:

```text
EMPTY
```

## 64.2 Application không import Mongoose/schema/model

```bash
rg -n \
"from ['\"]mongoose|\.schema['\"]|\.model['\"]" \
src/modules/*/application
```

Kết quả mong đợi:

```text
EMPTY
```

## 64.3 Presentation không truy cập DB/queue trực tiếp

```bash
rg -n \
"from ['\"]mongoose|bullmq|ioredis|infrastructure/persistence|\.model['\"]" \
src/modules/*/presentation
```

Kết quả mong đợi:

```text
EMPTY
```

## 64.4 Không cross-module qua infrastructure

```bash
rg -n \
"modules/.+/infrastructure/" \
src/modules
```

Mọi match phải được review.

Cross-module infrastructure import gần như luôn là lỗi.

---

# 65. MANUAL ARCHITECTURE CHECKLIST

Trước khi báo "xong":

- [ ] Đúng business module.
- [ ] Đúng layer.
- [ ] Domain sạch framework.
- [ ] Application không query Mongoose.
- [ ] Controller mỏng.
- [ ] Repository trả Entity/domain type.
- [ ] Mapper nằm infrastructure.
- [ ] Presenter nằm presentation.
- [ ] Repository token dùng Symbol.
- [ ] Organization isolation được kiểm tra.
- [ ] Auth/permission được kiểm tra.
- [ ] Không import infrastructure module khác.
- [ ] Queue payload nhỏ.
- [ ] Conversion tool không bị viết vào backend.
- [ ] Versioning không overwrite history.
- [ ] AI không tự mutate/approve.
- [ ] Sensitive data không vào logs/audit.
- [ ] Swagger cập nhật nếu API đổi.
- [ ] `.env.example` cập nhật nếu config đổi.
- [ ] README cập nhật nếu setup đổi.
- [ ] Tests/lint/build đã chạy phù hợp.

---

# 66. DEFINITION OF DONE — BACKEND TASK

Một task chỉ được coi là DONE khi:

1. Requirement/use case đúng.
2. Module ownership đúng.
3. Layer đúng.
4. Code compile.
5. Relevant tests pass.
6. Lint pass.
7. Organization isolation không bị phá.
8. Authorization không bị bypass.
9. Không tạo coupling sai.
10. Không leak secret/sensitive source.
11. API docs được cập nhật nếu cần.
12. Docker/env không bị phá nếu có thay đổi.
13. `RULE.md` vẫn được tuân thủ.
14. Developer báo rõ các TODO/deviation còn lại.

---

# 67. GIT / REVIEW RULE

Khuyến nghị branch:

```text
main
develop
feature/*
fix/*
refactor/*
```

Significant backend change phải review trước merge.

PR/review phải kiểm tra:

- business correctness;
- architecture boundary;
- tenant isolation;
- security;
- test;
- migration/backward compatibility;
- docs.

Không review chỉ bằng "build xanh".

---

# 68. NO DEAD CODE RULE

Không để:

- large commented-out code;
- unused service;
- fake adapter;
- unused abstraction;
- duplicate implementation;
- temporary hardcoded secret;
- TODO vô nghĩa.

TODO phải cụ thể.

Ví dụ:

```ts
// TODO(ALSM-CONVERSION):
// Integrate COBOL-to-Java external tool through ConversionEnginePort.
```

---

# 69. NO PREMATURE COMPLEXITY RULE

CẤM introduce chỉ để "trông enterprise":

```text
Microservices
Kafka
RabbitMQ
Kubernetes
CQRS framework
Event Sourcing
Service Mesh
GraphQL
Multiple primary databases
Distributed transactions
```

Nếu requirement thực sự cần:

- viết proposal/ADR;
- nêu problem;
- nêu trade-off;
- được approve;
- update `RULE.md`.

---

# 70. MODULE-SPECIFIC OWNERSHIP

Ownership gợi ý:

```text
auth/
  login, register, refresh, logout, auth policy

users/
  user profile/account state

organizations/
  organization, membership, roles

projects/
  project lifecycle, conversion type

conversions/
  conversion request/job/result orchestration

validation/
  validation policy, finding

reviews/
  review/approve/reject/correction workflow

versioning/
  conversion version history

collaboration/
  comments, mentions, activity

billing/
  plans, subscriptions, invoices, usage

crm/
  leads, quote/contract workflow

support/
  queue support, impersonation, escalation

admin/
  platform-level administration

audit/
  append-only audit trail
```

Nếu một feature chạm nhiều module:

- xác định module sở hữu state chính;
- module khác giao tiếp qua public port/event;
- không duplicate state.

---

# 71. FUTURE COLLECTIONS / DATA MODEL RULE

ALSM requirements hiện mô tả các collection business như:

```text
users
organizations
projects
screens
conversion_jobs
subscriptions
invoices
plans
leads
contracts
audit_logs
user_sessions
api_keys
comments
```

Business Overview còn yêu cầu traceability cho:

```text
Conversion Version
Finding
Review/Correction
```

Không bắt buộc giữ đúng 14 collection mãi mãi nếu SDD mới cần thêm collection để mô hình hóa business đúng.

Tuy nhiên:

- không thêm collection tùy tiện;
- phải có requirement/design reason;
- update SDD/data model;
- giữ organization isolation.

---

# 72. BUSINESS INVARIANTS TỪ ALSM

Các invariant sau phải được coi là rule nghiệp vụ cốt lõi:

1. Project phải có conversion type trước khi upload/convert.
2. Input phải phù hợp conversion type.
3. Mỗi conversion job phải trace được status/result.
4. BMS/DSPF-to-Frontend và COBOL-to-Java là hai conversion type độc lập.
5. Chỉ đúng Conversion Algorithm được phép xử lý job.
6. Conversion Result phải qua validation/review policy trước export.
7. Warning không tự động đồng nghĩa failure.
8. Conversion error phải được phân loại để xử lý đúng.
9. Unsupported construct phải có Manual Review/Technical Escalation.
10. Correction không được làm mất version trước.
11. Re-conversion phải tạo version mới hoặc traceability tương đương.
12. AI Validator không được tự overwrite result.
13. AI finding phải được review trước correction.
14. AI confidence không phải quyền approval.
15. Partner Managed Conversion là read-only.
16. Conversion Staff chỉ thao tác project được phân công.
17. Chỉ version Ready for Export mới được export chính thức.
18. Export phải trace version.
19. Staff assignment change phải audit.
20. Managed Conversion quota/contract thuộc customer/contract.

---

# 73. WORKER DISABLED MODE

Khi actual converter tool chưa tồn tại hoặc chưa được tích hợp:

```text
CONVERSION_WORKER_ENABLED=false
```

Worker có thể start nhưng:

- không consume conversion jobs;
- log rõ processing disabled;
- không đánh job thành failed chỉ vì adapter chưa implement;
- không fake conversion success.

Đây là behavior được ưu tiên cho backend bootstrap.

---

# 74. EXTERNAL ADAPTER RULE

Mọi external system nên qua port/adapter nếu ảnh hưởng application workflow.

Ví dụ:

```text
ConversionEnginePort
AiValidatorPort
StoragePort
EmailPort
PaymentGatewayPort
WebhookPort
```

External SDK chỉ nằm infrastructure.

Domain/Application không phụ thuộc:

```text
Stripe SDK
Anthropic/OpenAI SDK
AWS SDK
SendGrid SDK
DocuSign SDK
```

trực tiếp.

---

# 75. BACKWARD COMPATIBILITY RULE

Khi API đã có frontend sử dụng:

- không đổi route path tùy tiện;
- không đổi field/response shape tùy tiện;
- deprecate trước khi remove;
- update frontend contract có kế hoạch;
- update Swagger.

Nếu cần persistence legacy mapping:

- che tại mapper;
- không làm domain phụ thuộc field legacy.

---

# 76. MIGRATION / SCHEMA CHANGE RULE

Khi đổi schema:

1. kiểm tra backward compatibility;
2. kiểm tra indexes;
3. kiểm tra existing documents;
4. kiểm tra organization scope;
5. kiểm tra default;
6. kiểm tra enum;
7. kiểm tra audit/version implications;
8. document migration/backfill nếu cần.

Không deploy schema-breaking change rồi hy vọng dữ liệu tự khớp.

---

# 77. CODING AGENT RULE

Mọi AI coding agent làm việc trong backend phải:

1. Đọc toàn bộ `RULE.md`.
2. Đọc README và relevant module.
3. Inspect existing code trước khi generate.
4. Không tự thay architecture.
5. Không copy pattern sai chỉ vì nó đang tồn tại.
6. Nếu module hiện tại vi phạm `RULE.md`, không nhân vi phạm sang module mới.
7. Không xóa useful code nếu chưa hiểu.
8. Chạy lint/test/build khi tooling cho phép.
9. Không nói "pass" nếu chưa chạy.
10. Báo rõ file đã thay đổi.
11. Báo rõ deviation/TODO.
12. Nếu task xung đột `RULE.md`, nêu xung đột trước.

---

# 78. DEVELOPER PRE-CODING CHECKLIST

Trước khi code:

- [ ] Đã đọc `RULE.md`.
- [ ] Đã đọc requirement/use case liên quan.
- [ ] Biết module nào sở hữu feature.
- [ ] Biết layer nào cần sửa.
- [ ] Đã inspect code hiện tại.
- [ ] Đã xác định organization scope.
- [ ] Đã xác định auth/role.
- [ ] Đã xác định persistence port.
- [ ] Đã xác định external port nếu có.
- [ ] Đã xem test liên quan.
- [ ] Đã kiểm tra có duplicate implementation hay không.

---

# 79. POST-CODING CHECKLIST

Sau khi code:

- [ ] Build xanh.
- [ ] Lint xanh.
- [ ] Relevant tests xanh.
- [ ] Domain sạch.
- [ ] Application không chạm Mongoose.
- [ ] Presentation không chạm DB/queue.
- [ ] Cross-module không import infrastructure.
- [ ] Organization isolation test có nếu cần.
- [ ] Swagger update.
- [ ] `.env.example` update.
- [ ] README update.
- [ ] Docker config valid nếu bị ảnh hưởng.
- [ ] Không secret.
- [ ] Không fake converter.
- [ ] Không overwrite conversion version history.
- [ ] AI rule được giữ.
- [ ] Audit hợp lý.

---

# 80. RULE.md GOVERNANCE

`RULE.md` là governance file.

Không được sửa chỉ vì:

- code hiện tại khó refactor;
- developer muốn import model cho nhanh;
- deadline gấp;
- muốn bypass layer;
- muốn thêm framework mới.

Muốn đổi kiến trúc:

1. mô tả vấn đề;
2. đề xuất lựa chọn;
3. trade-off;
4. team/technical lead approve;
5. update `RULE.md`;
6. update README;
7. update SDD/ADR;
8. refactor code liên quan.

---

# 81. TÓM TẮT 15 GIÂY

> ALSM Backend = **Node.js + TypeScript + NestJS + MongoDB/Mongoose + Redis/BullMQ + Docker**.
>
> Kiến trúc = **Modular Monolith + Simplified Clean Architecture**.
>
> Module business trước; mỗi module chia `presentation → application → domain ← infrastructure`.
>
> `domain` tuyệt đối sạch framework/DB. `application` chỉ chạm persistence qua port. Mongoose/Redis/BullMQ/external SDK chỉ ở infrastructure. Repository trả Entity qua Mapper. Controller mỏng và dùng Presenter.
>
> Ba portal dùng chung một backend và một business platform; mọi resource tenant-owned phải enforce organization isolation.
>
> Conversion chạy async qua BullMQ Worker. MongoDB là business source of truth, Redis/BullMQ là execution queue.
>
> BMS/DSPF-to-Frontend và COBOL-to-Java là **external Conversion Tools**, không viết trực tiếp trong backend.
>
> Validation/AI chỉ hỗ trợ; AI không auto-fix/auto-approve. Correction → re-conversion phải giữ version cũ. Chỉ approved/Ready-for-Export version mới được export.
>
> Xong task phải chạy lint/test/build + architecture check và không báo PASS nếu chưa chạy.
