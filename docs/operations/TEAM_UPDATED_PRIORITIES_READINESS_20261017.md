# Team Performance updated-priorities readiness

17 October 2026. Local-only work in the original Backend and Web 2 repositories, starting from `3c78c6ee9ce527d7b6baa957074d4e634310b7b6` and `bd91ba0b17b6f6791b52a3b27d8d008810fdd3fc`. Existing feature branches/history remain intact. No push, PR, merge, deployment, Jira update or production database access occurred. Risk B investigation/integration is suspended by owner; genuine converters will be supplied separately. No converter was run or simulated for these checks.

## Delivered and verified

| Priority | Result |
|---|---|
| ALSMV2-1102 | Restricted real sourced-Lead intake, revision-checked reassignment with immutable history, actual customer-conversion recording and immutable confirmed-payment salesperson responsibility. Approved assignment-start 7/30-day cohort, event-time conversion credit, distinct team totals, historical contributors and VND revenue are integrated into Web 2. Empty denominator is Not applicable. No seeded business data or backfill. |
| Team administration audit | Team creation/edit and job assignment/revocation now share one explicit Mongo transaction with requested/outcome audit. Sales mutations use the same transaction pattern. Audit failure rolls back state/history/audit together. Standalone writes fail closed. Stable IDs/revisions and exact revocation preconditions prevent unsafe blind retries/replacement revocation. Unknown commit results require reconciliation. |
| ALSMV2-1186 | Existing workload semantics verified against persisted status/assignment/project/member scope, 7/30 periods, retries counted once, isolation, zero data, full startup/restart and Web 2 reload. No converter results are represented as genuine execution. |
| ALSMV2-1050 | Team/Sales entry points require the normal JWT's current persisted session, active user and no forced password reset. Revoked/expired/mismatched/missing sessions deny access. This is an ordinary-session prerequisite only; operational impersonation is not activated. |

Read [Sales contracts and approved definitions](SALES_PERSISTED_WORKFLOW_20261017.md), [atomic outcomes and retry contract](TEAM_ATOMIC_MUTATIONS_20261017.md) and [session prerequisite boundary](SAFE_SESSION_PREREQUISITE_20261017.md). Historical readiness reports retain their original results; this report supersedes their missing-Sales-source, separate-audit-write and 33-collection/124-index statements.

## Reviewed development setup

Use a transaction-capable development MongoDB replica set (or reviewed mongos deployment). Standalone MongoDB can still provision indexes/read reports but **cannot execute Team/Sales mutations**. No automatic topology conversion/fallback is supplied. Normal application authorization still requires actual organization membership, existing `users.manage` RBAC permission and explicit team configuration; setup creates no accounts/grants, leads or money.

The checked-in index procedure accepts no arbitrary URI, credentials, environment file or production name. Default mode remains restricted to the previously owned development standalone on loopback 27117. New `--replica-set` mode requires exact container `alsm-priorities-20261017-mongo-rs`, label `alsm.owner=priorities-20261017`, sole binding `127.0.0.1:27127`, and Mongo set name `alsmPriorities`. It accepts only unique `alsm_team_dev_<32 lowercase hex>` databases, creates an ownership marker on an empty database and rejects unowned existing databases. Never relax these guards to target production.

For a **new disposable development container only**, after checking that the exact name/port are absent, the reviewed topology used for verification was:

```powershell
docker run -d --name alsm-priorities-20261017-mongo-rs --label alsm.owner=priorities-20261017 -p 127.0.0.1:27127:27017 mongo:8 --replSet alsmPriorities --bind_ip_all --setParameter enableTestCommands=1
docker exec alsm-priorities-20261017-mongo-rs mongosh --quiet --eval 'rs.initiate({_id:"alsmPriorities",members:[{_id:0,host:"localhost:27017"}]})'
```

Do not rerun `rs.initiate` on an initialized set. If that name already exists, inspect ownership, loopback binding and `hello.setName` first; stop on mismatch. `enableTestCommands` is solely for isolated failure-injection tests, not an operational production setting. The single-node test set verifies transaction semantics, not high availability. Verification later removed only this newly owned container and its disposable databases; original application/worker/Mongo/Redis containers remained untouched.

From `E:\ALSM\ALSM_WEB_BE`, after checking each command's exit code:

```powershell
New-Item -ItemType Directory -Force coverage/updated-priorities | Out-Null
npm run build
node test/team-dev-indexes.cjs --replica-set > coverage/updated-priorities/indexes-first.json
$taskSetup = Get-Content -Raw coverage/updated-priorities/indexes-first.json | ConvertFrom-Json
node test/team-dev-indexes.cjs --replica-set --database $taskSetup.database > coverage/updated-priorities/indexes-second.json
node --test test/team-dev-indexes.test.cjs
```

Reuse the emitted exact database name for an isolated development application at `mongodb://127.0.0.1:27127/<database>?replicaSet=alsmPriorities&directConnection=true`. Calling setup without a name deliberately provisions a new unique database. All **34 current declared collections and 129 actual indexes** were verified twice on both owned topologies. The manifest includes `_id_` fences, the mandatory partial unique `one_active_team_job_assignment`, unique `one_lead_per_source_reference`, Lead period queries and confirmed-payment responsibility/identity indexes. Only compiled counterparts of schemas in the current source tree are loaded, excluding stale build files from other branches.

