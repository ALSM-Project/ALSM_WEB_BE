# Trusted Consent verification foundation — S1 TC E5A

E5A is an unregistered contract, validation and orchestration slice. It implements
no issuer integration, identity onboarding, challenge issuance, WebAuthn verifier,
MongoDB consumption adapter or positive Consent decision. E1–E4 remain unchanged.

## Recommended ALSM architecture (proposal, not approved security policy)

Use a small ALSM verification ledger, an approved external person-proofing source,
independently evidenced Organisation onboarding, and a WebAuthn action-confirmation
ceremony. Keep raw identity documents and assertions out of Consent records and
audit. Store opaque provenance references and immutable revisions/generations.
No identity issuer, onboarding assurance level, TTL or revocation guarantee has
been selected. The WebAuthn channel below is a recommendation requiring approval.

**A. VerifiedPersonBinding.** The required trust source is an approved identity
proofing issuer. Its authenticated proof must substantiate a stable person/issuer
subject and explicitly link that person to the exact admitted ALSM account under
an approved account-linking ceremony. Persist issuer subject, account/person IDs,
provenance revision/generation and revocation status. Email, a self-entered name,
Google login or an ordinary signed JWT alone cannot populate a verified binding.
Reuse `JwtAuthGuard`, `RequireCurrentSessionService` and the User account port for
admission only. New infrastructure: authenticated proofing integration, protected
binding issuance/linking and revocation records. **Owner decision:** issuer/key
trust configuration, accepted proofing and account-link/recovery assurance,
subject uniqueness/multiple-account rules and evidence retention. Revoked,
missing or ambiguous linkage denies; no physical-person assurance exists today.

**B. VerifiedOrganisationAuthority.** Recommend a protected business-onboarding
attestation backed by independently checked authoritative Organisation records
and evidence of that person's Owner authority. The actual evidence sources and
attestation issuer are unapproved. Pin the attestation to A's exact person/account
and provenance version, exact Organisation, issuer, revision and revocation status.
This is Organisation onboarding evidence, not Internal Support Approval. Reuse
`OwnerSupportTicketAccessService` as an additional live Owner/staff-denial check;
ordinary membership and platform-admin flags cannot issue this attestation.
New infrastructure: controlled attestation issuance, independent evidence review,
versioned removal/revocation and ambiguity handling. **Owner decision:** acceptable
authoritative records, who may attest, Owner/representative semantics, removal
authority and source freshness/revocation guarantees. None are implemented here.

