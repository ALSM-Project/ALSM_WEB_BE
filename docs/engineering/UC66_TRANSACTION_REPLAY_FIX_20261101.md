# ALSMV2-1050 / UC-66 — P2 transaction replay fix

1 November 2026. Branch: `feature/alsmv2-1050-uc66-01-02-foundation`.
Reviewed base: `dca2da2`. Ready for Hoang's renewed independent QA/Security review;
this handoff does not approve or activate operational impersonation.

## Root cause and source correction

Support delegated to the unchanged shared MongoTransactionRunner, which uses the
installed MongoDB driver **6.20.0** `withTransaction` convenience API. On a commit
error with code 50 (including nested `writeConcernError.code`) and both
`UnknownTransactionCommitResult` and `TransientTransactionError`, that driver skips
its commit-only retry branch, then restarts the entire transaction callback.
The review probe committed real activity before throwing the simulated error:
one request ran two callbacks, persisted two READ audits, advanced revision 1→3
and returned SUCCESS. Injection after the whole convenience wrapper had returned
could not expose this retry path.

Only one production source file changes: the Support unit of work now explicitly
starts a session/transaction, invokes business work at most once, and calls the Core
`commitTransaction` API. There is no convenience callback wrapper or application
retry loop. The driver can retry the same commit command internally, without access
to the business callback. Transaction options remain snapshot reads, majority writes,
primary read preference and 10-second maximum commit time.

Context and audit participants retain the exact same session/connection. The
commit-started flag is set before awaiting commit: every rejected commit, including
an unlabelled error, is conservatively `503 SUPPORT_CONTEXT_OUTCOME_UNCONFIRMED`
with the original context ID, `mutationCommitted: unknown`, `retrySafe: false`.
The adapter never claims rollback or resubmits business work after that outcome.
Definite pre-commit failures abort; duplicate/transient conflicts return 409 with
`mutationCommitted: false`, `retrySafe: false`. Abort/end-session failures are logged
without masking the primary outcome or a confirmed success.

Same-context requests are scheduled sequentially within one adapter instance to
preserve existing activity/Exit behavior without callback retry. This queue is not
a distributed lock. Across independent instances the existing unique index and
revision checks remain authoritative: a known pre-commit write conflict aborts with 409. Neither invocation is replayed. Concurrent Enter retains one successful ACTIVE
context; repeated/concurrent Exit remains terminal with one EXIT audit.

## Exact changed files

Modified:

- `src/modules/support/infrastructure/mongo-support-context.unit-of-work.ts`
- `test/uc66-context.unit-of-work.spec.ts`
- `test/uc66-foundation.mongo.integration.spec.ts`
- `src/modules/support/README.md`
- `docs/engineering/UC66_01_02_IMPLEMENTATION_20261101.md`

Added: `docs/engineering/UC66_TRANSACTION_REPLAY_FIX_20261101.md` (this handoff).
No files deleted. The initial working tree was clean at `dca2da2`; its historical
implementation and the existing backup/cleanup commits remain preserved.

## Fault injection and actual results

The integration helper wraps the actual session's `commitTransaction`, awaits its
real successful Mongo commit, then throws the synthetic error from that method.
Callback and commit invocations are counted separately. This hook is inside the
installed driver's transaction path, rather than after `withTransaction` returns.
Authentication, original sessions, RBAC, Organisation, context and audit persistence
in these HTTP integration tests remain real. These are simulated acknowledgement
failures, not a network partition or server failover campaign.

Six READ faults cover code-50 mixed labels, nested write-concern 50, top-level 64
with nested 50, the code-11000 mixed-label control, unknown-only code 50 and
unlabelled code 50. Additional real cases cover uncertain ENTER/EXIT and a forced
cross-instance pre-commit conflict. The original uncertain-ENTER case now also
injects at commitTransaction. Unit cases cover pre-commit abort/denial, topology and
index checks, session acquisition, cleanup failures and queue release.

| Check                                        | Actual result                                                                                                                                                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New six-fault matrix against unfixed adapter | **5 FAIL, 1 PASS**, 43 unrelated cases skipped by name filter. The code-50 mixed/nested variants reproduced callback replay; the unlabelled error incorrectly claimed an uncommitted outcome.                         |
| Real MongoDB after fix                       | **50 PASS, 0 FAIL, 0 SKIP**: all original 41 cases plus 9 new cases. Passed standalone and again in the full suite.                                                                                                   |
| All five UC-66 suites                        | **126 PASS, 0 FAIL, 0 SKIP**: Mongo 50, unit-of-work 21, services 37, entity 16, production boundary 2.                                                                                                               |
| Whole Jest suite, only UC-66 opt-in enabled  | **1,568 PASS, 13 FAIL, 44 SKIP**, 122 passing suites, 1 failing suite, 1 skipped suite.                                                                                                                               |
| Baseline comparison                          | All 13 Gemini failure names **and details** exactly match the reviewed `dca2da2` evidence. Gemini source/tests unchanged. The 44 legacy integration skips remain gated by their existing test database configuration. |
| TypeScript                                   | PASS: `tsc --noEmit --incremental false`.                                                                                                                                                                             |
| ESLint                                       | PASS: whole existing check, no auto-fix.                                                                                                                                                                              |
| Fresh build                                  | PASS: `npm run build`.                                                                                                                                                                                                |
| Changed-file formatting / diff               | PASS: Prettier limited to the six changed files; `git diff --check`.                                                                                                                                                  |

