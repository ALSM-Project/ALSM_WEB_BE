# Teams and performance (ALSMV2-1102 / ALSMV2-1186)

Organization-owned SALES and CONVERSION teams persist explicit members, managers and project/staff assignments. No membership, management scope or historical credit is inferred from global roles, job creators or today's roster. Domain/application public ports keep Mongoose in infrastructure; root AppModule is the composition boundary. No business records are backfilled.

All Team and Sales routes require a normal JWT and its current persisted session. Team administration requires an active organization OWNER/ADMIN plus existing users.manage permission. Appointments must name active members of that organization; projects must be active in that organization and project assignees must be explicit team members. No grants are added automatically. Report access requires explicit manager scope for the exact team/kind.

## Administration and atomic audit

- POST /api/v1/teams: stable 24-hex creationId, expectedRevision:0 and explicit configuration.
- PUT /api/v1/teams/:teamId: replace configuration using the exact revision. Kind is immutable; retained actor-attributed snapshots preserve changes.
- GET /api/v1/teams/:teamId/administration: restricted administrators inspect configuration/revision.
- GET /api/v1/teams?kind=SALES|CONVERSION: only explicitly managed teams in authorized x-organization-id context.
- POST /api/v1/teams/:teamId/job-assignments: stable assignmentId, actual jobId, explicit memberId. Job/project must belong to the organization; member needs both team and project assignment.
- GET /api/v1/teams/:teamId/job-assignments and .../:assignmentId: restricted inspection of active/retained records.
- DELETE /api/v1/teams/:teamId/job-assignments/:jobId?assignmentId=:exactAssignmentId: revoke only that retained assignment. Reassignment requires explicit revocation then a new record. A delayed retry cannot revoke its replacement.

Team/job administration now commits state and requested/outcome audit events in the **same MongoDB transaction**, using snapshot/primary/majority options. Audit failure aborts the change. Standalone MongoDB rejects writes with MONGO_TRANSACTIONS_REQUIRED before business work. This supersedes the separate-write limitation in historical readiness reports. The named partial unique one_active_team_job_assignment index on organizationId/jobId with revokedAt:null is mandatory; missing/mismatched definitions reject assignment writes. Provisioning is explicit and reviewed, never a destructive auto-migration.

Retain original IDs and payloads before sending mutations. Same-ID creation replay returns current state without resetting edits; revoked assignment replay returns its retained record without reactivation. Conflicting reuse rejects. PUT uses revision compare-and-set. No blind retries/new IDs on error: reconcile via scoped administration GET. ATOMIC_MUTATION_ABORTED reports known abort; TEAM_MUTATION_OUTCOME_UNCONFIRMED reports unknown commit result. Fields are in details[0], with retrySafe:false. See [atomic contract](../../../docs/operations/TEAM_ATOMIC_MUTATIONS_20261017.md).

## Sales performance

GET /api/v1/teams/:teamId/performance?days=7|30 uses persisted Lead assignment/customer-conversion history and existing confirmed payments with explicit seller responsibility. The owner-approved assignment-start cohort counts distinct leads assigned to each person during the period. Its numerator counts those same leads converted under that person's assignment by period end. History is immutable; conversion credit survives handover. Team totals deduplicate lead IDs; personal cohorts can overlap. Confirmed revenue uses actual payment amounts/dates and recorded seller, never invoices or inferred credit. Historical contributors remain visible through retained team-owned records. Zero cohorts show 0 leads, 0 VND and Not applicable conversion rate.

Restricted Sales APIs provide the smallest missing workflow: sourced Lead creation, explicit reassignment, actual conversion to an existing active organization customer account with evidence, and actual seller attribution of completed payments. No client amount/date/status overrides, synthetic business records, backfill, closed-opportunity win rate or recognition ledger is introduced. Coverage is recorded explicit assignments; it does not claim historic CRM has been imported. See [approved contracts/workflows](../../../docs/operations/SALES_PERSISTED_WORKFLOW_20261017.md).

## Conversion workload

GET /api/v1/teams/:teamId/workload?days=7|30 uses current explicit assignment, active project, active organization/team member and persisted job status. Server-anchored rolling elapsed UTC days use [start,end), selecting **job.createdAt**. One distinct job counts once despite retries/execution generations. Assigned includes all selected statuses; Processing/Completed/Failed count those exact statuses. Queued, cancelled/dead jobs can be assigned without belonging to those subsets. DEAD is not relabeled FAILED. No historical backlog/event-throughput/capacity claim is made.

Legacy unassigned jobs are excluded; no attribution from createdBy. Removed team/project members are excluded on subsequent reads; retained assignments need explicit administrator revocation. Access/team revision/organization membership/assignment set are rechecked before returning; concurrent configuration changes require refresh. Across-project status reads are not a single transactional snapshot. No source/result paths or another team's job details are returned.

## Operational boundaries

Use transaction-capable MongoDB and provision all current indexes. The --replica-set mode of test/team-dev-indexes.cjs is restricted to this task's labeled loopback disposable replica set and unique owned databases; it cannot target production/arbitrary URIs. Setup checks definition drift, never drops/repairs indexes or deletes conflicting records. See the updated-priorities readiness report for commands/results.

Risk B is suspended: queue, workers, adapter errors and review remain preserved pending genuine artifacts. Current ordinary-session checks are independently safe ALSMV2-1050 prerequisites only. Governance, MFA/replay protection, approval and containment are still required before operational impersonation, which is not activated. Frozen benchmark/security artifacts and protected security branch remain unchanged.
