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

## Related Documentation

[`RULE.md`](../../../RULE.md) · [Coding Standards](../../../docs/engineering/CODING_STANDARDS.md) · [ADR-004](../../../docs/engineering/adr/ADR-004-single-backend-multi-portal-organization-isolation.md)
