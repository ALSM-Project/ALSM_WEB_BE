# UC-66 Support foundation — UC66-01/02

The original Report 3 Organisation search/Enter/Exit foundation. Support Tickets,
Customer Consent, customer representative verification and internal Support approval
are not prerequisites. UC-67 remains in the Conversions module.

## Deployment boundary

`SupportFoundationModule` is deliberately **not imported by AppModule or the worker**.
There is no environment switch that activates it. All four routes below are
implemented, exercised through an isolated test module, and **unregistered in the
production application**. Hoang's independent QA/Security review and separate
activation approval are required before registration.

The existing authenticated `POST /api/v1/admin/organizations/:id/impersonate`
continues returning `503 SUPPORT_IMPERSONATION_UNAVAILABLE`. It is not replaced
or called by this foundation. No customer workspace facade is implemented.

## HTTP contract

All paths have the `/api/v1` prefix. Ordinary JWT authentication and the persisted
original session are mandatory. Responses use the backend's existing plain JSON
success objects and `ApiExceptionFilter` errors; Swagger response DTOs are declared.

| Method | Path                                                                    | Result                                                                                                                 |
| ------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| GET    | `/support/organizations?query=Customer&field=name&limit=10&afterId=...` | Safe metadata page; field `name` uses literal case-insensitive prefix matching.                                        |
| GET    | `/support/organizations?query=contact%40example.com&field=email`        | Same operation, literal case-insensitive **exact Organisation contactEmail** matching. No account/member email lookup. |
| POST   | `/support/organizations/:organizationId/contexts`                       | 201 with a new original-session-bound read-only context. Body/query must be empty.                                     |
| GET    | `/support/organizations/:organizationId/contexts/:contextId`            | 200 with own active context metadata; successful audited activity refreshes idle time.                                 |
| POST   | `/support/organizations/:organizationId/contexts/:contextId/exit`       | 200 with terminal context metadata. Repetition is idempotent without duplicate EXIT audit. Body/query must be empty.   |

The table has five examples for four handlers; name/email use the same search route.
Search requires 3–120 trimmed characters, rejects control characters/unknown fields,
allows 1–25 results (default 10), and uses canonical ObjectId keyset pagination.
Regex metacharacters are escaped, the database query has a 2-second execution bound,
and the limit+1 query yields an optional `nextAfterId`; there is no unrestricted
list or total-count operation. Metadata is only `{ id, name, type, status }`.
Contact addresses, membership, user accounts, billing data and credentials are
not returned. Search does not refresh an existing context's idle timestamp.

Eligible targets use the existing Organisation schema: SELF_SERVICE or ENTERPRISE,
with ACTIVE status, or TRIAL with a future `trialExpiresAt`. INTERNAL, SUSPENDED,
missing and expired/undated TRIAL Organisations are ineligible. This predicate is
rechecked on context entry and authorized activity. Exit does not require a still
eligible target, so a suspended Organisation does not strand an own context.

Context responses contain only `id`, `organizationId`, `readOnly: true`, `state`,
`createdAt`, `lastActivityAt`, `expiresAt`, `idleExpiresAt` and `endedAt`.
They contain no session generation, grant binding, customer token or session token.
An ordinary support JWT is always required; a context ID is not a credential.

## Authoritative staff and session checks

`SupportStaffAccessService` calls the existing exported
`RequireCurrentSessionService` and SessionRepository public port. It requires the
exact active session ID/user/accessVersion and rejects ambiguous session matches,
revoked/expired sessions, inactive/locked accounts and password-remediation-only
accounts through ordinary admission. Subject/session values are copied before awaits.

The RBAC-owned `SupportStaffAuthorityModule` exports a narrowly scoped port and
reads the existing `roles`, `permissions`, `role_permissions`, `user_roles` and
`temporary_roles` collections on the primary. Admission requires:

1. Exactly one canonical system role definition `INTERNAL_SUPPORT` and exactly one
   definition/grant of `organizations.impersonate` **on that support role**.
2. Exactly one current assignment source: either the persisted permanent support
   assignment or a current ACTIVE temporary assignment that is already APPROVED,
   not revoked, already granted and not expired. Overlapping/ambiguous sources deny.
