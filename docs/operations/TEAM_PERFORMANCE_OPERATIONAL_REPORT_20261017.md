# Team Performance operational-readiness result

17 October 2026. **Locally verified with remaining data/tool/audit limitations. STOP before publication.** Work was restricted to the original `E:\ALSM\ALSM_WEB_BE` and `E:\ALSM\ALSM_WEB_FE_2` checkouts. No UI expansion, new worktree, push, PR, merge, deployment, Jira update, production database connection or frozen evaluation/security modification occurred.

Starting Backend HEAD: `127c806665d19e2e6f845fdad7c2e6e032ea57d3`, branch `feature/demo-20261018-integrated-be`. Web 2 HEAD remains `bd91ba0b17b6f6791b52a3b27d8d008810fdd3fc`, branch `feature/demo-20261018-integrated-fe2`; no tracked frontend change was needed. The six feature commits, all preceding remediation commits and all 11 original demo commits remain ancestors. Full final local commit SHAs/HEADs and changed files are emitted in `E:\ALSM\ALSM_WEB_BE\coverage\team-readiness\final-manifest.json` after the documentation commits.

## Results against the requested checks

1. **Index provisioning verified.** Fresh guarded development MongoDB, `autoIndex:false`: **33 current declared collections, 124 indexes**, including `one_active_team_job_assignment` with the exact compound key, uniqueness and partial predicate. The second setup run produced the same manifest. Tests prove drift and duplicate-data rejection without implicit deletion, backfill or unsafe index replacement. Review caught stale compiled schemas from an earlier branch; the script now loads only compiled counterparts of schemas present in this source checkout. No production setup was attempted. See `TEAM_PERFORMANCE_READINESS_20261017.md` for exact commands and guards.
2. **Restricted administration verified through HTTP.** Normal login and persisted Organization ADMIN plus existing `users.manage` configured SALES and CONVERSION teams, explicit members/managers, project/staff scope and actual persisted job assignments. OWNER behavior and permission denial were covered by real HTTP/Mongo tests. Ordinary organization members cannot administer; reporting scope is not implicitly granted by org membership/global role. Exact canonical project identity remains enforced. No production grants or automatically inferred memberships were added.
3. **Startup/persistence/dashboard verification passed.** The actual AppModule was started, configured through APIs, fully closed, and restarted against the same persisted development database. The final run performed 32 asserted HTTP operations across setup and both startups. Both reports retained authorization and expected state. Browser verification exercised both dashboards after page reload, 7/30-day selection, empty Sales roster, zero explicit job cohort, another manager's team URL, and Refresh after API revocation of manager scope. Previous totals disappeared after revocation. The displayed job statuses were labeled development reporting fixtures, not executed converter results, CRM records or revenue. No hardcoded dashboard KPI was introduced.
4. **Unsafe retries fenced; central audit limitation remains explicit.** Team POST now requires stable `creationId`; assignment POST requires stable `assignmentId`; DELETE requires exact `assignmentId` query precondition. Permanent Mongo `_id` identity fences prevent same-ID duplicate creation and assignment resurrection. Reused IDs with different input/actor conflict. Updates retain revision compare-and-set. Restricted GET can reconcile retained revoked assignments. Known persistence followed by audit failure and unknown driver outcome return distinct codes with `retrySafe:false` in `details[0]`, preserved through the real API exception filter. Regression tests inject post-save, post-assignment and post-revocation audit failures. A delayed old DELETE cannot revoke a replacement. **Business state and central audit are still separate writes**; no transaction, automatic outbox, historical audit repair or eventual audit delivery is claimed.
5. **ALSMV2-1102 source gap confirmed.** No Lead/lead-conversion/contract lifecycle source is present in either inspected repository. Quote requests are not salesperson lead assignments. Billing has payment COMPLETED/paidAt and invoice PAID/paidAt evidence but customer/payer IDs do not identify credited salespeople. The smallest legitimate source contracts and unresolved attribution/time facts are recorded in `TEAM_PERFORMANCE_SOURCE_CONTRACTS_20261017.md`. No new CRM/revenue schema or data was created. Lead Count, Conversion Rate and Revenue Generated remain unavailable with explicit reasons; the approved formulas were preserved.
6. **Risk B remains dependency blocked.** Both real adapters were probed and returned the unchanged missing JAR/tool-directory messages, before tool execution or artifact writes. `../engineering/CONVERTER_DEPENDENCY_BLOCKER_20261017.md` records exact errors, required `akaBatch-1.0.jar`, `bms2react.py`, `dspf2react.py`, full ancillary distributions, provenance/license/runtime/output requirements. No fake converter or success fallback was activated. This documentation change is committed separately from team fixes.

## Validation evidence

All paths below are under ignored `E:\ALSM\ALSM_WEB_BE\coverage\team-readiness` and remain local:

