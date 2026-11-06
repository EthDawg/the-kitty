# Decisions: the household runtime

Taken on 7 November 2026 while building, without stopping to ask. Each is a default that can be changed. Where a test holds it, it says so.

## The Store

**Two ports, one set of rules.** An adapter supplies a few raw moves and `store/port.js` holds what every store obeys: rows normalised going in and out, an append that adds
only what is missing, the hash compare before a managed write. The compare is in the port, not in `close`, so nothing can write round it.

**There is one Fake, and it is the Google store.** `store/fake.js` is a fake of the connector's tool surface, and `fakeStore()` is `googleStore` over it. A fake failure takes the
same path a real one does. It models the documented habits: a 1,000 by 26 default tab, a refused write past the grid, 10M cells, 50,000 characters a cell, USER_ENTERED coercion,
display strings back, trailing blanks gone. It is a model of Google, not Google.

**A store holds exactly what a Sheet can hold.** `codec.normalise` is the only door: blank is absent, whole numbers are numbers, json is an object, the rest is text. So a Folder and a
Sheet cannot disagree, and the Davies world keeps its hash through either. The stored hash is the standard's own `hashTable` over those rows.

**Writes use `update_values` at a named row, never `append_values`.** Table detection walks past a blank row and the existing skill already forbids it. Every chunk is read back.

**Every string is guarded.** Under USER_ENTERED, Sheets reads `2026-07-05`, `Mar 2026`, `007`, `12e5` and `=IMPORTXML(...)` as things other than text, and a bank narrative is someone else's
text. A pattern list misses something, so every string gets the leading apostrophe. `init` writes one cell and reads it back to learn which mode the connector uses. The connector's docs don't say.

**The source row is the commit.** Bytes, then setup, then observations, then the source row. `viewOf` ignores observations whose source row is absent, so a cut-off run leaves rows nobody
reads, and rerunning adds only what is missing. This also survives Google doing the work and losing the answer.

**A managed write says what it is about to do.** The manifest gets `writing` before the first tab and loses it after the last. A half-written tab is then known to be ours, not a person's typing.

**The bytes' state lives in `source.uri`.** `blob:sha256:...` held, `device:...` on a device, `not-held:...` neither. No schema change. Blobs are optional: a store without them, or a Drive grant
that goes away, records the state and warns. It does not fail the add.

**Static tables read latest-wins by key.** The port has no edit, so a change to a period, a source's read state or a renamed account is one more row. The Sheet stays append-only for the runtime.

**`x_delivery` is the one table added.** See Finding R-002. A dormant account's identical empty export is a real arrival that `source`, keyed by content, cannot show. Without it a false gap
appears on Davies. Only a quiet file on a new day counts: re-adding a busy file adds nothing, or a person could hide a missing month by dropping January in again.

## Day one

**All 41 tables, plus `x_delivery` and About, from one atomic call.** Tabs, grid sizes, headers, colours, warnings and removing Sheet1 are one `update_spreadsheet`. Either a whole Kitty exists or nothing changed.
Growing tabs later would mean more failure modes and the same grant.

**A person sees eight tabs:** About, Household, Party, Account, Scope, Source, Decision, Rule. The other 35 are hidden, not missing. Colour says the class: green yours, blue evidence, grey managed. Evidence and
managed tabs warn before an edit. About is the manifest: every tab, its class, its rows and hash at the last close, and one plain sentence. It is a tab because a Sheet has nowhere else to keep a hash.
It is not called `Kitty`, because the v2 page reads that tab with another layout.

**Grids are sized.** About 25,000 cells on day one, against 1.07M for 41 default tabs. They grow when a write needs it.

**Category, Tax Map and Recipe start empty, and a blank household still has all three.** SPEC 13 makes them shared data, read through a household's overrides, so copying them in would be a small fork and an update would never arrive. `rebuildAt` overlays `defaults.json` and `add` reads the public recipes on every open, so a blank Kitty's first interest lands on label 10 with no row of its own. A household's row wins for its own key and the rest stay shared. Read `view.setup`, never the raw tabs: a reader of the Category tab alone sees only the overrides. Finding R-009.

**People belong from before the first file.** Membership, ownership and aliases start 1900-01-01, whatever the signing-up date. Dated from today, three months of backfilled statements belonged to nobody, and net worth read $0.00.

**A file's account comes into being.** Asking a person who just dropped their first file to set up an alias is the wrong first question. `add` makes bank, card, loan and super accounts from the file, owned equally by
the adults until someone says otherwise, with a stream to expect the next month. Anything else, such as a broker's holding, is reported and `next` asks.

