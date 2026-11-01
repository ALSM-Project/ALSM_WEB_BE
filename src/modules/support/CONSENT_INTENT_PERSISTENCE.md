# Durable Consent intent prototype — S1 TC E5B (unregistered)

This is local persistence for **synthetic trust records only**. It authenticates
no person, Owner, issuer, WebAuthn assertion or positive Consent. No production
provider/controller is registered. E1–E5A, Support View denial and authenticated
503 SUPPORT_IMPERSONATION_UNAVAILABLE remain unchanged.

`MongoConsentIntentConsumption` implements E5A's consumption port and adds an
explicitly named `registerSynthetic` fixture/provisioning boundary. Registration
persists the exact E5A request, policy and evidence supplied by the isolated test
harness. It does not issue a real challenge or verify those claims. Records carry
`trustMode: SYNTHETIC_ONLY`; there is no client route or default trusted source.
Policy lifetime is an explicit synthetic input, never a production TTL default.

## Storage and indexes

| Collection                            | Identity and required unique indexes                                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `synthetic_consent_intent_challenges` | UUID/string `_id` = challenge ID; global `nonceSha256`                                                                                                            |
| `synthetic_consent_intent_trust`      | `_id` = SHA-256 of kind/issuer/evidence ID; versioned policy/person/Owner/credential payload, CURRENT or REVOKED state and safe integer fence                     |
| `synthetic_consent_intent_receipts`   | UUID/string `_id` = original consumption ID; separate unique challenge ID, verification-attempt ID, nonce digest, audit ID, and global `(proofIssuerId, proofId)` |
| Existing `audit_logs`                 | Dedicated unique `(resourceType, resourceId)` partial index for `resourceType: CONSENT_INTENT_CONSUMPTION`; existing audit schema is unchanged                    |

Proof identity is the intent provenance's issuer/evidence ID pair. Its uniqueness
deliberately excludes Organisation, action, reference revision and generation.
Changing any of those cannot make a consumed proof reusable. Nonce uniqueness
also prevents registering aliases of the same server challenge. No TTL indexes
are allowed on these ledgers/audit: deleting tombstones would remove protection.
Retention remains an unapproved production decision.

The challenge retains a canonical, immutable full registration plus its SHA-256:
account/person references, Organisation, Ticket, episode, purpose/full scope,
REQUEST or DECLINE, Consent/revisions, attempt, proof/source, policy, credential
and provenance versions. Organisation and actor indexes/scopes use BSON ObjectIds;
the E5A nested values retain their canonical string types. Initial challenge state
is ISSUED/revision 0; consumption writes CONSUMED/revision 1 and original receipt ID.
Receipts are insert-only. Adapter methods never rewrite bindings or old receipts.

Raw BSON readers enforce exact fields, types, derived IDs/hashes, time ordering
and cross-record consistency without hydration repair or schema casting. Nested
schema Mixed values are validated by those readers and E5A validators. Historical
receipt validation uses the recorded registration time, so expiry does not erase
committed history or turn reconciliation into fresh authority.

## One transaction, no business replay

The adapter verifies required unique indexes (including exact partial/collation
options), rejects TTL indexes and requires a replica set or mongos. All models
and the audit participant must use one connection. It uses explicit Core
`startTransaction` with snapshot/majority/primary, work once, and one application
`commitTransaction` invocation. No withTransaction callback, shared runner change
or retry loop is introduced. The installed driver may internally retry the same
commit command; business work is never replayed.

Consumption loads the exact scoped challenge and compares the complete immutable
registration. It checks all current local synthetic trust payloads, then performs
conditional fence writes on them, preventing read-only revocation/write skew.
It conditionally updates only ISSUED/revision 0, with the full context and an
additional MongoDB server-time expiry predicate. It appends attributed audit via
the required same-session audit factory, reads/verifies that actual audit in the
transaction, and inserts the uniquely keyed receipt linked to that audit ID.
Any failure before commit aborts all state, fence, audit and receipt writes.