| Check | Result | Evidence |
| --- | --- | --- |
| Focused Backend regressions | 154 tests, 18 suites passed | `focused-results.json`, `focused-tests.txt` |
| Team real HTTP/JWT/Mongo/RBAC with real API error filter | 13 tests passed | `http-tests.txt` |
| Guarded index setup | 1 integration test with repeated setup, drift/duplicate rejection and guarded cleanup passed | `index-tests.txt`, `indexes-first.json`, `indexes-second.json` |
| Full AppModule fresh startup and persisted restart | 32 asserted HTTP operations passed | `startup-initial.json`, `startup-restarted.json`, `startup-indexes.json`, `browser-server-final.txt` |
| Actual worker Mongo/Redis regression | 6 tests passed | `worker-tests.txt` |
| Conversion HTTP/JWT/Mongo/Redis/storage regression | 8 checks passed; seeded completed-result fixtures explicitly labeled | `conversion-http.txt` |
| Web 2 | All 51 tests, 9 files passed | `frontend-tests.txt` |
| Backend and Web 2 build/lint | Passed | `build.txt`, `lint.txt`, `frontend-build.txt`, `frontend-lint.txt` |
| Missing real converter dependencies | Both expected original exceptions reproduced | `converter-errors.jsonl` |
| Browser reload/period/empty/scope | Verified in owned persisted fixture session | `sales-reload.txt`, `sales-empty.txt`, `workload-reload.txt`, `workload30.txt`, `workload-zero.txt`, `other-team-denied.txt`, `scope-revoked.txt`; corresponding PNGs |

For workload, Assigned/Processing/Completed/Failed were respectively **4/1/1/1** for 7 days and **5/1/2/1** for 30 days. The zero-data team returned **0/0/0/0** despite another team's assigned work in the same organization. Sales returned the actual persisted staff roster, all three unavailable metric objects, and an explicit empty roster for the empty Sales team. Source absence was never represented as measured zero revenue or leads.

The browser screenshots/AX records are from disposable run `084466806a634dd9a22e8e7ba2ad2bb7`; the final source-restricted index/startup verification used `af51e097ef1b471fae1cbffe3dd0c43c`. Different record IDs are expected. Early fixture-label encoding was corrected in the committed harness; no application UI change was involved. Normal sign-out reached the default Web 1 login URL on port 5173, where no login portal was running in this isolated exercise. Configure `VITE_USER_PORTAL_URL` and the existing Web 1 login portal for a complete multi-portal login/logout test. Ordinary-member/cross-org backend denial was verified with normal tokens. This report does not claim a separate Web 1 login UI test.

The focused suite is not an all-tests claim. Previously established unrelated provider-timing suite failures were not rewritten, and no live AI/evaluation run was executed. Worker/HTTP success fixtures validate application plumbing, not successful real external conversion.

## Setup requirements and remaining blockers

- Provision and verify the declared indexes with the guarded procedure before relying on assignments. This local tool deliberately cannot provision production. Real environment index rollout remains a separately controlled operation.
- Supply active real organization accounts, the existing administration permission, explicit team/member/manager/project relationships and real persisted jobs through authorized existing flows. Team membership is not organization membership. Retain creation/assignment IDs and exact mutation payloads before sending; disable blind retries and follow the incident reconciliation procedure. Do not delete retained records to clear retry fences.
- Configure the intended API origin including `/api/v1`, user-login portal origin and normal authentication. The fixture helper is local test tooling, never a deployment component.
- Central completion audit is non-atomic. Missing completion events require investigation using persisted state and retained attribution; replay does not reconstruct historical audit certainty. Separate project status reads also are not one transactional snapshot.
- Three sales KPI sources and verified reassignment/conversion/revenue attribution facts remain absent. Existing billing confirmation alone is insufficient; do not fabricate CRM data, substitute a win-rate formula or activate an unapproved recognition-ledger/historical model.
- Real conversion remains blocked on authentic tool bundles and verified worker runtimes/shared storage. Both original dependency errors remain observable. No real converter success was verified.

## Local commits and integrity

The retry fix is `28efcd548551003a5699433f0c9a60bce40a5cb1`; guarded setup is `4675d709f2089f068ddd46a9ab4c16c3d8b75f33`. Startup/source-findings and Risk B documentation are separate subsequent focused local commits; their final full SHAs are in `final-manifest.json` and the final user report. Every commit used explicitly scoped staging and `git diff --cached --check`.

Integrity verification checks all 93 frozen evaluation file hashes/timestamps, three checkpoints, 78 protected security archive hashes, protected AUTH-H1 branch `50f14b7106ac2f1dbba1fddf99069bb1e446e3c9`, prior commit ancestry/unrelated refs and 32 recovery source hashes/timestamps. All matched. Phase 6.3F remains **READY, 14/40**, unrecalculated. See `prefinal-integrity.json` and `final-integrity.json`.

Owned verification API/Vite processes were stopped, and generated verification databases were removed only after exact name/container/ownership checks. Original application containers were not restarted or stopped. Setup scripts do not delete data; deliberate fixture cleanup belongs only to their guarded tests/harness. Cleanup evidence is `cleanup.json`.

**ALSM TEAM PERFORMANCE PARTIALLY COMPLETE — DATA DEPENDENCIES REMAIN. LOCAL COMMITS ONLY. STOP LOCALLY.**
