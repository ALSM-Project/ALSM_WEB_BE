# Customer Consent domain/application — S1 TC E1 and E2

This is an unregistered, non-operational foundation. E2 adds a MongoDB adapter
for the accepted pending/negative states; see [persistence and deployment](./CUSTOMER_CONSENT_PERSISTENCE.md).
There is no production Consent REST API, verification provider or
dependency-injection registration. E3 adds an [isolated API contract](./CUSTOMER_CONSENT_API.md)
with synthetic authority tests; all three routes remain unregistered in AppModule.
The accepted A–D source and Owner-only Ticket
API are unchanged.

`CustomerConsentEntity` is an immutable, versioned value. It reuses the existing
Ticket entity and A reference/scope types. One record binds one Ticket,
Organisation, episode and purpose; one proposed read-only operation/projection
and environment; one proposed individual beneficiary with explicit matching
person/account coverage; grantor/provenance, policy and source references; and
append-only revision history. References, hashes, CURRENT labels and TypeScript
types never authenticate a consent decision. No raw evidence or credentials are
stored. There is no expiry field, TTL default or numeric operational policy.

Supported state edges:

- `NOT_REQUESTED → PENDING_VERIFICATION`: a newly authenticated request creates
  a fresh UUID consent record. NOT_REQUESTED is the absence before this record,
  represented in its first history event rather than a stored request.
- `PENDING_VERIFICATION → DECLINED`: an explicit, verified refusal from the
  original grantor account/person, still a current Owner.
- `PENDING_VERIFICATION → INVALIDATED`: an explicitly authorized negative action
  whose reason is derived from the authoritative Ticket: closed, cancelled or
  a different current episode. It preserves the original episode and history.

GRANT, WITHDRAW, EXPIRE and SUPERSEDE are explicitly unsupported. The full proposed
state vocabulary is retained, and every terminal state rejects reactivation.
E1 reconstitution accepts only pending/declined/invalidated records: it rejects
VERIFIED_GRANTED and records from not-yet-implemented withdrawal/expiry/replacement
workflows. No caller-controlled snapshot can restore a grant. Representative
delegation, Owner succession and other invalidation reasons remain deferred.

`RequestCustomerConsentService`, `GetCustomerConsentStatusService` and
`TransitionCustomerConsentService` each expose `execute()`. They capture primitive
identity/revision fields and detach/freeze nested proposed data before awaiting.
Every supported operation requires both:

1. Existing `SUPPORT_TICKET_ACCESS` READ authorization (the accepted current Owner
   mechanism, with its existing staff denial and no Platform Admin bypass).
2. An explicitly installed `CUSTOMER_CONSENT_AUTHORITY` adapter authenticating
   person/account linkage, current Owner provenance and the exact action/source
   intent. The response must bind the full immutable request. There is no default
   implementation; ordinary membership or the Ticket creator is insufficient.

The second port authorizes requesting/status/negative actions only. It cannot
verify a positive consent or grant operational Support access. Missing, stale,
unavailable or mismatched authority fails closed. Proposed staff identity,
entitlement, session and coverage remain unverified descriptions until a future
reviewed beneficiary policy/provider establishes them.

Ticket reads use the existing scoped repository. Preparing/refusing requires the
exact current OPEN episode, purpose and expected Ticket revision. Rereads after
authority/storage waits reject observed concurrent Ticket changes. Historical
status remains readable only with explicit scoped authority and identifies a
closed/cancelled/reopened episode as incompatible; it always returns
`operationalAccess: false`. A status read does not mutate the consent or Ticket.
Ticket lifecycle changes do not automatically write consent records in E1.

`CUSTOMER_CONSENT_REPOSITORY` requires insert-only identities/source uniqueness,
immutable bindings/history and scoped revision CAS, and confirmation of consent
plus the existing audit contract together. E2 implements this contract through
the unregistered adapter. Services do not separately append unbound audit.
Only literal CONFIRMED yields a confirmed result; CONFLICT yields 409; unknown,
unrecognized or thrown write outcomes yield sanitized 503
`CUSTOMER_CONSENT_OUTCOME_UNCONFIRMED` with original reconciliation IDs and
`retrySafe: false`. No automatic business retry is performed.

No atomic Ticket/consent/remote-authority revocation transaction, revocation
latency or session termination is claimed. Those require later policy, trusted
providers and fencing implementation. E2's durable transaction guarantee covers
the Consent mutation and its audit only. Consent verification,
the proposed 24-hour maximum, effective beneficiary coverage and source freshness
are unresolved. This foundation issues no internal approval, proof, MFA, session,
UC-67 write/retry capability or customer-data access; A remains denial-only and
authenticated impersonation remains `503 SUPPORT_IMPERSONATION_UNAVAILABLE`.

Synthetic tests:

```sh
npm run test -- --runTestsByPath test/customer-consent.entity.spec.ts test/customer-consent.service.spec.ts
```

