# ALSMV2-1050 / UC-66 — UC66-01/02 implementation handoff

1 November 2026. Repository: `E:/ALSM/ALSM_WEB_BE`.
Branch: `feature/alsmv2-1050-uc66-01-02-foundation`, based on accepted cleanup
`b7587fa`. Historical backup `3237f9f` is preserved.

**Ready for Hoang's QA/Security review; deliberately unregistered and not activated.**
The existing authenticated impersonation endpoint remains
`503 SUPPORT_IMPERSONATION_UNAVAILABLE`. No customer workspace facade, customer
JWT or membership grant is introduced. No Ticket/Consent prerequisite is restored.

## Implemented API and registration

All paths below have the `/api/v1` prefix and are **unregistered in AppModule and
the worker**. The isolated `SupportFoundationModule` is exercised through real
HTTP authentication/current-session checks and owned MongoDB tests.

| Method | Route                                                           | Behavior                                                                                                                            |
| ------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /support/organizations                                          | Name-prefix or exact contactEmail search; 3–120 characters, literal escaped matching, limit 1–25, keyset pagination, metadata only. |
| POST   | /support/organizations/:organizationId/contexts                 | Empty body/query; create exact actor/original-session-bound, server-controlled READ_ONLY context with required ENTER audit.         |
| GET    | /support/organizations/:organizationId/contexts/:contextId      | Exact-scope active context status; only explicitly allowlisted CONTEXT_STATUS activity, transactionally audited with idle refresh.  |
| POST   | /support/organizations/:organizationId/contexts/:contextId/exit | Exact-scope termination with EXIT audit; repeated/concurrent exits are idempotent.                                                  |

Compiled production registration still has **34 controllers and 188 routes**;
there are zero new Support routes and zero old Ticket routes. The additional public
transactional audit factory is a stateless provider, not an endpoint or context
activation. The original impersonation route and both independent UC-67 Support
Patch routes remain registered. New route DTOs, response DTOs, error contracts and
Swagger metadata are implemented.

## Security and lifetime

The existing JWT guard and RequireCurrentSessionService retain the real staff
identity and persisted original session. Support additionally requires exactly one
current persisted INTERNAL_SUPPORT assignment and that canonical system role's
existing organizations.impersonate permission. Permanent and current approved
ordinary temporary-role sources are supported; absent, revoked, expired, pending,
overlapping or ambiguous sources deny. A Platform Admin flag or the general
Admin permission expansion is insufficient. Client claims/headers, customer
ownership and readOnly/lifetime overrides cannot supply authority.

The context binds UUID identity, real actor, original session ID/access generation,
current role/permission evidence binding, exact Organisation, fixed UC66 audience,
readOnly=true, lifecycle/revision and server timestamps. No JWT/session issuance,
customer identity substitution or modification of Organisation membership occurs.
Existing customer APIs do not consume the context or accept its ID as a credential.

The Technical Owner explicitly approved `UC66-TO-2026-11-01` in this task:
**30-minute maximum absolute lifetime and 15-minute idle timeout**, no renewal past
the original deadline, and a new explicit Enter after expiry. Original-session or
temporary-role expiry can shorten the deadline. Only authorized, committed activity
refreshes idle time. Exact deadlines deny; backwards/invalid time fails closed.
Exit is immediately terminal on commit. Live account/session/staff checks prevent
reuse after logout, revocation, lock/deactivation or loss/replacement of staff
permission/assignment. No arbitrary production TTL or client-controlled timestamp
was introduced; the approved policy is centralized in the domain.

Eligible targets are existing SELF_SERVICE/ENTERPRISE Organisations with ACTIVE
status or unexpired TRIAL status. Search returns only id/name/type/status and uses
Organisation.contactEmail, not customer account/member email disclosure. The named
operation allowlist admits only context status in this slice; all customer resource
projections, writes, uploads, mapping, conversion/retry, exports and billing
capabilities remain ungranted. HTTP GET alone grants no permission.

## Persistence and audit guarantees

Only a new `support_contexts` schema and its exclusive partial unique index
`support_context_active_origin_unique` are declared. They are not provisioned in
production by this task. One stored ACTIVE context per real actor/original session
is enforced by the index plus transaction/revision checks. Missing/drifted index
fails closed. There is no TTL/purge and no reuse of old Ticket/Consent collections.

The unchanged MongoTransactionRunner and existing session-bound audit repository
are reused through a new public transactional audit factory. Context mutation and
required ENTER/EXIT/READ/EXPIRED/REVOKED audit use the same connection/session and
commit or roll back together. Events retain real actor, Organisation, context ID
and original session reference without logging credentials or contact queries.
Mongo collection validators actually rejected context and audit writes in the
integration tests; rollback claims are not based only on mocks.

Stable Enter IDs, partial uniqueness, optimistic revisions and normal driver
transaction retry semantics handle concurrent Enter/activity/Exit. Unknown commit
outcomes return `SUPPORT_CONTEXT_OUTCOME_UNCONFIRMED` with the original context ID,
`mutationCommitted: unknown` and `retrySafe: false`. They never claim rollback
or trigger a new business replay. Own context status/idempotent Exit provide
reconciliation. Lost acknowledgements can mean an authorized change committed.

