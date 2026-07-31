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
