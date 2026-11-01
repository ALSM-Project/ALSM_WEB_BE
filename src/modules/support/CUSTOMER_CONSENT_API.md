# Customer Consent API contract — S1 TC E3 (unregistered)

Three controller methods are implemented in isolation. **Zero Consent routes or
providers are registered in production AppModule.** They remain 404 there.
E4 refines authority response correlation; the E1 lifecycle services and E2
repository are unchanged. No production authority adapter is supplied. Do not
register this slice merely because its synthetic tests pass.

## Missing authority prerequisite

Source inspection found the real JWT/current-session and exact current Owner
mechanisms, but no independent trusted Consent person/account linkage, Owner
provenance and exact action/source-intent verification provider. The existing
`CUSTOMER_CONSENT_AUTHORITY` is a port only. JWT, an Owner membership, a checkbox,
Ticket creation and an opaque reference cannot fill it. A later reviewed adapter
must verify the full E1 request binding, including original grantor person/account
for decline. Proposed beneficiary and policy references remain unverified claims.
The new test-only approval ledger lives under `test/`, never production DI.

## Paths and input

All paths have prefix
`/api/v1/organizations/:organizationId/support-tickets/:ticketId/customer-consents`.
Organisation is canonical lowercase 24-hex; Ticket, Consent and episode are UUID v4
(E1 requires canonical lowercase). Actor comes exclusively from `CurrentUser`.
No actor, grantor, role, Organisation, state or outcome field is accepted in bodies.

| Method / suffix            | Input                                                                        | Success in the isolated harness |
| -------------------------- | ---------------------------------------------------------------------------- | ------------------------------- |
| POST `/`                   | `episodeId`, `expectedTicketRevision`, `proposal`, `source`                  | 201, pending metadata           |
| GET `/:consentId`          | flat query below; no body                                                    | 200, scoped status              |
| POST `/:consentId/decline` | `episodeId`, `expectedTicketRevision`, `expectedRevision`, `scope`, `source` | 200, declined metadata          |

Revisions in POST bodies are JSON numbers, nonnegative safe integers; strings,
fractions and unsafe numbers reject. GET `expectedTicketRevision` is a canonical
decimal integer in the same range (no exponent, sign, padding or duplicate values).
GET also requires `episodeId`, `purposeId`, `operation`, `projectionId`,
`environmentId`. The controller fixes its scope `useCase` to UC66 and `mode` to
READ_ONLY. There is no LIST or pagination contract in E1/E3.

`scope` has exactly `useCase: "UC66"`, `purposeId`, `operation`, `projectionId`,
`environmentId`, `mode: "READ_ONLY"`. Operation is UC66_READ_PROJECTS,
UC66_READ_SCREENS, UC66_READ_PROGRAMS or UC66_READ_LOGS. Identifier strings are
nonempty, at most 200 characters, without whitespace/control characters.

`source` has exactly `authorityId`, `evidenceId`, `revision`, `generation` identifier
strings. These are candidate intent references, never trusted evidence by input.
An evidence reference adds `status` in CURRENT, STALE, REVOKED, EXPIRED, INVALIDATED,
SUPERSEDED or UNKNOWN; even CURRENT never verifies authority.

`proposal` has exactly:

- `scope` as above;
- `beneficiary`: `identity` (`personId`, canonical `accountId`, `provenance` evidence
  reference), `ordinarySession` evidence reference, `entitlement` evidence reference;
- `coverage`: `kind: "INDIVIDUAL"`, `personId`, canonical `accountId`, matching the
  proposed beneficiary exactly;
- `policy`: `policyId`, `version`, lowercase 64-hex `sha256`, `decisionEvidence`
  reference. A hash is not approval or independently verified policy.

Strict nested DTO validation rejects ordinary unknown body/query fields and
malformed objects; it performs no implicit body number coercion. The configured
Nest validation pipeline strips reserved own-property keys `__proto__`,
`prototype` and `constructor` recursively before DTO validation rather than
rejecting them as unknown fields. A request containing those keys can therefore
succeed when its remaining fields are valid and independently authorized. The
stripped keys cannot supply trusted actor identity, Organisation or Ticket scope,
Consent action, consent evidence or authorization decisions. Ordinary unknown
fields still return 400; blanket unknown-field rejection is not promised.
POST accepts no query
fields. GET bodies are ignored and never affect identity, scope or authorization;
clients should not send GET bodies. No raw evidence/credentials are accepted.