These E1 fixtures model application CAS/outcome orchestration only. They do not
establish MongoDB behavior, real authority verification or atomic persistence.
Separate opt-in E2 tests exercise real database transactions and concurrency.

## E4 bounded verification boundary

No real Consent authority adapter can yet be implemented from the discovered
mechanisms. `CUSTOMER_CONSENT_AUTHORITY` remains unbound in production, and E3
routes remain unregistered. The existing port now specifies independent intent
verification and durable single-use consumption requirements. A server-generated
`verificationAttemptId` binds each authority response to one invocation, including
otherwise identical STATUS requests. The context generates and overrides it,
detaches/freezes the request, and checks exact response equality. It is correlation
only: it authenticates no person, creates no verification token, establishes no
freshness interval and does not stop a provider from reauthorizing consumed intent.
It is never accepted from HTTP, exposed in responses, or persisted as Consent
evidence. There is no local replay cache or new persistence behavior.

Source inspection establishes the following boundaries:

| Requirement                           | Classification                 | Existing mechanism and remaining gap                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated account/actor           | Proven for HTTP admission      | `JwtAuthGuard` verifies the signed JWT; `RequireCurrentSessionService` checks the persisted active/unlocked account, exact session/account/version, expiry and revocation, then rereads the account. This is ordinary session assurance.                                                                                                                                                                               |
| Verified person/account linkage       | Missing                        | `UserRecord` persists no verified person identity or identity-provider subject linkage. Google login verifies an audience-bound Google ID token and verified email, then resolves the local account by email; it does not persist a stable Google subject/person binding or Consent intent. Email verification proves mailbox control only.                                                                            |
| Current Owner for exact Organisation  | Partially supported            | `OwnerSupportTicketAccessService` resolves exact persisted membership, requires exactly one matching Owner and denies current Support assignments. The membership schema stores account/role, without independent person-level Owner provenance. Membership rereads are not atomic remote-authority revocation fencing.                                                                                                |
| Exact Ticket/episode/purpose/action   | Proven as local binding checks | E1 validates scoped Ticket, episode, purpose, revisions, scope and proposal; authority response equality covers the complete request plus invocation ID. These checks cannot authenticate a source that simply echoes claims.                                                                                                                                                                                          |
| Genuine source intent for that action | Missing                        | No Consent-specific challenge or independently authenticated intent channel exists. MFA code verifies setup only (`ConfirmMfaSetupService`), with no operational step-up or command binding. A JWT, Owner role, checkbox, Ticket creation or source reference supplies no independent intent.                                                                                                                          |
| Original grantor for DECLINE          | Partially supported            | E1 reconstitutes the scoped stored Consent and compares both original grantor person and account to the independent authority response. The initial and current person/account authentication mechanisms remain missing; a successor Owner/person is insufficient.                                                                                                                                                     |
| Freshness and replay resistance       | Partially supported            | Session expiry/version/revocation, atomic email-proof consumption (`MongoEmailVerificationRepository.consumeActive`), and refresh rotation (`MongoSessionRepository.rotateRefresh`) protect their own workflows only. E2 source uniqueness/revision CAS and E4 invocation binding reject their respective duplicates. No approved Consent-source freshness/revocation policy or durable source-intent consumer exists. |

`MongoAuditRepository` supplies append-only audit and a same-connection transaction
participant used by E2; audit records are traceability, never independent Consent
proof. Source claims (`authorityId`, `evidenceId`, `revision`, `generation`) must be
resolved through a server-configured trusted integration. A client cannot select
the trust root. Conflicting/ambiguous evidence must deny, and source/consumption
outages or uncertain consumption must fail closed without automatic retries.

The Technical Owner/security decisions still needed are the authoritative
person/account linkage and Owner provenance, the action-bound intent channel and
its assurance requirements, source freshness/revocation rules, and durable atomic
verification/consumption with reconciliation for uncertain outcomes. No TTL,
identity assurance level, provider allowlist or infrastructure policy is chosen
by this change. Existing session/email/MFA mechanisms are not repurposed into
Consent verification.

`customer-consent-authority.spec.ts` checks consumer-side identity/scope/action
binding, stale identity/Owner references, mismatched source revisions, original
grantor mismatch, unavailable/missing authority, ambiguity and response replay.
E3 HTTP reserved-key tests explicitly construct own keys through JSON.parse and
check nested stripping, independent authority denial, ordinary-field 400s and
authentication/Owner enforcement. All authority responses in these tests are
synthetic. They do not test real source-intent authentication, policy freshness or
durable consumption; those require the missing provider. E4 is suitable for a
bounded review of this contract and these checks, not production wiring approval.
No positive grant, Support View, withdrawal, expiry or supersession is implemented.

E5A adds a separate, unregistered [trusted-verification foundation](./CUSTOMER_CONSENT_VERIFICATION.md)
with explicit trust dependencies and no production verification or consumption adapter.
