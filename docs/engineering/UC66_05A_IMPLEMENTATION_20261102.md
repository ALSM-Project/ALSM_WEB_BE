# ALSMV2-1050 / UC66-05A — isolated integration, recovery and revocation

2 November 2026. Branch: `feature/alsmv2-1050-uc66-05a-isolated-integration`.
Backend base `ba9f91e` includes replay correction `a14c6de`; Frontend base `e1e54ec`
includes the accepted Project pagination correction. The approved Technical Owner
bounded in-flight decision is implemented, not reopened. No Ticket, Consent or
independent customer approval prerequisite is introduced.

## Registration and authentication

AppModule, worker registrations, shared MongoTransactionRunner, UC-67, Gemini and
Sales are unchanged. SupportFoundationModule adds a recovery controller but remains
unregistered in production. Authenticated legacy impersonation remains 503
SUPPORT_IMPERSONATION_UNAVAILABLE. No customer JWT, identity substitution, OWNER
authority or Organisation membership is created.

`test/uc66-integration/test-app.ts` owns registration. Its login/profile wrapper
delegates to real AuthService password verification, persisted session creation,
token issuance, profile projection and EffectivePermissionsService. Actual Support
controllers use real JWT/current-session guards and persisted INTERNAL_SUPPORT and
permission evidence. No guard/authority mock or override is used. This is a minimal
test-owned application, not the complete production AppModule.

Only `ALSM_UC66_TEST=owned-local-only` is accepted. The harness checks the fixed
loopback Mongo container name, ownership label, identity, port and replica set.
Every run creates a fresh `alsm_uc66_05a_<32 hex>` database, refuses existing data,
and creates an ownership marker checked before index provisioning, clearing and
dropping. No arbitrary URI or .env database credentials are accepted. The context
unique index and audit evidence lookup index are provisioned only there. Real
snapshot transactions and majority commits use an owned single-member Mongo 8
replica set; this is not a multi-member failover campaign.

## Pure recovery contract

`GET /api/v1/support/organizations/:organizationId/recovery`

Optional canonical UUID-v4 query fields: contextId, operationId. OperationId requires
contextId; unknown fields reject. Cache-Control is no-store. Response fields:

| Field        | Meaning                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------- |
| outcome      | FOUND or UNRESOLVED; absence never proves rollback.                                       |
| context      | Existing safe context DTO (same timestamps/deadlines as status), or null.                 |
| organization | Existing safe id/name/type/status projection, or null if unavailable.                     |
| usable       | Current binding, context lifetime and eligible Organisation allow explicit resume.        |
| operation    | Null without operationId; otherwise `{id,state:COMMITTED\|UNRESOLVED,kind:string\|null}`. |
| observedAt   | Server inspection time for conservative remaining-deadline calculation.                   |

Without contextId, discovery prefers the unique stored ACTIVE context, then the
latest terminal context for the exact current actor/original-session/Organisation.
Equal terminal creation timestamps are unresolved rather than ordered by random
UUID; an active context cannot be hidden by historical timestamp ties.
With contextId, absent/foreign contexts
return 404. Missing discovery evidence returns UNRESOLVED and null context. Exact
operation evidence is COMMITTED only when one durable allowlisted Support audit
matches actor, original session, Organisation, contextId and operationId. Missing
or ambiguous evidence remains UNRESOLVED. No raw audit record or customer resource
is returned. Another authorized staff actor, another login of the same actor,
revoked authority or changed session/grant binding cannot inspect the old context.

Enter, Exit and audited status now generate operation IDs, persist them in their
existing transactional audit, and include original IDs on uncertain commit errors.
Workspace operation identities are preserved. Historical missing IDs remain
unresolved. Reconciliation makes primary majority reads only: no idle refresh,
audit append, context repair, lifecycle transition, retry or business replay.
The persisted context is rechecked after evidence lookup to observe another
instance's Exit. Terminal/logically expired contexts are unusable without silently
rewriting stored lifecycle. Status GET remains audited activity and is not used.

## Approved bounded in-flight ordering

