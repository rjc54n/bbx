# Import source profiles

**Profile date:** 2026-07-25
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

`Pending` agrees closely with the BBR snapshot, but it is not a location field.
After allowing for name ordering and producer aliases, 114 of the 116 BBR rows
have a same-vintage CellarTracker counterpart. Of those, 112 have the same BBR
quantity and CellarTracker `Pending` quantity. The two quantity conflicts are
retained for review. Pintia 2017 and Tignanello 2023 occur in BBR but not in
this CellarTracker file. CellarTracker also has a pending 2021 Domaine de
Thalabert row absent from the BBR file.

This evidence is strong enough to use `Pending` as a reconciliation signal.
It is not sufficient to label every pending bottle as BBR-held. The accepted
BBR snapshot remains authoritative for that location. `Quantity` can be
labelled `home` only after the owner confirms that no other physical location
is represented by this export. Until then its location is
`cellartracker_unspecified`.

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
prove that it was purchased. Product matching uses vintage plus the source
name, retains unresolved rows and records the matching method and confidence.
Direct numeric BBR product identifiers take precedence when a source or
resolved promotion URL supplies one.

Personalised BBR promotion links may be followed when more information is
needed. Automated ingestion follows each unique link at most once, accepts
only known BBR or mail-tracking hosts, rate-limits requests and requires the
final destination to be on `bbr.com`. Tracking tokens are never logged or
stored outside the immutable raw source evidence. The resolved public BBR
product URL and numeric product ID are stored separately for matching.

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
