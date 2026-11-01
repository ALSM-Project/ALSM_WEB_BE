# ALSMV2-1050 / UC-66 superseded implementation cleanup

1 November 2026. Repository: `E:/ALSM/ALSM_WEB_BE`.

The superseded S1 TC A-D and E1-E5B Ticket/Consent architecture has been removed.
No Support View or new UC-66 route is implemented. Authenticated impersonation
continues to return `503 SUPPORT_IMPERSONATION_UNAVAILABLE`.

The Technical Owner's accepted flow is: `internal_support` searches by Organisation
name/email, selects Enter Organisation, reads scoped Projects, Screens, Programs,
Findings and Logs with all access audited, then exits to the original context.
Support Tickets, Customer Consent, independent customer representative verification
and internal approval are not prerequisites for this UC-66 flow.

## Git protection and pre-existing work

- Original branch: `fix/auth-verification-proof-and-lock-enforcement-p0-p1`.
- Original HEAD: `6b72ecdaada3b15c4833254dc29789c15c10e7fa`.
- Backup branch: `backup/alsmv2-1050-ticket-consent-before-cleanup-20261101`.
- Backup commit: `3237f9f6163ce2fa071502b3edbed8e82d05b994`.
- Cleanup branch: `cleanup/alsmv2-1050-remove-superseded-ticket-consent`, created from the clean backup commit.

The backup commit captures all initially modified/untracked, non-ignored work,
including the entire previously uncommitted implementation and its fixtures.
The original branch pointer is unchanged. No reset, Git clean, stash or history
rewrite was used. Original status, tracked patch and raw file hashes are saved
under `E:/ALSM/alsmv2-1050-cleanup-evidence-20261101`.

The initially modified AppModule and RbacModule contained only the obsolete
feature's registrations. Their final contents match original HEAD `6b72ecd`.
These pre-existing shared files remain byte-for-byte unchanged from the initial
working tree, including the initially untracked Team/Sales regression test:

- `src/shared/database/mongo-transaction-runner.ts`
- `test/mongo-transaction-runner.spec.ts`
- `test/mongo-export-publication.unit-of-work.spec.ts`
- `test/mongo-unit-of-work-outcomes.spec.ts`

Gemini implementation and latency tests were not modified. Package manifests and
lockfiles were not modified. No whole-repository formatting was run.

## Dependency inventory and deletion decision

TypeScript import resolution was applied to all tracked TS/JS/CJS/MJS files before
deletion. Exactly two files outside the deletion set imported its components:
`src/app.module.ts` and `src/modules/rbac/rbac.module.ts`. Their obsolete imports,
registrations, injection tokens and export were removed. No independent consumer
of a deleted file/provider was found. Text searches also covered source, tests,
scripts, evaluation and documentation for dynamic/string references.

GitNexus's existing index did not contain the previously untracked implementation;
its missing-symbol results were not treated as proof of isolation. The direct
TypeScript dependency inventory, consumers, shared dependency paths and edges are
saved in `dependency-inventory.json` in the evidence directory.

| Superseded slice | Removed components |
| --- | --- |
| A - Ticket Consent Boundary | Boundary contracts, denial policy and dedicated policy tests. |
| B - Support Ticket domain/application | Ticket entity/types, repository/listing/access ports, create/get/list/transition services and tests. |
| C - Ticket MongoDB persistence | Schema/index definition, snapshot mapper, Mongo repository, atomicity/race/persistence fixtures and tests. |
| D - Owner-only APIs | Ticket controller/DTOs/presenter/guard, Organisation Owner adapter, dedicated internal-support-assignment port/reader, AppModule/RbacModule registrations and HTTP tests. |
| E1-E4 - Customer Consent | Entity/types/validation/repository, context/authority/write/request/status/transition application code, Mongo schema/mapper/repository, isolated controller/DTOs/presenter, verification boundary, tests and fixtures. |
| E5A-E5B - Verification and durable intent | Verification contracts/validation/orchestration, synthetic registration/consumption ports, schemas/index constants/mapper/Mongo consumption adapter, fixtures and tests. |

The seven dedicated technical documents within `src/modules/support` were removed.
The historical security blocker is preserved with a prominent UC-66 supersession
notice; its older approval/verification proposals are not current UC-66 requirements.