The mutation linearization point is successful majority Core transaction commit
of context revision/activity and required audit. A business callback runs once.
Activity and Exit contend on the same ACTIVE context row and expected revision.
A stale writer aborts through MongoDB conflict/CAS even across separate Node
processes. Absolute/idle equality denies activity; the final pre-commit expiry and
authority checks follow fresh ownership validation.

The original projection uses the context transaction snapshot. Before commit, an
independent read-only snapshot validates current parent/resource ownership and
Finding run/job links using the owning modules' public projection readers. Current
Organisation eligibility, authority and expiry are checked again. Observed loss
aborts pending activity/audit. This adds database validation, not extra HTTP calls.

Before protected data delivery, the service repeats fresh ownership, Organisation
eligibility and live account/session/role/permission checks, then reads the exact
persisted context with primary majority concern and checks binding/expiry. A
post-commit denial returns SUPPORT_WORKSPACE_DELIVERY_WITHHELD with original
contextId/operationId, activityCommitted=true and retrySafe=false, without resource
data. Earlier committed activity/audit remains accurately recorded.

The delivery boundary is completion of these final observations immediately before
returning the buffered DTO to the HTTP controller. These are bounded observations,
not an atomic security epoch covering all independent RBAC/account/resource
mutations. A change after its last observation can race transmission; the remaining
ownership-check/transmission gap follows the approved bounded policy. A response
whose transmission has started may complete. Subsequent requests re-read live
stores and deny. Transmitted bytes cannot be recalled. Frontend timers and local
queues do not constitute distributed fencing.

The real HTTP suite uses independent Nest applications/connections for all eleven
revocation/lifecycle cases before and after commit. A separate suite starts two
actual Node OS processes: both deny persisted role loss, and process A's paused
projection cannot commit after process B's HTTP Exit. A split real HTTP response
also verifies allowed completion after its first bytes were transmitted, with
committed audit retained.

## Test-only configuration

Provision the checked disposable container only when absent; no shared volumes:

```powershell
docker run -d --name alsm-uc66-foundation-20261101-mongo --label alsm.owner=uc66-foundation-20261101 -p 127.0.0.1:27128:27017 --tmpfs /data/db:rw,noexec,nosuid,size=1g mongo:8 --replSet alsmUc66Foundation --bind_ip_all
docker exec alsm-uc66-foundation-20261101-mongo mongosh --quiet --eval 'rs.initiate({_id:"alsmUc66Foundation",members:[{_id:0,host:"127.0.0.1:27017"}]})'
$env:ALSM_UC66_TEST = 'owned-local-only'
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/uc66-foundation.mongo.integration.spec.ts test/uc66-05a.http.integration.spec.ts test/uc66-05a.process.integration.spec.ts
```

For the development UI:

```powershell
$env:ALSM_UC66_TEST = 'owned-local-only'
node -r ts-node/register test/uc66-integration/serve.ts
```

It binds only 127.0.0.1:3016 and 3018. Its own stdin accepts lose-next-commit,
revoke-role and stop; there is no HTTP test-control mutation endpoint. Stop closes
both apps and drops its verified disposable database. Synthetic fixture credentials
are uc66-05a@example.invalid / Owned-UC66-05A-Only!, valid only in that owned database.
The Frontend companion handoff documents dev serve and the test-only login entry.

## Evidence, review and remaining activation requirements

Exact results and logs: `E:/ALSM/alsmv2-1050-uc66-05a-evidence-20261102/verification-summary.json`.
Categories distinguish unit/controller regressions, real Mongo/authenticated HTTP,
separate Node processes, and actual Frontend-to-Backend HTTP flows in jsdom.
Lost acknowledgements are injected after the real driver commit, not simulated by
mocked success or a callback retry. This is not a packet-level fault campaign.

Native Chrome verification was not executed: Computer Use stopped before a UI action
because it could not determine the current URL confidently enough to enforce
policy. No native-browser or complete whole-repository test-suite pass is claimed.

Ready for Hoang's independent isolated UC66-05A QA/Security review. UC66-05B still
requires successful independent security verification, native-browser/full app-shell
E2E, separately approved production registration and HTTP integration, deployment
transaction/index/audit/retention/staff-provisioning checks, multi-instance deployment
and failure validation, operational recovery procedures and separate activation
approval. This delivery approves no production registration or operational activation.
