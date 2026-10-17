# Team Performance development setup and incident procedure

17 October 2026. Applies to the original Backend and Web 2 checkouts. Local development only. This is an operational procedure, not a production migration or new business-model proposal.

## Guarded MongoDB index setup

Run from `E:\ALSM\ALSM_WEB_BE` after reviewing `test/team-dev-indexes.cjs` and its regression test:

```powershell
New-Item -ItemType Directory -Force coverage/team-readiness | Out-Null
npm run build
node test/team-dev-indexes.cjs > coverage/team-readiness/indexes-first.json
$setup = Get-Content -Raw coverage/team-readiness/indexes-first.json | ConvertFrom-Json
node test/team-dev-indexes.cjs --database $setup.database > coverage/team-readiness/indexes-second.json
node --test test/team-dev-indexes.test.cjs
```

Create the ignored `coverage/team-readiness` directory first if absent. Check every exit code; stop on failure. The emitted database name is the one to configure for an isolated development application. Repeating with that exact name is idempotent. Calling without a database deliberately creates a new unique development database.

The procedure accepts no URI, credentials, host, environment file or production database name. It checks the running Docker container `alsm-emergency-20261017-mongo`, label `alsm.owner=emergency-20261017`, and its sole `127.0.0.1:27117` binding. Only `alsm_team_dev_<32 lowercase hex>` is accepted. A fresh database gets a `_team_dev_owner` marker; an existing database must have the matching marker and exact database name. If the owned container is absent or different, stop; do not weaken guards to point this script at another installation.

It imports only schema modules, never AppModule or `.env`. Build first: index definitions are taken from compiled counterparts of schema files actually present in `src/modules` in this checkout. Stale compiled files left by a different branch are excluded. Multiple current schemas targeting one collection contribute their declared indexes. No business records, users, RBAC grants, CRM records or revenue are provisioned. The ownership marker is the only inserted record.

Verified fresh result: **33 declared collections and 124 indexes, including each collection's `_id_` index**. The emitted JSON is the complete actual index manifest; rerunning produced an identical manifest. This includes organization, user, authentication-session, existing RBAC/menu, project, conversion-job, audit and team dependencies, as well as other current checked-in collection schemas. An unchanged already-built index is reused. New indexes are created with the declared key order, uniqueness, sparse/partial/TTL/collation options. Existing conflicting definitions cause a preflight error before index creation. Index creation rejects existing duplicates; it never deletes records, drops indexes, calls `syncIndexes`, backfills attribution or changes an index to nonunique. A failure during creation can leave some correct indexes created; record the error and rerun only after an explicit diagnosis. There is no automatic repair.

Feature constraints:

| Collection | Index | Required behavior |
| --- | --- | --- |
| `teams` | `_id_` | Permanent identity fence for client-supplied creation IDs |
| `teams` | `organizationId_1_kind_1_managerIds_1` | Organization/type/explicit manager lookup |
| `team_job_assignments` | `_id_` | Permanent assignment retry fence, including revoked records |
| `team_job_assignments` | `one_active_team_job_assignment` | Unique `{organizationId:1,jobId:1}`, partial `{revokedAt:null}`; one active assignment per job across teams |
| `team_job_assignments` | `organizationId_1_teamId_1_revokedAt_1` | Scoped active assignment lookup |

Assignment writes check the exact named partial unique index and fail closed if absent or mismatched. The regression test provisions a disposable database twice, deliberately creates index drift and duplicate active rows, proves rejection without automatic repair/deletion, then cleans up only its guarded test database. Setup itself never drops a database. Do not use this script against production or as evidence of a production migration review.

## Authorized administration through real APIs

Use the existing normal authentication flow. Every administration endpoint requires an active persisted account, membership in the selected organization as **OWNER or ADMIN**, and the existing **`users.manage`** effective permission. Global permission alone or organization membership alone is insufficient. No new permission, production grant or organization-to-team backfill is introduced. Include `Authorization: Bearer <normal access token>` and `x-organization-id: <exact organization ID>`.