## Exact files removed (80)

Paths below are relative to the repository root. This list matches the Git deletion
set against backup commit `3237f9f`.

- `src/modules/organizations/application/owner-support-ticket-access.service.ts`
- `src/modules/rbac/domain/internal-support-assignment.port.ts`
- `src/modules/rbac/infrastructure/mongo-internal-support-assignment.reader.ts`
- `src/modules/support/API.md`
- `src/modules/support/CONSENT_INTENT_PERSISTENCE.md`
- `src/modules/support/CUSTOMER_CONSENT.md`
- `src/modules/support/CUSTOMER_CONSENT_API.md`
- `src/modules/support/CUSTOMER_CONSENT_PERSISTENCE.md`
- `src/modules/support/CUSTOMER_CONSENT_VERIFICATION.md`
- `src/modules/support/README.md`
- `src/modules/support/application/consent-intent-persistence.port.ts`
- `src/modules/support/application/consent-verification-foundation.port.ts`
- `src/modules/support/application/consent-verification-foundation.validation.ts`
- `src/modules/support/application/create-support-ticket.service.ts`
- `src/modules/support/application/customer-consent-authority.port.ts`
- `src/modules/support/application/customer-consent-context.service.ts`
- `src/modules/support/application/customer-consent-write.ts`
- `src/modules/support/application/get-customer-consent-status.service.ts`
- `src/modules/support/application/get-support-ticket.service.ts`
- `src/modules/support/application/list-support-tickets.service.ts`
- `src/modules/support/application/request-customer-consent.service.ts`
- `src/modules/support/application/support-ticket-access.port.ts`
- `src/modules/support/application/transition-customer-consent.service.ts`
- `src/modules/support/application/transition-support-ticket.service.ts`
- `src/modules/support/application/verify-consent-action-foundation.service.ts`
- `src/modules/support/domain/customer-consent.entity.ts`
- `src/modules/support/domain/customer-consent.repository.ts`
- `src/modules/support/domain/customer-consent.types.ts`
- `src/modules/support/domain/customer-consent.validation.ts`
- `src/modules/support/domain/support-ticket-listing.port.ts`
- `src/modules/support/domain/support-ticket.entity.ts`
- `src/modules/support/domain/support-ticket.repository.ts`
- `src/modules/support/domain/support-ticket.types.ts`
- `src/modules/support/domain/ticket-consent-boundary.contracts.ts`
- `src/modules/support/domain/ticket-consent-boundary.policy.ts`
- `src/modules/support/infrastructure/consent-intent.mapper.ts`
- `src/modules/support/infrastructure/consent-intent.schema.ts`
- `src/modules/support/infrastructure/customer-consent.mapper.ts`
- `src/modules/support/infrastructure/customer-consent.schema.ts`
- `src/modules/support/infrastructure/mongo-consent-intent-consumption.ts`
- `src/modules/support/infrastructure/mongo-customer-consent.repository.ts`
- `src/modules/support/infrastructure/mongo-support-ticket.repository.ts`
- `src/modules/support/infrastructure/support-ticket.mapper.ts`
- `src/modules/support/infrastructure/support-ticket.schema.ts`
- `src/modules/support/presentation/customer-consent.controller.ts`
- `src/modules/support/presentation/customer-consent.dto.ts`
- `src/modules/support/presentation/customer-consent.presenter.ts`
- `src/modules/support/presentation/support-ticket-owner.guard.ts`
- `src/modules/support/presentation/support-ticket.controller.ts`
- `src/modules/support/presentation/support-ticket.dto.ts`
- `src/modules/support/presentation/support-ticket.presenter.ts`
- `test/consent-intent.persistence.fixtures.ts`
- `test/consent-intent.persistence.integration.spec.ts`
- `test/consent-verification-foundation.spec.ts`
- `test/customer-consent-api.fixtures.ts`
- `test/customer-consent-api.http.spec.ts`
- `test/customer-consent-api.integration.spec.ts`
- `test/customer-consent-authority.spec.ts`
- `test/customer-consent.entity.spec.ts`
- `test/customer-consent.fixtures.ts`
- `test/customer-consent.mapper.spec.ts`
- `test/customer-consent.persistence.fixtures.ts`
- `test/customer-consent.persistence.integration.spec.ts`
- `test/customer-consent.service.spec.ts`
- `test/mongo-consent-intent-consumption.spec.ts`
- `test/mongo-customer-consent.repository.spec.ts`
- `test/mongo-support-ticket-listing.spec.ts`
- `test/mongo-support-ticket.repository.spec.ts`
- `test/owner-support-ticket-access.service.spec.ts`
- `test/support-ticket-api.http.spec.ts`
- `test/support-ticket-api.integration.spec.ts`
- `test/support-ticket-race-barrier.spec.ts`
- `test/support-ticket-race-barrier.ts`
- `test/support-ticket-read.service.spec.ts`
- `test/support-ticket.entity.spec.ts`
- `test/support-ticket.mapper.spec.ts`
- `test/support-ticket.persistence.fixtures.ts`
- `test/support-ticket.persistence.integration.spec.ts`
- `test/support-ticket.service.spec.ts`
- `test/ticket-consent-boundary.policy.spec.ts`

