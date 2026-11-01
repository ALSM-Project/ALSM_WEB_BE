# S1 TC D — ordinary Owner-only Ticket API

Policy: the UC-66 Technical Owner explicitly approved CREATE, READ, LIST, CLOSE,
CANCEL and REOPEN for the current verified Owner of the exact Organisation on
29 October 2026 in the implementation request. Members, Admins, Viewers and
Support Staff receive no Ticket authority. Platform Admin status grants no bypass.
This permission covers Ticket metadata only.

The existing SRS/Report 3 describes internal Support View and troubleshooting;
it does not define ordinary first-party Ticket action permissions. No direct
conflict was found with this narrower policy or the accepted B/C contracts.
Their missing access adapter is filled only for the explicitly approved actions.
S1 TC A, disabled Support View, UC-67 and consent/approval remain separate.

## Contract (defined before route implementation)

All paths below start with `/api/v1/organizations/:organizationId/support-tickets`.
Organisation IDs are canonical lowercase 24-hex IDs. Ticket IDs and pagination
cursors are server-generated UUID v4 strings. Organisation scope is mandatory in
the path; there is no default Organisation or global listing.

| Method / suffix | Request | Success |
| --- | --- | --- |
| POST `/` | `{ "purposeId": "diagnose-rendering" }` | 201, Ticket |
| GET `/:ticketId` | no body/query | 200, Ticket |
| GET `/` | `limit` decimal integer 1–50 (default 20); optional `afterTicketId` UUID v4 | 200, Page |
| POST `/:ticketId/close` | `{ "expectedRevision": 0 }` | 200, Ticket |
| POST `/:ticketId/cancel` | `{ "expectedRevision": 0 }` | 200, Ticket |
| POST `/:ticketId/reopen` | `{ "expectedRevision": 1 }` | 200, Ticket with a fresh episode ID |

`purposeId` is a nonempty identifier without whitespace/control characters,
maximum 200 characters. Revision is a JSON number, a nonnegative safe integer.
POST endpoints reject unknown body fields, including actor/person/role/ownership,
Organisation, consent/approval and lifecycle claims, without implicit body coercion.
Unknown query fields are rejected on all routes.

GET and LIST request bodies are currently ignored, not rejected. They are never
used for authority, filtering or scope decisions. Clients should not send bodies
with GET requests. All Organisation scoping and authorization use the routed
Organisation ID, the trusted authenticated principal and verified current Owner
authority; the route ID alone is not proof of access.

Ticket has exactly these fields:

```json
{
  "ticketId": "00000000-0000-4000-8000-000000000001",
  "organizationId": "111111111111111111111111",
  "episodeId": "00000000-0000-4000-8000-000000000002",
  "purposeId": "diagnose-rendering",
  "status": "OPEN",
  "revision": 0,
  "createdAt": "2026-10-29T04:00:00.000Z",
  "updatedAt": "2026-10-29T04:00:00.000Z"
}
```

Page is `{ "items": [Ticket], "nextAfterTicketId": "uuid-or-null" }`, with an
actual JSON null when exhausted. Ordering is ascending immutable Ticket ID;
pagination reads at most limit + 1 scoped records and exposes no total/global
count. New Tickets may sort before an existing cursor; this is not a snapshot.
Actor IDs, full episode history and retained decision references stay private.

## Authorization and execution

Every route uses the existing `JwtAuthGuard` and its persisted account/current
session verification. Actor identity comes only from `CurrentUser`. The Owner
adapter reuses `OrganizationContextService.resolve(actor, exactOrganisation)`
and `OrganizationAuthorizationService.require(..., [OWNER])`, requiring the
returned exact Organisation and exactly one matching membership. Removal,
demotion, duplicates, missing authority or failed authority reads cannot grant
access. Permanent or current temporary `INTERNAL_SUPPORT` assignment denies even
a simultaneous Owner; a denial-only RBAC reader uses the existing repository and
temporary-role schema without the permission service's Admin expansion or outage
fallback. No role or permission grants are introduced.

The authorization guard and application services both check the exact
actor/Organisation/action. Services snapshot primitive command fields before any
await. Scoped repository reads and compare-and-set writes bind the same scope.
Ownership is evaluated at authorization time; this API does not claim an atomic
transaction between membership changes and Ticket mutations.

## Persistence, errors and retries

Use the accepted Mongo repository for reads/writes, plus its bounded scoped list
query. Bind the real `MongoAuditRepository.inTransaction(session, connection)`
factory in the composition root. Creation and each lifecycle transition commit
Ticket state plus correctly attributed audit together using the accepted strict
transaction path. Reads do not write audit entries or decisions.

