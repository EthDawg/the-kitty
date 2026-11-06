# The merchant dictionary

The most reusable thing in this repository: what a bank descriptor means. `merchants.json` holds the merchants an Australian
household meets (supermarkets, fuel, transport cards, telcos, energy and water, councils and other government, insurers,
streaming and software, airlines and travel, food delivery and fast food, chemists, hardware, department stores and
retail, gyms, childcare and kids' activities, hair and beauty, car services and parking, property managers and strata,
charities, education, payment rails, bank fees, transfers, salary and interest), each with:

| Field | Meaning |
|---|---|
| `id` | kebab-case, stable; a household's gitignored `logos/<id>.svg` or `.png` is embedded at build time |
| `name` | the clean trading name the row shows |
| `patterns` | regular expressions over `Engine.normalise(raw_text)`; the longest match wins |
| `category_id` | a row on the sheet's Categories tab (the Davies set: `GROCERIES`, `SUBS`, `RENT-INT`…) |
| `hue` | the brand's colour as a hex; the page tints a disc with it and draws two letters on top |
| `website` | domain, with a path only where the brand needs one; blank for a generic entry |
| `kind` | `merchant`, `transfer`, `fee`, `income` or `government` |
| `icon` | optional: a brand icon id that beats the category's (a fuel station under Fuel and transport shows the pump) |

`categories.json` maps every `category_id` on the Davies sheet to a brand icon (`brand/icons/icons.json`) and a hue, with
fallbacks by group and by account kind for valuations and trades.

No real marks live here. A merchant renders as a monogram in its hue; only a household's own `logos/` pack (gitignored,
never in the public demo) puts a logo on a row.

## How a descriptor resolves

`Engine.normalise(raw)` uppercases, drops card suffixes (`Card xx4471`), processor stars (`SQ *`, `PAYPAL *`),
`VALUE DATE` and friends, dates (`14/10/2025`, `14 OCT`), foreign amounts (`USD 20.00`), `PTY LTD`, `AU`/`AUS`, a trailing
state or capital city (`VIC AU`, `MELBOURNE CENTRAL`, `SYDNEY SOUTH`), store numbers and reference codes (`3021`, `P2F4A`),
and punctuation, then collapses spaces. `WOOLWORTHS 3021 BRUNSWICK Card xx4471 Value Date: 14/10/2025` becomes
`WOOLWORTHS BRUNSWICK`.

`Engine.merchant(raw, model)` then tries, in order:

1. **The sheet's Rules tab.** A `normalised` rule matches when its tokens appear together, in order, in the normalised
   descriptor; a descriptor a bank cut at 24 characters (`WOOLWORTHS 3021 BRUNSWIC`) still matches because the last token
   may be the start of the rule's. `exact`, `contains` and `regex` rules are honoured too. Longer rules win over shorter
   ones (`AIRBNB NOOSA` before `AIRBNB`). The household's own words always beat the dictionary.
2. **This dictionary.** Every pattern runs over the normalised text; the longest match wins, so `UBER EATS` is Uber Eats
   and `UBER` alone is a ride.
3. **A Title Case fallback**, flagged `unresolved`, with a processor prefix (`SQ`, `SP`, `TST`, `PP`) dropped:
   `SQ *GOLDEN FLEECE BAKEHOUSE` shows as "Golden Fleece Bakehouse" and lands in the Review queue, where the fortune
   cookie proposes a rule.

## Miss rate, measured

Over the 925 historical transactions on the Davies v2 sheet (`data/snapshot-v2.json`, 99 distinct descriptors), on
4 November 2026:

| Resolver | Rows resolved | Miss rate | Category agrees with the sheet |
|---|---|---|---|
| Rules then dictionary (what the page does) | 925 of 925 | 0.0% | 924 of 925 (the one exception is `AMAZON MKTPLC AU REFUND`, which the sheet files under Shopping and the rule reads the same way; the engine's refund badge covers it) |
| Dictionary alone, no sheet Rules | 903 of 925 | 2.4% | 880 of 903 |

The 22 dictionary-only misses are 19 rows of `SOCIAL CLUB BRUNSWICK` (a local cafe), one `SURFCOAST KITCHENS` (a
local tradesperson), and the two processor-only descriptors `PAYPAL *DIGITALRIVER` and `SQ *MARKET LANE`, exactly the
rows a household rule or the cookie should settle. The 23 category disagreements are the sheet's own judgment that a
general dictionary cannot carry: a Geelong rates bill and Barwon Water filed under the rental (`RENT-RATES`), a JB Hi-Fi
and an Officeworks purchase under `WORK-EQUIP`, Myer and Big W under Gifts, plumbing and hot water under rental repairs.

Against the parody portals' eight years of varied descriptors (the `transactions` array of `portals/data/months.json`: `VIC AU` suffixes, 24-character cuts, `Card xx4471 Value Date:` tails, city
and entity tokens, store numbers that alternate, trading names that change over the years), 4,179 rows and 276 distinct
descriptors: rules plus dictionary resolve all 4,179 (the first measurement missed six one-off rows around the Geelong
purchase, a conveyancer, the settlement, a locksmith, an appliance repair, a car sold for cash, and one hotel, which
the dictionary now covers with generic entries). The dictionary alone resolves 4,089 (2.2% miss), 87 of the 90 misses
being `SOCIAL CLUB BRUNSWICK` in its three spellings. The earlier draft of this paragraph counted the file's payslip rows as
descriptors and reported employer-name misses that do not exist; the phase E session caught it.

`node --test test-v2.js` keeps these numbers honest: every historical row must resolve, the dictionary-only miss rate
must stay at or under 3%, and the normaliser's cases above are pinned.

## Adding a merchant

One line in `merchants.json`, one entry per line, in any position. Write the pattern against the normalised text (uppercase,
no punctuation, no store numbers), start and end it on word boundaries, and add a negative lookahead when a shorter brand is a
prefix of a longer one (`\bUBER\b(?! EATS)`). Patterns are unanchored, so a token left at the end, such as a bank's cut-off
`NS` for `NSW`, does no harm. Pick the category the household would file it under most often; the person can always overrule it
with a Rules row. Keep the hue close to the brand's own, and say so in the pull request if you could not confirm it. Keep the
repo free of logos.

Real merchant names belong here: a brand and a public suburb identify nobody. A reference number, card digits or a person's
name from a statement do not.

Then the test. Add a descriptor to the `dictionary:` test in `test-v2.js`, or a new `dictionary:` test beside it if the case
needs more than a line. Add it first and watch it fail, then add the entry:

```bash
node --test --test-name-pattern="dictionary" test-v2.js
python3 check.py app standard
```

Run `standard` too, because its benchmark reads this dictionary. A new entry can change how a held-out household's lines resolve.
