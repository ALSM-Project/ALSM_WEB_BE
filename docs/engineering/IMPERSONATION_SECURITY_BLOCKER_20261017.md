# ALSMV2-1050: operational impersonation SECURITY BLOCKED

17 October 2026. Inspected active demo backend `12070af` and preserved security ref `feature/ALSMV2-1051-p0-security-baseline` at `50f14b7106ac2f1dbba1fddf99069bb1e446e3c9` using read-only Git object inspection. No security branch was checked out, copied, merged or activated.

Report 3 UC-54 requires Support Staff to enter an existing customer organization read-only and audit that access. Its support-role precondition is business intent, not proof that the missing security mechanisms exist.

| Mandatory prerequisite | Active demo branch | Protected AUTH-H1/P1 foundations and remaining dependency |
| --- | --- | --- |
| Trusted personnel identity | No support identity/governance module | Support identity checks exist on the protected branch, but trusted personnel binding, issuer/custodian roots, signed bootstrap and recovery remain unavailable. A client role, account email or platform-admin flag cannot substitute. |
| Approved principal and role authority | Ordinary role seed/global grants; no governed support principal | P1C-A/B0/B1 describe role-command policy, person separation, generations and assurance contracts. Operational B2/B3/B4 and trusted governance bootstrap are not supplied. Definitions/seeds alone must not appoint trusted staff. |
| Current session and authentication generation | JWT signature/expiry with optional sid; no authoritative current-session/generation check in JwtAuthGuard | AUTH-H1 implements refresh rotation/reuse handling on the preserved branch. It does not deliver all protected current-session/security-epoch authority. B1's authoritative session/generation providers explicitly return unavailable. Finish reviewed AUTH-H2/H3/session and invalidation hardening. |
| Command-bound MFA and replay protection | TOTP enrollment helpers, not command step-up | B1 defines command/session/account/fingerprint/scope-bound proof checks and atomic consumption contracts. The proof verifier returns no evidence; atomic proof consumption rejects with `ATOMIC_PROOF_CONSUMPTION_UNAVAILABLE`. Enrollment or an MFA-enabled flag is insufficient. Implement real issuer/verifier, challenge controls, permanent replay uniqueness and transaction-bound consumption in the later B work. |
| Approval generation/revocation | No active support approval module/routes | Protected P1A/P1B has scoped READ_ONLY approval creation/revocation with transactional audit, exact roles/permissions, no self-approval and expiry/revocation checks. It requires provisioned named indexes and a transaction-capable deployment; those foundations do not supply operational P1C-C entitlement/approval-generation admission and fencing against concurrent revocation. |
| Read-only support lifecycle | No operational impersonation/session endpoint | Even protected support authorization returns actor, organization, approval and bounded read-only scope; it creates no customer identity, token or session. Need a reviewed support session lifecycle with real actor retention, exact organization/purpose, short expiry, end/revoke enforcement and read-only enforcement on every downstream operation. |
| Audit and containment | Existing application audit is not a support admission/containment system | Protected transactional governance/approval foundations do not finish P1C-D cross-instance containment, emergency termination, incident evidence or recovery. Bind security state/proof/privileged effects/audit in one validated transaction; reconcile unknown commit outcomes without bypasses. |

Exact protected evidence: `src/modules/support/README.md`, `src/modules/auth/AUTH_H1_SESSION_ROTATION.md`, `src/modules/rbac/P1C_A_SECURITY_FOUNDATION.md`, `src/modules/rbac/P1C_B0_COMMAND_POLICY.md`, `src/modules/rbac/P1C_B1_SESSION_ASSURANCE.md`, `src/modules/auth/infrastructure/unavailable-session-assurance.providers.ts`. These paths refer to the preserved security ref, not a claim that the demo checkout contains them.

Safe local action is to retain the disabled feature and document prerequisites. No support route, token, MFA claim, principal assignment, approval grant or customer read bypass is introduced. The existing tenant-scoped queue/review APIs remain independent. An owner product decision alone does not remove this security block.

Before operational implementation: complete and independently review the trusted personnel/governance bootstrap, AUTH-H2/H3 and P1C-B2/B3/B4 work; integrate selected reviewed prerequisites without automatically copying the full branch; implement approval-generation and read-only session admission plus containment. Require isolated real database concurrency/replay/revocation/rollback tests, session and credential invalidation tests, cross-tenant denials, read-only enforcement, attributed audit, and session termination across instances. A pure-policy unit test or authenticated browser fixture cannot certify this chain.

## Re-evaluation on synchronized develop — 25 October 2026 (ALSMV2-1050)

