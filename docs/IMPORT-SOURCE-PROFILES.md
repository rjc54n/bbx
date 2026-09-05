# Import source profiles

**Profile date:** 2026-07-31
**Data handling:** source files are private and remain outside Git

This document records the contracts observed in the three representative CSV
files. Counts describe these files, not a permanent limit or a promise about
future exports.

## BBR current holdings

Source: `my-cellar-view-2026-07-23.csv`
SHA-256: `ddeb94d5b188c05258787de804965464a2cbe503d7bf8acb7e24e803011b874d`

The file has 116 data rows and 28 columns. Every row has a distinct `Parent ID`
and `Product Code(s)`. A live catalogue check on 2026-07-25 resolved all 116
`Parent ID` values to `catalogue_view.parent_sku`.

The snapshot contains 837 bottles. In this file:

- all 116 rows are `75 cl` bottles;
- all 116 are marked `YES` for `Eligible for Sale on BBX`;
- all 116 have status `In bond`;
- 104 rows have `Quantity in Bottles` equal to `Case Size`; and
- `Selling Case Quantity on BBX`, `Selling Price on BBX` and
  `Purchase date / warehouse goods in date` are blank throughout.

The parser must accept the exact observed headers, strip a UTF-8 byte-order
mark from the first header and retain unknown future columns in the raw row.
`Parent ID` is the direct product match. `Bottle Volume` plus `Case Size`
select the format. `Product Code(s)` remains source evidence and a secondary
diagnostic identifier.

BBR is authoritative for the current BBR-held position. Market-price, bid,
BBX listing and maturity columns are attributes of this dated export. They do
not replace the catalogue scan or create holding movements. `Account Payer`
and `Beneficial Owner` are personal fields and must never enter logs, public
views or synthetic fixtures.

## BBR recovered historical exports (Slice 0)

**Profile date:** 2026-09-05. Inputs: two recovered `my-cellar-view-*.csv`
exports, dated in the filename, supplied by the owner and never searched for.
Neither file was added to Git; both are covered by a new `.gitignore` entry.
No `Account Payer` or `Beneficial Owner` value appears anywhere below.

| File | SHA-256 | Data rows | Header count |
|---|---|---:|---:|
| `my-cellar-view-2025-05-21.csv` (historic) | `6b1c9a878a992159bf795c7523c731ae871df954f86c0bba1700f546d1c23e80` | 130 | 30 |
| `my-cellar-view-2026-09-05.csv` (current) | `a44d39d578570ab50b9a4d27eb5406509a7109ef84737327a43dfda654121596` | 121 | 28 |

**1. Header sets.** The current file's 28 headers match `BBR_HEADERS` exactly,
so `parseBbrCsv` accepts it as-is. The historic file does not: it is missing
four headers the parser requires —
`Drinking Window (From)`, `Drinking Window (To)`, `Alcohol Content`,
`Purchase date / warehouse goods in date` — and carries six the parser does
not know about — `Pending Sale Case Quantity on BBX`, `Provenance`,
`Bottle Condition`, `Packaging Condition`, `Wine Condition`, `Own Goods?`.
`parseBbrCsv` rejects it outright with a missing-headers `BbrFileError`
before any row is parsed. **The header contract does differ, so Slice 0b is
required**: split `BBR_HEADERS` into required and optional names, accept the
historic file's narrower set, and bump `BBR_PARSER_VERSION` to `bbr-v2`.

Two different fates apply to the four headers missing from the historic file.
`Drinking Window (From)`, `Drinking Window (To)` and `Alcohol Content` are
columns BBR has added since 2025-05-21, and the current parser already parses
them into typed columns (`drinking_window_from`, `drinking_window_to`,
`alcohol_percent`). Slice 0b should make these **optional-but-typed**: parsed
and stored exactly as today when the column is present, left `null` when it
is not — not demoted to `raw_row`-only, since they are the kind of BBR-added
field worth capturing going forward as coverage improves. `Purchase date /
warehouse goods in date` stays untyped per finding 5 and the second review.
The six columns present only in the historic file (`Pending Sale Case
Quantity on BBX`, `Provenance`, `Bottle Condition`, `Packaging Condition`,
`Wine Condition`, `Own Goods?`) are the reverse case — BBR has since dropped
them — and Slice 0b should decide whether any is worth an optional typed
field or all stay in `raw_row` only.