3. A binding to the assignment and role/permission evidence identities/revisions.
   Removal/regrant or permission/grant revision changes do not revive an old context.

The temporary-role checks reuse ordinary existing RBAC grant lifecycle fields;
they introduce no UC-66 approval workflow. There is no fallback when a store is
unavailable. `EffectivePermissionsService`'s Platform Admin expansion is deliberately
not used. A persisted Admin flag, broad Admin permissions, client roles/permissions,
tenant ownership or an arbitrary header cannot replace the support assignment.

The owning Organisation directory module exports only its public metadata port.
Support imports no other business module's infrastructure models or implementations.
The only existing-module wiring changes are exporting the existing session repository
and exposing a public transactional audit factory. Existing behavior is preserved.

## Approved lifetime and read-only boundary

Technical Owner policy approved in this task on **1 November 2026**:
`UC66-TO-2026-11-01`, centralized in `SUPPORT_CONTEXT_POLICY`.

- Absolute lifetime is at most 30 minutes from Enter; the stored deadline is never
  renewed. Original-session/temporary-staff expiry can shorten that deadline.
- Idle lifetime is 15 minutes since the last successfully authorized, committed
  activity, capped by the immutable absolute deadline. Exact deadline equality denies.
- Timestamps come only from the server clock. Backwards/invalid time fails closed.
- Rejected/unauthenticated/unreviewed/cross-scope activity never updates idle time.
  An audit failure or authorization loss found before commit rolls the update back.
- Explicit Exit persists EXITED immediately on commit. Concurrent/repeated Exit
  cannot reactivate a context or append duplicate EXIT events.
- Logout/session invalidation, deactivation and loss of staff authority prevent
  subsequent use through live checks. No cache or stored ACTIVE flag bypasses them.
- Expiration requires a fresh explicit Enter and fresh authorization. Enter closes
  a previous expired/obsolete origin context with an attributed EXPIRED/REVOKED
  audit before creating the new one in the same transaction.

An origin is the real support actor plus original session ID; only one stored
ACTIVE context is allowed per origin. There is no customer identity switch,
customer JWT, new browser login or Organization membership/OWNER grant. Exiting
needs no identity restoration because the original staff identity never changed.

`AuthorizeSupportContextReadService` is an explicit operation boundary. Its only
allowed operation in this slice is `CONTEXT_STATUS`. It validates the exact actor,
original session/generation, current staff binding, Organisation and context, then
audits and advances activity in one transaction. All Project/Screen/Program/Finding/
Log operations remain denied until separately implemented and reviewed. An HTTP GET
does not make an operation eligible; an exporter or other GET with effects is not
implicitly admitted. Existing customer APIs continue using their own membership
and resource policies and do not interpret support contexts or support headers.
The real existing Project write boundary is tested with a valid context and still
denies the nonmember support actor; ordinary customer writes remain authorized.

## Persistence, audit and concurrency

Only the new `support_contexts` collection is defined. It stores a UUID identity,
real actor/original session, exact Organisation, session/grant bindings, fixed
read-only UC66 audience, policy reference, lifecycle/revision and server timestamps.
Raw snapshots are validated; corrupt writable/cross-audience/history fields fail
closed rather than receiving hydration defaults or repairs.

The declared `support_context_active_origin_unique` partial unique index covers
`{ actorUserId: 1, originalSessionId: 1 }` where `state: ACTIVE`. The adapter verifies
its definition before operations and fails closed if it is missing/drifted. Provision
it through normal non-destructive deployment procedures before future registration
when automatic indexes are disabled. No existing index or collection is changed.
There is no TTL or purge; expired/terminal records remain for audit/reconciliation.
Retention requires a separate decision. Old Ticket/Consent collections are not reused.