Backend `develop` and `origin/develop` were verified at
`19a76ef5b642108442a8d72d1b66aef6d34134e6`; Web 2 at
`174ab19c4a8c88f5f06f8cb334612b43e504ccff`. The historical table above describes
the 17 October demo baseline, not the current implementation. Jira calls this
UC-56; the available Report 3 SRS calls the same business flow UC-54. Match by
feature name and actor, and retain the task's read-only boundary.

| Prerequisite | Current develop evidence and remaining work |
| --- | --- |
| Ordinary current session | Improved: `JwtAuthGuard` now invokes `RequireCurrentSessionService` and verifies an active account plus a persisted, unexpired, unrevoked owner session and current access version. Sessionless/stale tokens fail closed. Refresh/logout transaction hardening is present (`5dc825f`, `8b476aa`, `f6c87c3`). This is not command MFA, trusted support authorization or fencing of support effects against concurrent revocation. |
| Trusted support staff / governance | Still missing. `INTERNAL_SUPPORT` and `organizations.impersonate` are seeded ordinary RBAC data. `EffectivePermissionsService` grants all ordinary permissions to platform admins. Neither proves trusted personnel provenance or approval authority. Owner module: RBAC/personnel governance, P1C-A and B2/B3/B4 prerequisites. |
| Support approvals / command-bound step-up | No support module in this develop tree. Approval persistence, trusted step-up issuer/verifier, replay consumption and generation-bound admission are unavailable. Owner modules: support P1A/P1B/P1C-C, auth/RBAC P1C-B2/B3/B4. These are design identifiers in protected documentation, not verified additional Jira issue keys. |
| Support lifecycle / tenant reads / read-only enforcement | No scoped support-session persistence or protected read pipeline exists. `OrganizationContextService` still resolves membership and must not be bypassed. There is no support expiry, exit/revoke or enforcement against uploads, conversions, writes, deletes or exports. Owner: support session P2/P3 plus each downstream resource module. |
| Audit / concurrent revocation / containment | The ordinary audit repository exists, but support admission/use/rejection/termination is not transactionally bound to support authority and protected effects. Cross-instance containment and recovery remain absent (P1C-C/D). No real database support concurrency, replay or revocation guarantee is verified. |

The preserved security branch remains at
`50f14b7106ac2f1dbba1fddf99069bb1e446e3c9`. Read-only Git inspection confirms
its personnel/root, session/generation, command proof and atomic proof-consumption
providers still explicitly return unavailable/deny. It was not checked out,
modified, activated, merged or cherry-picked.

### Safe changes while operational access remains blocked

Current develop had acquired `POST /api/v1/admin/organizations/:id/impersonate`,
which looked up a tenant, appended `ORGANISATION_IMPERSONATED`, and returned
`readOnly: true` without establishing a secure session. ALSMV2-1050 replaces that
false success with unconditional `503 SUPPORT_IMPERSONATION_UNAVAILABLE` after
ordinary authentication, before tenant lookup or audit writes. No feature flag,
alternate role path, customer identity, token or support capability is issued.
Invalid/nonexistent tenant identifiers receive the same unavailable response;
tenant eligibility validation belongs to future authorized admission. Ordinary
authentication failures retain their existing 401/503 responses.

Web 2 disables both Support View entry points, removes the simulated confirmation
and unused success/token DTO, and removes storage-driven entry/restoration.
Legacy `alsm_support_view` / `alsm_impersonation` values are only cleared on mount
or local cleanup; they cannot activate context, including when storage fails or
forged events arrive. That cleanup is not server session termination. Organisation
directory/detail reads no longer substitute demo organisations on API failures.

`test/support-impersonation-disabled.spec.ts` exercises the real controller,
JWT guard, current-session service and error filter with fixture persistence ports.
It verifies closure, ordinary-session denials, spoofed claims and no false success
audit. Web 2 tests verify disabled entry and storage forgery resistance. These
tests certify only the disabled boundary; they do not certify operational support
authorization, lifecycle, revocation races, read-only enforcement or containment.

Adjacent admin directory/detail and other administration routes currently have
JWT authentication without trusted support authorization. Disabling impersonation
does not certify or repair those separate access policies. Review them before any
customer support rollout; no unrelated RBAC/authentication system is added here.

Verdict: **BLOCKED / REQUEST CHANGES** for operational ALSMV2-1050/1051/1052/1053.
Complete and independently review the dependencies above, then implement and
verify the full workflow with isolated database and cross-instance tests. The
external implementation/review reports and exact test evidence are stored under
`E:\ALSM\alsmv2-1050-evidence\` for owner review.