**2. Repeated `(Parent ID, derived format)` rows.** Replicating the parser's
own `Case Size` + `Bottle Volume` derivation, **zero repeats** were found in
either file. Every row is unique at that grain. This is a two-file sample —
one current, one seven-quarters-old — so it is thin evidence for a
never-changing invariant, but it is what was recoverable, and the plan does
not set a minimum sample size for this decision. **D10 branch selected: no
repeats.** Keep the existing parser rejection of a repeated position, add
`UNIQUE (import_id, parent_sku, format_code)` in Slice 3, and treat
observation grain as equal to evidence grain. Slices 3, 7 and 9 should be
written against this branch. If a wider set of historic exports later turns
up a repeat, that is a design change to re-open, not a bug in these two
files.

**3. Same-day exports.** None. The two files are almost 16 months apart; no
pair in this sample shares an effective date, so D2's one-snapshot-per-date
rule is not exercised here and remains untested against a real same-day
pair.

**4. Byte-identical pairs.** None — the files differ in size (30,889 vs
33,759 bytes), row count and header set, and their SHA-256 digests differ.
The D9 duplicate-file case remains unobserved in this sample.

**5. `Purchase date / warehouse goods in date`.** Absent from the historic
file (not one of its 30 headers). Present in the current file but blank on
all 121 rows. Confirms the second review's basis for keeping this column out
of typed evidence in this version.

**6. Row counts and end-to-end outcome.** Historic file: 130 data rows,
rejected at the header-check stage — no row reaches duplicate detection or
catalogue matching. Current file: 121 data rows, passes the header check,
zero rows are marked `invalid` by the repeat check (finding 2), so all 121
proceed to catalogue matching (not exercised here, since Slice 0 touches no
database).

**Conclusion.** The parser needs a changed header contract (Slice 0b, exact
scope above) before Slice 2 can proceed. D10 is decided: no-repeats branch.
Findings 3 and 4 are inconclusive on this two-file sample and are not gating.

**Slice 0b implementation, 2026-09-05.** Running the parser against both real
files (not just fixtures) surfaced two more differences the header/row-count
scan above did not, both now fixed in `bbrParser.ts` (`BBR_PARSER_VERSION`
bumped to `bbr-v2`):

- The historic file ends with one physical line that is not a data row — a
  BBR terms-of-service disclaimer with 2 fields instead of 30 — which made
  `csv-parse` throw before header validation even ran. The parser now allows
  a ragged column count and drops trailing rows whose length doesn't match
  the header, recording the count on the parser's return value
  (`droppedTrailingRowCount`); a short/ragged row anywhere other than the
  end of the file still fails that row's validation as before, unchanged.
- 127 of the historic file's 129 real rows use `Y`/`N` for
  **Eligible for Sale on BBX** rather than `YES`/`NO`. Owner-confirmed this
  field distinguishes in-bond BBR-warehouse stock (listable) from stock held
  elsewhere, and `Y`/`N` is the same two-state fact as BBR's older export
  spelling — `parseEligibility` now accepts both forms.
- One row's `Purchase Price per Case` carried excess floating-point
  precision (`109.97999999999999`). `parseMoneyPence` now accepts any
  decimal precision and rounds to the nearest penny, matching the existing
  convention in `cellartrackerParser.ts`'s `price()`, rather than rejecting
  anything past two decimals.

Both recovered files now parse end to end with zero row-level validation
errors.

## CellarTracker My Cellar summary

Source: `My Cellar.csv`
SHA-256: `2c310a979e27f4662da9d9bba088d39ee85d5eb8957101364a158cf8c3f80b52`

The file is Windows-1252 encoded, not UTF-8. Decoding it as UTF-8 corrupts
producer and appellation names. The import parser must detect or explicitly
support Windows-1252 before parsing CSV.