1. Use existing organization/user/project administration to establish real active organization members and an active organization-owned project. This feature does not create users or projects implicitly. Manager IDs must refer to active non-VIEWER organization members.
2. Generate a random MongoDB-style 24-hex creation ID once in the client and persist it with the complete intended request **before** sending. `POST /api/v1/teams` accepts `creationId`, `name`, `kind` (`SALES` or `CONVERSION`), explicit `memberIds`, explicit `managerIds`, `projectAssignments`, and `expectedRevision:0`. SALES requires an empty project-assignment list. CONVERSION project assignments have `{projectId,memberIds}` with members explicitly in the team. IDs must be canonical persisted IDs, never project-name aliases.
3. Inspect `GET /api/v1/teams/:teamId/administration`. Replace configuration with `PUT /api/v1/teams/:teamId`, the complete desired state and the exact returned `expectedRevision`; omit `creationId` on PUT. Kind cannot change. Membership/management/project changes retain actor/revision/snapshot attribution.
4. For a real persisted job in that project, generate and retain one stable 24-hex `assignmentId`. `POST /api/v1/teams/:teamId/job-assignments` accepts `{assignmentId,jobId,memberId}`. The member must still be active in the organization and explicitly assigned to this CONVERSION team and project. Job creators and workers do not become assignees automatically.
5. Inspect active records with `GET /api/v1/teams/:teamId/job-assignments`, or a specific retained record with `GET /api/v1/teams/:teamId/job-assignments/:assignmentId`. Revoke only using `DELETE /api/v1/teams/:teamId/job-assignments/:jobId?assignmentId=<exact current assignment ID>`. Reassignment requires a separate explicit intent and a new assignment ID after revocation. A missing precondition is rejected, and an old precondition cannot revoke a replacement.