## Exact files modified (3)

- `src/app.module.ts`
- `src/modules/rbac/rbac.module.ts`
- `docs/engineering/IMPERSONATION_SECURITY_BLOCKER_20261017.md`

New file added:

- `docs/engineering/UC66_SUPERSEDED_IMPLEMENTATION_CLEANUP_20261101.md`

AppModule loses the Ticket schema/model, controller, four application services,
Owner access service/guard, access/listing tokens and audited repository factory.
RbacModule loses only the Ticket-specific internal-support-assignment adapter/token
and its export. All other imports, providers, exports and controllers are preserved.

The following six Owner-only routes are unregistered, using base
`/api/v1/organizations/:organizationId/support-tickets`:

| Method | Suffix |
| --- | --- |
| POST | base |
| GET | base |
| GET | /:ticketId |
| POST | /:ticketId/close |
| POST | /:ticketId/cancel |
| POST | /:ticketId/reopen |

The three isolated Consent controller handlers were already absent from production;
their implementation has now also been removed. E5A/E5B had no production provider
registration and are removed entirely.

## Shared components preserved

- Customer authentication, JWT guards, current-session assurance, email verification, MFA, account locks and session repositories/controllers.
- Organisation context, Owner authorization, membership model and Mongo repository.
- Ordinary RBAC repository, seeds (including INTERNAL_SUPPORT and organizations.impersonate), effective permissions and temporary roles/schema.
- AuditModule, audit schema/indexes, audit repository and same-session audit infrastructure.
- MongoTransactionRunner, transaction/session helpers and Team/Sales/UC-48 unit-of-work callers, including their pre-existing regressions.
- PlatformAdminController, PlatformAdminService, disabled-impersonation guard exception and all existing impersonation boundary tests.
- Team, Sales, UC-48 partner export and UC-67 conversion Support Patch code, routes, schemas and tests.

The exact shared dependency paths referenced by removed components are retained in
`dependency-inventory.json`. In particular, deleting the Ticket-only RBAC reader
does not remove ordinary INTERNAL_SUPPORT assignments or TemporaryRole persistence.

## Remaining references

No implementation reference to SupportTicket, CustomerConsent, ConsentIntent,
ticket-consent boundary, INTERNAL_SUPPORT_ASSIGNMENT, VerifiedPersonBinding or
VerifiedOrganisationAuthority remains in source, tests, scripts, evaluation or
compiled JavaScript/declarations. No Ticket/Consent route or provider remains in
the compiled production module graph.

Intentional historical or independent references remain:

- This cleanup report and the new supersession notice name the removed architecture.
- `docs/engineering/IMPERSONATION_SECURITY_BLOCKER_20261017.md` retains historical approval/security proposals and paths explicitly belonging to a separate preserved security ref. Its new notice overrides those proposals for UC-66.
- `docs/operations/TEAM_UPDATED_PRIORITIES_READINESS_20261017.md`, `docs/operations/SAFE_SESSION_PREREQUISITE_20261017.md` and `src/modules/teams/README.md` retain earlier generic governance/MFA/approval wording. These are not active Ticket/Consent dependencies; the Technical Owner's UC-66 decision recorded here takes precedence.
- `docs/engineering/folder-readme-templates/modules/support-README.md` is a generic architecture template for future support/retry/read-only work, not deleted implementation.
- UC-67 Support Patch and the support RBAC/menu catalogue remain independent functionality.
- Existing Lead controller/test labels also say UC-66 for Update Lead Status. That unrelated business implementation and its labels are preserved.

