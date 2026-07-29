# CellarTracker implementation

**Status:** implemented locally; database schema deployed 29 July 2026

**Source contract:** `IMPORT-SOURCE-PROFILES.md`

## Source and snapshot model

CellarTracker is the fourth private dataset. It complements the biddable
catalogue, the canonical BBR-held snapshot and historic release-offer prices.

The importer reads the documented 25-column My Cellar CSV as Windows-1252. It
stores the private source object, immutable raw staging rows, parser version
and SHA-256 checksum. An exact file and parser-version re-upload returns the
existing import. Changed reports create separate evidence.

Every upload is a complete periodic snapshot. The latest accepted import by
acceptance time supplies the active view. Earlier accepted imports remain
source history. Acceptance does not inspect a source-embedded date.

The parser deliberately accepts only standard 750 ml holdings. CellarTracker
records size per bottle rather than a wine-level case format, so multi-format
support is outside this dataset. Numeric GBP prices are rounded to the nearest
penny before validation and storage of the comparison value. The original
source text remains in the raw row.

`Quantity` is home-held and `Pending` is BBR-held. Prices are GBP, per bottle
and in bond. A zero `TotalQuantity` row sets `fully_consumed` without creating
a bottle count, consumption date or event.

Invalid staging rows show their validation errors and editable source fields.
The owner can repair or discard a row, or delete the unaccepted import. Import
acceptance remains separate from catalogue matching.

## Active view and comparison

`current_cellartracker_records` reads only the latest accepted snapshot. The
`My CellarTracker` page shows current and consumed wines, home and BBR-held
quantities, recorded purchase price, Parent ID and live BBX values.

Links are stored against `parent_sku`, not a format. For a linked Parent ID,
the market view chooses the smallest available positive `case_size` row and
divides ask and highest bid by that case size. This is an approximate
per-bottle comparison because CellarTracker supplies no case-size relationship.

## Catalogue matching

`/cellartracker/matches` follows the release-price workflow. It operates on
wine-and-vintage groups in the latest accepted snapshot and keeps catalogue
identity separate from current BBX eligibility.

The matching sequence is:

1. Normalise accents, punctuation, spacing and an embedded vintage. Link only
   when the same vintage and exact name resolve to one local Parent ID.
2. For unresolved groups, prepare an Algolia query. When CellarTracker's
   `Producer` value prefixes `Wine`, remove that leading producer and search
   the remaining cuvee or property name. Otherwise search the full wine name.
3. Query the full BBR `prod_product` index with the wine family and vintage
   filters. Runs use batches of 25 groups and resume failed groups.
4. Auto-link only when an exhaustive result contains one exact Parent ID. The
   shared exact rule may remove a trailing country label only when it matches
   the candidate's own country.
5. Store up to five non-exact Algolia results as provisional suggestions. Rank
   and typo count are retrieval evidence, not match probability.

The review page has unresolved, candidate, linked and suppressed filters,
source search and pagination. It supports suggestion confirmation, wider
catalogue search, manual Parent ID entry, edit, unlink, suppress, restore and
group deletion. Resolution changes and deletions write audit events. Unlinked
groups can be retried. Confirmed off-biddable Parent IDs remain linked and gain
live BBX values automatically if they re-enter the eligible catalogue.

The accepted 605-row representative snapshot contained no unique local exact
groups on 29 July 2026. This is expected because CellarTracker and BBR use
different name ordering. A live check of the producer-stripped query `barrua`
with vintage 2018 returned BBR Parent ID `20188027560` as the first Algolia
candidate for `Agricola Punica Barrua`.

## Security and deployment

Source objects remain in the private `cellar-imports` bucket. CellarTracker
tables use owner-only RLS and grant no table access to `PUBLIC` or `anon`.
Views use `security_invoker`. Mutation functions set an empty search path,
re-check the stable owner allowlist and grant execution only to authenticated
sessions.

Migration `20260729124117_cellartracker_catalogue_matching.sql` is applied to
the linked Supabase project. The local and remote migration ledgers matched
through that migration on 29 July 2026.

## Verification and remaining work

On 29 July 2026, ESLint, all 150 web tests and the Next.js production build
passed. The deployed start-run and result-recording RPCs were executed under an
owner identity inside rolled-back transactions. The live Algolia query above
confirmed the source-specific query heuristic.

Two items remain outside the shipped workflow:

- the acceptance page does not yet show the informational additions, removals
  and quantity-change summary against the previous active snapshot; and
- the BBR/CellarTracker reconciliation tool remains roadmap backlog work.