Reuse `ApiExceptionFilter`: errors are `{ statusCode, code, message, details,
requestId }` (requestId when provided by middleware). Expected outcomes:

| Status | Code / meaning |
| --- | --- |
| 400 | `VALIDATION_ERROR` or `INVALID_SUPPORT_TICKET`; invalid request |
| 401 | `UNAUTHORIZED` / `CURRENT_SESSION_REQUIRED`; invalid authentication/account/session |
| 403 | `SUPPORT_TICKET_ACCESS_DENIED`; no verified Owner authority |
| 404 | `SUPPORT_TICKET_NOT_FOUND`; missing Ticket or Ticket outside the authorized Organisation |
| 409 | `SUPPORT_TICKET_CONFLICT` / `SUPPORT_TICKET_INVALID_TRANSITION`; stale revision or illegal lifecycle action |
| 503 | `SUPPORT_TICKET_AUTHORITY_UNAVAILABLE`; authority cannot be verified |
| 503 | existing session-assurance, transaction-required, aborted/snapshot-invalid persistence errors |
| 503 | `SUPPORT_TICKET_OUTCOME_UNCONFIRMED`; preserve reconciliation IDs and `retrySafe: false` |

There is no automatic mutation retry or newly invented idempotency key. Creation
generates new IDs once per request; an unconfirmed creation must be reconciled
using the returned original identity before a new intent. Repeated lifecycle
requests with a stale revision conflict. No success is returned for uncertain
commits. A foreign Ticket and a nonexistent Ticket have the same scoped 404.

No Support Session, MFA, consent, approval, impersonation or customer-data
capability is created. The existing impersonation endpoint retains unconditional
authenticated `503 SUPPORT_IMPERSONATION_UNAVAILABLE`.

## Implementation and verification

All six ordinary routes above are implemented; none is deferred under the
approved Owner-only policy. Staff/global discovery, consent/approval and
operational Support access remain outside this API.

Created in this slice (paths relative to the backend root):

```text
src/modules/organizations/application/owner-support-ticket-access.service.ts
src/modules/rbac/domain/internal-support-assignment.port.ts
src/modules/rbac/infrastructure/mongo-internal-support-assignment.reader.ts
src/modules/support/application/get-support-ticket.service.ts
src/modules/support/application/list-support-tickets.service.ts
src/modules/support/domain/support-ticket-listing.port.ts
src/modules/support/presentation/support-ticket.controller.ts
src/modules/support/presentation/support-ticket.dto.ts
src/modules/support/presentation/support-ticket-owner.guard.ts
src/modules/support/presentation/support-ticket.presenter.ts
src/modules/support/API.md
test/support-ticket-api.http.spec.ts
test/support-ticket-api.integration.spec.ts
test/support-ticket-read.service.spec.ts
test/mongo-support-ticket-listing.spec.ts
test/owner-support-ticket-access.service.spec.ts
```

Modified in this slice:

```text
src/app.module.ts
src/modules/rbac/rbac.module.ts
src/modules/support/README.md
src/modules/support/application/support-ticket-access.port.ts
src/modules/support/infrastructure/mongo-support-ticket.repository.ts
src/modules/support/infrastructure/support-ticket.mapper.ts
src/modules/support/infrastructure/support-ticket.schema.ts
```

Verification on 29 October 2026:

- Build and repository lint: PASS. Layer/import scans of the changed Ticket code
  and tracked whitespace check: PASS.
- Focused 18-suite run: **541 PASS, 0 FAIL, 0 SKIPPED**, including **15 real
  production-AppModule API tests + 19 accepted persistence integration tests**.
- Full default suite: **1,883 PASS, 13 FAIL, 78 SKIPPED** (127 suites passed,
  one failed, three skipped). All failures are existing latency expectations in
  unchanged `test/gemini-provider-reliability.spec.ts`; for example, 3,000 ms
  expected versus 26,000 ms observed. Gemini source/tests were not edited.

Ready for Hoang's QA/Security code review of this bounded slice; this is not QA
acceptance or deployment approval. No unresolved Ticket permission adapter is
needed for these six actions. Runtime requires the accepted transaction-capable
MongoDB deployment and the declared Organisation/Ticket-ID list index. Authority
is checked at request/use-case admission, without a new atomic ownership-revocation
protocol. The unrelated full-suite Gemini failures remain a repository check
limitation; this slice does not repair them.
