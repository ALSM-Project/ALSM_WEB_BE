# ALSMV2-1102: persisted source findings and minimum contracts

17 October 2026. Source inspection of the original Backend and Web 2 repositories. This records data dependencies for the already approved metrics; it does not approve a new attribution policy, add schemas, or substitute opportunity win rate or accounting recognition for the approved formulas.

## What the repositories actually provide

| Source | Actual persisted contract | Can it supply the approved sales KPI? |
| --- | --- | --- |
| `teams`, organization/users | Organization-owned team, explicit current salesperson roster, manager scope, revision and attributed membership changes | Supplies authorization/roster only. No lead assignments or sales events |
| Backend `billing/infrastructure/quote-request.schema.ts` | Customer/requester `userId`, organization, contact/company fields, request/review/appeal statuses | No lead identity/assignment lifecycle or converted-to-customer state. A quote request/approval is not a converted lead |
| `billing/infrastructure/payment.schema.ts` and `billing/application/payment.service.ts` | Organization, payer `userId`, optional invoice/subscription IDs, `amountVnd`, `PaymentStatus.COMPLETED`, `paidAt`, reference/Casso transaction ID. Existing matching flow can mark a pending payment completed | Has payment confirmation fields, **no salesperson attribution** or lead/contract relationship. Customer/payer identity cannot be treated as the salesperson |
| `billing/infrastructure/invoice.schema.ts` | Organization, payer `userId`, subscription, amount VND, `InvoiceStatus.PAID`, `paidAt` | May describe the same payment's invoice. No salesperson attribution. Summing both invoice and payment would double count |
| Subscriptions/plans | Subscription ownership, plan and price/status | Subscription/plan price or activation is not attributed confirmed salesperson revenue |
| Projects/conversion jobs/assignments | Real conversion workload, technical job statuses and human assignment | Supports ALSMV2-1186 workload, not CRM lead conversion |
| Web 2 Team Performance service/pages | Typed read API, roster rendering and unavailable metric reasons | No separate persisted CRM, lead, customer-conversion or revenue repository/API; UI values cannot become a source of business truth |

The Backend source modules contain no Lead/customer-conversion/contract lifecycle repository or schema. Web 2 contains no authoritative persisted alternative. Existing billing sources provide some confirmation evidence but not a legitimate salesperson-revenue contract. No new schema, imported CRM rows, synthetic lead/customer records, fake invoice/payment, or fabricated revenue was introduced. This finding concerns the two inspected checkouts; it does not claim that an external CRM/accounting system cannot exist elsewhere.

## Smallest usable persisted contracts

These describe fields/evidence a legitimate owning source must expose through scoped repository/read ports. They are not proposed collection definitions. Reuse an existing authoritative source or approved integration before introducing a schema.

| Needed source | Minimum identity and evidence | Why required |
| --- | --- | --- |
| Lead plus assignment evidence | Stable `leadId`, `organizationId`, persisted salesperson identity, assignment event identity/effective timestamp(s), and enough retained assignment/reassignment evidence to resolve exactly one credited salesperson for a counted lead in the selected period | Distinct assigned lead counting and deduplication after reassignment cannot be reconstructed from only today's team roster or lead creation date |
| Lead conversion to customer | Same scoped `leadId`, actual persisted lifecycle status or event with a **verified business mapping** to converted-to-customer, conversion effective time and authoritative customer/reference evidence; durable event identity where events can repeat or be corrected | Establishes which members of the assigned-lead cohort really converted. There is no verified status in these repositories to map today |
| Confirmed salesperson revenue | Stable revenue/payment source identity, `organizationId`, explicit credited salesperson ID backed by real attribution evidence, confirmed amount with exact numeric representation and currency, confirmation status/proof and effective timestamp; links identifying duplicate invoice/payment representations and any reversal/correction | Allows one confirmed amount to be attributed once to a salesperson in the reporting period. Existing customer `userId` and estimated values do not satisfy this |

For revenue, existing `payments`/`invoices` may be reusable **after** legitimate persisted salesperson attribution and confirmation/time semantics are established. A link to a real lead/customer/contract may provide that evidence; an invented contract table or a default owner copied from the current user cannot. No recognition ledger is required merely to satisfy the approved sum of confirmed attributed revenue. Do not aggregate different currencies without an approved conversion source; do not count pending invoices, quotations or plan estimates as confirmed revenue. Payment and invoice for the same economic amount must resolve to one source identity. Reversals/corrections must not leave a known cancelled amount counted as confirmed.

## Preserved formulas and unresolved semantics

- **Lead Count:** count distinct real leads assigned to the salesperson during the selected reporting period. Source assignment timestamps must support that period. Do not substitute quote requests, organization members, lead-created timestamps or current ownership for assignment evidence.
- **Conversion Rate:** distinct converted leads from that same attributed assigned-lead cohort divided by distinct assigned leads, multiplied by 100. Confirm the real converted-to-customer mapping and date/cohort behavior first. Do not replace it with closed opportunities won divided by opportunities closed. Once a real denominator exists, handle zero explicitly instead of dividing by zero. Source absence is unavailable, never a fabricated numeric zero.
- **Revenue Generated:** sum distinct confirmed source amounts attributed to the corresponding salesperson in the selected period. Use the source's established confirmation/effective-time contract, never quotation value, pending invoices or customer payments with inferred salesperson ownership.

The reporting API already anchors 7/30 rolling elapsed UTC days with half-open `[start,end)` boundaries. A legitimate source must support those boundaries and retain evidence through reassignment. The existing repositories do **not** establish whether first/last/effective assignment determines credit after reassignment, whether an older conversion belongs in a new assigned cohort, or how historical team transfers affect sales attribution. Do not silently choose any of these policies or activate historical accounting/generation metrics from the unapproved seven-decision proposal. Obtaining a source contract that resolves those facts is a remaining business/data dependency, not justification for creating synthetic history.

Current implementation therefore returns the actual authorized active salesperson roster and `available:false` plus the precise missing-source reason for all three KPIs. It supplies no numeric value when the source is missing. Workload reporting remains independent and operational on explicitly assigned persisted jobs.
