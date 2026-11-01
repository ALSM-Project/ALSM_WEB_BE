# Customer Consent MongoDB persistence — S1 TC E2

`MongoCustomerConsentRepository` implements the existing E1 port for insert-only
pending records, exact Consent/Organisation/Ticket reads, and revision-checked
DECLINED/INVALIDATED transitions. It is not registered in production DI and adds
no routes, roles, positive consent, TTL, withdrawal or operational Support access.

## Storage and validation

`customer_consents` stores the server-created Consent UUID as string `_id`;
Organisation and top-level created/updated account IDs are BSON ObjectIds. Ticket
and episode IDs are UUID strings. Nested account/evidence references retain E1's
canonical string representation. No slug conversion, credential/evidence payload,
hydration defaults or automatic repair is supported by the adapter.

The mapper validates the complete raw/lean BSON snapshot with E1 reconstitution.
Unknown fields, inconsistent history, malformed identifiers and unsupported
states (including VERIFIED_GRANTED) fail closed. Writes validate and detach the
entity and audit input before awaiting. Insert accepts initial pending state
only. Save loads the exact stored scope inside the transaction and replays one
domain transition, comparing the entire resulting value. It rejects replacement
of bindings, policy/provenance, creation metadata or any retained historical event.
The database update matches `_id`, Organisation, Ticket, original episode, expected
revision and pending state, never upserts, and changes lifecycle/history together.

Stored evidence labels and identities remain claims. Retaining an old episode
does not make it current after reopening. Current Ticket/Owner eligibility still
requires the E1 authority/context checks; E2 creates no cross-store revocation
fence and does not automatically invalidate records on Ticket changes.

## Required indexes and deployment

Required fences:

1. MongoDB's mandatory unique `_id_` index on the Consent UUID.
2. `consent_source_event_scope_unique`, a non-partial, non-sparse unique multikey
   index with simple binary collation:

```javascript
{
  organizationId: 1,
  ticketId: 1,
  episodeId: 1,
  'history.source.authorityId': 1,
  'history.source.evidenceId': 1
}
```

The source-event identity is issuer `authorityId` plus stable `evidenceId` within
one Organisation/Ticket/episode. Revision/generation changes cannot evade that
identity. It covers creation and appended negative decisions across records;
E1 also rejects duplicate event identities inside one record. Other scopes are
independent storage jurisdictions; this never authenticates an event for them.
There is no TTL index. Duplicate IDs/events conflict, never overwrite or silently
return an earlier result. This is not a general idempotency/retry guarantee.

Provision the declared schema indexes through the normal operator-reviewed
index workflow before writing. Use create/inspect operations; do not automatically
drop, weaken, sync-replace or repair conflicting production indexes/documents.
Existing duplicates or definition drift require operator diagnosis. Each write
checks that the exact required unique definition is available; missing or
unverifiable indexes yield `503 CUSTOMER_CONSENT_INDEX_REQUIRED` before mutation.
Reads remain exact-ID scoped. The adapter neither provisions indexes nor starts
or converts a deployment. Normal storage permissions must protect the indexes,
business documents and append-only audit from out-of-band changes.

## Transactions, audit and outcomes

Use a replica set or reviewed mongos deployment. Standalone MongoDB fails closed
with `MONGO_TRANSACTIONS_REQUIRED`. Composition must supply the real existing
`MongoAuditRepository.inTransaction(session, connection)` participant on the same
connection; an unbound/no-op audit dependency does not satisfy this contract.

The adapter starts one explicit Core API transaction with snapshot reads,
majority writes and primary read preference, performs the mutation and audit,
then calls `commitTransaction()` once. It does not call `withTransaction()` or
Mongoose `transaction()` and does not replay business work. The installed driver's
internal same-transaction commit-command retry remains possible. The technical
commit-command timeout is not a consent lifetime or revocation guarantee.

Audit input must exactly match the entity-derived actor, Organisation, action,
Consent, Ticket, episode, state, revisions and source-event identifiers. Unknown
fields or mismatched attribution reject before writing. No raw evidence, person
details, scope contents or credentials are added to audit metadata.

- `CONFIRMED`: both writes received confirmed commit acknowledgement.
- `CONFLICT`: scoped CAS miss, duplicate ID/event or a known precommit write
  conflict. No callback replay or losing audit commit.
- `UNCONFIRMED`: any commit error, unknown-commit label or unconfirmed write
  acknowledgement/count. Never retry automatically. The original immutable
  input retains reconciliation IDs; the unchanged E1 write helper exposes them
  in sanitized `CUSTOMER_CONSENT_OUTCOME_UNCONFIRMED` errors with `retrySafe: false`.
- Invalid snapshots/rewrite/audit inputs reject; other precommit failures abort
  and retain the original cause in a sanitized `ATOMIC_MUTATION_ABORTED` exception.

Abort is attempted only before commit. Cleanup failures are logged without
customer payloads and cannot replace the primary error or established outcome.
The shared `MongoTransactionRunner` and Team/Sales/UC-48 behavior are unchanged.

## Verification

Unit/schema/mapper tests:

```sh
npm run test -- --runTestsByPath test/customer-consent.mapper.spec.ts test/mongo-customer-consent.repository.spec.ts
```

Real tests require the exact existing owned loopback replica set documented in
[the approved development workflow](../../../docs/operations/TEAM_UPDATED_PRIORITIES_READINESS_20261017.md).
They verify container label/binding and `hello.setName`, accept no arbitrary URI,
start no service and create only a unique ownership-marked disposable database.
Cleanup rechecks ownership before dropping that database.

```powershell
$env:ALSM_SUPPORT_TICKET_TEST = 'owned-local-only'
npm.cmd run test -- --runTestsByPath test/customer-consent.persistence.integration.spec.ts
Remove-Item Env:ALSM_SUPPORT_TICKET_TEST
```

Tests exercise real unique indexes, state/audit commits, both rollback directions,
three bounded distinct-session snapshot races, history preservation and corrupt
snapshot rejection. Acknowledgement-loss cases throw after a real commit and
verify one mutation/audit attempt, an unconfirmed public outcome and original
reconciliation identity. They do not certify replica-set failover or high
availability. Non-secret transaction observations and cleanup evidence are saved
under `coverage/customer-consent-persistence/<runId>.json`; Jest results establish
PASS/FAIL counts separately. Tests use synthetic authorization intent and do not
certify a production customer-authority provider. Support View remains disabled
and authenticated impersonation remains `503 SUPPORT_IMPERSONATION_UNAVAILABLE`.
