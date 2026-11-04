# Auth Module

## Purpose

Owns authentication, session lifecycle, and MFA workflow.

## Responsibilities

Authentication use cases, refresh-session handling, MFA setup/confirmation, and
HTTP authentication contracts. User records and organization membership remain
owned by their respective modules.

## Architecture

Uses `application/`, `domain/`, `infrastructure/`, and `presentation/`. Session
persistence and MFA technical implementations are infrastructure concerns.

## Security / Organization Isolation

Credentials, MFA secrets, and refresh tokens are sensitive. Authorization must
use authenticated identity and organization membership, never a client-supplied
organization claim alone.

Every ordinary user access JWT protected by `JwtAuthGuard` must include `sid`
and pass `RequireCurrentSessionService` against the active account and persisted
unexpired, unrevoked session belonging to that user. Sessionless legacy tokens
are rejected; sign in again. Logout and refresh rotation invalidate the old
session's access tokens on subsequent requests. Unavailable authoritative state
fails closed with `503 SESSION_ASSURANCE_UNAVAILABLE`; invalid sessions receive
`401 CURRENT_SESSION_REQUIRED`. Public authentication/health routes keep their
existing contracts. This is ordinary session assurance, not impersonation or
command MFA admission. `SessionAssuranceModule` exports only this service globally
so guards in the RBAC/menu modules enforce the same contract.

## Related Documentation

[Email verification and account admission guarantees](../../../docs/security/AUTHENTICATION_ADMISSION.md)
documents proof consumption, locked-account rejection, error compatibility and
the remaining cross-document lock race.

[`RULE.md`](../../../RULE.md) · [Coding Standards](../../../docs/engineering/CODING_STANDARDS.md) · [ADR-004](../../../docs/engineering/adr/ADR-004-single-backend-multi-portal-organization-isolation.md)