## Authority, lifecycle and output

All methods use existing JwtAuthGuard/persisted account/current-session checks,
then SupportTicketOwnerGuard with the accepted E1 Ticket READ prerequisite.
E1 rechecks that same trusted actor/exact Organisation and independently verifies
REQUEST, STATUS or DECLINE, bound to Ticket, episode, purpose/scope, revisions,
source and proposal where relevant. Neither Owner admission nor a test provider
constitutes verified positive consent. Members, internal Support assignments and
Platform Admin status alone grant no access.

Request and decline require the current OPEN episode and expected Ticket revision;
decline additionally requires expected Consent revision, pending state and the
verified original grantor. Status may identify retained historical Consent as
incompatible. DTO values and nested proposals become plain detached data
synchronously before E1's pre-await capture. Observed Ticket/Owner changes reject;
this is not atomic Ticket/Owner revocation fencing.

Mutation output has exactly `consentId`, `organizationId`, `ticketId`, `episodeId`,
`state`, `revision`, `operationalAccess: false`. Status adds `ticketCompatibility`
(CURRENT_EPISODE_OPEN, TICKET_CLOSED, TICKET_CANCELLED or EPISODE_CHANGED).
No grantor/person/account, beneficiary, scope/projection, policy, evidence/source,
provenance or history fields are exposed. No response grants operational access.

INVALIDATE remains internal E1 application behavior derived from authoritative
Ticket lifecycle facts, with no public route or automatic hook introduced here.
There are no GRANT, WITHDRAW, EXPIRE or SUPERSEDE routes.

## Errors and persistence

The existing ApiExceptionFilter supplies `{ statusCode, code, message, details,
requestId }` (requestId where available): 400 invalid DTO/command; 401 invalid
account/session; 403 missing verified Owner/independent Consent authority; safe
404 for unavailable scoped Ticket/Consent; 409 stale revision/context/transition;
503 unavailable trusted authority/persistence or outcome unconfirmed.

E1's accepted write helper conservatively translates thrown/unknown write outcomes
to 503 CUSTOMER_CONSENT_OUTCOME_UNCONFIRMED, including original Consent,
Organisation, Ticket, episode and revisions with retrySafe false. Never replay
business mutations automatically. Foreign and missing scoped Consent share the
same 404; no foreign metadata is returned.

The isolated real-Mongo harness binds unchanged E2 persistence to the real
MongoAuditRepository.inTransaction(session, sameConnection). Consent state and
audit share snapshot/majority Core transactions with no withTransaction callback
replay. Production has no such Consent wiring yet. Before later registration,
provision E2's required indexes, use transaction-capable MongoDB, bind the real
session participant and supply the reviewed independent authority mechanism.

## Verification boundary

`customer-consent-api.http.spec.ts` uses actual HTTP routing, DTO pipes, guards,
session assurance, Owner logic and E1 services with synthetic persistence and
authority. `customer-consent-api.integration.spec.ts` uses real persisted account,
session, Organisation, Support assignment, Ticket, Consent and audit adapters in
the approved ownership-marked disposable MongoDB database. **Consent routes are
registered only in its isolated test module.** A separate production AppModule
instance verifies their absence and the unchanged impersonation 503. Production
RBAC seeding and unused queue ports are replaced as in accepted Ticket tests.

The real suite checks scoped isolation, audit, rollback, competing HTTP declines
using distinct transaction sessions, and injected acknowledgement loss after
real commits. Authority remains synthetic in both suites. This does not certify
a production consent-verification provider or replica-set failover. Non-secret
transaction/cleanup evidence is written to
`coverage/customer-consent-api/<runId>.json`.

```powershell
npm.cmd run test -- --runTestsByPath test/customer-consent-api.http.spec.ts
$env:ALSM_SUPPORT_TICKET_TEST = 'owned-local-only'
npm.cmd run test -- --runTestsByPath test/customer-consent-api.integration.spec.ts
Remove-Item Env:ALSM_SUPPORT_TICKET_TEST
```

Support View stays disabled, S1 TC A remains denial-only, and impersonation remains
503 SUPPORT_IMPERSONATION_UNAVAILABLE. No positive grant, internal approval,
Support Session, MFA, UC-67 or shared transaction-runner change is introduced.
