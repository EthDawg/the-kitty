# Workbook template source

This directory contains source material for a clean household template. It does **not** yet create or validate a new household workbook. The native app still offers an existing-Sheet connection and an explicitly fictional demo copy.

[davies-v1.json](source/davies-v1.json) was captured read-only from the [public fictional Davies workbook](https://docs.google.com/spreadsheets/d/1zfiCnqO36a0YmMwC8-J6iGHUGvmLdXmhbL5aPWNlExM/edit) on 5 November 2026 Sydney time. Its SHA-256 is `41743ff2a6bcbc21fc112656a4a3af71d9d2d233aa23657e801b3112ad4268ab`.

All 21 grids were read at their reported bounds. The manifest retains 3,193 populated source cells, including all 1,981 formulas, plus data validation and number formats. Repeated rules/formats are grouped into contiguous row ranges with one-based coordinates. Fictional raw values in Transactions A2:J, Payslips A2:G and Valuations A2:C were omitted; their headers, formula anchors, validation and formats remain. Fictional **configuration** still exists in the source and must be replaced by the generator.

The [capture comparison](source/capture-check.json) matched every fetched formula, 5,735 validation cells and 8,170 number-format cells, with no mismatches. It confirmed that 8,466 raw input values were omitted. This comparison did not calculate formulas or create a Sheet. Reads spanned multiple requests, so this is not an atomic snapshot. Visual styles other than number formats, merged cells, charts, protections, permissions and bound scripts are outside the capture.

The current private project's default branch contains raw-demo-data and HTML generators, but no complete Sheet builder was found there. This public formula capture makes recovering that original builder unnecessary for the next implementation. See [the required adaptations](ADAPTATION.md).

The intended first profile is AU/AUD, one or two people, an explicit opening month-end, and user-supplied accounts and signed opening balances. Optional budgets and goals require explicit input. Tax, mortgage and other optional domains must remain unavailable until their own inputs and history are complete. This is a proposed implementation boundary, not accepted support.
