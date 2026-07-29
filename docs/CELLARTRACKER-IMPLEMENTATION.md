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

1. Build identity as an order-independent set of core tokens on both sides:
   accents folded, vintages and articles dropped, producer words deliberately
   kept. BBR names additionally have wholly geographic trailing comma segments
   removed, but never the first segment, so a Burgundy cru name that is also
   an appellation is never stripped.
2. Tier one links locally across the whole product table, with no Algolia
   call, whenever the CellarTracker and BBR core keys are identical and
   resolve to one Parent ID.
3. Groups tier one leaves unresolved get two Algolia shortlist queries against
   the BBR `prod_product` index: one with the leading producer stripped to
   surface the distinctive cuvee name, and one on the full identity with
   optional words, so CellarTracker-only tokens cannot force a zero-hit
   strict AND. Their hits are unioned. Runs use batches of 20 groups (two
   queries per group, within Algolia's 50-query multi-search limit) and
   resume failed groups.
4. Candidates are ranked locally by token overlap, not by Algolia's ordering.
   Tier two auto-links only a unique exact-set candidate, or a unique
   containment winner that is clearly ahead of the rest of the field.
5. Store up to five ranked candidates as provisional suggestions, each with
   its match score. Rank and typo count remain retrieval evidence; match score
   is the local ranking signal.

The review page has unresolved, candidate, linked and suppressed filters,
source search and pagination. It supports suggestion confirmation, wider
catalogue search, manual Parent ID entry, edit, unlink, suppress, restore and
group deletion. Resolution changes and deletions write audit events. Unlinked
groups can be retried. Confirmed off-biddable Parent IDs remain linked and gain
live BBX values automatically if they re-enter the eligible catalogue.

Order-independent core keys let tier one link CellarTracker's producer-first
names against BBR's producer-later names directly, something the earlier
full-string comparison could never do. The former exhaustive multi-page
validation pass, which paged through an entire Algolia result set looking for
a unique exact hit, is retired: tier one now owns whole-catalogue exactness,
and Algolia is used only to shortlist candidates for local ranking. Against 14
representative rows, ranking put the correct product first in 13 and
auto-linked 12 with no incorrect links; the one deliberate non-link is a wine
absent from the catalogue.

## Security and deployment

Source objects remain in the private `cellar-imports` bucket. CellarTracker
tables use owner-only RLS and grant no table access to `PUBLIC` or `anon`.
Views use `security_invoker`. Mutation functions set an empty search path,
re-check the stable owner allowlist and grant execution only to authenticated
sessions.

Migration `20260729124117_cellartracker_catalogue_matching.sql` is applied to
the linked Supabase project. The local and remote migration ledgers matched
through that migration on 29 July 2026.

Migration `20260729160000_cellartracker_token_matching.sql`, which introduces
the core-key functions and the tier-one join, is applied to the linked Supabase
project. The local and remote migration ledgers matched through that migration
on 29 July 2026.

## Verification and remaining work

On 29 July 2026, ESLint, all 181 web tests and `tsc --noEmit` passed. The
core-key and ranking rules are covered by 34 unit tests built from real
`prod_product` records, and the two shortlist query shapes were checked against
the live index.

The SQL core-key functions are valid against the deployed schema: the migration
applied cleanly, so the expression index on `private.products` and the
generated `source_core_key` column were both accepted. Their behaviour is not
yet confirmed. No local Postgres was available, so
`supabase/tests/database/cellartracker_core_key.test.sql`, which asserts the
same 37 expected core keys the TypeScript suite asserts, has not been run.

Three items remain outside the shipped workflow:

- the core-key functions need the pgTAP run and a match run against the
  accepted snapshot, recording `local_exact_link_count` and
  `algolia_exact_link_count`, before the new tiers can be relied on;

- the acceptance page does not yet show the informational additions, removals
  and quantity-change summary against the previous active snapshot; and
- the BBR/CellarTracker reconciliation tool remains roadmap backlog work.
