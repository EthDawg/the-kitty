# Device import preview

Open **Setup → Bank imports** and choose a fictional bank CSV to try the preview. On iPhone, Files supplies the original bytes. Kitty hashes them and retains a protected copy under the selected household. PDF text extraction and OCR run on the device. The browser host accepts a CSV through its file input. Both hosts use the shared import core for account selection, signed amounts, duplicate checks and review issues. The current host offers preview only.

The native `PeriodBankWriter` accepts a separately reviewed `kitty-write-plan/1` for a single account on a verified v2 Sheet. Its narrow adapter accepts contiguous new transaction rows, writes raw values and date types, checks the exact cells and receipt, and holds an uncertain result for readback. Changes to existing rows, deferred operations and other record types fall outside this adapter.

The Google boundary uses a synthetic transport and journal in tests. The tests exercise a lost write response, a second device checking the same receipt, literal cell types, a changed ledger and an unverified original. A real Google save still needs the household-owned Drive archive, a durable intent and a shared hold, plus a fresh source-to-plan check. Confirm stays unavailable until those pieces are connected and verified against a private fictional Sheet.

On 5 November 2026, all 10 focused tests passed on the iPhone SE simulator with iOS 26.5. The bundled page showed the two fictional card rows across January and February as a debit of 8.50 and a refund of 3.25. Its account menu contained the six active ledger accounts. A touch journey opened the system Files picker and cancelled back to an empty preview. The remaining checks covered protected original bytes, household isolation and the synthetic Google boundary above. A private Google write and a physical-phone import remain separate acceptance steps.

Run the shared import checks with `node --test src/core/*.test.js`.