## The clock

`today` filters originals before the engine runs. `as_of` is the earlier of today and the last evidence, and null with no evidence. A static table has no `recorded_at`, so an account is hidden when every ownership row of it is recorded later.

**Assumed tax means a financial year that starts after the law was last read.** A year already under way when the law was read stays known. `au.json` says `verified_at: null`, so the date comes from `au-verified.json` through `defaults.json`. Finding R-003.

## Close and next

**A month is whole when it has ended and each account's evidence reaches its end:** the last line, or the day a file was downloaded, whichever is later. A file taken after a month ends speaks for that month, and if it does not, the next
balance will not chain. One rule for `close` and for the stale step.

**A close is refused** while the month runs, while a file stops short, with no stated balance, or when an account's balances contradict. L2 does not refuse: Davies has long-open items, and they are reported.

**Closed and locked are different.** A month with unanswered lines or a pay with no payslip closes but does not lock, because an answer would change the seal. Saying `scope payroll = none` is the answer for a pay. Finding R-006.

**A hand edit becomes a proposed decision and stops the close before any tab is touched.** An accepted decision naming that found hash lets the next close take the tab back. A later edit has a new hash and is asked about again.

**`next` is an ordered list, and that list is the whole policy.** Hand edit, unread, refused, first file, changed seal, unresolved account, missing month, failed law, uncategorised, other review, no balance, stale, payslips, close, scan, scope, clear.
A missing month comes before a failed law because most laws fail for want of a file: L8 fails on any household missing a month. Payslips come before a close, so a month locks the first time. A scan waits behind money. It never says up to date over an open question.

**Domains asked are the Davies world's words.** There is no vocabulary. Finding R-010.

## The bundle

**One script, by concatenation.** `tools/household-bundle.js` walks the requires and wraps each file: no transforms, no dependencies. It is not yet in `build.py` or on the page: `.replace('/*HOUSEHOLD*/', ...)` is one line when the page worker wants it.

**The bundle is pure ASCII.** The browser proof caught a raw ellipsis decoded as windows-1252 on a page with no charset, which changed the words a household stored. The bundle hash did not notice. The proof now compares every table.

**Inflate is ours.** Containers call it synchronously in the middle of a parse, and `DecompressionStream` is async. 80 lines, compared with zlib in the tests.

**The v2 engine comes along.** 70 KB, for `Engine.merchant`. Finding R-004.

## What it cost, measured

Davies-sized: 2,369 files, 10,513 observations, 14,008 postings. Chromium 156, headless, on this Mac. Reproduce with `node tools/household-bundle.js && node tools/household-browser.js`.

| | |
|---|---|
| Script | 739 KB, 202 KB gzipped |
| Load | 16 ms |
| Whole life from nothing, all files, in the page | 1.4 s |
| One rebuild from what the store holds | 252 ms |
| Bundle hash, Node and Chromium | `07a1336af73ccd9b`, the same as `standard/eval/run.js` |
| Hash over every table, Node and Chromium | the same |

The tests were audited by breaking the code on purpose: 45 mutations, each removing one safety (the commit, the dedupe, the hash compare, the guard, the readback, each clock filter, each refusal, the shared data overlay, the honest wording, and so on). All 45 turn a test red. The first pass found one survivor, `as_of` passing `today`, which is why a post-dated line has its own test.

## What it says about itself

Blind 5 had 14 of 63 traps silently wrong, so nothing a person reads calls the engine finished. `next` says what a file shows, never that a number is right. "You're up to date" carries "that means your files are in, not that every number is right", every `status` ends by saying The Kitty is experimental and can be wrong in silence, and the skill tells an agent never to vouch for the numbers. A test scans the words.

## Not proved

- **Nothing here has met the real connector.** The Sheets tools match their published schemas. The Drive `search_files` and `download_file_content` response shapes are guesses, read tolerantly. Quota numbers and whether the connector writes USER_ENTERED or RAW are unknown, which is why there is a probe.
- **Opening a Sheet is about 40 reads:** one per table, in chunks past 2,500 rows, and Google allows about 60 a minute. Davies-sized households will sit through the pacing.
- **Two writers.** The named-row write assumes one writer at a time. A person's phone and laptop writing in the same second could collide. Readback would report it.
- **A person typing a bad value in a yours tab** reaches the engine as is. Only a moved header is caught.
- **A column added to the standard stops an older Sheet.** `rule.direction` arrived during this build. A Sheet made before such a change fails with `header_changed`, loudly and before any write, because no `update` verb exists yet to add the column. No household is on a Sheet today.
- **Scan extraction** has no path in the command line.