The file has 605 data rows and 25 columns. A row is unique at the observed
`Vintage`, `Wine` and `Size` grain. The quantity fields are internally
consistent on every row:

`TotalQuantity = Quantity + Pending`

The observed position is:

| Measure | Rows | Bottles |
| --- | ---: | ---: |
| Positive `Quantity` | 92 | 266 |
| Positive `Pending` | 115 | 843 |
| Both positive | 6 | included above |
| Positive `TotalQuantity` | 201 | 1,109 |
| Zero `TotalQuantity` | 404 | 0 |

All 201 positive rows have size `750ml`. All 404 zero-total rows have size
`(n/a)`, zero value and zero price. `PScore` is populated on only two rows and
`CScore` is blank throughout. `BeginConsume` is `9999` on 584 rows and
`EndConsume` is `9999` on 567 rows.

`9999` is not a usable drinking year in this application. The current parser
stores it as an integer and the wine card can display it as a year. This is a
known defect. Until the parser-version and existing snapshot treatment are
decided, consumers must treat `9999` as unknown. See
[`CODEBASE-REVIEW-2026-07-31.md`](CODEBASE-REVIEW-2026-07-31.md).

`Price` is a GBP per-bottle source value. Nine positive rows use four decimal
places because CellarTracker has divided a case cost; the parser normalises any
numeric GBP source price by rounding it to the nearest penny before validation
or storage of the comparison value.

This is a wine-level summary, not an all-time transaction export. It has no
purchase date, consumed quantity, consumption date, movement, location, bin or
source record ID.

**Product decision, 2026-07-25:** treat a zero-total row as evidence that all
bottles of that wine have been consumed. This is a wine-level `fully_consumed`
state. It does not supply the number of bottles consumed or the consumption
dates. The file therefore supports:

- current CellarTracker quantities;
- a `fully_consumed` state for zero-total wines; and
- drinking-window, taxonomy and price fields where populated.

It does not support bottle-level consumption history or a lifetime purchase
and movement ledger. Those would require a separate CellarTracker transaction
or bottle export.

`Pending` agrees closely with the BBR snapshot. After allowing for name
ordering and producer aliases, 114 of the 116 BBR rows have a same-vintage
CellarTracker counterpart. Of those, 112 have the same BBR quantity and
CellarTracker `Pending` quantity. The two quantity conflicts are retained for
future reconciliation. Pintia 2017 and Tignanello 2023 occur in BBR but not in
this CellarTracker file. CellarTracker also has a pending 2021 Domaine de
Thalabert row absent from the BBR file.

**Product decision, 29 July 2026:** `Quantity` is the owner-confirmed home-held
position and `Pending` is the owner-confirmed BBR-held position. This resolves
the previous provisional location caveat. The source remains a periodic
summary, not a movement ledger.

Each upload is a complete snapshot. SHA-256 plus parser version identifies an
exact re-upload. A changed full report creates new immutable evidence. The
latest accepted import by acceptance time supplies the active CellarTracker
view; earlier accepted imports remain source history. No source-embedded date
guard is applied.

Matching is separate from import acceptance. It groups the latest snapshot by
normalised wine name and vintage. Tier one links a unique Parent ID when the
order-independent CellarTracker and BBR core-token sets match across the local
product table. Remaining groups use two bounded `prod_product` Algolia
shortlists, including a producer-stripped query where appropriate. Candidates
are ranked locally. Tier two links only a unique exact-set candidate or a
unique containment winner that is ahead of the rest. Other results remain
provisional suggestions for confirmation.

Links are stored at `parent_sku` grain and remain valid when the wine is absent
from the current BBX-eligible catalogue. CellarTracker has no case-size field.
For market comparison, the application converts every available positive
case-size and bottle-volume format to a 75cl bottle equivalent using
`price * 750 / (case_size * bottle_volume_ml)`. It then selects the lowest
normalised ask and highest normalised bid for the linked Parent ID.

## Historic BBR offers

Source: `BBR Offers of Interest - Historic Offers.csv`
SHA-256: `94becb93a1cfbdd0fba523cb83632e1daf1ebe267fd3e27bd145cc440784ac43`

