# Team performance: owner decision proposal

Status: SEVEN EXTENSIONS PROPOSED, NOT APPROVED. The earlier approved minimum Team/KPI model remains controlling. The owner explicitly declined blanket approval on 17 October and requested a comparison. See `TEAM_PERFORMANCE_DECISION_COMPARISON_20261017.md`; do not implement conflicting recommendations below.
Prepared 17 October 2026 for the 18 October demonstration.

## Confirmed intent and persisted gaps

The owner's remediation brief defines ALSMV2-1102 as a Web 2 Sales Manager view of individual lead counts, sales conversion rates, revenue and employee comparisons. ALSMV2-1186 is a Web 2 Team Lead view of team performance and workload. Sales conversion means a lead becoming a customer; it is separate from source-code conversion.

Reports 1 and 2 define the modernization product and delivery process. The available Report 3 describes CRM lead conversion, project progress, organization membership and read-only support. Its extracted text does not contain the two exact team-performance titles. An earlier owner-approved minimum was subsequently recovered from the attachment to the chat “Complete ALSM Jira use cases”; its organization-owned teams, assigned-lead conversion formula and 7/30-day periods override conflicting proposals here. Remaining gaps are persisted sources and specific attribution/boundary choices, not an absence of all business approval.

Source inspected at backend `12070af`:

| Existing source | What it persists | Missing for these tasks |
| --- | --- | --- |
| `src/modules/organizations/infrastructure/organization.schema.ts` | Organization members and organization roles | Internal teams, membership periods, manager/leader assignments |
| `src/modules/projects/infrastructure/project.schema.ts` | Customer organization, project creator, status | Assigned internal team and staff; creator is not assignee |
| `src/modules/conversions/infrastructure/conversion-job.schema.ts` | Organization/project, creator, status, execution generation, attempts, timestamps | Staff/team assignment history and reporting attribution |
| `src/modules/billing/infrastructure/quote-request.schema.ts` | Customer request, requester, organization and approval status | Sales lead owner, lead lifecycle, won event; quote approval is not a sale |
| `src/modules/billing/infrastructure/invoice.schema.ts` | Organization, customer user, amountVnd, billing period, payment status/time | Sales attribution, contract/lead linkage, recognized revenue ledger |
| `src/modules/billing/infrastructure/payment.schema.ts` | Customer payment, optional invoice/subscription, amountVnd/status | Revenue recognition and salesperson ownership |
| `src/modules/rbac/application/rbac-seed.service.ts` | Global role/permission associations, including TEAM_LEAD user management | Exact teams a manager/lead can access; performance permissions |

No lead, contract, team, staff-assignment or revenue-recognition schema/service was found in the active backend. Navigation labels, global roles, invoice customer IDs and organization membership cannot fill these gaps. No operational database was queried.

## Recommended decisions requiring explicit owner approval

