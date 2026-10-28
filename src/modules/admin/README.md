# Global platform administration authorization

Every enabled `PlatformAdminController` endpoint requires ordinary JWT/current-session
authentication **and** a fresh persisted active, unlocked `isPlatformAdmin === true`
account **and** every operation permission below. Tenant membership, a role named
ADMIN, support/team-lead grants, JWT claims, headers and client UI state do not
establish this global authority. The owner confirmed this boundary on 25 October 2026.

Permissions use the existing RBAC repository and `EffectivePermissionsService`.
Its existing convention grants persisted platform administrators the current
permission catalogue; the operation key must still be present in that catalogue.
No roles, grants, seed data, shared permission guard or tenant/team policy changed.

Prefix: `/api/v1/admin`.

| Method/path | Required permission(s) |
| --- | --- |
| GET organizations | organizations.view |
| GET organizations/:id | organizations.view |
| POST organizations/enterprise | organizations.manage |
| PATCH organizations/:id/engagement | organizations.manage |
| GET revenue/summary | revenue.view |
| GET engagement-types | engagement-types.manage |
| POST engagement-types | engagement-types.manage |
| PATCH engagement-types/:id | engagement-types.manage |
| POST users/:id/lock | users.lock |
| POST users/:id/unlock | users.lock |
| GET users/:id/offboarding-summary | users.offboard.review |
| POST users/:id/offboard | users.offboard; additionally both transfer permissions when transferToUserId executes a transfer |
| POST resources/transfer | resources.transfer AND resources.transfer.confirm |
| GET audit-logs | audit.view |
| GET audit-logs/export | audit.view |
| GET audit-logs/export/pdf | audit.view |

### Audit logs (UC 3.13.10 — View Audit Logs)
- Immutable, append-only trail of all system actions.
- Automatically captures client `ipAddress` via `RequestIpMiddleware` and `requestIpStorage`.
- Retained for a minimum of 7 years, automatically enforced via MongoDB TTL index on `expiresAt` (`expireAfterSeconds: 0`).
- Supports filtering by date range (`from`, `to`), `actor`, `action`, and `target` (`resourceType` / `resourceId`).
- Exports to CSV and PDF with full column support: `timestamp`, `actor`, `action`, `target`, and `ipAddress`.

The related global `PATCH /api/v1/users/:id/status` route also requires persisted
Platform Admin status and `users.manage`. Otherwise it would provide an alternate
global account-deactivation path for a team lead denied by this controller. Other
user routes retain their existing permission guards. AdminModule exports the guard
and its application policy as the public authorization adapter for this route.

`POST /api/v1/projects/:id/assign-team-lead` also performs global reassignment and
is called by Web 2's resource transfer modal. It requires persisted Platform Admin
status, `organizations.manage`, `resources.transfer` and `resources.transfer.confirm`.
Ordinary membership-scoped project list/create/read/update/delete and team-assignment
workflows keep their existing authorization; no team-lead permission grant is removed.

GET engagement-types currently initializes default plans when empty, so it needs
catalogue-management permission while that write side effect remains. It is not
an unprivileged catalogue-read operation.

The sole exception is `POST organizations/:id/impersonate`: after ordinary
authentication it always returns `503 SUPPORT_IMPERSONATION_UNAVAILABLE` without
admin/RBAC admission, tenant lookup, support credentials or a success audit.
`DisabledSupportImpersonation` marks only this permanently rejecting handler.
It is not an enable flag. Missing explicit policy on any other handler returns
503. Authentication failures preserve 401 or session-authority 503; an authenticated
caller lacking admin status or a required permission receives generic 403 before
business persistence. Mandatory admin authority/RBAC failures return secret-free
`503 PLATFORM_ADMIN_AUTHORIZATION_UNAVAILABLE`. Authorized resource lookups retain
their existing 404 behavior. Verified global administrators can intentionally
administer organisations beyond their ordinary tenant membership.

`resources.transfer.confirm` is defined in the existing catalogue as explicit
confirmation and execution authority. Both direct transfer and offboarding's
embedded transfer require it in addition to `resources.transfer`. These checks do
not create or consume a separate approval. Jira's team-lead approval/lifecycle use
cases still need an authoritative scope and approval specification before a new
team-scoped workflow can be implemented. The global endpoints deny team leads;
their existing permissions and independently scoped workflows remain unchanged.

Ordinary admission checks are point-in-time checks, not transactional fencing
against concurrent revocation. Existing lifecycle transaction/rollback behavior
and test-account bootstrap are outside this remediation. Operational support
impersonation remains blocked on the separate security prerequisites documented
in `docs/engineering/IMPERSONATION_SECURITY_BLOCKER_20261017.md`.

`test/platform-admin-authorization.spec.ts` exercises the real AdminModule,
controller, authorization/RBAC resolver, JWT/current-session guard, exception filter
and business services with isolated persistence/email ports. It covers all enabled
routes positively and negatively, each missing operation permission, support/team
lead/forged claims, cross-target denials before business data access, embedded
transfer, authority outages, ordinary authentication and unchanged impersonation.
It does not certify live database concurrency or an operational support session.