Use collision-resistant IDs (for example, the existing MongoDB driver's `new Types.ObjectId().toHexString()` in trusted developer tooling). They are identifiers, not credentials or authorization. Do not regenerate them after a timeout. Existing previously created records need no schema change. No administration UI was added; existing dashboards only read these APIs.

Reporting remains explicit manager scope: `GET /api/v1/teams?kind=...`, `/teams/:id/performance?days=7|30`, `/teams/:id/workload?days=7|30`. Org administrators do not automatically get reporting scope. Reporting managers do not automatically get administration permission.

## Audit failure and retry incident procedure

Business state and central audit use separate repository writes. The current owned MongoDB runs standalone, and no shared transaction/session contract exists across these ports. A fully atomic central-audit outcome is **not** implemented. Do not enable transactions by silently changing deployment topology or claim rollback after an error.

The HTTP error envelope preserves outcome details through the existing exception filter in `details[0]`:

| Code | Meaning of this attempt | Operator action |
| --- | --- | --- |
| `TEAM_AUDIT_UNAVAILABLE` | Request audit failed before this attempt's business mutation | Restore audit availability and reconcile prior attempts; this does not prove the same operation never committed earlier |
| `TEAM_MUTATION_OUTCOME_UNCONFIRMED` | Driver failed without a reliable write outcome | Treat as unknown, inspect by the retained identity and revision |
| `TEAM_MUTATION_COMMITTED_AUDIT_PENDING` | Business write returned success; completion audit failed | Business state is persisted; do not issue a new mutation to compensate blindly |

All three set `retrySafe:false`. The latter two include the known resource ID, and team-save completion failure also includes the revision. Administration clients must disable automatic mutation retries and show reconciliation guidance. The existing Web 2 dashboards have no team-write client. Server protection remains effective even if an old client repeats a request: stable creation/assignment identities and update revisions fence repeated writes, and DELETE requires the exact assignment identity. Creating a fresh ID constitutes a new intent and defeats identity-based deduplication; never do that as error recovery.

Read team state at `/teams/:creationId/administration`, or retained assignment state at `/teams/:teamId/job-assignments/:assignmentId`. Confirm actor, original intended payload, current revision/assignment and any revocation before another action. A same-ID POST with unchanged normalized original payload and actor can deliberately reconcile: it returns `replayedCreation:true` plus the team's **current** state, or `replayed:true` plus the original assignment and its `revokedAt`. It never resets an edited team or reactivates a revoked assignment. Mismatched IDs/input/actor conflict. Revalidation of current membership/project access can reject a replay after configuration changes; the restricted read remains the reconciliation path.

For PUT, an old revision cannot be applied twice. After an uncertain result, do not advance `expectedRevision` just to make a retry succeed: that creates a new edit. Verify retained change history through an explicitly authorized operational investigation if current revision has moved beyond the response. For DELETE, repeat only the original assignment ID if needed; 404 can mean it is already revoked, so GET that retained record. Never fetch a replacement ID and retry an old revoke against it.

Central audit can retain request events without corresponding mutations, miss completion events, or contain multiple request/reconciliation events. Team change snapshots and assignment actor/time/revocation fields are atomic with their respective business documents, but are not a cross-document audit ledger or historical KPI model. A successful replay appends an explicit reconciliation event; it does not recreate the original completion event or prove its timestamp. Audit outages require operational follow-up, and there is no automatic durable outbox or eventual-delivery guarantee. Retain original response/error/request context and IDs in the incident record; do not edit audit history or delete retained retry fences. Job status across projects also is not a transactional reporting snapshot.

## Repeat startup and browser verification

After a successful build, `node test/team-readiness-browser.cjs` creates its own guarded database and provisions the indexes with auto-indexing disabled. It starts the actual AppModule on loopback port 3107, uses only the labeled owned Redis on 6398, disables conversion/validation/AI workers and external mail/calendar integrations, and keeps generated test credentials in memory. Ports must be free. It inserts clearly labeled, non-sensitive identity/organization/project/job-state test fixtures; it creates **all teams, memberships, manager scopes and job assignments through normal authenticated HTTP administration**, including a real persisted org ADMIN with existing RBAC permission. These job statuses test reporting only; they are not converter success evidence. It creates no leads or revenue.

The harness checks 7/30 totals, real sales roster/unavailable values, empty teams, ordinary-member denial, other-manager denial, cross-organization denial and administrator read/write behavior. It fully closes and restarts AppModule using the same persisted database and reruns the assertions before printing readiness. Runtime IDs and evidence go only under ignored `coverage/team-readiness`; no access tokens or passwords are saved. For the Web 2 dev server, set `VITE_API_BASE_URL=http://127.0.0.1:3107/api/v1` and run Vite on `127.0.0.1:3012`. The helper's `/sign-in` performs normal login and redirects through the existing callback. Do not publish this fixture harness.

Browser checks cover both dashboards after a full page reload, period selection, empty sales roster, zero explicitly assigned jobs, another manager's team URL, and disappearance of previously visible totals after a real API management-scope revocation plus Refresh. The scoped helper POST `/revoke-scope/<runId>` performs that authorized test mutation. The helper POST `/shutdown/<runId>` verifies database ownership, removes only its own generated test database and closes the test application. Stop only the exact Vite process launched for this test. Existing original application containers are not restarted or stopped.

Normal Web 2 sign-out/unauthenticated redirects depend on `VITE_USER_PORTAL_URL` (default `http://localhost:5173`) and a running Web 1 login portal. In the isolated test only Web 2 ran, so sign-out reached an unavailable default login portal. Configure the real development login origin for a complete multi-portal login/logout exercise; this does not change team access rules. Ordinary-member backend denial was verified through normal tokens; no standalone Web 1 login UI was added or claimed tested.

Sales source findings and minimum contracts are recorded separately in `TEAM_PERFORMANCE_SOURCE_CONTRACTS_20261017.md`. The exact external converter dependency block remains in `../engineering/CONVERTER_DEPENDENCY_BLOCKER_20261017.md`. Neither missing data source is replaced with fabricated statistics or generated converter output.
