# ALSMV2-1050 / UC66-05A — P2-01 original idle-window correction

2 November 2026. Backend base: reviewed `90ecddc`. Branch:
`feature/alsmv2-1050-uc66-05a-isolated-integration`. Frontend remains at `6f9be0a`.

## Root cause and correction

Workspace reads and audited CONTEXT_STATUS called context.activity() before awaited
transaction work and the final expiry check. That provisionally advanced lastActivityAt;
checking the mutated entity could validate the pending operation against its own
new idle deadline. The original committed 15-minute window could expire before the
required final guard without the transaction being rejected.

SupportContextEntity.captureActivityWindow() now makes a detached domain snapshot
of the loaded context before any provisional mutation. Its predicate applies the
existing isActive() rules to both that original snapshot and the current entity.
The snapshot preserves the committed activity timestamp, idle/absolute deadlines
and lifecycle without duplicating deadline arithmetic. The current-entity check
retains the existing state and backwards-clock protections.

Both callers capture this predicate immediately after loading the scoped context
and use it at their existing final pre-commit guard, after awaited audit/ownership
and authorization work. Original idle or absolute expiry, including exact equality,
returns the existing 409 SUPPORT_CONTEXT_INACTIVE. The unchanged Core transaction
path aborts before commit, rolling pending revision/activity and required audit
back together. No resource/status success body is returned. Pure recovery observes
the original expired context as unusable and subsequent reads are denied.

A request genuinely committed before the original deadline still renews idle within
the immutable absolute cap. A later request rehydrates the newly committed state and
captures that new window; the guard is neither global nor tied forever to Enter.
No transport contract or Frontend correction is needed.

## Permanent regression evidence

`test/uc66-idle-window.http.integration.spec.ts` uses the existing ownership-checked
disposable MongoDB fixture, real password login, persisted staff/session/RBAC,
actual Support controllers and real Mongo Core transactions/audit. No authority
guard or resource reader is mocked. A timing wrapper delays only after the real
READ/STATUS audit insert in the still-uncommitted transaction.

Ten cases exercise both workspace and status:

- Start at 14:59 and cross the original deadline to 15:01 before the final guard.
- Reach exact original idle-deadline equality after provisional activity.
- Commit at 14:59.500 successfully, then use the newly committed window at minute 16.
- Cross the immutable absolute deadline after earlier committed activity.
- Age only the owned fixture to 14:57, then use real Date.now() and a real five-second
  pending delay across idle expiry. Runtime time is not advanced artificially in these cases.

Every expired-pending case asserts inactive rejection, no success/resource body,
unchanged full persisted context (including revision, lastActivityAt and absolute
expiry), no new durable READ/STATUS audit, pure recovery usable=false, and denial
of a subsequent workspace request without state/audit renewal.

The same test file, SHA-256
`7a13dafec2b763226d2f7b8f3822dd95bd74aa2d9dcd3933b191705039952678`,
ran against the unmodified reviewed implementation before the correction:
**4 PASS / 6 FAIL / 0 SKIP**, all six failures receiving 200 instead of 409.
After correction: **10 PASS / 0 FAIL / 0 SKIP**. Three additional domain tests cover
the detached window, a fresh committed snapshot and current state/clock protections.

The independent external reproduction from
`E:/ALSM/alsmv2-1050-uc66-05a-independent-review-20261102` is retained unchanged.
A copy with only its evidence-output/config paths relocated is rerun against the fix,
so original failed review evidence is not overwritten.

## Verification and preserved boundaries

Commands, counts, logs, original-reproduction facts and changed-file hashes are in
`E:/ALSM/alsmv2-1050-uc66-05a-idle-fix-evidence-20261102/verification-summary.json`.

```powershell
$env:ALSM_UC66_TEST = 'owned-local-only'
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/uc66-idle-window.http.integration.spec.ts
```

The existing UC-66 suites verify actual rollback, recovery/reconciliation, uncertain
commit IDs without callback replay, cross-Organisation/ownership checks, post-commit
DELIVERY_WITHHELD attribution, independent-process Exit/CAS fencing and permitted
completion after HTTP transmission starts. Relevant authentication/RBAC/Organisation
and unchanged UC-67 regressions are included. TypeScript, Backend repository ESLint,
formatting and a fresh Nest build are recorded separately.

The Core unit of work, repository/CAS predicates, shared MongoTransactionRunner,
transaction replay/uncertainty behavior, audit infrastructure and delivery gate are
unchanged. There is no new API call, worker, poll, renewal policy or production
registration. AppModule/worker, legacy impersonation 503, Frontend, UC-67, Gemini and
Sales remain unchanged. Only owned disposable test databases/indexes are used and
cleaned up; no production/shared data is modified.

Ready for Hoang's renewed isolated UC66-05A QA/Security review after the recorded
checks pass. This implementation does not supply independent acceptance or approve
production access. Previously outstanding native-browser/full app-shell E2E,
deployment checks and separate registration/activation approvals remain unchanged.
