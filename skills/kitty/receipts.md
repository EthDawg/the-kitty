# Receipts

For any docket photo, e-receipt PDF, online order invoice or emailed receipt. The output is rows on Receipts and Receipt Lines (sheet version 3), and a spending row on Entries when nothing reached a bank.

## Read
- Read every printed line, in printed order. Keep the printed text exactly. Then add a plain product name, the brand if printed, one Group, the pack size, the quantity and the unit.
- Weighed lines print the weight and the rate under the item, as in `0.131 kg NET @ $4.90/kg`. The quantity is 0.131 and the unit is kg.
- A line under an item, such as `2 @ $4.00 EACH`, gives that item's quantity and unit price. It is not a separate line.
- A promotion is its own negative line with Kind `Discount`, for example `Strawberries 2 FOR $7  -1.00`. Never fold it into the item.
- Every docket prints its own GST marks in its footer. Read the footer.
  - Coles prints `% = Taxable items` and `* = Specials`.
  - ALDI prints `A` (GST-free) and `B` (taxable), plus net and GST lines for each.
  - Woolworths is reported to use `#`. Confirm it on the docket.
- Long dockets get cut short: vision models drop lines from long lists. Count your lines against the printed "N items".

## The tie gate
Write a receipt only when both of these hold:
1. The lines add to the printed total, within 5 cents.
2. The printed GST equals the taxable lines divided by 11, within 2 cents. If the docket prints no GST, use the retailer's GST mark on each line instead.

If either fails, read it again. If it still fails, queue it for a person with the file. Never adjust a line to make it tie.

## Pay
- **Card.** Match the receipt to one Entries row with the same amount, dated the same day to 3 days later, on a likely account. Put that row's ID in Entry ID.
- **Gift card, cash or points.** No bank row will ever come. It is still spending, so add a spending row on Entries against that payment's account. Each gift card is an account. Record the balance after, when the docket prints it.
- **Split payment.** Record each part. Match only the card part to the bank.

## Who sold it
Take the merchant from the ABN printed on the receipt, not from the name. Look the ABN up once on the ABR's public page, `https://abr.business.gov.au/ABN/View/<abn>`, and keep the entity on the merchant list. A search by name picks the wrong company. ALDI, for example, trades as ALDI Stores (A Limited Partnership).

## Duplicates
The same receipt arrives twice: two photos, a photo and the e-receipt, an emailed copy. It is the same receipt when any of these match:
- store, register, receipt number and date;
- the same total within two minutes at the same store.

Keep one row and add the other file's link to its Note.

## Write
- Write Receipts and Receipt Lines by explicit range with typed cells (`update_spreadsheet`, `updateCells`), never by append.
- File the original under `Sources/receipts/<yyyy-mm>/` and put its link in Source.
- Report one line per receipt, for example: "Woolworths Brunswick, 4 Jan, 23 lines, $186.40, ties, matched to T0912."

## From a phone
The dependable path today:
1. Share the photo to the Kitty Inbox folder in Drive as a JPEG. On an iPhone, Camera set to Most Compatible, or "Share as JPEG", avoids HEIC.
2. Ask Claude or Codex to "do the receipts".

A phone app writing straight to the Sheet in one step is untested here.
