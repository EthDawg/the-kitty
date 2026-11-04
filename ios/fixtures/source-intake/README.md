# Fictional source intake fixtures

The four PDFs in `ios/Kitty/Resources/source-*.pdf` are generated from committed Davies CSVs. They contain no personal household records. `manifest.json` records their byte hashes and expected values.

- Statement text: January ACC-EVD, 12 rows, opening 5,335.17 and closing 5,971.06 AUD. This closing balance agrees with the bundled January household.
- Statement scan: image-only rendering of the same page, with no PDF text layer. It exercises local Vision OCR.
- Payslip: the optional February `DEMO-PAY-001` fixture; current gross 5,250.00, PAYG 1,250.00, employer super 630.00, net 4,000.00. Synthetic YTD totals are six-pay multiples. `Jordan Davies` must be explicitly mapped to `Jordan` in the Sheet.
- Loan valuation: January `LN-HOME` balance 591,715.18 owing, normalised to -59,171,518 minor units. Facility limit, repayment and redraw are deliberate decoys.

Regenerate with `python3 ios/fixtures/source-intake/build.py` in an environment with ReportLab and Poppler. Generated files are deterministic. Rendered PNGs are retained in `rendered/`; all four full pages were visually checked for clipping, overlap, readability and fictional labelling. These are test fixtures, not statements from real providers.

`SourceIntakeTests.swift` tests suggestions and explicit confirmation separately. Successful parsing/OCR does not approve financial records, prove source accuracy, or establish Sheet write/reconciliation success.
