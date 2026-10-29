# UC-32: Upgrade to Full Migration — Test Record

## Scope

The automated coverage exercises the Enterprise Customer quote request, permission-protected staff review and approval, and the resulting Enterprise subscription update. Quote management requires the persisted `billing.quotes.manage` permission; Platform Admins receive it through the RBAC catalog.

## Test cases and current results

| ID | Scenario | Automated coverage | Result |
| --- | --- | --- | --- |
| UC32-01 | Customer submits valid migration quote details; request is stored as `PENDING` and returned with its identifier and organization | `enterprise-quote.spec.ts`: DTO, service creation, controller presenter | PASS |
| UC32-02 | Customer views no request or the latest request; form displays pending/contacted status and successful submission confirmation | backend service/controller tests; `RequestEnterprisePage.test.tsx` | PASS |
| UC32-03 | Required fields, email, phone and message length validation; message at exactly 1000 characters; trimming and blank values | DTO and service tests; frontend form validation test | PASS |
| UC32-04 | Organization owner/admin can submit; member/viewer cannot; customer cannot use staff list/update actions | service permission tests | PASS |
| UC32-05 | Existing open request, active Enterprise subscription, or duplicate-key race prevents a duplicate request | service conflict tests | PASS |
| UC32-06 | Request persistence failure and approval subscription dependency failure return errors without reporting success or updating the quote status | service failure-path tests | PASS |
| UC32-07 | Staff member with `billing.quotes.manage` approves a pending quote; Enterprise subscription plan/status and quote status are updated in one transaction | service approval test verifies repository calls, result and session lifecycle | PASS |
| UC32-08 | Invalid admin request ID, invalid status transition, closed request and invalid list pagination are rejected; page size 100 is accepted | service boundary tests | PASS |
| UC32-09 | Missing or invalid bearer tokens are rejected in production; valid and legacy tokens remain accepted | `jwt-auth.guard.spec.ts` | PASS |
| UC32-10 | Enterprise Admin portal permission, pending request list, approval confirmation, success/error feedback, filtering and empty state | FE2 `AdminQuoteRequestsRoute.test.tsx` + `AdminQuoteRequestsPage.test.tsx` | PASS |

## Executed results

The results below record the earlier run. They predate the permission alignment in the current working changes, so rerun the affected suite before release.

- Backend UC-32 and JWT guard suites: **44 passed** (`enterprise-quote.spec.ts` 40 + `jwt-auth.guard.spec.ts` 4).
- Enterprise Customer page: **7 passed** (`ALSM_WEB_FE_1`, `RequestEnterprisePage.test.tsx`).
- Enterprise Admin portal: **7 passed** (`ALSM_WEB_FE_2`, `AdminQuoteRequestsPage.test.tsx` + `AdminQuoteRequestsRoute.test.tsx`).
- Enterprise Admin portal production build: **passed** (`npm run build`). Vite reported its existing native config-loader warning and a large-chunk warning.
- During the first Admin UI run, one test exposed a success-message defect (`[object Object]` instead of the approved status). The status label lookup was corrected and the full new Admin test set then passed. This was a product defect caught and fixed by this test work; there is no open defect from that run.
- FE1 Vitest initially could not rename a temporary cache directory inside the sandbox (`EPERM`); rerunning with the approved outside-sandbox access passed all 7 tests. This was an environment restriction, not a product failure.

Backend Jest required `NODE_OPTIONS=--max-old-space-size=4096` in this environment. Jest printed its existing open-handle notice after completing the two passing suites.

## Coverage boundary

These are unit/component tests with repository and service dependencies mocked. The approval test proves the expected repository operations are requested inside the transaction wrapper; it does not prove rollback against a live MongoDB instance. This flow does not enqueue a conversion or queue job: it records a quote and, after admin approval, creates or upgrades the Enterprise subscription. Conversion, project and queue regressions are therefore outside the observed side effects of this use case. No outbound customer notification is sent by this path; the customer-facing result is the returned quote and confirmation page.

The FE2 routes `/billing/quotes` and `/admin/billing/quotes` require `billing.quotes.manage`. The backend checks the same persisted permission in its guard and service layer for list, status updates, and appeal decisions. The Enterprise Quote portal is a staff portal; its quote-management route is not an Enterprise Customer feature. RBAC grants this permission to sales roles, while users without it receive `403` and cannot read or change quote data.

## Functional test execution boundary

The attached Test Report workbook is a blank template, and no deployed application/API test environment or test accounts were supplied. Therefore no live browser/API functional run is claimed. Keep the corresponding Test Report rows `Pending` until a tester runs the cases against the configured environment. Suggested minimum live cases are:

| ID | Role | Live functional steps | Expected result | Status |
| --- | --- | --- | --- | --- |
| UC32-F01 | Enterprise Customer; organization Owner | Sign in to FE1, open full migration request, submit valid name/company/email and optional scope | One `PENDING` request is saved; response and confirmation show its ID and submitted values | Pending — live environment required |
| UC32-F02 | Enterprise Customer; organization Admin | Repeat with another eligible organization | Request is associated with the authenticated user's organization | Pending — live environment required |
| UC32-F03 | Enterprise Customer; Member/Viewer | Attempt request submission | UI/API denies the action; no quote is stored | Pending — live environment required |
| UC32-F04 | Enterprise Customer | Submit missing/invalid required values and message lengths 1000/1001 | Invalid input is rejected; 1000 is accepted; 1001 creates no request | Pending — live environment required |
| UC32-F05 | Enterprise Customer | Submit while a request is open; retry after successful submit | Duplicate is rejected; only one open request remains | Pending — live environment required |
| UC32-F06 | Staff with `billing.quotes.manage` (for example, Sales Manager) | Open FE2 quote list, filter pending, approve a request | List/filter work; approval response and persisted quote/subscription show `APPROVED` and Enterprise `ACTIVE` | Pending — live environment required |
| UC32-F07 | Authenticated user without `billing.quotes.manage` | Open both FE2 quote-management routes and call admin endpoints directly | FE2 shows Access Denied; API returns `403`; no quote/subscription state changes | Pending — live environment required |
| UC32-F08 | Unauthenticated user | Call quote submit, own-request, list and update endpoints without/with invalid bearer token | API returns `401`; no state changes | Pending — live environment required |
| UC32-F09 | Staff with `billing.quotes.manage` | Use malformed/missing request ID, invalid transition, and list page/limit boundary values | Correct `400`/`404`; repository state remains unchanged; `limit=100` is accepted | Pending — live environment required |
| UC32-F10 | Enterprise Admin; dependency fault injected in test environment | Fail subscription activation during approval, then inspect quote/subscription state | API reports failure and neither change is committed | Pending — live MongoDB/transaction test environment required |