Setup first checks definition drift across existing collections, then creates absent declared indexes and verifies actual definitions. Same-name/key drift and duplicate active assignments reject provisioning. It never drops/repairs indexes, deletes conflicting business records, calls `syncIndexes`, weakens uniqueness or backfills attribution. Creation failure can leave some correct indexes in place; diagnose explicitly before repeating. Production provisioning/topology requires a separate operator-reviewed procedure; this script cannot perform it.

## Test evidence

Ignored local evidence is under `E:\ALSM\ALSM_WEB_BE\coverage\updated-priorities`. Tests used unique ownership-marked databases, loopback-only owned services and guarded cleanup. No credentials are included in evidence. No frozen evaluation was rerun or rescored.

| Check | Result / evidence |
|---|---|
| Team + Sales real HTTP/Mongo | **31 passed**: `final-http.txt`. Normal login/full AppModule for Sales; Team controllers with actual persisted sessions. Assignment/conversion races, replay/revisions, customer evidence, payment status/date/amount/actual seller, duplicate confirmation rejection, 7/30 boundaries, tenant/team isolation, historical contributors, missing indexes and injected audit rollback. |
| Focused unit + persistence suites | **80 passed**: `final-focused-tests.txt`; plus **13 Team service tests**: `final-team-unit.txt`. Includes actual Mongo Lead CAS/history and audit rollback, approved formulas, periods, workload, transaction outcomes, current-session checks and existing review/DTO behavior. Total distinct backend Jest cases in this verification: **124**. |
| Index setup regression | **2 passed**: `final-indexes.txt`. Both topologies, identical repeated manifest, definition drift and duplicate rejection, explicit fixture repair/recovery. |
| Backend lint/build/types | Passed: `final-lint.txt`, `final-build.txt`, `final-types.txt`. |
| Web 2 | **53 tests passed**, lint/build passed: `web2-tests.txt`, `web2-lint.txt`, `web2-build.txt`. Includes cohort labels, server-computed distinct totals, VND/percent formatting, zero denominator, retained historical credit and existing isolation/cache/error cases. Vite emits its existing future config-loader warning. |
| Fresh startup + restart | `browser/startup-initial.json`, `browser/startup-restarted.json`, `browser/startup-indexes.json`. Full AppModule starts twice against persisted owned fixtures, workers/AI disabled. Real restricted APIs configure teams, managers, project/staff/job assignments and Sales business events. |
| Browser reload/access | `browser/browser-verification.json`, AX snapshots, `sales-seven.png`, `workload-thirty.png`. Both full reloads, 7/30 filters, zero data, another manager's team denial, ordinary member denial, refreshed revoked management scope removes prior data. |

Opt-in HTTP command: set `ALSM_TEAM_HTTP_TEST=owned-local-only` and `ALSM_SALES_HTTP_TEST=owned-local-only`, then run Jest with `--runInBand --testRegex 'test/(teams-http|sales-http)\.integration-test\.ts$'`. The persistence suite uses the Sales opt-in. Tests independently check exact container label/loopback ownership. Browser harness is `node test/team-readiness-browser.cjs`; it writes runtime metadata and exposes only loopback helper/API ports 3108/3107. Web 2 is started from its original checkout with `VITE_API_BASE_URL=http://127.0.0.1:3107/api/v1` on loopback3012. All records visible in screenshots are explicitly **TEST FIXTURE**, not imported business, bank receipts or genuine converter results. Fixture confirmed-payment amounts demonstrate reporting only. The existing logout redirect points to Web 1 at localhost:5173, which was absent from the isolated harness; ordinary member sign-in used the normal login helper and passed both dashboard denial checks. No unrelated logout behavior was changed.

## Remaining operational boundaries

- Real operators must provision the reviewed transaction topology/indexes and record genuine Leads/conversions/payment responsibility. The feature does not invent historical records. Read-source coverage is explicit, not total historical CRM coverage. Payment confirmation/onboarding remain existing workflows.
- Unknown commit results still require scoped reconciliation by original identity. Business/audit atomicity does not make network commit acknowledgement infallible. Clients must retain stable IDs and disable blind mutation retries.
- Report reads do not claim a single global historical snapshot; Sales uses immutable attribution plus current confirmed payment status, and workload uses current assignments/status of the created-job cohort.
- ALSMV2-1050 governance, protected sessions, MFA/replay proofs, approval consumption and containment remain unverified/unactivated. The protected security branch and evaluation artifacts remain frozen.
- Risk B remains suspended pending the genuine team-provided artifacts. Existing dependency errors/contracts are preserved; no fake success, substitute engine or new search/download was introduced.

## Local commits and final record

Backend implementation commits: `fc22096eaa0f5070b1658099e95cbe334ebbcb4e` (atomic audit), `3f44dae356951c08799d7aeeda1e0433dc21c987` (current session), `7bacf19b17961cccb2569b3038e95b428a276a22` (persisted Sales sources), `fe264db08e5b335733304e0887c10c9b25cc5e4c` (authorized workflows/approved reporting). The local setup/harness/report commit follows those commits. Web 2 implementation/final HEAD: `d0ed77ce6e4472a394df40ab0faec0a740992d34`.

Resolved final Backend HEAD, all new commit SHAs, clean statuses, prior commit ancestry, frozen hashes/timestamps, protected security ref and owned-service cleanup results are captured after this documentation commit in `coverage/updated-priorities/final-manifest.json` and `final-integrity.json`. Stop locally; no remote operation is authorized.
