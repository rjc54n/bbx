# Phase 7 implementation: BBR release prices

**Status:** manual CSV import and whole-dataset product linking.
**Source contract:** `IMPORT-SOURCE-PROFILES.md`

## Outcome

Phase 7 keeps BBR release offers as private, dated evidence and compares exact
product-format anchors with the current BBX ask and highest bid. It supports:

- the current ask against the release price;
- the current bid and estimated seller proceeds against release; and
- a whole-pound bid that would return at least the release outlay after the
  recorded BBX seller commission.

Storage charges are not included in the recoup calculation. The application
must say this beside the result.

## Evidence and publication

`release_offer_imports` records manual historic CSV imports and retains the
original private Storage object. Gmail ingestion is not part of this workflow.

`release_offer_source_rows` preserves every source row, including duplicates.
After approval, every source row is visible in the Release offers tab. A
catalogue link is not a publication condition.

`release_offer_prices` stores one record per GBP price fragment. The parser
records amount, case size, bottle volume, tax basis and warnings. Raw price
fragments remain attached to their source row. They are not converted or
guessed.

## Product matching

The Match page operates across every accepted import. A supplied BBR Parent ID
links first, followed by a unique exact local name and vintage. Remaining wine
and vintage groups are searched against BBR's full `prod_product` Algolia
index. This can find stocked BBR products that are absent from the
`prod_biddable` BBX-eligible universe.

A unique, exhaustively checked Algolia name and vintage result links
automatically. The exact-match comparison drops trailing comma segments that
the candidate itself declares as its country, region or subregion, not only a
trailing country label. Roughly a third of catalogue names carry a geographic
tail two or more segments deep, so a source name that stopped at the country
previously failed to match a candidate whose tail also named the region or
subregion.

Non-exact Algolia results remain suggestions until the owner confirms one.
Suggestions are ordered by how much of the source identity each candidate
accounts for, with Algolia's own rank breaking ties, and each suggestion
stores that score. Word order is still significant here: unlike CellarTracker,
both the release-offer source and the BBR catalogue already share BBR's
ordering, so no order-independent comparison is applied. Algolia rank alone is
not stored or displayed as a probability.

Matching runs are manual, batched and resumable. Existing links and suppressed
records are excluded from retries. Resolution changes have an append-only
audit history. Confirming a group applies only to unresolved source records
with the same normalised wine name and vintage.

## Anchors and comparisons

The oldest published evidence for a product format is the provisional anchor.
The owner can confirm any accepted exact evidence row. A confirmed choice
overrides the provisional anchor without deleting other history.

The market view joins anchors to current `catalogue_view` rows at
`(parent_sku, format_code)`. Bid and ask values therefore change with scanner
updates and do not require another offer import.

The fee schedule records the source and effective date of the seller
commission. With a 10% commission, the minimum whole-pound recoup bid is:

```text
ceil(release_price_p / 90) * 100
```

## Web workflow

The protected application has a `Release offers` tab. It lists every accepted
source record, its original price text, parsed-fragment counts and any existing
link state. The whole-dataset Match page groups repeated source identities,
shows local and wider-catalogue status, and supports confirmation, manual
search, editing, unlinking, suppression and restoration.

`Import offers` links to the release-offer import. The upload flow validates
the UTF-8 CSV, stores the source privately, stages batches safely, shows
parsing samples and requires explicit acceptance.
Uploading the same checksum and parser version returns the existing import.
An interrupted staging import resumes idempotently when the same file is sent
again.

## Reset

Delete an import to remove its source rows, parsed fragments and product-link
decisions. The private Storage object is removed first, so a Storage failure
leaves the import available for retry.

## Security and tests

All release tables use owner-only RLS. `PUBLIC` and `anon` have no table or
view privileges. Views use `security_invoker = true`. Mutation RPCs are
available only to authenticated sessions and repeat the stable owner-ID check.

Acceptance requires:

- all web unit tests and lint pass;
- the production build passes;
- the migration chain replays on clean PostgreSQL;
- pgTAP covers owner, non-owner and anonymous access, import staging,
  deterministic matching, provisional Algolia suggestions, exact Algolia
  links, group decisions, resumable errors and audit history;
- the representative 3,288-row file can be uploaded twice without duplicated
  evidence; and
- production accepted-offer counts are checked after import.