This file belongs to the release-price connector rather than the Phase 5
holdings import. It has 3,288 data rows and four columns: `Date`, `Wine`,
`Case Price` and `JSON_Data`. Dates run from 2010-05-19 to 2026-05-11.

All 3,288 JSON values parse. Each has `date`, `wine`, `description` and
`tasting_notes`; the JSON date and wine agree with the corresponding flat
columns on every row. No `Case Price` value is blank. There are:

- 121 exact duplicate rows;
- 188 duplicate occurrences at the `Date`, `Wine`, `Case Price` grain; and
- 696 rows whose price field contains multiple offers separated by `;`.

The version 1 parser extracts 5,166 GBP price fragments. Of those, 4,846
contain an exact case size and bottle volume, and 4,532 also state an in-bond
basis. Parsing success does not imply a catalogue match or publication.

The raw import keeps every source row, including duplicates. The normalised
offer projection deduplicates exact evidence by a stable content fingerprint
and expands multi-price strings to one candidate per stated format. It must
retain the original price text and JSON beside any parsed amount, case size,
bottle volume and currency.

These records prove that a wine was offered at the stated price. They do not
prove that it was purchased. Accepted records remain visible without a product
link. The Match page links the complete accepted dataset to the catalogue.
Direct numeric BBR product identifiers take precedence over a unique exact
name and vintage match.

## Import boundary

The three sources must not be merged into one undifferentiated cellar table:

- BBR current holdings are dated remote-stock snapshots.
- CellarTracker My Cellar files are dated inventory summaries with a derived
  `fully_consumed` state for zero-total rows.
- Historic BBR offers are dated offer evidence.
- A future CellarTracker event export will supply purchases, movements and
  consumption.

Every accepted projection points back to its import and source row. Conflicts
remain visible. No source silently overwrites another source's evidence.

## Release-offer reset, 27 July 2026

Release offers now use manual CSV imports only. Existing release-offer imports,
Gmail cursor history and matching state were removed before the new workflow.
The clean historic CSV keeps the 3,288-row base and the later enriched
129-row increment. It must stage 3,417 source rows and 5,412 price fragments.
The earlier un-enriched 129-row increment is excluded.

## Owner decisions survive the next upload, 30 July 2026

Evidence is import-scoped. A decision about a wine is not. Links, price
corrections and exclusions were all keyed to `(import_id, source_row_number)`,
which meant an upload could undo work the owner had already done:

- **CellarTracker** replaces the active snapshot outright, so the next accepted
  file arrived with no links, no price corrections and every excluded record
  back in place. Manual and Algolia-confirmed matches were lost with it, so
  re-matching cost Algolia calls and repeated the confirmation work.
- **Release offers** accumulate rather than replace, so links survived, but a
  later file repeating a deleted row reintroduced it.
- **BBR** has no manual edits or deletions, so it had nothing to lose.

A durable decision layer now sits beside the evidence, keyed on identifiers
that survive re-import: `match_group_key` plus the source wine text for
CellarTracker (`cellartracker_record_decisions`), and the content fingerprint
for release offers (`release_offer_record_exclusions`).

**Exclusion replaces deletion.** Excluding a record leaves the evidence row in
place and filters it out of the read views. The record is therefore hidden
everywhere, kept out of future imports, and restorable in one call. Both
sources list their excluded records for restore. The audit event is unchanged.

**Accepting a CellarTracker snapshot re-applies the decisions.** The import
page shows what will be carried before the owner commits — links, price
corrections, records kept excluded, and records new to them — and reports what
was applied afterwards.

One asymmetry is deliberate. A price correction is re-applied only where
CellarTracker still reports the value that was corrected. If the source itself
has changed, the new source value is kept and the held-back correction is
reported, because a changed source may be the upstream fix. Both the pre-accept
panel and the post-accept summary carry that count.

A confirmed release-price anchor whose offer is later excluded falls back to
the provisional pick. The override row is retained, so restoring the offer
restores the confirmation, and `release_price_anchor_view` reports the anchor
as provisional in the meantime rather than labelling a provisional pick
confirmed.
