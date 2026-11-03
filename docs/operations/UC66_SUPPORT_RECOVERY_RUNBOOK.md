# UC-66 Support View recovery

UC66-05B, 2 November 2026. Applies to the accepted UC66-05A contracts, including the original-idle-window correction. Production registration and activation are separately gated. This runbook grants no production database or role-management access.

## Rules and pure inspection

Use the original staff identity and persisted login session. Preserve the Organisation ID and any original contextId/operationId returned by the error. Do not record access/refresh tokens, passwords or customer payloads in tickets, logs or screenshots.

The pure endpoint is:

```text
GET /api/v1/support/organizations/{organizationId}/recovery
GET /api/v1/support/organizations/{organizationId}/recovery?contextId={originalContextId}
GET /api/v1/support/organizations/{organizationId}/recovery?contextId={originalContextId}&operationId={originalOperationId}
```

An operationId requires its contextId. Use the authenticated application or an approved client; responses are no-store. Inspection never refreshes idle, appends audit, repairs lifecycle or replays work. Do not substitute audited context-status GET for pure recovery.

`FOUND` means own-session context metadata was found. `usable` separately determines whether it may be resumed now. `operation.state=COMMITTED` requires exact durable actor/session/Organisation/context/operation audit evidence; it does not prove delivery of a resource response. Missing or ambiguous evidence remains `UNRESOLVED`, not a failed-operation assertion. No-reference discovery cannot prove the outcome of an original operation.

## Staff actions

| Situation                  | Required action and expected result                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tab closed before Exit     | With the same valid original login, search the exact Organisation and choose Recover, or supply its exact ID in the recovery panel. Inspect first. Explicitly resume only a usable context, or explicitly Exit it if leaving. Closing the tab is not proof of Exit.                                                                   |
| Reload with active context | The workspace and references are volatile. Discover/inspect the original own-session context, then explicitly select Resume recovered context. Recovery/resume itself does not load resources or extend deadlines; Load Projects is a new explicit authorized activity.                                                               |
| Enter acknowledgement lost | Retain the error's original IDs. Do not press Enter again to guess success. Inspect the exact operation. If COMMITTED and usable, explicitly resume; if terminal/expired, do not resume. If UNRESOLVED, retain references and escalate rather than automatically Entering again.                                                      |
| Exit acknowledgement lost  | Clear customer data while the result is uncertain. Inspect original IDs. COMMITTED plus terminal context confirms the exit; UNRESOLVED stays uncertain. Do not automatically replay Exit or claim success. A new explicit operation requires the uncertainty to be reviewed/resolved.                                                 |
| Workspace UNCONFIRMED      | No resource success body is available. Preserve original contextId/operationId and inspect exact durable evidence. COMMITTED means activity/audit committed; it does not prove delivery. Never replay the uncertain activity automatically. Any later Load is a fresh explicit request after current authorization/usability checks.  |
| DELIVERY_WITHHELD          | Treat activityCommitted=true and retrySafe=false accurately: earlier activity/audit committed, protected data was withheld. Clear customer data and preserve original IDs. Do not label the activity rolled back. Inspect only while still authorized; do not restore stale UI or retry automatically.                                |
| Staff session revoked      | Close access and clear protected UI. Ordinary reauthentication may be necessary, but a new login cannot inspect/resume a context bound to the old original session. Do not copy a context into a new session, mint a customer JWT or grant customer membership. Role/account loss requires normal authorized personnel/RBAC handling. |
| Idle or absolute expiry    | Equality is expired. Do not resume or refresh through recovery. A stored ACTIVE row can be logically expired; never edit timestamps/state to revive it. A fresh explicit Enter is possible only after the outcome is known and current staff/Organisation admission succeeds.                                                         |

## Operator triage

1. Record error code, UTC timestamp, Organisation/context/operation IDs, request correlation ID if available, instance and commit. Record whether the response explicitly says mutationCommitted=false, unknown or activityCommitted=true. Keep these distinctions.
2. Use pure recovery under the original authorized session. Repeated pure inspection is not business replay. Stop when authority is denied; do not bypass actor/session/Organisation binding. Missing evidence or a failed inspection remains unresolved.
3. Correlate exact original IDs with authorized durable audit investigation. Do not infer success from approximate timestamps, a different operation or another staff login. Never expose raw audit/customer records through the recovery endpoint.
4. During audit/database/index failures, keep admission closed. Restore the infrastructure through its approved procedures, then inspect the original outcome. Do not disable audit, relax indexes, use a nontransactional fallback or replay callbacks to clear an incident.
5. Escalate unresolved outcomes with the retained references. Do not directly update contexts, delete audit or perform customer mutations as a recovery shortcut. No Ticket/Consent prerequisite is introduced.

## Retention and handover

The current Support Context schema deliberately has no TTL. Terminal and logically expired rows are retained for reconciliation/audit; logical 30-minute absolute / 15-minute idle expiry is independent of physical retention. The audit schema also declares no TTL. This task creates no purge, migration or production index.

Before activation, operations must record approved context/audit retention periods, archival/legal-hold access, backup/restore coverage and an audit investigation owner. Preserve enough linked context and exact audit evidence for the approved recovery period. Do not choose an arbitrary TTL or automatically delete superseded Ticket/Consent history. Existing staff-role provisioning and session retention stay governed by their owning modules.

Validate this runbook with the native checklist and intended-deployment failure/restart drills before operational activation. Local tmpfs/single-member Mongo evidence does not establish production disk durability or failover.