## Schemas, indexes, data and migrations

Only exclusive source definitions were removed. No database connection was opened
for cleanup, and no collection, document, deployed index or migration was dropped.
No migration file contained these feature references; no migrations were removed.

If any earlier manual deployment or opt-in test persisted these records, their
retention/export/deletion requires a separate decision. Database contents and
record counts were not inspected or inferred:

| Collection | Removed source definition / retained data consideration |
| --- | --- |
| support_tickets | Ticket documents/history; compound organizationId + _id listing index definition. Existing documents/indexes are untouched. |
| customer_consents | Consent/history/evidence references; consent_source_event_scope_unique index on Organisation/Ticket/episode/source authority + evidence. Existing documents/indexes are untouched. |
| synthetic_consent_intent_challenges | Synthetic challenge ledger; intent_challenge_nonce_unique definition. |
| synthetic_consent_intent_trust | Synthetic policy/person/Organisation/credential trust payloads; default _id identity. |
| synthetic_consent_intent_receipts | Consumption/tombstone ledger; intent_receipt_challenge_unique, intent_receipt_attempt_unique, intent_receipt_proof_global_unique, intent_receipt_nonce_unique and intent_receipt_audit_unique definitions. |
| audit_logs (shared) | Existing Ticket/Consent audit events and CONSENT_INTENT_CONSUMPTION events remain. The exclusive intent_consumption_audit_unique partial-index constant was removed from the deleted synthetic schema file; the shared audit schema and all deployed indexes remain untouched. |

Removing application schemas does not delete stored data. Reusing an old collection
name in future could encounter legacy documents/indexes, so inspect and decide
retention/migration explicitly before any future reuse. No TTL or automatic cleanup
was added. Shared audit history must not be purged with a future feature migration.

The ignored dist directory contained stale generated code from earlier builds,
including older support approval artifacts absent from current source. It was
archived to `E:/ALSM/alsmv2-1050-cleanup-evidence-20261101/preexisting-dist-archive` and rebuilt into a fresh dist
directory. Exact generated files matching the deleted sources are separately listed
in `removed-generated-files.txt`. The fresh build contains no support module or
old Ticket/Consent symbols. No unrelated source or database data was removed.

## Verification

| Check | Result |
| --- | --- |
| TypeScript: node node_modules/typescript/bin/tsc --noEmit --incremental false | PASS before and after cleanup. |
| ESLint: npm run lint | PASS before and after cleanup. |
| Build: npm run build | PASS; also PASS from an empty output directory. |
| Git diff whitespace check | PASS. |
| Deleted-file/import/provider inventory | PASS: 80 deleted files, only two external consumers updated; no orphaned old symbols/imports/providers. |
| Compiled production registration inspection | PASS: 11 module types, 34 controllers, 218 provider tokens, 188 routes; zero Ticket/Consent routes/providers. ConfigModule environment loading is stubbed for metadata inspection only; no services are started. |
| Existing impersonation safety tests | PASS: 18 tests; authenticated endpoint remains 503 SUPPORT_IMPERSONATION_UNAVAILABLE, ordinary authentication denials retained. |
| Full default Jest suite after cleanup | FAIL: 117 suites pass, 1 fails, 1 skips; 1,442 tests pass, 13 fail, 44 skip. |
| Full default Jest suite before cleanup | FAIL: 135 suites pass, 1 fails, 6 skip; 2,370 tests pass, 13 fail, 144 skip. |
| Baseline vs final failures | Identical failing case names in gemini-provider-reliability.spec.ts; all 13 concern existing latency expectations. Left unchanged as requested. |
| Live validation integration | SKIP: 44 existing tests gated on a configured test Mongo URI. |
| Team/Sales/worker real-database integration | SKIP: 4 opt-in suites / 39 tests; no owned-service opt-ins enabled. Correct Jest discovery exits 0. |
| Standalone emergency HTTP harness | SKIP with exit 0 using its documented ts-node entry point; requires owned-local-only opt-in. |