1. **Internal scope and membership.** Create a distinct internal reporting scope, separate from customer organizations. Proposed `teams`: `id`, `internalScopeId`, `name`, `kind` (SALES or CONVERSION), `status`. Proposed `team_memberships`: `id`, `internalScopeId`, `teamId`, `userId`, `role` (MEMBER, SALES_MANAGER, TEAM_LEAD), `validFrom`, exclusive `validTo`, `assignedBy`, audit reference. Reject overlapping duplicate membership intervals; allow multiple explicitly assigned teams. Membership creation requires trusted internal personnel eligibility and an authorized manager. Do not seed teams from organization members or global role names.
2. **Customer access.** Proposed `team_project_assignments`: internal scope/team, customer organization/project, staff user, effective interval, assigner and audit reference. Every job assignment must reference a matching active project assignment. Customer reads require both team entitlement and an explicitly approved customer/project assignment. Until a cross-tenant staff authorization contract is approved and implemented, existing customer organization authorization remains required. Reporting permission alone must not grant customer access.
3. **Attribution and history.** Persist effective-dated lead and job assignments, separate from `createdBy`. Store immutable attribution on each lead conversion/revenue event and job execution generation. Record reassignments; do not rewrite past event attribution when staff move. Explicitly reconcile legacy records; unassigned history stays unavailable/unattributed, never inferred from creators. Use a per-user distinct count across overlapping team selections; do not sum duplicate memberships.
4. **Sales events.** Add `sales_leads` with scoped assignment history and append-only `lead_outcome_events` (WON/LOST, effective event time, customer/contract link, attributed user/team). Use one first terminal outcome per sales opportunity; reopening requires a new opportunity identity. Lead count is distinct leads first assigned to the salesperson during the period, with that first assignment's historical team. Sales conversion rate is `100 * distinct WON opportunities / distinct (WON + LOST) opportunities` whose first terminal event occurs in the period. This is a closed-opportunity win rate; display that denominator explicitly. No terminal opportunities means unavailable, not 0%. An open pipeline cohort conversion rate is a different KPI and requires a separate decision.
5. **Revenue.** Add `revenue_recognition_entries`: internal scope, customer organization, invoice/contract/lead link, recognized-at timestamp, signed amount in integer minor currency units, currency, attributed salesperson/team, reversal reference, immutable audit reference and idempotency key. Sum signed recognized entries in the period per salesperson and currency. Do not sum currencies together or infer recognition from invoice issuance, payment receipt, subscription MRR or quote approval. Recommend single salesperson attribution per entry initially; shared credit requires an approved allocation rule. Until the accounting source, policy and salesperson linkage are supplied, revenue remains explicitly unavailable even if other KPIs become available.
6. **Workload.** Add immutable job-generation assignment snapshots (`jobId`, `executionGeneration`, internal scope/team/staff, customer project assignment, assignedAt). Current workload is distinct assigned job IDs with authoritative QUEUED/PROCESSING state at the server's `asOf`, attributed to the current active assignment. Completed/failed counts use distinct `(jobId, executionGeneration)` terminal outcomes within the period and their historical assignment. Automatic attempts are not additional completed jobs; a manual retry is a new generation. Duration, quality averages, trends, capacity estimates and alerts stay unavailable until separately specified. Do not reconstruct historical backlog from current status.
7. **Periods and access.** Use user-selected calendar date ranges in Asia/Bangkok, converted to half-open UTC `[start, end)` query bounds; default to the current calendar month only after approval. Return `periodStart`, `periodEnd`, timezone and server `asOf`. Recommend manual refresh first; add 30-second polling only if approved. Grant proposed `team.performance.read` and `team.workload.read` independently, AND intersect them with persisted active manager/team-lead membership and internal scope. Enforce authorization in authoritative queries before aggregation, pagination or totals. Revoked membership denies subsequent reads; no client-supplied user/team scope is authoritative.

Recommended indexes include `(internalScopeId, teamId, userId, validFrom)`, `(internalScopeId, userId, validFrom, validTo)`, scoped project-assignment lookup, unique `(jobId, executionGeneration)` attribution, and unique recognition idempotency keys. Conditional writes/transactions must prevent assignment overlap and bind audit to assignment changes. These are proposed designs, not installed collections or grants.

## Acceptance examples for later implementation

These are proposed test expectations, not displayed metrics or existing production records:

- Three opportunities close WON, WON, LOST in a period: win rate `2/3 * 100`; an open opportunity is outside the denominator. No closed opportunities: unavailable with a reason.
- Recognized VND entries `+100000`, `+50000`, `-20000`: VND `130000`; an invoice without recognition contributes nothing. Missing recognition integration makes the KPI unavailable, not zero. A different currency is a separate total.
- One job generation takes three automatic attempts: one terminal outcome, three attempts. A manually retried generation may add another terminal outcome; current backlog still counts the job once.
- Adjacent periods include an event exactly at the shared boundary once. Moving a staff member changes current authorization/workload, not historical sale/revenue attribution.
- Foreign internal scope, another team's member, missing permission, expired membership and unassigned customer project all deny access without returning counts or names. Test reassignment and revocation races against authoritative storage.

## Approval record and increments

Owner approval of these seven proposed extensions: **WITHHELD / PENDING INDIVIDUAL REVIEW**. The earlier minimum remains approved. No schema, permissions, aggregation or reporting API is activated by this document. Approval of product decisions does not supply missing accounting records or trusted staff security adapters.

After explicit approval, implement and review separately: (1) persisted scoped teams and membership, (2) assigned leads and sales aggregation, (3) attributed job workload, (4) Web 2 APIs and dashboards, (5) real HTTP, tenant/team isolation, independently calculated KPI and browser-persistence verification. Keep unavailable states for each missing source rather than presenting fabricated zeroes.
