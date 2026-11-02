# UC66-03 isolated read-only workspace

Base: accepted foundation `a14c6de`. Implementation branch:
`feature/alsmv2-1050-uc66-03-workspace`. Production activation remains closed.

## Revocation boundary recorded before implementation

The accepted foundation checks the authoritative account, original session and
support role/permission before work and before commit. These reads are not fenced
against the independent authentication/RBAC revocation commands. A revocation after
the final check can race the context/audit commit. The per-instance context queue
only schedules local requests; it does not serialize revocation or other instances.

UC66-03 will recheck admission after projections, immediately before committing,
and after commit before returning data. This narrows the window and suppresses data
when revocation is observed, but cannot eliminate a change after the final check
or atomically couple delivery of an HTTP response to database/audit persistence.
An already committed audit/activity must not be described as rolled back if a final
delivery check fails. No revocation-ordering policy is approved by this implementation.

Activation blocker: the Technical Owner must approve the required in-flight and
revocation-ordering semantics. Add transactional fencing where required, or obtain
explicit approval for bounded in-flight behavior, with cross-instance revocation
and resource-read tests. All UC-66 handlers stay unregistered until independent
QA/Security review and separate activation approval.

## Inspected ownership model

- Projects: `projects.organizationId`; deleted projects are excluded.
- Screens and Programs share `screens`: BMS/DSPF are Screens, COBOL rows are Programs.
  Both require a live parent Project in the exact Organisation. Older conversion
  screen rows use string project IDs and omit organizationId; ownership derives
  from the parent. An explicit conflicting organizationId is never ignored.
- Findings share `validation_findings` across the canonical Validation and legacy
  conversion schemas. Legacy findings can omit organizationId. Validate their
  `validationRunId` against `validation_runs` and the run/finding conversion job,
  then validate that job and Project against the same Organisation/project.
- Conversion logs are diagnostic metadata from `conversion_jobs`; Error Logs use
  `error_logs`. Both bind to the exact Organisation and parent Project. Error Logs
  have screenName rather than a reliable screen foreign key; no ownership inference
  is made from filenames.

Existing customer read services are unsuitable for this facade: some return source
or storage references, lack bounds, or update Screen status during GET. New public
owner-module projection ports will read the existing collections without invoking
those services or adding schemas.

## Implemented routes and allowlist

All remain **unregistered** in AppModule and the worker. No activation flag exists.
Prefix: `/api/v1/support/organizations/:organizationId/contexts/:contextId/workspace`.

| GET suffix                                           | Operation                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| `/projects`                                          | WORKSPACE_PROJECT_LIST                                          |
| `/projects/:projectId`                               | WORKSPACE_PROJECT_DETAIL                                        |
| `/projects/:projectId/screens[/:resourceId]`         | WORKSPACE_SCREEN_LIST / WORKSPACE_SCREEN_DETAIL                 |
| `/projects/:projectId/programs[/:resourceId]`        | WORKSPACE_PROGRAM_LIST / WORKSPACE_PROGRAM_DETAIL               |
| `/projects/:projectId/findings[/:resourceId]`        | WORKSPACE_FINDING_LIST / WORKSPACE_FINDING_DETAIL               |
| `/projects/:projectId/conversion-logs[/:resourceId]` | WORKSPACE_CONVERSION_LOG_LIST / WORKSPACE_CONVERSION_LOG_DETAIL |
| `/projects/:projectId/error-logs[/:resourceId]`      | WORKSPACE_ERROR_LOG_LIST / WORKSPACE_ERROR_LOG_DETAIL           |

Four new handlers implement twelve concrete named read operations. Lists accept only
limit 1–25 (default 10) and canonical ObjectId afterId. Each query is bounded to
2 seconds, sorted by ObjectId and uses a single lookahead row. Details require a
canonical resource ID; unknown body/query fields deny. Cache-Control is no-store.
No create/update/delete/upload/convert/retry/mapping/generation/export/download/
billing operation, side-effect GET, customer JWT or membership grant is introduced.

