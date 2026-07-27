# Phase 7 implementation: BBR release prices

**Status:** manual CSV import and independent product linking.
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

## Deferred matching

Matching, manual links, ignored records and re-matching belong on a future
whole-dataset Match page. It must operate across all accepted imports, never
one import at a time. The initial matching sequence remains supplied BBR Parent
ID, then unique exact name and vintage, then unresolved. Probabilistic matching
is out of scope.

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
link state. The page is paginated past the Data API response cap.

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
  accepted-offer visibility and import deletion;
- the representative 3,288-row file can be uploaded twice without duplicated
  evidence; and
- production accepted-offer counts are checked after import.