All six corrected READ fault cases assert one callback, one application commit call,
one durable READ audit, revision **1→2**, unchanged absolute deadline, and an
UNCONFIRMED response with the original ID. Audit assertions retain actor, original
session, Organisation, context and CONTEXT_STATUS operation. Direct scoped read-only
queries reconcile the stored result without submitting another activity mutation.
ENTER and EXIT fault cases similarly retain exactly one transition/audit, with
revisions 1 and 2 respectively. The separate copied review probe independently
records the same one-callback/one-audit/revision-2 outcome for codes 50 and 11000.
The code-11000 control now returns unconfirmed conservatively rather than relying
on a convenience commit retry.

The forced cross-instance conflict runs each callback once, with one commit and
one definite 409 abort, final revision 2 and one READ audit. Existing real validator
rejections still demonstrate atomic context/audit rollback. Unique-index enforcement,
competing Enter/Exit/activity, 30/15-minute expiry, live revocation and Organisation
isolation all pass in the retained Mongo cases.

Relevant full-suite regressions also pass: authentication admission 12, JWT guard 15,
current-session assurance 11, RBAC bootstrap 45, RBAC service 8, Organisation
authorization 9 and repository 7, shared transaction runner 13, unit-of-work outcomes
6, export publication transaction 5, Team service 13, Sales performance 6, UC-48
publication/controller 10/8, UC-67 service/controller 12/3 and disabled impersonation 18. Separate opt-in Team/Sales live-service harnesses were not activated.

## Boundaries and remaining work

The shared MongoTransactionRunner, its Team/Sales/UC-48 callers, UC-67, Gemini,
authentication/RBAC/Organisation implementations, domain lifetime policy, schemas,
indexes, migrations and production entrypoints are unchanged from `dca2da2`.
The four Support handlers remain unregistered; authenticated legacy impersonation
still returns `503 SUPPORT_IMPERSONATION_UNAVAILABLE`. No workspace read facade,
customer JWT/membership/write authority or Ticket/Consent prerequisite is enabled.
The approved absolute 30-minute/idle 15-minute policy is unchanged.

No additional concrete defect was found in this fix's scope. The reviewed limitation
remains: external role/session/account revocation after the last admission check is
not transactionally fenced against an in-flight context commit. Local scheduling
does not resolve it. Before production activation, establish and approve revocation
ordering/in-flight semantics, implement fencing where required, and test across
instances and resource reads. UC66-03 still requires explicit scoped read projections,
bounded operation allowlists and attributed successful-read audit/activity. Renewed
independent QA/Security review and separate activation approval remain required.

## Evidence and data safety

Current evidence: `E:/ALSM/alsmv2-1050-uc66-replay-fix-evidence-20261101`:

- `before-fix-jest.json` / `.log`: failing fault matrix against the old adapter.
- `after-fix-mongo.json` / `.log`: 50 real Mongo cases.
- `full-jest.json` / `.log`, `verification-summary.json`: actual counts, named
  compatibility suites and exact baseline failure comparison.
- `real-mongo-commit-replay.json`, copied `commit-replay-repro.cjs` and its log:
  standalone reviewer probe against the freshly built adapter.
- `typescript.log`, `eslint.log`, `build.log`, `formatting.log`,
  `baseline-protection.json`, `cleanup.json`: static checks, scope and safe cleanup.

The earlier review evidence directory is preserved unchanged. Tests/probe used only
the ownership-checked `mongo:8` disposable replica set `alsmUc66Foundation` at
**127.0.0.1:27128**, container `alsm-uc66-foundation-20261101-mongo`, label
`alsm.owner=uc66-foundation-20261101`, with tmpfs storage and no shared volume.
Every fixture database had a random name and verified ownership marker before drop.
Only admin/config/local remained before the owned container was stopped and
auto-removed. Existing backend/worker/Redis and other containers were left unchanged.
No production database credentials, production data, deployed indexes or migrations
were accessed or modified.
