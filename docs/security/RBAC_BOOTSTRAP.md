# RBAC startup and legacy demo account response

## Startup policy

API and worker startup initialize the existing RBAC catalogue only: system roles,
permission definitions and default role-permission mappings. They never create demo
users, hash passwords, query identities by historical demo email, change account
state, or assign user roles. Existing identities and sessions are untouched.

This applies in **every environment**, including local development and test. There
is no supported demo-account opt-in or supplied bootstrap password.
`ENABLE_SEED` and `ALSM_ENABLE_DEV_TEST_ACCOUNTS` have no effect. Do not add these
settings to enable accounts. The retired `scripts/seed-actors.ts` prints a fixed
refusal and exits with status 1 before loading configuration or connecting to a DB.

Central Joi configuration currently accepts `development`, `test` and `production`;
it defaults a missing `NODE_ENV` to `development` and rejects `staging`, aliases and
unknown values. A staging deployment using the production runtime classification
has the same account prohibition. These existing global configuration semantics
are unchanged. A mistaken environment name or flag cannot reach removed account
provisioning code.

The current configuration can point development at a shared MongoDB database and
has no reliable isolation attestation. Consequently optional startup provisioning
is deliberately unsupported, even for loopback database addresses. A future local
demo workflow needs separate review, explicit authorization and disposable-store
isolation; startup is never a password reset or first-admin recovery mechanism.

## Developer compatibility

Normal startup no longer supplies historical demo logins. Use ordinary registration
for an ordinary self-service account and the existing authorized onboarding/role
management workflows for other approved users. Registration and a role named
`ADMIN` do not grant persisted Platform Admin authority. Creating an initial
Platform Admin requires a separately reviewed, owner-authorized identity procedure;
this patch supplies no shortcut.

Automated tests create explicit isolated in-memory identities. Run
`npm test -- --runTestsByPath test/rbac-bootstrap-security.spec.ts` for startup
coverage and the existing auth/Platform Admin/disabled-support tests for runtime
security. Real DB fixtures require their own explicit disposable DB configuration;
never supply an application or shared DB URI to a fixture. No new environment keys,
secret defaults or schema changes are required.

Catalogue behavior is preserved, including system-role reconciliation, permission
label updates and additive default role grants. Removing a default permission from
a role can still be reversed by the inherited catalogue seed on restart. Catalogue
read/create races and delete/reinsert mapping updates are also inherited; these
are separate governance/concurrency concerns, not evidence that user accounts are
mutated. This patch changes no permission key, role grant or authorization guard.

## Inventory before any account cleanup

Only an authorized administrator/incident responder should perform the following
reads against an explicitly verified environment. No inventory or live changes were
executed by this patch. Verify the deployment's actual database binding through
approved operational records; do not infer production absence from local results.

The historical startup/script email set is:

```javascript
const historicalEmails = [
  'admin@alsm.io', 'teamlead@alsm.io', 'sales@alsm.io', 'sales_staff@alsm.io',
  'support@alsm.io', 'converter@alsm.io', 'enterprise@company.com',
  'partner@fintechnexus.io', 'staff@alsm.io', 'partner@alsm.io', 'enterprise@alsm.io'
];
db.users.find(
  { $or: [{ email: { $in: historicalEmails } }, { isPlatformAdmin: true }] },
  { _id: 1, email: 1, isPlatformAdmin: 1, isActive: 1, isEmailVerified: 1,
    isLocked: 1, mustChangePassword: 1, createdAt: 1, updatedAt: 1 }
);
```

Use inclusion projections. Never retrieve password hashes, MFA secrets/backup
codes, reset/verification tokens, refresh hashes or access versions. Email matches
are investigation indicators, not proof of seed provenance. Also review all
SYSTEM_ADMIN/ADMIN assignments, custom privileged roles, effective role-permission
mappings and active temporary roles; seed-granted privileges may have moved to
other identities. For selected account IDs, read only role identifiers and current
session metadata (`_id`, `userId`, `createdAt`, `lastActiveAt`, `expiresAt`,
`revokedAt`) through authorized administration or constrained read-only queries.
Review successful logins, role/account changes and audit gaps around deployments
and restarts. The old seeder did not produce a complete credential-change trail.

## Owner-authorized response

1. Inventory each production/staging database and record sanitized results in
   restricted incident records. Review account owners, required privileges, role
   grants and current sessions before proposing any change. Confirm no deployment,
   automation or old image still invokes the legacy seed code.
2. Treat historical default login credentials and the database credential embedded
   in the old actor script and the remaining `scripts/seed-atlas-menus.js` as
   exposed. Do not copy credential values into tickets, reports or logs. Database
   credential containment/rotation needs an owner-approved operational plan; the
   unrelated menu script is not executed or rewritten here.
3. Review and authorize per-account credential replacement through the existing
   credential-management workflow. Independently verify session termination:
   current password-update persistence alone does **not** revoke existing sessions.
   Use the established authorized session revocation procedure; if it cannot cover
   all affected sessions, keep the incident open for a separately reviewed response.
4. Review stale persisted admin flags/roles and authorize any lock, disablement or
   role change separately. Verify revocation across refresh and current-session
   checks, preserve incident evidence, and confirm subsequent restarts do not undo
   the authorized state.

This patch never deletes/disables an existing account, rotates a credential,
revokes a session or runs a cleanup migration. Legacy exposure remains an incident
response and production-release blocker until the owner resolves it. Platform Admin
still requires persisted authority plus operation permissions; operational support
impersonation remains unavailable.
