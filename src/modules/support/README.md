# Support

UC-66 / ALSMV2-1050 owns first-party Support Ticket state here. S1 TC A remains
the existing denial-only ticket-consent policy. S1 TC B adds a domain/application
slice. S1 TC C adds a MongoDB schema, validated BSON mapper and audited repository
adapter. S1 TC D registers the ordinary Owner-only API and the audited repository
in `AppModule`. See [API.md](./API.md) for exact routes, fields, limits and checks.

## Ticket lifecycle

`SupportTicketEntity` reuses `TicketEpisodeIdentity` and the known ticket statuses
from the S1 TC A contracts. It stores Ticket/Organisation/episode IDs, requester
user ID, purpose ID, revision, creation/update times and episode start/end actors
and times. Requester and purpose stay fixed for this slice. Creation derives the
requester from the application actor and generates Ticket/episode UUIDs server-side.

- `OPEN` can become `CLOSED` or `CANCELLED`.
- Either terminal state can reopen in a fresh episode. All historical episode
  IDs are retained and cannot be reused.
- Every transition increments the revision and rejects clocks older than the
  previous mutation. Invalid transitions leave state unchanged.
- Retained consent/approval references are unverified metadata only. There is no
  command to issue or attach them. Closing/cancelling clears both references in
  the same state change; reopening starts without them. Reconstitution rejects
  references on terminal tickets or bound to another Ticket/Organisation/episode.

## Application and integration boundary

`CreateSupportTicketService` and `TransitionSupportTicketService` each expose
`execute()`. `SUPPORT_TICKET_ACCESS` must explicitly authorize the current actor,
exact Organisation, action and (for transitions) Ticket. Missing, negative or
unavailable authorization prevents repository access. The Technical Owner-approved
adapter reuses current exact Organisation membership and the existing Owner check.
It rejects ambiguous memberships and permanent/current temporary Support staff
assignments. No permission seeds, Admin bypass or customer-data API is introduced.
`GetSupportTicketService` and `ListSupportTicketsService` use the same boundary.

`SUPPORT_TICKET_REPOSITORY` requires scoped reads, insert-only creation, and a
single atomic save matching Ticket ID, Organisation ID and expected revision.
The save must include lifecycle metadata and cleared references together. A lost
revision returns a conflict without a retry. Tests use a local CAS fixture;
MongoDB atomicity and operational authorization are not certified by these tests.

Integrate consent/approval only through separately reviewed trusted
authorities. This slice grants no Support View or impersonation access. The
existing `503 SUPPORT_IMPERSONATION_UNAVAILABLE` and UC-67 remain unchanged.

## MongoDB persistence (S1 TC C)

`support_tickets` stores the Ticket UUID/string as `_id` (the mandatory unique
`_id_` index), Organisation/requester as BSON ObjectIds and episode actors as
canonical ObjectId strings. IDs are rejected unless canonical; no slug-to-ID
fallback or lifecycle-history repair exists. Reads use lean BSON plus validated
domain reconstitution, bypassing hydration defaults/casting of stored history.

`MongoSupportTicketRepository` implements the existing port. Create is insert-only
and accepts initial Tickets only. Save matches Ticket ID, Organisation and expected
revision in the actual database update, never upserts, and writes lifecycle,
history and cleared decision references together. Within the transaction it
replays exactly one domain transition from the stored Ticket and compares the
whole result, rejecting immutable-field changes and self-consistent rewrites of
past episodes. Revision arithmetic alone does not prove history completeness.

Every write uses a strict Core Transaction API path (snapshot/majority/primary)
inside the Support adapter and a required factory for the existing session-bound
audit adapter on that same connection. It starts one transaction, executes the
Ticket mutation and audit once, and calls `commitTransaction()` once. It never
uses `withTransaction()` or Mongoose `transaction()`, which can replay callbacks
for mixed-label commit errors, including code 50. No application retry loop is
added; only the installed driver's internal same-transaction commit-command retry
can occur. Pre-commit failures abort; commit errors remain unconfirmed, retaining
the original cause and Ticket/Organisation/episode/revision reconciliation IDs.
The shared runner and its Team, Sales and UC-48 callers retain their behavior.
Audit actor comes from creation/episode metadata; no authority is
inferred from those references. `AppModule` binds the real audit adapter's
`inTransaction(session, connection)` participant; the ordinary unbound audit port
is insufficient. Transition audit metadata includes string `expectedRevision`
and `revision` values. Standalone deployments
fail closed.

S1 TC D adds a scoped ascending-ID list with a limit + 1 database bound and
`{ organizationId: 1, _id: 1 }` index. No history or decision storage is changed.
Deployments with automatic index creation disabled must provision this declared
index through their normal index workflow before serving list traffic.

Creation duplicates throw `SUPPORT_TICKET_ALREADY_EXISTS`. Scoped reads return
null when unavailable. The existing boolean save port returns false for either
missing Ticket or stale revision without disclosing a foreign resource. Corrupt
stored data throws `SUPPORT_TICKET_SNAPSHOT_INVALID`; an unconfirmed write/commit
throws `SUPPORT_TICKET_OUTCOME_UNCONFIRMED` with `retrySafe: false`. Reconcile the
original identity before retrying; no adapter-level unknown-outcome retry exists.

Unit/schema tests use mocks or disconnected Mongoose validation and do not prove
database concurrency/rollback. The integration suite is opt-in and creates only
a uniquely named, ownership-marked disposable database. It requires the exact
labelled loopback replica set from the reviewed [development workflow](../../../docs/operations/TEAM_UPDATED_PRIORITIES_READINESS_20261017.md).
It starts no service and accepts no arbitrary URI or environment-file credentials.

```powershell
$env:ALSM_SUPPORT_TICKET_TEST = 'owned-local-only'
npm.cmd run test -- --runTestsByPath test/support-ticket.persistence.integration.spec.ts test/support-ticket-api.integration.spec.ts
Remove-Item Env:ALSM_SUPPORT_TICKET_TEST
```

The acknowledgement-loss integration case injects a client error after a real
commit; it does not simulate server failover or certify high availability.
The API integration suite loads the production `AppModule` in its own marked
database. It replaces only RBAC startup seeding and unused external queue ports;
authentication, membership, Ticket persistence and audit use real production DI.

## Focused tests

From the backend root, use the existing `npm run test` Jest workflow:

```sh
npm run test -- --runTestsByPath test/support-ticket-api.http.spec.ts test/support-ticket-read.service.spec.ts test/support-ticket.entity.spec.ts test/support-ticket.service.spec.ts test/ticket-consent-boundary.policy.spec.ts test/support-impersonation-disabled.spec.ts
```

Repository quality gates remain `npm run lint`, `npm run test`, `npm run build`.
