# Email proof and account admission

## Public email verification

`POST /api/v1/auth/verify-email` keeps its successful `AuthTokens` response for an
active, unlocked, unverified account with valid proof. The `code` field accepts
exactly six decimal digits or the 64 lowercase hexadecimal characters generated
for an email link. Email lookup is normalized. Body fields cannot grant authority.

Already-verified accounts, missing identities, invalid/expired/consumed/revoked or
cross-account proofs, and initially ineligible accounts receive the same generic
`400 INVALID_VERIFICATION_CODE`. Malformed DTOs receive `400 VALIDATION_ERROR`.
An already-verified request never creates a session, changes verification state,
or appends `USER_EMAIL_VERIFIED`, including repeated link visits. Use ordinary
sign-in after verification has already completed.

The verifier checks identity, expiry and unconsumed state independently of the
repository's active lookup. `consumeActive` conditionally updates the exact proof
document with matching identity, proof snapshot, unconsumed state and current
expiry. Only one acknowledged, majority-written match and modification wins.
An expired or revoked snapshot cannot win later. Unknown write outcomes are not
retried and never authorize issuance.

After consumption, a separate conditional user update changes only
`isEmailVerified: false -> true` for the same email/ID, active/unlocked account,
and disabled MFA. This prevents concurrent distinct proofs from each issuing a
session for the same verification transition. The returned persisted user is
checked again; the session issuer reloads that identity before creating a session.
No schema migration, identity backfill or change to existing accounts is performed.
Legacy records missing explicit eligible flags can fail the conditional transition;
the owner must investigate such records through a separately authorized workflow.

Proof consumption, the account transition, session persistence and audit are not
one transaction. A failure can consume a proof without completing verification,
or verify the account without delivering credentials. The response is an error,
never authentication by retry: request a new proof if still unverified, otherwise
sign in normally. There is no compensation that restores consumed proof. The
success audit occurs only after proof and session admission complete. Audit failure
does not publish credentials, but an undisclosed session record may remain.

This endpoint has no MFA challenge. An MFA-enabled or unknown-MFA account fails
closed before consumption, and MFA is checked again at the conditional account
transition and session admission. This does not implement or certify ordinary
password/Google second-factor login; the inherited login paths have no challenge.
MFA enrollment and password remediation remain separate workflows.

Verification storage errors return sanitized `503 EMAIL_VERIFICATION_UNAVAILABLE`;
session persistence/signing errors return `503 SESSION_ISSUANCE_UNAVAILABLE`.
Account admission changing after proof processing returns `401 INVALID_CREDENTIALS`.
Proof values and account emails are no longer written to verification logs.

## Session boundaries

The shared domain predicate requires explicit `isActive === true` and
`isLocked === false`. Password/Google login retain their original proof checks.
Every common session issuance reloads the account, verifies identity/email and
verified state, checks admission, then creates and initializes the session. It
checks account admission again before publishing credentials. Observed failures
after creation trigger revocation of that newly created local test/runtime session;
unconfirmed persistence returns an error. No operational session change is part of
the implementation task.

Refresh retains signed proof, persisted refresh hash, identity, lineage, expiry,
revocation and atomic rotation checks. It rejects locked/inactive/unverified
accounts before rotation, checks admission again afterward and revokes the rotated
session if the final check fails. Unknown storage outcomes remain a sanitized
`503 REFRESH_UNAVAILABLE`; rejected proof/state remains `401 INVALID_REFRESH_TOKEN`.

`RequireCurrentSessionService` rejects locked/inactive accounts regardless of
whether a revocation sweep found the session. It requires a canonical identity and
session ID, an explicit nonempty generation matching persisted state, correct
session ownership, expiry and nonrevocation. It reloads the account after reading
sessions. Missing generations no longer pass by comparing two undefined values.
State rejection is `401 CURRENT_SESSION_REQUIRED`; unavailable storage is
`503 SESSION_ASSURANCE_UNAVAILABLE`. Ordinary user/proof reads use the primary.

`mustChangePassword` still permits only the two explicitly marked password
remediation handlers with a live current generation. It never bypasses account
lock, inactivity, ownership, expiry or revocation. Platform Admin additionally
requires persisted admin authority and every required operation permission;
`resources.transfer` and `resources.transfer.confirm` are unchanged.

## Concurrency limits and owner review

The existing lock workflow still saves the lock, sweeps sessions, audits and
notifies. Unlock behavior is unchanged. Deterministic in-memory tests cover lock
before creation, creation after the lock sweep, lock during initialization,
lock before/after refresh rotation, and lock during current-session lookup.

These checks are **not a cross-document atomic lock fence**. A lock may be saved
after the final account read and before response publication; an already admitted
request can finish. A session created around a sweep may remain stored if cleanup
fails. While the account stays locked, later refresh and current-session checks
reject that session independently. A lock/unlock interval entirely between reads
cannot be detected without a persisted account security epoch or coordinated
transaction used by all state writers. Such fencing needs separate architecture
and disposable-database validation. Majority proof writes are not a claim of
verified replica-set failover behavior; no database was accessed for this task.

Six-digit proof attempt throttling, resend serialization, ordinary MFA login
assurance, legacy credentials/sessions, credential-bearing seed scripts, and
catalogue reconciliation remain separate inherited concerns. Startup remains
catalogue-only. Operational impersonation still returns
`503 SUPPORT_IMPERSONATION_UNAVAILABLE` after ordinary authentication.

## Frontend compatibility

Web 2 redirects authentication to Web 1 and has no verification/registration API
client. Web 1 expects tokens only on success, catches verification failures and
displays their messages; its token admission waits for a successful response.
Therefore neither frontend requires a source edit. Repeat links now display the
generic error directing users to sign in; they never silently reauthenticate.
No `USER_NOT_FOUND` response is returned by verification. This intentional error
contract change reduces identity disclosure and removes the unsafe success case.