**C. ConsentActionChallenge.** Recommend WebAuthn with a credential enrolled only
after approved person/account proofing and secure account linking. The server must
issue an unpredictable nonce and persist its digest with the complete transaction:
account/person, Organisation, Ticket, episode, purpose/full scope, exact REQUEST
or DECLINE, Consent/revisions, proposal/source, person/Owner provenance versions,
approved RP/channel configuration, policy, issuance and expiry. Verification must
check the enrolled credential, RP ID, allowed origin, user verification, nonce and
the exact server-held transaction. A copied reference or checkbox is insufficient.
Show the exact action/context in a protected confirmation ceremony; WebAuthn alone
does not attest that a human read or understood that summary. New infrastructure:
credential registry and secure enrollment/recovery, maintained WebAuthn verifier,
protected confirmation UI and challenge store. No passkey/step-up implementation
exists; current MFA verifies setup only. **Owner decision:** adopt this channel,
RP/origin policy, enrollment/recovery assurance, explicit challenge TTL, clock/skew
rules, ceremony requirements and revocation/freshness policy. E5A supplies none.
The assertion-verification obligations follow the
[W3C WebAuthn verification ceremony](https://www.w3.org/TR/webauthn-2/#sctn-verifying-assertion);
they do not establish person-proofing or Organisation authority.

The challenge's stable binding excludes E4's transient verification-attempt ID:
the future ceremony may predate that invocation. The source response and subsequent
consumption envelope additionally bind E4's exact attempt, preventing cached
responses from being substituted across invocations. This is not source proof.
STATUS and internal INVALIDATE are outside this challenge slice; existing E1/E4
behavior is preserved. No GRANT ceremony or lifecycle expansion is introduced.

**D. DurableIntentConsumption.** Recommend a dedicated local MongoDB adapter using
the E2 strict Core transaction pattern and the existing
`MongoAuditRepository.inTransaction(session, sameConnection)` participant. Use an
ISSUED/unexpired challenge CAS with the full binding and current local policy,
person, Owner-attestation and credential revisions; maintain unique challenge ID,
nonce digest and `(proof issuer, intent evidence ID)` across all actions/scopes,
including changed reference revisions. Commit consumption, its immutable receipt
and `CUSTOMER_CONSENT_INTENT_CONSUMED` audit together. One concurrent request wins.
Never replay business work after an unknown commit; reconcile the original
consumption/attempt/challenge/context IDs with a scoped read, never reconsume.
Reuse email `consumeActive` and refresh-rotation CAS as conditional-write examples;
neither existing adapter supplies Consent consumption or its transaction-safe audit.
New infrastructure: transaction-capable MongoDB, ledger/index provisioning,
session-bound participant, reconciliation and replay tombstones. **Owner decision:**
retention/tombstone policy, required local revocation fencing and reconciliation
ownership. TTL cleanup must not erase replay protection. The shared transaction
runner is untouched. External providers and ordinary membership reads are not
atomic with this local transaction; no distributed revocation guarantee is claimed.

## What the foundation code enforces

`VerifyConsentActionFoundationService` is separate from
`CustomerConsentAuthorityPort`. It returns only a consumption ID and
`operationalAccess: false`, never an E1 authority response, Consent state or access
credential. A future adapter must retain E1/E3 account/session, scoped Ticket,
revision/lifecycle and original-grantor checks; this service does not replace them.

All four dependencies are required: current Owner admission, approved server
policy, trusted verification source and durable consumer. There are no providers
or defaults. Policy lookup takes no client selector. The source must independently
authenticate the issuer, person, Owner evidence and intent ceremony; types,
CURRENT labels and local equality cannot do that. DECLINE's original grantor must
come from scoped E1/E2 reconstitution, not the command. Client source references
are candidates compared to the independently verified intent, not trust roots.

The service detaches/freezes inputs before awaiting, rejects strict-shape and
binding mismatches, rechecks Owner and approved policy, and validates challenge
expiry again before consumption. An explicit positive lifetime must come from the
approved policy; no numeric default is supplied. Source failures are sanitized;
missing/ambiguous/stale evidence denies. Only an exact CONFIRMED receipt for the
original consumption/attempt/challenge succeeds. Thrown, malformed or unknown
outcomes return 503 with `retrySafe: false`; there is no automatic retry or
reconciliation. The consumer must recheck expiry/local versions in its transaction.

Synthetic tests exercise these consumer-side checks and model a single-winner
consumption port. They prove neither WebAuthn/identity assurance nor MongoDB
atomicity, durable replay protection or audit rollback. No durable prototype or
new persistence behavior is implemented, so real MongoDB tests are not required
for E5A. The next implementation gate is approval of A–D's trust and policy
dependencies, followed by the smallest real binding/verification adapter and an
isolated consumption adapter with real transaction/concurrency/audit tests.

Production Consent routes/providers remain absent. No VERIFIED_GRANTED, Support
View, operational impersonation, Support Session or MFA authorization is added.
Authenticated impersonation remains 503 SUPPORT_IMPERSONATION_UNAVAILABLE.

E5B adds an isolated [MongoDB consumption prototype](./CONSENT_INTENT_PERSISTENCE.md)
for synthetic trust records only. It adds no source-authentication provider or
production registration; E5A's verification and authority boundaries are unchanged.