The existing `MongoAuditRepository.inTransaction(session, sameConnection)` is used
by the real harness. Audit includes account/Organisation attribution, Ticket,
episode, purpose, exact action, original challenge/attempt/proof/consumption IDs,
Consent/revision, person-binding references, context hash and CONSUMED state.
No raw credential, assertion, identity document or issuer subject is audited.

Known CAS/unique/write conflicts return local CONFLICT, mapped to E5A REJECTED.
Every duplicate consumption is rejected; no duplicate delivery creates a new
success. Only literal successful commit returns CONFIRMED. Commit errors and
unknown acknowledgements return UNCONFIRMED with the original consumption,
attempt and challenge IDs; the original request retains the exact proof reference.
Other failures have sanitized persistence error codes. Abort/session cleanup
errors cannot mask the primary outcome. Observed eligibility expiry also rejects.

Shared policy/person fence records can conservatively conflict across unrelated
concurrent transactions. This prototype favors denial over retry and does not
claim production throughput. Local fencing is not atomic with ordinary Owner
membership reads or an external identity/WebAuthn provider. No distributed
revocation guarantee, identity assurance or new Owner policy is established.

## Scoped, read-only reconciliation

Reconciliation captures the original consumption/request/challenge IDs and derives
the exact proof from the original request source. It reads challenge, receipt and
audit in one explicit snapshot transaction. It never consumes, issues or retries.
Missing and foreign scoped challenges share a safe 403 without foreign metadata.

| Diagnostic status     | E5A outcome | Required evidence                                                                                                                                    |
| --------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| COMMITTED             | CONFIRMED   | Exact original receipt, matching consumed challenge/context and exact linked audit                                                                   |
| ALREADY_CONSUMED      | REJECTED    | Independently matched committed receipt/challenge/audit for the scoped consumed challenge or stable proof identity; returns only original caller IDs |
| ABSENT_UNCERTAIN      | UNCONFIRMED | No scoped receipt at the read snapshot; this never proves that an uncertain transaction did not or will not commit                                   |
| EVIDENCE_INCONSISTENT | UNCONFIRMED | Missing, corrupt, duplicate or mismatched receipt/challenge/audit evidence                                                                           |
| EVIDENCE_UNAVAILABLE  | UNCONFIRMED | Read/transaction outcome could not be confirmed                                                                                                      |

All diagnostic results have `operationalAccess: false`. A historical COMMITTED
diagnostic confirms local persistence only, never Customer Consent or eligibility
to repeat an action. Missing infrastructure fails closed with a sanitized 503.

## Verification

`mongo-consent-intent-consumption.spec.ts` uses a staged synthetic transaction
fixture. It checks orchestration and failure handling, not MongoDB durability.
`consent-intent.persistence.integration.spec.ts` uses the accepted labelled loopback
replica set, ownership-marked unique disposable database, real audit adapter and
distinct sessions with a bounded barrier. It checks index effects, competing
consumption, global proof reuse, rollback, local revocation races, injected client
acknowledgement loss after real commit, and scoped reconciliation. This is not a
server failover test or external-source assurance test.

```powershell
npm.cmd run test -- --runTestsByPath test/mongo-consent-intent-consumption.spec.ts
# Only after verifying the approved replica set is available:
$env:ALSM_SUPPORT_TICKET_TEST = 'owned-local-only'
npm.cmd run test -- --runTestsByPath test/consent-intent.persistence.integration.spec.ts
Remove-Item Env:ALSM_SUPPORT_TICKET_TEST
```

The harness accepts no arbitrary URI or .env credentials, starts no services and
drops only its verified ownership-marked database. Real-run transaction/cleanup
evidence is written to `coverage/consent-intent-persistence/<runId>.json`.
If Docker/MongoDB is unavailable, report real tests as NOT RUN, never mock PASS.
Production still requires approved identity/Owner/intent sources, enrollment and
recovery, freshness/revocation, retention/fencing policy and separately reviewed
real authority wiring. This isolated adapter supplies none of those prerequisites.
