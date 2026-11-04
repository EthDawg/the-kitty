# Clean household adaptation — source review

The following findings come from the captured public formulas, not a recalculated new workbook. `build.mjs` implements the basic-profile adaptation described below while preserving positional Settings references and the existing raw-tab contract. Its generated requests and local tests do not establish provider recalculation. Clearing raw rows alone is insufficient.

| Area | Source evidence | Required behavior |
|---|---|---|
| People | Tax Forecast B4:E4 and name-dependent branches in rows 7/16; Transactions H2:H1201 and Payslips B2:B300 validation | Populate explicit person slots and validation from household metadata. A missing second person must not receive calculated income or shares. |
| Demo inputs | Kitty B5:B12; Settings B5:B6/B11:B22; Accounts, Assets, Loans, Goals, Subscriptions; Categories E2:E35 | Replace fictional names, balances, dates, budgets, work hours, depreciation, rates and ownership assumptions. Remove unused input records and their row formulas. Keep category IDs and taxonomy. |
| Opening balances | Accounts H2:H7 ignores opening dates; Net Worth B5:B20 adds opening balances to older months | Use an explicit opening month-end and history start. Reject imports at/before their opening anchor; do not show earlier balances or fabricate previous history. |
| Partial history | Cash Flow has 16 monthly rows; averages divide by three; comparisons use prior-year columns | Blank unsupported periods and suppress averages/comparisons until the entire window exists. Retain explicit As-of dates. |
| Empty collections | Unguarded FILTER in Budget A7; Metrics C24/F24 and C27/E27/F27/G27; Dashboard B29/H29 | Empty budgets/watchlists must yield deliberate empty results. A blank spill must not count as one item. |
| Optional account/loan roles | Metrics C14 names ACC-SAV; mortgage/savings calculations use Loans row 2 | Bind emergency-account and primary-home-loan roles explicitly. Gate PMT, NPER, DATEDIF, offset and refinancing outputs when inputs are absent. |
| Tax | FY26/FY27 rates; shared interest/rental split; July-to-date projection | Leave unavailable until supported rates, complete relevant history and explicit ownership are present. Do not inherit a second person's work hours or share. |
| No-activity accounts | Compliance Checks C19 flags transaction/card accounts with no monthly rows | Align the check with authoritative statement reconciliation. A verified no-activity statement must be able to satisfy the close. |
| Template identity | Calder/Davies titles, fictional banner and planted README examples | Replace demo content and turn the known public feed off. Check Drive sharing separately. |

## Narrow setup contract

Use an AU/AUD v1 profile initially. Collect a household name; one or two unique, nonempty person names excluding commas and the reserved `Joint`; a common opening month-end; and one or more accounts with immutable IDs, supported types, valid owners and signed opening balances. Explain held versus owing amounts before confirmation. Budgets must be nonnegative explicit inputs; an optional goal must refer to a configured account. Do not populate loans, assets or subscriptions that were not supplied.

The reviewed plan needs a durable identity and recoverable creation state. A bootstrap writer should create and configure a new workbook, verify its formula/input boundaries and ownership, and hand it to the existing importer only after read-back. An interrupted creation must not silently create another workbook. This is separate from unrestricted setup edits on an existing household.

## Acceptance before enabling setup

- One-person and two-person cases; no goals, budgets, loans, assets or subscriptions; reordered account/loan rows.
- No retained demo facts, literal person validation or formulas attached to absent input records.
- Opening balances begin at their anchor. Missing history remains unavailable; genuine zero remains zero.
- Pre-anchor imports fail visibly, and a complete no-activity statement can close a period.
- Validation and formula coverage extends beyond the source's initial row capacities.
- A newly owned Google workbook recalculates without unexpected errors, then passes native projection, first import, replay and first close. Repeat with a second Google identity.

Local generator tests cover configuration, request reconstruction, empty-domain structure, history gates, capacities and a synthetic native readback. None of the new-template **provider acceptance** cases has run. The source capture and generator do not establish a visual clone, workbook protections, private sharing, OAuth, deployment or successful recalculation.