The [Support README](../../src/modules/support/README.md) specifies every response
field and error. Views expose bounded resource labels, known enum values, numeric
diagnostics, timestamps and needed finding ownership IDs. They exclude raw source,
generated code, free-form finding/error payloads, tokens, credentials, storage
references, processing claims and member/billing information. Resource labels may
contain customer-authored filenames. Existing read repositories/services are not
reused where they lack projection/bounds or have GET side effects; owner-module
public projection factories query the actual collections without model registration.

## Authorization, audit and reconciliation

Ordinary JWT authentication and the existing SupportStaffAccessService enforce the
real actor, persisted active original session/account, exact current INTERNAL_SUPPORT
assignment and organizations.impersonate grant. Admin status alone is insufficient.
Every workspace request checks the actor/session/context/Organisation binding,
unchanged 30/15-minute lifetime, eligible Organisation and exact Project/child/run/
job ownership. Missing resources, inconsistent parent chains and forged IDs fail
closed without activity. Client capability fields cannot replace server authority.

The accepted Support Core unit of work supplies an opaque session/connection handle
to the owning projection factories. Projection/ownership reads, context revision/
idle update and required audit use that same snapshot transaction. No production
schema/index or shared transaction runner changes are required. Database operations
are sequential inside a transaction. An audit failure rolls pending activity back.
An exception after commit starts never becomes confirmed rollback or business replay.

Each read gets a server-generated operationId outside its single business callback.
One SUPPORT_WORKSPACE_READ audit records actor, Organisation, context, original
session, resource collection/type/ID, operationId, named operation, server timestamp
and every returned resource ID. A list targets the scoped collection (Organisation
for Projects, Project for child lists); details target the exact resource ID. Cursor,
limit and authorization time are included. Responses contain operationId; unknown
commit responses retain contextId, operationId, mutationCommitted:unknown and
retrySafe:false without resource data. Reconciliation must inspect the original
scoped audit/operation identity read-only, not submit another activity mutation.
No new reconciliation endpoint is activated here.

Post-commit authority loss withholds data using SUPPORT_WORKSPACE_DELIVERY_WITHHELD,
activityCommitted:true, contextId, operationId and retrySafe:false. This honestly
distinguishes a committed authorized activity/audit from HTTP delivery. Context Exit
fences later context writes through optimistic revision checks, including independent
instances; a response from a read committed before Exit can still be in flight.
Ownership is validated in the transaction snapshot, not a global epoch fencing every
customer lifecycle/ownership change against response delivery.

## Actual verification

| Check                                            | Result                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| New workspace unit/orchestration tests           | **20 PASS, 0 FAIL, 0 SKIP**                                                                                     |
| New real Mongo workspace cases                   | **53 PASS, 0 FAIL, 0 SKIP**                                                                                     |
| All real Mongo cases                             | **103 PASS, 0 FAIL, 0 SKIP** (the accepted 50 are preserved)                                                    |
| All UC-66 suites                                 | **199 PASS, 0 FAIL, 0 SKIP**, six suites; non-Mongo total 96                                                    |
| Full Jest suite, only UC-66 Mongo opt-in enabled | **1,641 PASS, 13 FAIL, 44 SKIP**; 123 passing suites, one failing and one skipped                               |
| Baseline comparison                              | All 13 Gemini failure names and details exactly match the accepted a14c6de review evidence; Gemini is unchanged |
| TypeScript / ESLint / fresh build                | PASS, no auto-fix                                                                                               |
| Changed-file formatting / diff / architecture    | PASS; formatting is limited to changed files                                                                    |

The 53 new Mongo cases run inside the existing ownership-checked random database
fixture. They cover all six lists/details, legacy/inconsistent nested ownership,
Organisation isolation, missing/forged IDs, safe projections, pagination, denied
writes/side-effect GET, lifetime, original-session/account/role revocation, real
audit-validator rollback, local and independent-instance read/Exit conflicts, and
six actual-commit acknowledgement-loss variants. Those faults assert one callback,
one application commit call, one durable workspace audit, revision 1→2, retained
scope/operation identity and UNCONFIRMED without data. No read-activity mutation is
automatically replayed.