**Review boundary:** authentication/RBAC/Organisation checks are live primary reads
before work and again before commit, rather than a new global security epoch that
serializes all external revocation commands with context commits. Context activity
and Exit share a transactionally fenced row. A revocation after the last admission
check denies the next request; global cross-instance revocation/commit linearizability
is not claimed. Definitive pre-commit authorization failures roll idle/audit back.
Logical session/role revocation can leave a stored ACTIVE tombstone until lazy
replacement; that stored state never overrides live admission. Review these semantics
and existing staff-role provisioning before separate activation approval.

## Exact file changes

Existing files modified (2):

- `src/modules/audit/audit.module.ts`
- `src/modules/auth/session-assurance.module.ts`

Their changes only expose the existing session repository public port and a public
session-bound audit factory. No existing authentication/RBAC/Organisation policy,
shared transaction runner, UC-67, Gemini, Team/Sales/UC-48 or production entrypoint
implementation is changed. No files were deleted.

New source files (26):

- `src/modules/audit/domain/transactional-audit.port.ts`
- `src/modules/audit/infrastructure/mongo-transactional-audit.factory.ts`
- `src/modules/organizations/domain/support-organization-directory.port.ts`
- `src/modules/organizations/infrastructure/mongo-support-organization-directory.ts`
- `src/modules/organizations/support-organization-directory.module.ts`
- `src/modules/rbac/domain/support-staff-authority.port.ts`
- `src/modules/rbac/infrastructure/mongo-support-staff-authority.reader.ts`
- `src/modules/rbac/support-staff-authority.module.ts`
- `src/modules/support/application/authorize-support-context-read.service.ts`
- `src/modules/support/application/enter-support-context.service.ts`
- `src/modules/support/application/exit-support-context.service.ts`
- `src/modules/support/application/search-support-organizations.service.ts`
- `src/modules/support/application/support-context.errors.ts`
- `src/modules/support/application/support-context.ports.ts`
- `src/modules/support/application/support-staff-access.service.ts`
- `src/modules/support/domain/support-context.entity.ts`
- `src/modules/support/domain/support-context.repository.ts`
- `src/modules/support/infrastructure/mongo-support-context.repository.ts`
- `src/modules/support/infrastructure/mongo-support-context.unit-of-work.ts`
- `src/modules/support/infrastructure/support-context.mapper.ts`
- `src/modules/support/infrastructure/support-context.schema.ts`
- `src/modules/support/presentation/support-context.controller.ts`
- `src/modules/support/presentation/support-context.dto.ts`
- `src/modules/support/presentation/support-context.presenter.ts`
- `src/modules/support/support-foundation.module.ts`
- `src/shared/utils/date.util.ts`

New test/fixture files (6):

- `test/uc66-context.entity.spec.ts`
- `test/uc66-context.unit-of-work.spec.ts`
- `test/uc66-foundation.fixtures.ts`
- `test/uc66-foundation.mongo.integration.spec.ts`
- `test/uc66-foundation.services.spec.ts`
- `test/uc66-production-boundary.spec.ts`

Documentation:

- `docs/engineering/UC66_01_02_IMPLEMENTATION_20261101.md`
- `src/modules/support/README.md`

The [Support module README](../../src/modules/support/README.md) documents complete
contracts, public module/port boundaries, model/index/retention behavior, error
semantics, limitations and future resource integration.

## Actual verification

| Check                                                         | Result                                                                                                                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused UC66-01/02                                            | **102 PASS**, 0 FAIL, 0 SKIP (five suites), including 41 actual owned MongoDB tests.                                                                                       |
| Full suite with only ALSM_UC66_TEST=owned-local-only enabled  | **1544 PASS, 13 FAIL, 44 SKIP**; 122 suites pass, 1 fails, 1 skips.                                                                                                        |
| Existing baseline comparison                                  | Existing 1,442 passes are preserved; all 13 Gemini latency failure names and details match cleanup evidence exactly. Gemini code/tests are unchanged.                      |
| Existing skipped suite                                        | 44 legacy validation integration cases remain gated on their existing test Mongo URI. Other previously opt-in Team/Sales/worker live-service harnesses were not activated. |
| TypeScript                                                    | PASS: node node_modules/typescript/bin/tsc --noEmit --incremental false.                                                                                                   |
| ESLint                                                        | PASS: existing whole check without auto-fix.                                                                                                                               |
| Build                                                         | PASS: npm run build.                                                                                                                                                       |
| Changed-file formatting                                       | PASS: Prettier applied/checks limited to changed TS/Markdown files.                                                                                                        |
| Architecture                                                  | PASS for every new source file: clean domain, port-based application, thin presentation, no cross-module infrastructure imports.                                           |
| Production activation regression and compiled route inventory | PASS: foundation unregistered; old Ticket routes absent; impersonation/UC-67 retained.                                                                                     |
| Diff/protected paths                                          | PASS: no whitespace defects; MongoTransactionRunner, Gemini, UC-67, Team/Sales/UC-48, AppModule and worker unchanged.                                                      |