The Support-specific unit of work uses the explicit MongoDB **Core Transaction API**,
not the convenience `withTransaction` callback retry path. The shared
MongoTransactionRunner and its other callers are unchanged. The audit module's
public factory binds the existing MongoAuditRepository to this transaction.
Both writes use the same explicit Mongo session/connection. Required ENTER, EXIT,
READ and lazy EXPIRED/REVOKED audit writes commit with the context transition or
roll back together. Events retain the real actor, target Organisation, context ID,
original session ID and mode; no JWTs, generations, contact queries or secrets are
written to audit metadata. Only a confirmed commit returns ordinary success.

Each invocation executes its business callback at most once. Same-context calls
are queued within one adapter instance; this is scheduling, not a distributed lock.
Across instances, optimistic revisions and the active-origin unique index protect
Enter/activity/Exit. A definite pre-commit write conflict aborts with 409 and no
callback replay; duplicate Enter remains a conflict. No application commit retry
loop is used. The installed Core API may retry the same commit command internally,
but cannot restart business work. Abort/session cleanup failures are logged without
replacing the primary outcome.

`503 SUPPORT_CONTEXT_OUTCOME_UNCONFIRMED` includes the original context ID,
`mutationCommitted: unknown` and `retrySafe: false`. A lost acknowledgement can
mean the context/activity/audit actually committed; do not claim such a response
rolled back or blindly replay it. Every rejected commit is conservatively unconfirmed,
including mixed labels, nested write-concern code 50 and unlabelled failures.
Reconcile Enter through own context status;
reconcile Exit through its idempotent endpoint. An inactive/expired context stays
unusable and a fresh Enter can replace it after fresh authorization.

Session/role/Organisation checks use live authoritative primary reads before work
and again before committing; they are not a new cross-module security epoch or
atomic transaction spanning all authentication/RBAC revocation commands. Context
activity and Exit are serialized through their shared context row. A concurrent
external revocation after the last admission check denies the next boundary check;
this slice does not claim cross-instance revocation/commit linearizability. No late
authorization exception is introduced after a confirmed activity commit. Review
these ordering semantics and existing staff-role provisioning during activation QA.
Stored ACTIVE rows may be logically unusable after session/role invalidation until
lazy expiry/replacement; live checks always take precedence over stored state.

## Tests and review handoff

Focused unit tests exercise domain lifetime/corruption, authority/session denials,
search redaction, exact Organisation scope, idle rollback and uncertain outcomes.
The production metadata regression verifies that no foundation controller, model
or reader is registered, while disabled impersonation and UC-67 remain present.

Owned real-Mongo integration uses only loopback port 27128, replica set
`alsmUc66Foundation`, container `alsm-uc66-foundation-20261101-mongo`, and ownership
label `alsm.owner=uc66-foundation-20261101`. It accepts no arbitrary URI or .env DB
credentials. Each run uses a new random database with a checked ownership marker;
only that disposable test database is cleared/dropped. Tests use actual collection
validators to reject context/ENTER/READ/EXIT writes, demonstrating durable rollback.
Concurrency and role/session invalidation use real persisted records. Uncertain
acknowledgement tests hook `commitTransaction` itself, inside the installed driver's
transaction path, and throw **after the real commit succeeds**. They verify one
callback, one durable mutation/audit and an unconfirmed response, including code-50
mixed-label/nested variants and the code-11000 control. They simulate acknowledgement
loss; they are not a real network fault campaign.

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/uc66-context.entity.spec.ts test/uc66-foundation.services.spec.ts test/uc66-context.unit-of-work.spec.ts test/uc66-production-boundary.spec.ts
$env:ALSM_UC66_TEST = 'owned-local-only'
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/uc66-foundation.mongo.integration.spec.ts
```

The Mongo suite skips unless explicitly opted in; never point it at a shared or
production database. Test bootstrap and actual results are recorded in
`docs/engineering/UC66_01_02_IMPLEMENTATION_20261101.md` and the subsequent
[transaction replay fix handoff](../../../docs/engineering/UC66_TRANSACTION_REPLAY_FIX_20261101.md).

Next, implement explicitly named, bounded customer read projections in their owning
resource modules, verify exact resource Organisation ownership on every read, bind
attributed audit and successful activity to those operations, and test cross-scope,
side-effect, expiry and revocation races before extending the allowlist. This is
separate work; no customer workspace reads or writes are enabled by this foundation.