Revocation tests use another real database connection. Changes during projection
roll back with no activity/audit. Changes after the final pre-commit check are
observed by the delivery check: data is withheld while the already committed audit
and activity remain. Three tests deliberately reproduce the remaining window:
role/session/account revocation **after** the final delivery check can still allow
that in-flight response; the next request denies without new activity. Passing
these tests documents the activation blocker; it does not approve those semantics.
Independent-adapter tests additionally prove one conflicting resource read aborts
without replay and an independently committed Exit prevents stale activity commit.

Existing authentication, RBAC, Organisation, Team/Sales/UC-48, UC-67, disabled
impersonation and shared transaction-runner regression suites pass in the full run.
Separate opt-in Team/Sales external-service harnesses were not activated. The 44
legacy validation integration skips retain their existing test database gate.

Evidence: `E:/ALSM/alsmv2-1050-uc66-03-evidence-20261101` contains full-jest.json/log,
verification-summary.json, typescript.log, eslint.log, build.log, formatting.log,
architecture.json, baseline-protection.json and cleanup.json. The initial focused
run (188 PASS / 3 FAIL) is preserved separately; those three new tests used the
wrong BSON type to revoke a string user_roles.userId. The fixture was corrected
before the final full verification above.

## Exact files changed

Modified (6):

- `src/modules/support/README.md`
- `src/modules/support/application/support-context.ports.ts`
- `src/modules/support/infrastructure/mongo-support-context.unit-of-work.ts`
- `src/modules/support/support-foundation.module.ts`
- `test/uc66-foundation.mongo.integration.spec.ts`
- `test/uc66-production-boundary.spec.ts`

Added (20):

- `docs/engineering/UC66_03_IMPLEMENTATION_20261101.md`
- `src/modules/conversions/application/support-conversion-reader.port.ts`
- `src/modules/conversions/infrastructure/mongo-support-conversion-reader.ts`
- `src/modules/conversions/support-conversion-reader.module.ts`
- `src/modules/projects/application/support-project-reader.port.ts`
- `src/modules/projects/infrastructure/mongo-support-project-reader.ts`
- `src/modules/projects/support-project-reader.module.ts`
- `src/modules/screens/application/support-screen-reader.port.ts`
- `src/modules/screens/infrastructure/mongo-support-screen-reader.ts`
- `src/modules/screens/support-screen-reader.module.ts`
- `src/modules/support/application/read-support-workspace.service.ts`
- `src/modules/support/presentation/support-workspace.controller.ts`
- `src/modules/support/presentation/support-workspace.dto.ts`
- `src/modules/validation/application/support-finding-reader.port.ts`
- `src/modules/validation/infrastructure/mongo-support-finding-reader.ts`
- `src/modules/validation/support-finding-reader.module.ts`
- `src/shared/application/diagnostic-read.port.ts`
- `src/shared/database/mongo-diagnostic-read.ts`
- `test/uc66-workspace.mongo.cases.ts`
- `test/uc66-workspace.services.spec.ts`

No files deleted. The Support Core adapter change only exposes its already active
session/connection to read-only projection participants; transaction/retry/cleanup
behavior is unchanged. Existing authentication/RBAC/Organisation services, UC-67,
Gemini, Team/Sales/UC-48, shared MongoTransactionRunner, domain lifetime policy,
existing schemas/migrations/index declarations, AppModule and worker are unchanged.
The production metadata test now explicitly excludes the workspace controller and
all projection-reader tokens. Legacy impersonation still returns authenticated
503 SUPPORT_IMPERSONATION_UNAVAILABLE. Ticket/Consent prerequisites remain absent.

## Data safety and handoff

Only the verified disposable mongo:8 replica set at 127.0.0.1:27128 is used, with
the existing expected name, label and set identity, tmpfs data and no shared data
volume. Parent fixture ownership markers are checked before each test and database
drop. No production credentials, data, deployed indexes or migrations are changed.
The test container is removed after final verification; unrelated container identity
and running states are checked against the before-run inventory.

Ready for Hoang's independent QA/Security review within isolated UC66-03 scope.
Operational activation remains blocked on the explicitly unresolved revocation and
in-flight ordering decision/fencing, cross-instance review, non-destructive storage/
index provisioning, retention/staff-role review and separate activation approval.
No activation is included in this delivery.
