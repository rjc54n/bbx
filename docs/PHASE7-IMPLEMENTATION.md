# Phase 7 implementation: BBR release prices

**Status:** backend and web workflow implemented and database migrations
applied on 2026-07-26; first historic import and weekly Gmail task pending
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

`release_offer_imports` records historic CSV and Gmail batches. Historic CSV
imports retain the original private Storage object. Gmail imports retain the
complete source message fields in raw source-row evidence and do not invent a
file object.

`release_offer_source_rows` preserves every source row, including duplicates.
It stores the raw row, offer date, source wine, embedded description and
tasting notes, message identity, source product link and matching result.

`release_offer_prices` stores one record per GBP price fragment. The parser
records amount, case size, bottle volume, tax basis and warnings. A fragment is
published only after the import is accepted and all these conditions hold:

- the product match is exact or manually confirmed;
- the case size and bottle volume map to an existing BBX format;
- the amount is explicit; and
- the price states that it is in bond.

Duty-paid, incomplete and ambiguous prices remain pending evidence. They are
not converted or guessed.

The analytical evidence view removes duplicates at product, format, offer
date and amount grain. It never deletes the underlying source rows.

## Matching

Matching order is:

1. a numeric Parent ID obtained from a source or resolved BBR product URL;
2. one unique catalogue product with the same vintage and normalised name;
3. manual confirmation using the Parent ID; or
4. unresolved, with up to three trigram candidates shown for review.

Candidate similarity is a review aid. It never publishes evidence.

Personalised promotion links may be followed when needed to resolve a product.
The job follows a unique link once, applies a request delay, accepts only known
BBR or mail-tracking hosts and requires the final URL to be on `bbr.com`.
Tokens remain confined to raw evidence and are excluded from logs and reports.

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

The protected application has a fourth primary tab, `Release prices`.
It provides URL-backed filters for wine, region, vintage, format, anchor state,
listing state, current bid and an ask below release. The history page shows all
accepted exact evidence and supports confirming an anchor.

`Import data` links to the release-offer import. The upload flow validates the
four-column UTF-8 CSV, stores the source privately, stages batches safely,
shows unresolved rows and parsing samples, and requires explicit acceptance.
Uploading the same checksum and parser version returns the existing import.
An interrupted staging import resumes idempotently when the same file is sent
again.

## Gmail ingestion

The weekly job uses the Gmail and Supabase connectors. Its search is:

```text
label:Wine from:bbr.com -in:trash -in:spam
```

The job uses a high-water mark with a two-day overlap and paginates to the end.
It advances the high-water mark only after the database batch has been
verified. Exact evidence may be accepted. Ambiguous products, formats or tax
bases remain pending.

`release_offer_ingestion_cursors` stores the successful Gmail high-water mark.
`release_offer_link_resolutions` stores only a SHA-256 digest of each tracking
URL plus its public final product URL or failure state. This prevents repeated
clicks without copying personalised tokens into operational state.

The first job is a manual backfill after the historic file's final date,
2026-05-11. The proposed recurring time is Monday at 08:30 Europe/London.
Review the first three weekly runs before treating the job as unattended.

## Security and tests

All release tables use owner-only RLS. `PUBLIC` and `anon` have no table or
view privileges. Views use `security_invoker = true`. Mutation RPCs are
available only to authenticated sessions and repeat the stable owner-ID check.

Acceptance requires:

- all web unit tests and lint pass;
- the production build passes;
- the migration chain replays on clean PostgreSQL;
- pgTAP covers owner, non-owner and anonymous access, import staging,
  publication gates, deduplication, current-market joins, recoup maths,
  resolution and anchor confirmation;
- the representative 3,288-row file can be uploaded twice without duplicated
  evidence; and
- production counts and the first Gmail backfill are reviewed before the
  weekly task is enabled.