Focused suites:

| Suite                                            | Result  |
| ------------------------------------------------ | ------- |
| `test/uc66-foundation.mongo.integration.spec.ts` | 41 PASS |
| `test/uc66-foundation.services.spec.ts`          | 37 PASS |
| `test/uc66-production-boundary.spec.ts`          | 2 PASS  |
| `test/uc66-context.entity.spec.ts`               | 16 PASS |
| `test/uc66-context.unit-of-work.spec.ts`         | 6 PASS  |

Relevant preserved regressions from the full run:

| Suite                                                | Result  |
| ---------------------------------------------------- | ------- |
| `test/rbac-bootstrap-security.spec.ts`               | 45 PASS |
| `test/authentication-admission.http.spec.ts`         | 12 PASS |
| `test/partner-export.controller.http.spec.ts`        | 8 PASS  |
| `test/support-patch.controller.http.spec.ts`         | 3 PASS  |
| `test/support-impersonation-disabled.spec.ts`        | 18 PASS |
| `test/mongo-unit-of-work-outcomes.spec.ts`           | 6 PASS  |
| `test/rbac.service.spec.ts`                          | 8 PASS  |
| `test/mongo-organization.repository.spec.ts`         | 7 PASS  |
| `test/mongo-export-publication.unit-of-work.spec.ts` | 5 PASS  |
| `test/teams.service.spec.ts`                         | 13 PASS |
| `test/publish-partner-export.service.spec.ts`        | 10 PASS |
| `test/mongo-transaction-runner.spec.ts`              | 13 PASS |
| `test/jwt-auth.guard.spec.ts`                        | 15 PASS |
| `test/current-session-assurance.spec.ts`             | 11 PASS |
| `test/conversion-support-patch.service.spec.ts`      | 12 PASS |
| `test/organization-authorization.service.spec.ts`    | 9 PASS  |
| `test/sales-performance.spec.ts`                     | 6 PASS  |

## Mongo test isolation and data safety

A dedicated disposable `mongo:8` replica set ran on **127.0.0.1:27128**, with name
`alsm-uc66-foundation-20261101-mongo`, set `alsmUc66Foundation`, and ownership label
`alsm.owner=uc66-foundation-20261101`. It used a 2 GB tmpfs and no shared data volume.
Each run verified container ownership/topology and used a new random database with
an ownership marker. Only its own disposable fixtures/database were cleared/dropped.
The owned container was stopped/auto-removed after verification. Existing application,
worker and Redis containers were left running and unchanged.

No .env/application Mongo credentials or production connection were used. No
production database data, deployed index, collection or migration was deleted or
changed. The integration index-removal test affected only the new disposable test
collection and restored the declared index before later tests. The unknown-commit
case injected a transport-style exception after a real successful Mongo commit;
it is a reconciliation/no-replay test, not a real network fault campaign.

To reproduce in a separately verified disposable environment, start the fixed
loopback-only topology using the locally available mongo:8 image, wait for ping,
and initialize its replica set:

```powershell
docker run --detach --rm --name alsm-uc66-foundation-20261101-mongo --label alsm.owner=uc66-foundation-20261101 --publish 127.0.0.1:27128:27017 --tmpfs /data/db:rw,size=2g mongo:8 --replSet alsmUc66Foundation --bind_ip_all --wiredTigerCacheSizeGB 0.25
docker exec alsm-uc66-foundation-20261101-mongo mongosh --quiet --eval 'rs.initiate({_id:"alsmUc66Foundation",members:[{_id:0,host:"127.0.0.1:27017"}]})'
$env:ALSM_UC66_TEST = 'owned-local-only'
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/uc66-foundation.mongo.integration.spec.ts
```

Tests do not accept an arbitrary Mongo URL; do not replace this topology with any
shared or production database. Stop only the container whose ownership/topology you
have verified. With no opt-in, the 41 new Mongo tests skip instead of connecting.

Evidence: `E:/ALSM/alsmv2-1050-uc66-foundation-evidence-20261101`. Files include `focused-jest.json`, `full-jest.json`,
`typescript.log`, `eslint.log`, `build.log`, `baseline-protection.json`,
`architecture.json`, `production-routes.json` and `test-container-lifecycle.json`.

## Handoff and next steps

Ready for Hoang's independent QA/Security review of the isolated foundation.
There is no outstanding lifetime-policy decision; the 30/15-minute policy is approved
and implemented. Separate activation approval and review of the documented admission,
role-provisioning, audit/index/retention and read-only boundaries remain required.
The unrelated existing Gemini failures remain visible and untouched.

Next, implement named bounded read projections for Projects/Screens/Programs/
Findings/Logs in their owning modules, check exact Organisation and resource ownership
on every request, couple attributed successful-read audit/activity to each explicit
operation, and test cross-Organisation, expiry/revocation and side-effect denial before
extending the allowlist. Do not route support contexts through ordinary customer
membership APIs or enable the legacy impersonation endpoint as part of this work.