The default suite's reduction is exactly 23 deleted dedicated suites (18 previously
passing and 5 previously skipped), including 928 passing and 100 skipped cases.
No preserved test was removed to improve the result.

An exploratory broad .integration-test.ts Jest discovery included the standalone
emergency HTTP script and returned "Your test suite must contain at least one test".
That script is not a Jest suite; the correct Jest-compatible discovery and its
separate documented entry point are reported above. This did not involve database
writes or a source change.

Relevant preserved suites from the full post-cleanup run:

| Suite | Result |
| --- | --- |
| `test/rbac-bootstrap-security.spec.ts` | 45 PASS |
| `test/platform-admin-authorization.spec.ts` | 133 PASS |
| `test/authentication-admission.http.spec.ts` | 12 PASS |
| `test/auth.service.spec.ts` | 7 PASS |
| `test/auth-atomic-lifecycle.spec.ts` | 6 PASS |
| `test/partner-export.controller.http.spec.ts` | 8 PASS |
| `test/export-code.spec.ts` | 8 PASS |
| `test/support-patch.controller.http.spec.ts` | 3 PASS |
| `test/support-impersonation-disabled.spec.ts` | 18 PASS |
| `test/view-organisation-details.service.spec.ts` | 3 PASS |
| `test/internal-portal-workflows.spec.ts` | 14 PASS |
| `test/mongo-organization.repository.spec.ts` | 7 PASS |
| `test/mongo-export-publication.unit-of-work.spec.ts` | 5 PASS |
| `test/dynamic-menu-rbac.spec.ts` | 8 PASS |
| `test/mongo-session.repository.spec.ts` | 6 PASS |
| `test/auth-sessions.controller.spec.ts` | 9 PASS |
| `test/auth-me-projection.spec.ts` | 2 PASS |
| `test/teams.service.spec.ts` | 13 PASS |
| `test/auth-mfa.controller.spec.ts` | 4 PASS |
| `test/publish-partner-export.service.spec.ts` | 10 PASS |
| `test/mongo-unit-of-work-outcomes.spec.ts` | 6 PASS |
| `test/team-workload.service.spec.ts` | 5 PASS |
| `test/remote-session-revocation-lifecycle.spec.ts` | 1 PASS |
| `test/rbac.service.spec.ts` | 8 PASS |
| `test/update-lead-status.service.spec.ts` | 28 PASS |
| `test/jwt-auth.guard.spec.ts` | 15 PASS |
| `test/conversion-support-patch.service.spec.ts` | 12 PASS |
| `test/session-management.service.spec.ts` | 3 PASS |
| `test/list-leads.service.spec.ts` | 3 PASS |
| `test/current-session-assurance.spec.ts` | 11 PASS |
| `test/organization-authorization.service.spec.ts` | 9 PASS |
| `test/sales-performance.spec.ts` | 6 PASS |
| `test/team-reporting-period.spec.ts` | 7 PASS |
| `test/session-client-metadata.spec.ts` | 7 PASS |

Additional transaction-runner regressions also pass in the full run. All existing
Organisation, RBAC, customer authentication, Team/Sales, UC-48 and UC-67 unit/HTTP
checks executed by the default suite pass. Real database concurrency and live
service behavior are not certified by skipped opt-in tests.

Evidence directory: `E:/ALSM/alsmv2-1050-cleanup-evidence-20261101`. Key files:
`initial-status.txt`, `initial-file-hashes.json`, `initial-tracked.patch`,
`dependency-inventory.json`, `baseline-jest.log`, `final-jest.json`,
`failure-comparison.json`, `final-typescript.log`, `final-eslint.log`,
`clean-build.log`, `verify-registration.cjs`, `compiled-route-inventory.json`,
`opt-in-jest-compatible.json` and `standalone-emergency-http.log`.

## Readiness

The Backend source is free of the superseded UC-66 implementation and is ready
for a separately scoped implementation of the original read-only flow. Impersonation
remains disabled and no future flow has been enabled. The complete test suite is
not green because of the 13 pre-existing Gemini failures; real-database suites
remain unverified because their opt-ins were not enabled. Stored feature data,
if present, remains pending a separate retention/migration decision.
