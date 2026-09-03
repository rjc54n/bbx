# BBR holdings history: implementation plan

**Status:** revision 2, 3 September 2026, revised in response to
[`BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN-REVIEW.md`](BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN-REVIEW.md).
For review. No code or migration written; nothing applied to any database.

Revision 1 (3 September 2026) was the first plan. Every review finding is
answered in [§8](#8-review-response); eight were accepted and changed the
plan, one was accepted with a different remedy, and one exposed a conflict
with the agreed functional spec that the owner has to settle (D9).

**Product authority:**
[`BBR-HOLDINGS-HISTORY-FUNCTIONAL-SPEC.md`](BBR-HOLDINGS-HISTORY-FUNCTIONAL-SPEC.md).
**Constraints and open technical questions:**
[`BBR-HOLDINGS-HISTORY-ENGINEERING-VIEW.md`](BBR-HOLDINGS-HISTORY-ENGINEERING-VIEW.md).
**Stories and acceptance criteria:**
[`BBR-HOLDINGS-HISTORY-EPIC.md`](BBR-HOLDINGS-HISTORY-EPIC.md).

---

## 1. Verified baseline

Read from the deployed code and migrations on 3 September 2026, not from the
companion documents.

### Schema

`supabase/migrations/20260725120000_bbr_cellar_import.sql` defines:

- `public.cellar_imports` — shared by `bbr_holdings` and
  `cellartracker_inventory` (`20260729105057_cellartracker_inventory.sql`
  widened the `source_type` check). Any new column added here is visible to
  both sources, so BBR-only rules must be source-scoped `CHECK` constraints
  and partial indexes, never table-wide `NOT NULL`. Line 72 carries
  `UNIQUE (source_type, content_checksum, parser_version)`.
- `public.cellar_import_rows` — `(import_id, source_row_number)`, holds
  `raw_row JSONB` and a `(parent_sku, format_code)` foreign key to
  `public.skus`. Both columns are `NULL` unless `match_status = 'matched'`.
- `public.bbr_holding_evidence` — `(import_id, source_row_number)`, the typed
  BBR row, also foreign-keyed to `public.skus`.
- `public.stage_bbr_import(...)` — inserts evidence
  `WHERE r.match_status = 'matched'`. Unmatched rows never reach evidence.
- `public.accept_bbr_import(p_import_id)` — sets `status`, `accepted_at`,
  `accepted_by`. It takes no date and no role.
- `public.current_bbr_holdings` — selects the accepted import with the newest
  `accepted_at`, ties broken by `id DESC`.

`20260725170000_bbr_cellar_market_view.sql` adds `bbr_cellar_market_view`,
which is `current_bbr_holdings LEFT JOIN catalogue_view` on
`(parent_sku, format_code)`. The decoration is already a left join; the
coupling to the catalogue is enforced by the foreign keys, not by this view.

### Application

- `apps/web/src/lib/cellar/bbrParser.ts` — `BBR_PARSER_VERSION = "bbr-v1"`;
  `BBR_HEADERS` is an exact 28-name contract and `parseBbrCsv` throws
  `BbrFileError` if any one is missing; `matchBbrRows` downgrades a valid row
  to `unmatched` when the catalogue has no exact `(parent_sku, format_code)`.
- `app/(protected)/cellar/imports/bbr/actions.ts` — upload, checksum dedupe
  (lines 110–124, which return the existing import and delete the newly
  uploaded object), parse, catalogue check, `stage_bbr_import`,
  `accept_bbr_import`.
- `app/(protected)/cellar/imports/bbr/[id]/page.tsx` — preview. Its diff
  against `current_bbr_holdings` produces three integers and no identities.
- `app/(protected)/cellar/bbr/page.tsx` and
  `components/cellar/BbrCellarBrowser.tsx` — the cellar browser, filtered and
  sorted client-side by `lib/cellar/bbrBrowser.ts`.
- Consumers of `current_bbr_holdings`: the BBR imports list page, the BBR
  import detail page, and `app/(protected)/wine/parent/[parentSku]/page.tsx`.
  `bbr_cellar_market_view` has one consumer, the cellar page.

### Data shape

From [`IMPORT-SOURCE-PROFILES.md`](IMPORT-SOURCE-PROFILES.md):
`my-cellar-view-2026-07-23.csv` has 116 data rows, 837 bottles, one distinct
`Parent ID` per row, and all 116 resolved to the catalogue.
`Purchase date / warehouse goods in date` is present as a header but blank
throughout, and is not read by the parser.

### Consequences that shape this plan

1. **The header contract will reject old exports.** `parseBbrCsv` fails the
   whole file if any of the 28 headers is absent. Recovered exports from
   earlier years are the most likely place for the column set to differ. This
   is the largest schedule risk and is why Slice 0 exists.
2. **Position uniqueness inside a snapshot is enforced only by the parser.**
   `parseBbrCsv` marks a repeated `(parent_sku, format_code)` invalid, but
   `bbr_holding_evidence` has no constraint on it. The consolidated projection
   depends on that uniqueness, so it must become a database constraint.
3. **`quantity_bottles > 0` is a check constraint.** A position cannot be
   observed at zero; absence from a snapshot is the only exit signal, which
   matches the spec's observational language.
4. **`cellar_import_rows.raw_row` contains `Account Payer` and
   `Beneficial Owner`.** Every new projection must be built from
   `bbr_holding_evidence`, never from `raw_row` (spec §10).
5. **One accepted BBR import exists**, so backfill is a single row and
   before/after equivalence of `current_bbr_holdings` is cheap to prove. It is
   also the *only* row, so migrations must not assume a row exists — a clean
   `supabase db reset` or CI replay runs them against an empty database.
6. **The wine record page renders from BBR holdings alone.**
   `app/(protected)/wine/parent/[parentSku]/page.tsx:176-182` treats
   `bbrHoldings.length > 0` as sufficient to render, and falls back to
   `bbrHoldings[0]?.description` for the wine's name. Revision 1 stated the
   opposite. This is corrected in D3 and it is a real, intended contract
   expansion once unmatched rows reach evidence.
7. **The cellar heading prints the acceptance timestamp.**
   `components/cellar/BbrCellarBrowser.tsx:154` reads
   "Holdings confirmed {formatDateTime(confirmedAt)}", where `confirmedAt` is
   `cellar_imports.accepted_at`. Once an effective date exists, that heading
   is showing the wrong date. See D7.

---

## 2. Design decisions

These answer the engineering view's §10 questions. Each is a recommendation,
not an agreed decision; [§7](#7-questions-for-the-owner) lists the ones that
need an answer before Slice 2 is written.

### D1 — Current authority is a role column plus a partial unique index

*(engineering view Q1)*

Add to `public.cellar_imports`:

| Column | Type | Meaning |
|---|---|---|
| `effective_date` | `DATE` | Owner-confirmed date the file described holdings. |
| `accepted_role` | `TEXT` | `'current'` or `'historical'`, set at acceptance, never edited. |
| `superseded_at` | `TIMESTAMPTZ` | When a later current declaration replaced this one. |
| `superseded_by` | `UUID` | The import that replaced it. |

The nominated current snapshot is
`accepted_role = 'current' AND superseded_at IS NULL`, enforced by

```sql
CREATE UNIQUE INDEX cellar_imports_one_nominated_current_idx
    ON public.cellar_imports (source_type)
    WHERE source_type = 'bbr_holdings'
      AND status = 'accepted'
      AND accepted_role = 'current'
      AND superseded_at IS NULL;
```

Rejected: a singleton `bbr_current_snapshot` pointer table. It needs its own
RLS, grants, policies and pgTAP coverage, and it lets the pointer and the
import disagree. The partial index cannot disagree with itself, and it
generalises to a second source type for free.

A superseded current declaration keeps `accepted_role = 'current'`, which is
what records "it was once accepted as current" (epic decision 5).
`superseded_at` is what stops it being authoritative now.

### D2 — Effective date is date-only, and unique among accepted snapshots

*(Q2, Q3)*

`DATE`, no time component. A second accepted BBR snapshot with the same
effective date is refused at acceptance:

```sql
CREATE UNIQUE INDEX cellar_imports_bbr_effective_date_idx
    ON public.cellar_imports (source_type, effective_date)
    WHERE source_type = 'bbr_holdings' AND status = 'accepted';
```

This makes the effective-date ordering total, so "deterministic tie handling"
(spec §4.3) needs no tie-breaker rule, no sequence column and no fallback to
`accepted_at` or UUID order. Two complete snapshots dated the same day are a
dating mistake or a redundant file; refusing the second with an explicit error
is the smallest thing that can be built, and the index can be widened later
without touching an evidence row.

This index is also the load-bearing invariant behind D9: it is what stops two
snapshots describing the same day, whatever happens to file-level dedupe.

### D3 — Ownership evidence stops depending on catalogue coverage

*(Q4)*

Drop the `bbr_holding_evidence (parent_sku, format_code) → public.skus`
foreign key. `parent_sku` becomes the BBR-asserted Parent ID and
`format_code` the source-derived format, always populated for a valid row.
Add `catalogue_matched BOOLEAN NOT NULL`, recording whether local resolution
succeeded *at import time* — spec §7.3 asks the position history to show
"whether local catalogue decoration was available", which is a dated fact
about the observation, not about the catalogue today.

`stage_bbr_import` then inserts evidence for
`match_status IN ('matched', 'unmatched')`.

`cellar_import_rows` is left alone. It is shared with CellarTracker, its
`parent_sku` keeps meaning "resolved catalogue identity", and nothing here
needs to change it.

Rejected: a parallel `bbr_ownership_evidence` table for unmatched rows. It
doubles the write path, the RLS surface and every projection's union, to store
identical columns.

**Two contract changes follow, both intended, both now tested.**

*`current_bbr_holdings` starts including rows with no catalogue match.*
Present-data impact is nil — the one accepted import matched 116 of 116 — so
the equivalence check in Slice 4 still passes exactly.
`bbr_cellar_market_view` already left-joins, so such a row arrives with null
market columns, which is what spec §7.4 asks for.

*The wine record page becomes reachable for an unmatched Parent ID.* Revision
1 claimed it could not be. It can: the route renders whenever
`bbrHoldings.length > 0` and names the wine from `bbrHoldings[0].description`.
That is the right behaviour — a wine the owner demonstrably held should have a
record even when the local catalogue has never seen it — but it is a widened
route contract and is treated as one: documented in
[`WINE-RECORD-SPEC.md`](WINE-RECORD-SPEC.md) and covered by a test asserting
that such a page renders with BBR identity, no catalogue formats and no market
figures, rather than 404ing or throwing.

### D4 — Derived history is query-time views, with a stated revisit threshold

*(Q5, Q8)*

At 116 positions per snapshot, ten recovered snapshots are ~1,200 evidence
rows and twenty are ~2,300 — smaller than several views this application
already serves on every page load. Plain `security_invoker` views over
`bbr_holding_evidence` are the right answer; a materialised read model would
be speculative cost.

Four new views:

- `bbr_snapshot_view` — the accepted-snapshot calendar and import history of
  spec §8: filename, effective date, upload and acceptance times, derived
  state (`historical` / `nominated_current` / `superseded_current`), row
  counts and validation state. Never selects `raw_row`.
- `bbr_position_observations` — observation grain: one row per
  `(import_id, parent_sku, format_code)` for accepted BBR imports, carrying
  `effective_date`, `accepted_role`, `superseded_at`, quantity, reported
  price, source status fields and `catalogue_matched`. Never selects
  `raw_row`.
- `bbr_positions_view` — consolidated grain: one row per
  `(parent_sku, format_code)` with `membership` (D8),
  `current_quantity_bottles`, `first_seen`, `last_seen`, `absent_by`,
  `reported_price_min_p`, `reported_price_max_p`, `observation_count`,
  `latest_observation_date`, `latest_catalogue_matched`.
- `bbr_cellar_positions_market_view` — `bbr_positions_view` left-joined to
  `catalogue_view`, exposing the same decoration columns as
  `bbr_cellar_market_view` so the existing browser is adapted rather than
  rewritten.

`current_quantity_bottles` comes only from the nominated current snapshot
(spec §5.4). `absent_by` is the earliest accepted `effective_date` after
`last_seen`, computed by a lateral against the snapshot calendar.

**Episodes need the calendar, not just the observations.** Revision 1 said
episodes were derived "from one position's ordered observation list". That is
insufficient and the review is right: observations in 2021 and 2024 cannot
distinguish continuous holding from present → absent → present, because the
list does not say which snapshots existed in between. The corrected design:

`lib/cellar/bbrEpisodes.ts` takes **two** inputs — the full ordered accepted
snapshot calendar from `bbr_snapshot_view` (one row per snapshot, a handful of
rows) and the position's observations from `bbr_position_observations` — and
walks the calendar, emitting a present run, an absence, then a further present
run. A position with no observation at a calendar date is absent at that date;
that is the only inference made, and it is exactly the evidence-of-absence
statement spec §5.3 permits.

This keeps derivation in the presentation layer, which the review explicitly
allows once the layer receives enough evidence, and keeps episode state out of
the write model (engineering view §3.4).

**Revisit threshold, stated now so it is not a later judgement call:** if
accepted BBR snapshots exceed 40, or `bbr_holding_evidence` exceeds 20,000
rows, or the cellar page's server timing for this query exceeds 300 ms,
re-measure and consider a materialised model. Until then, no MV.

### D5 — Correction is a narrow audited amendment, not delete-and-resubmit

*(Q6)*

The engineering view asks for both to be estimated.

**Delete and resubmit.** Needs a `delete_bbr_import` RPC (the CellarTracker
one in `20260729120310` is ~10 lines, so this part is small); private Storage
object cleanup in the server action, which is the part that fails silently and
leaves orphans; release of the file-identity row so the same file can be
re-uploaded; a guard for the nominated-current reference; and re-upload of a
file the owner may no longer have — the recovered-backup case is exactly where
the original is hardest to produce twice. Roughly 40 lines of SQL, 60 of
TypeScript, plus the Storage failure mode.

**Audited amendment.** Needs a `bbr_import_date_amendments` audit table (~25
lines with RLS and grants) and an `amend_bbr_effective_date` RPC (~50 lines)
re-checking the same chronology rules acceptance uses. No Storage work, no
file-identity interaction, no re-upload, and the source file and every source
row are untouched, which is what BBRH-10 actually requires.

**Recommendation: the amendment.** Smaller in total, cannot orphan a Storage
object, does not depend on the owner still holding the file. The immutability
concern in the engineering view §5 is answered by the column split:
`effective_date` and `accepted_role` are owner assertions attached to the
import (spec §3.3), not source facts, and only the date is amendable.

Constraints: owner-only; never changes `accepted_role`; must leave the
nominated current snapshot no earlier than every other accepted snapshot; must
not collide with another accepted snapshot's date (D2); writes one audit row
with old date, new date, actor and timestamp; requires confirmation in the UI.

`withdraw_bbr_current_nomination` remains, and D8 removes the reason the
review questioned it: the unknown state has to exist and be rendered anyway,
because it is also the state of a database with no accepted snapshot at all.
Given the state exists, withdrawal is a few lines, and without it the owner
who discovers the nominated snapshot is wrong and has no replacement has no
safe move. It is never a side effect of anything else.

### D6 — Deployment sequence: the freeze is announced, and short

*(Q7)*

The review is right that revision 1 left the Accept control visible while the
database refused every acceptance, for five migrations. Two changes:

**The freeze is visible in the release that starts it.** Slice 1 is an
app-only deploy that disables the Accept control and explains why, shipped
*before* any migration. No release ever presents a button that cannot work.

**The freeze covers three migrations, not five.** Only chronology (Slice 2),
the acceptance RPCs (Slice 3) and the current-authority switch (Slice 4) are
needed before acceptance can be restored. Evidence coverage and the history
projections do not gate acceptance and move after it. The three can be pushed
and smoke-tested in one working session.

**Slice 5 restores acceptance at capability parity**, offering only the
`current` role — the one thing the owner could already do — now with a
required effective date and the role restated on the final action. Historical
acceptance is a *new* capability and arrives in Slice 8, once the projections
that make its preview meaningful exist. So the sequence is additive from the
owner's point of view: nothing is taken away except during an announced
window, and nothing new appears before it works.

I did not take the review's literal suggestion of retaining the legacy path
during the window. `accept_bbr_import(p_import_id)` supplies neither a date
nor a role; keeping it callable is precisely the "an old recovered file
replaces current holdings by accident" hazard that spec §4.2 forbids a default
for. Slice 2 replaces its body with an explicit refusal message.

### D7 — Cellar URL, default state, and which date the heading shows

Spec §7.1: the page defaults to all owned positions, with a
`Current holdings only` checkbox.

The existing filters in `parseCellarQuery` use named enums absent from the URL
at their default. Following that: **`holdings=current` appears in the URL when
the box is ticked, and is absent otherwise.** No `holdings=all` is written.

The summary shows three separate figures (spec §7.1): consolidated positions
displayed, current positions, current bottles. Filters change the first; they
never change the definition of the second and third.

**The heading changes date.** `BbrCellarBrowser.tsx:154` currently prints
"Holdings confirmed {accepted_at}". From Slice 8 it reads **"Holdings as at
{effective_date}"**, which is the date the file described the holdings and the
only date meaningful on this page. Upload and acceptance timestamps stay where
they belong, in `bbr_snapshot_view` and the import history page. The
`confirmed_at` column stays in `current_bbr_holdings` for contract stability;
it simply stops being what the cellar heading shows.

### D8 — Membership is a tri-state, and unknown is not former

Revision 1 had `is_current BOOLEAN`, which forces every position into current
or former. With no nominated current snapshot — after a withdrawal, and also
before the very first current acceptance — nothing has been established about
current membership. Calling those positions "former" asserts an absence that
no snapshot evidences.

`bbr_positions_view.membership` is therefore `'current'`, `'former'` or
`'unknown'`:

| Nomination | Position observed in it | `membership` | `current_quantity_bottles` |
|---|---|---|---|
| exists | yes | `current` | the observed quantity |
| exists | no | `former` | `0` |
| none | — | `unknown` | `NULL` |

`NULL`, not zero, in the unknown state: zero is a claim, null is the absence
of one. Consequences carried through the app:

- current-bottle and current-position totals are shown as unavailable, not as
  zero, when membership is unknown;
- the `Current holdings only` filter is disabled with the spec §7.4 message
  ("current holdings have not been nominated"), rather than returning an empty
  table that looks like "you hold nothing";
- the position history says the position was last observed on a date, and does
  not describe it as former.

### D9 — File identity and snapshot occurrence — **spec conflict, owner decides**

The review found that `UNIQUE (source_type, content_checksum, parser_version)`
plus the upload-time dedupe means two exports with identical bytes and
different effective dates collapse into one import, so the later date records
no observation. It also means a completely unchanged export cannot become the
new current snapshot, leaving the nominated snapshot's effective date stale.

The mechanism is exactly as described. But this is not a plan defect to fix
silently: **spec §4.5 states the behaviour as an agreed product decision** —
"An exact checksum and parser-version repeat returns the existing immutable
import. It does not create another observation date." Changing it is an
amendment to the functional spec, and that is the owner's call, not mine.

*How likely is it?* Lower than it first appears. A BBR export carries
`Livex Market Price`, `BBX Lowest Price`, `BBX Highest Bid` and
`Wine Searcher Lowest List Price`, which move independently of the owner's
holdings. Two downloads on different dates being byte-identical requires all
of those to be unchanged too. It is most plausible for two downloads a few
days apart in a quiet market — which is also exactly when the owner is most
likely to want to refresh the current snapshot's date.

*Recommended resolution, if the owner amends §4.5.* Keep file identity as
information, and let the effective date be the thing that must be unique:

- replace the unique constraint with a non-unique index on
  `(source_type, content_checksum, parser_version)`, used for lookup;
- keep the upload-time duplicate check, but make it **advisory**: the owner is
  told "this exact file was already imported and accepted as the snapshot for
  2026-07-23" and chooses between opening the existing import (today's
  behaviour, still the default) and staging it again as a separate snapshot at
  a different date;
- rely on D2's effective-date uniqueness index for the invariant that actually
  matters — one accepted snapshot per date. An accidental double-import cannot
  produce two observations of the same day, because the second acceptance is
  refused.

Cost: the constraint swap, the early return in `stage_bbr_import`, the early
return in `actions.ts:110-124`, and one confirmation step in the UI. It is
contained, and it is materially smaller than the alternative the review
sketches (a separate snapshot-occurrence table below `cellar_imports`), which
would re-key every observation join in the feature.

*If the owner keeps §4.5 as written*, the plan proceeds unchanged, and the
limitation is documented on the import page so the owner can recognise it:
re-download after any holdings or market change and the file will differ; a
byte-identical file cannot be redated.

Slice 2 does not depend on this answer. Slice 3, which writes the acceptance
RPCs, does.

---

## 3. Slices

Twelve slices. Every database slice is one migration, pushed with
`supabase db push --linked` and confirmed with
`supabase migration list --linked` before the next is written. Migration
filenames are indicative; timestamps are assigned when the file is created.

The order changed in revision 2 (D6). A mapping from revision 1's numbering is
in [§8](#8-review-response).

### Stage A — announce, then establish chronology

#### Slice 0 — inspect the recovered exports (no code)

**Why first.** `parseBbrCsv` rejects a file missing any of its 28 headers. If
the 2019 export lacks `BBX Highest Bid`, every slice after this is built on a
parser that cannot read the data the feature exists to hold.

**Work.** For each recovered export: record the header set, row count, and
whether `Parent ID`, `Bottle Volume`, `Case Size`, `Quantity in Bottles` and
`Purchase Price per Case` are present and in the expected formats. Run the
existing parser against each file locally and record what it does. Record
whether any two files are byte-identical (D9's likelihood, measured rather
than argued) and whether
`Purchase date / warehouse goods in date` is ever populated.

**Output.** A new section in
[`IMPORT-SOURCE-PROFILES.md`](IMPORT-SOURCE-PROFILES.md), with no personal
field values, and a yes/no answer to: does the parser need a tolerant or
versioned header contract?

**Gate.** If any header set differs, a Slice 0b is inserted before Slice 2:
split `BBR_HEADERS` into required and optional names, keep exact-match
rejection only for the required set, and version the contract. Whether
`BBR_PARSER_VERSION` moves to `bbr-v2` is decided there — it interacts with
file identity (D9), because a version bump makes the same file stageable
twice.

#### Slice 1 — announce the acceptance freeze (app only)

The Accept control on `cellar/imports/bbr/[id]/page.tsx` is disabled, with
text saying acceptance is paused while snapshot dating is added and what will
replace it. Upload, parse and preview are untouched.

Shipped **before** any migration, so no release presents a button the database
will refuse. Reverting is a one-line revert if Slice 2 is delayed.

#### Slice 2 — snapshot chronology and authority (migration)

`2026xxxxxxxxxx_bbr_snapshot_chronology.sql`

Written to run against an empty database as well as production. The order
inside the migration matters:

1. Add `effective_date`, `accepted_role`, `superseded_at`, `superseded_by` to
   `public.cellar_imports`, all nullable (the table is shared with
   CellarTracker).
2. **Backfill, tolerating zero rows.** For every accepted `bbr_holdings`
   import, set `accepted_role = 'current'` and `effective_date` from an ISO
   date in `original_filename`. A clean database matches nothing and the
   statement is a no-op. Then raise only if an accepted BBR import still has a
   null `effective_date` or `accepted_role` — that is a real inconsistency, on
   any database, and is worth failing on. Revision 1 raised unless exactly one
   row existed, which would have failed every clean replay; the review is
   right and this is the fix.
3. **Only then** add the constraints: accepted BBR imports must have both
   `effective_date` and `accepted_role`; `superseded_at IS NOT NULL` implies
   `accepted_role = 'current'`; `superseded_at` and `superseded_by` are set or
   null together.
4. The two partial unique indexes from D1 and D2, plus
   `(source_type, effective_date DESC) WHERE status = 'accepted'`.
5. Replace `accept_bbr_import`'s body with the explicit refusal from D6.

**Production preflight, not migration logic.** Before pushing, run the
read-only check that production has exactly one accepted BBR import and that
its filename yields `2026-07-23`. That is a deployment step with a recorded
result, not a `RAISE` inside a migration that also has to run on empty
databases.

**Verification.** New
`supabase/tests/database/bbr_snapshot_chronology.test.sql`: at most one
nominated current; a second same-date accepted snapshot is refused; an
accepted BBR import without a date or role is refused; a CellarTracker import
is unaffected by all of the above; non-owner and anonymous access unchanged.
`supabase db reset` must succeed from empty. After push: exactly one nominated
current snapshot with `effective_date = 2026-07-23`, and
`current_bbr_holdings` still returning 116 rows.

**Rollback.** Drop the four columns, two indexes and the constraints; restore
the previous `accept_bbr_import` body. No evidence row is touched. Clean at
any point.

#### Slice 3 — acceptance RPCs (migration)

`2026xxxxxxxxxx_bbr_snapshot_acceptance.sql`

- `set_bbr_import_effective_date(p_import_id UUID, p_effective_date DATE)` —
  pre-acceptance only; refuses an accepted import.
- `accept_bbr_snapshot(p_import_id UUID, p_effective_date DATE, p_role TEXT)`
  — owner check; import must be `validated` with no row errors; role supplied
  explicitly with no default (spec §4.2); a `current` acceptance must not
  pre-date any accepted snapshot; a `historical` acceptance must not post-date
  the nominated current snapshot (spec §4.3); D2's same-date rule applies; on
  a `current` acceptance the prior nomination is superseded in the same
  transaction.
- **Idempotency is conditional**, per the review: calling it on an
  already-accepted import succeeds only when `p_effective_date` and `p_role`
  both match what is stored. A retry with different values raises a conflict
  naming the stored declaration. A silent success there would let a retried
  request appear to have changed the chronology when it did not.
- `withdraw_bbr_current_nomination(p_import_id UUID)` — explicit, leaves the
  unknown state of D8.
- If the owner amends spec §4.5 (D9), this slice also carries the constraint
  swap and the `stage_bbr_import` early-return change.

**Verification.** Extend the Slice 2 pgTAP file: every refusal path above;
matching and conflicting re-acceptance; two concurrent current acceptances
cannot both win (the partial unique index is the backstop). No production
acceptance yet — the app still cannot call these.

**Rollback.** Drop the functions.

#### Slice 4 — switch current authority (migration)

`2026xxxxxxxxxx_bbr_current_authority.sql`

- `CREATE OR REPLACE VIEW public.current_bbr_holdings` selecting from the
  nominated current snapshot instead of `ORDER BY accepted_at DESC LIMIT 1`.
  Every existing column keeps its name and meaning; `confirmed_at` stays
  `accepted_at` for contract stability; `effective_date` is **added**.
- `CREATE VIEW public.bbr_snapshot_view` — the snapshot calendar and import
  history of spec §8 (D4). It lands here rather than with the other
  projections because the acceptance flow and the freeze-ending release both
  need it.

**Verification.** The row-equivalence slice the engineering view §8 requires.
On a Supabase data branch if one is available (per `AGENTS.md`), otherwise
recorded as a deliberate trade-off: capture the old view's
`(parent_sku, format_code, quantity_bottles)` set and row count before,
compare after. pgTAP: with no nominated current snapshot the view is empty and
does not fall back to a historical import (spec §7.4). Smoke-check the three
consuming pages after push, before any app change.

**Rollback.** `CREATE OR REPLACE VIEW` back to the `accepted_at` rule.

#### Slice 5 — restore acceptance with dates and roles (app) — **freeze ends**

Capability parity plus dating. Only the `current` role is selectable;
historical acceptance arrives in Slice 8 (D6).

New `apps/web/src/lib/cellar/bbrSnapshots.ts`, unit-tested:

- `suggestEffectiveDate(filename)` — ISO date from the filename
  (`my-cellar-view-2026-07-23.csv`), returning null rather than guessing.
  Suggestion only; the owner confirms (spec §4.1, BBRH-01).
- `diffCurrentSnapshot(current, proposed)` — returns **identities**, not
  counts: new current positions, positions becoming former, quantity changes,
  reported-price changes, rows without catalogue decoration (spec §4.4,
  "counts alone are insufficient"). Runs on ~116 × 2 rows in the server
  component; no new SQL.

UI in `cellar/imports/bbr/[id]/page.tsx` and `actions.ts`: the confirmed date
field; the role restated on the final acceptance action with nothing
pre-selected (spec §4.2); the identity-level preview; wording that a `current`
acceptance makes omitted positions formerly held with an unknown exit reason
(BBRH-03); blocked acceptances explaining which rule blocked them and what the
owner can do. Regenerate `apps/web/src/lib/database.types.ts`.

**Verification.** Vitest over the new module. The protected routes cannot be
driven by the browser tools without owner credentials, so verification is unit
tests plus `next build` and a manual owner pass in production after deploy.

### Stage B — evidence and history

#### Slice 6 — evidence independent of catalogue coverage (migration)

`2026xxxxxxxxxx_bbr_evidence_without_catalogue_match.sql`

- Guard: raise unless every accepted BBR import has zero `unmatched` rows,
  making the "no evidence backfill needed" assumption explicit. Tolerates zero
  imports, so a clean replay passes.
- Drop the `bbr_holding_evidence → public.skus` foreign key.
- Add `catalogue_matched BOOLEAN NOT NULL DEFAULT TRUE`; drop the default
  after backfilling existing rows to `TRUE`.
- Add `UNIQUE (import_id, parent_sku, format_code)` — the position-grain
  uniqueness the consolidated projection relies on and that today only the
  parser enforces.
- Rewrite `stage_bbr_import` to insert evidence for
  `match_status IN ('matched', 'unmatched')` with
  `catalogue_matched = (r.match_status = 'matched')`.

**Deliberate gap.** Unmatched rows in imports staged before this migration
have no evidence row and are not reconstructed from `raw_row`. Reconstruction
would mean re-implementing money, volume and percentage parsing in SQL for a
set the guard has just proved empty.

**Rollback is forward-fix-only past its activation point**, per the review.
The activation point is the first import staged after this migration that
contains an unmatched row. Before it, rollback is clean. After it, restoring
the foreign key would require deleting valid BBR ownership evidence, which
contradicts the whole purpose of the slice — so after activation the response
to a defect here is a further migration, never a revert. The migration header
says so, and the check for "has activation occurred" is one query:

```sql
SELECT count(*) FROM public.bbr_holding_evidence WHERE NOT catalogue_matched;
```

**Verification.** Extend `supabase/tests/database/bbr_cellar_import.test.sql`:
staging a file whose Parent ID is not in `skus` produces an evidence row with
`catalogue_matched = FALSE`; a duplicate `(parent_sku, format_code)` inside one
import is rejected. After push: evidence row count unchanged (116),
`catalogue_matched` true on all of them. Plus the widened wine-route test from
D3.

#### Slice 7 — history projections (migration)

`2026xxxxxxxxxx_bbr_position_history.sql`

`bbr_position_observations`, `bbr_positions_view` and
`bbr_cellar_positions_market_view` from D4, with the tri-state `membership` of
D8. All `WITH (security_invoker = TRUE)`, all
`REVOKE ALL ... FROM PUBLIC, anon, authenticated` then
`GRANT SELECT ... TO authenticated`, matching the existing personal views.
Comments on each view stating grain and provenance (epic BBRH-11).

**Verification.** New `supabase/tests/database/bbr_position_history.test.sql`
over synthetic snapshots, covering the engineering view §9 list:

- historical import accepted before, and after, the current import;
- upload order differing from effective-date order, asserting identical
  derived output either way;
- presence, absence, reappearance — `first_seen`, `last_seen`, `absent_by`;
- quantity and reported-price change across snapshots, with `min`/`max`;
- two formats under one Parent ID;
- a valid Parent ID absent from `skus`, retained with null decoration;
- a former position contributing zero to current quantity;
- **no nominated current snapshot: every position is `unknown` with a null
  current quantity, and none is reported as `former`** (D8);
- non-owner and anonymous denial on all three views.

Fixtures are synthetic. `Account Payer` and `Beneficial Owner` appear in no
fixture and no view (spec §10).

**Rollback.** Drop three views; nothing consumes them yet.

### Stage C — the owner-facing history

#### Slice 8 — historical acceptance and the all-owned cellar (app)

- The `historical` role becomes selectable, with `historicalPreview(...)` in
  `bbrSnapshots.ts`: positions first seen by this import, and positions whose
  last-seen date or price range will change (spec §4.3).
- `cellar/bbr/page.tsx` reads `bbr_cellar_positions_market_view`.
- `lib/cellar/bbrBrowser.ts` gains the `holdings` parameter of D7, the new
  sort fields (`membership`, `first_seen`, `last_seen`, reported price), and
  keeps every existing filter working over the wider row set. Its row type
  moves to the new view.
- `components/cellar/BbrCellarBrowser.tsx` gains the
  `Current holdings only` checkbox, the membership, first-seen, last-seen and
  reported-price-or-range columns, and the three-part summary. The heading
  becomes "Holdings as at {effective_date}" (D7). Former rows show zero
  current bottles and never contribute to current totals under any filter. The
  reported price renders as one value when min = max and a range otherwise
  (spec §6.7–6.8). The unknown state renders per D8 — totals unavailable, the
  current-only filter disabled with the spec §7.4 message.
- Favourites are unchanged: `loadFavourites` already returns Parent IDs and
  every format row under one Parent ID shows the same star (BBRH-09).

**Verification.** `bbrBrowser.test.ts`: the current-only filter returns exactly
the nominated snapshot's positions; current bottle totals are invariant under
every other filter; sorting is stable across former rows with null market
data; the unknown state renders without asserting former.

#### Slice 9 — position history and import history (app)

- New route `app/(protected)/cellar/bbr/[parentSku]/[formatCode]/page.tsx`
  reading `bbr_position_observations` **and** `bbr_snapshot_view`, listing
  every dated observation with effective date, quantity, reported price,
  source status fields, `catalogue_matched`, and a link to the immutable
  import (spec §7.3).
- `lib/cellar/bbrEpisodes.ts` implementing the calendar-walk of D4,
  unit-tested, with observational wording throughout: "absent by *date*",
  never "sold" or "withdrawn".
- `cellar/imports/bbr/page.tsx` shows the spec §8 columns from
  `bbr_snapshot_view`, ordered by effective date, with upload order still
  available.

**Verification.** Vitest over episode derivation, with the calendar as an
input: present → absent → present is detected only because the intervening
snapshot is in the calendar; the same observations against a calendar without
that snapshot correctly yield one continuous run; two formats of one Parent ID
are independent.

### Stage D — correction, and switching history on

#### Slice 10 — correction path (migration + app)

`2026xxxxxxxxxx_bbr_effective_date_amendment.sql`: the
`bbr_import_date_amendments` audit table and `amend_bbr_effective_date` RPC
from D5. UI on the import detail page: current date, proposed date, what will
be recalculated, and a confirmation step before the write.

**Verification.** pgTAP: an amendment leaving the nominated current snapshot
pre-dating another accepted snapshot is refused; an amendment onto an occupied
date is refused; the role cannot be changed; a non-owner is refused; one audit
row per successful amendment; source rows byte-identical afterwards.

#### Slice 11 — enable historical acceptance in production

Nothing new is built. Per the engineering view §8, historical imports are not
accepted in production until the new current authority and rollback behaviour
have been verified. The checklist:

- `supabase migration list --linked` shows every migration above applied;
- the nominated current snapshot is the expected import and
  `current_bbr_holdings` still returns the pre-change position set;
- one synthetic historical snapshot has been accepted and reviewed on a data
  branch, not on production first;
- the cellar page's current-only totals match the nominated snapshot;
- `docs/README.md` indexes this plan, `IMPORT-SOURCE-PROFILES.md` carries the
  Slice 0 findings, and `WINE-RECORD-SPEC.md` carries the D3 route contract.

Only then are the recovered files accepted, oldest first, checking the
consolidated view after each.

---

## 4. What each slice deploys

| Slice | Migration | App deploy | Acceptance available |
|---|---|---|---|
| 0 inspect exports | no | no | yes |
| 1 announce freeze | no | yes | **paused, and says so** |
| 2 chronology | yes | no | paused |
| 3 acceptance RPCs | yes | no | paused |
| 4 current authority | yes | no | paused |
| 5 dates and roles | no | yes | **restored, current role** |
| 6 evidence coverage | yes | no | yes |
| 7 history projections | yes | no | yes |
| 8 historical + cellar | no | yes | **historical role added** |
| 9 position history | no | yes | yes |
| 10 correction path | yes | yes | yes |
| 11 production enable | no | no | yes |

Slices 2, 3 and 4 are three migrations with no app deployment between them and
can be pushed in one session, which is the whole of the freeze.

---

## 5. Cross-cutting requirements

**Privacy (spec §10).** No new view selects `cellar_import_rows.raw_row`.
`bbr_holding_evidence` carries no personal column, and every new projection is
built from it. Fixtures contain no `Account Payer` or `Beneficial Owner`
value. Error messages name row numbers and rule violations, never source-row
contents.

**Access control.** Every new view is `security_invoker = TRUE` with
`REVOKE ALL ... FROM PUBLIC, anon, authenticated` and
`GRANT SELECT ... TO authenticated`, relying on existing base-table RLS. Every
new function is `SECURITY DEFINER` with `SET search_path = ''` and a
`private.is_app_owner()` check as its first statement, matching
`stage_bbr_import`. Anonymous and non-owner denial is asserted in pgTAP for
every new relation and function, as
`supabase/tests/database/read_layer_security.test.sql` does for existing ones.

**Clean replay.** Every migration here must run against an empty database.
`supabase db reset` is part of each slice's verification, not just the pgTAP
run. Assumptions about production data are deployment preflights with recorded
results, never `RAISE` statements that a clean replay would trip.

**Production database hygiene.** Per `AGENTS.md`: no verification work in the
02:00–05:00 UTC window; a data branch for any equivalence or timing check
where one is available; no retry after an ambiguous failure without first
checking server state; no throwaway schema left behind.

**Rollback posture.** Slices 4, 7 and 10 are pure view/function changes and
revert with `CREATE OR REPLACE` or `DROP`. Slice 2 alters table structure and
reverts cleanly at any point. **Slice 6 is forward-fix-only past its
activation point**, and its header says so with the query that detects
activation.

---

## 6. Deliberately out of scope

Confirming the epic's exclusions against this plan: no inferred sale,
withdrawal or consumption events; no acquisition-lot or cost-basis accounting;
no inflation adjustment; no cross-vintage identity; no advisories, rankings or
alerts; no scenario-engine change; no LLM querying; no general-purpose import
editor.

Two things this plan additionally leaves alone: the wine record page keeps
reading `current_bbr_holdings` and gains no former-holdings panel — its only
change is the documented contract widening in D3 — and CellarTracker is
untouched apart from the shared-table constraints being written so they cannot
affect it.

---

## 7. Questions for the owner

Ordered by how much a different answer changes the plan. The first blocks
Slice 3.

1. **D9 — does spec §4.5 stand?** Two exports with identical bytes and
   different dates currently collapse into one import, and an unchanged export
   cannot refresh the current snapshot's date. §4.5 says that is intended. The
   recommended amendment — advisory duplicate detection, uniqueness enforced on
   effective date instead of file content — is contained, but it changes agreed
   product behaviour and is your call. Slice 0 will measure how often the
   recovered files are actually byte-identical.
2. **D6 — the announced freeze.** Acceptance is paused across three migrations
   (Slices 2–4), with Slice 1 disabling the control and explaining why.
   Acceptable, or should the three migrations be collapsed into one to close
   the window entirely, against the `AGENTS.md` small-slice rule?
3. **D2 — refusing a second snapshot on the same effective date.** Makes
   ordering total with no tie-breaker anywhere. Is a same-day pair of different
   complete exports realistic enough in the recovered set to justify an
   `effective_sequence` column now? Slice 0 may answer this from the files.
4. **D3 — the widened wine-record route.** An unmatched BBR Parent ID will get
   a wine page named from its BBR description, with no catalogue or market
   data. I think that is right and it is now tested and documented, but it is a
   route contract you should agree to rather than inherit.
5. **D7 — the cellar page default and heading.** All owned positions by
   default (spec §7.1), `holdings=current` in the URL when the box is ticked,
   and the heading changing from "Holdings confirmed {accepted_at}" to
   "Holdings as at {effective_date}". Three visible changes to a page you use
   operationally.
6. **D5 — audited amendment over delete-and-resubmit.** Cost estimates are in
   D5; the engineering view asked for both. Is the conclusion right?
7. **Slice 0's gate.** If the recovered exports have different header sets,
   does the parser get a tolerant required/optional split at `bbr-v1`, or a
   `bbr-v2` bump? The bump interacts with file identity (D9) and would let one
   file be staged twice.
8. **`Purchase date / warehouse goods in date`.** Blank in the one profiled
   file and unread by the parser. If older exports populate it, it is real
   dated evidence the spec does not model. Record and ignore, or capture into
   evidence now while the write path is already being changed?

---

## 8. Review response

Against
[`BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN-REVIEW.md`](BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN-REVIEW.md),
3 September 2026.

| Finding | Outcome | Where |
|---|---|---|
| P1 Slice 1 cannot run against a clean database | Accepted. Backfill tolerates zero rows and runs before the constraints; the one-row assumption becomes a deployment preflight. Clean replay added to every slice's verification. | Slice 2, §5 |
| P1 File deduplication prevents valid repeated observations | Accepted as a real mechanism, but it is agreed behaviour in spec §4.5, so the resolution is an owner decision rather than a silent fix. Recommended amendment and its cost are set out. | D9, question 1 |
| P1 Episodes cannot be derived from observations alone | Accepted. Episode derivation takes the accepted-snapshot calendar as a second input; stays in TypeScript, which the review allows. | D4, Slice 9 |
| P1 The no-current state cannot classify positions as former | Accepted. `membership` is `current` / `former` / `unknown`, with a null current quantity when unknown, carried through totals, the current-only filter and the position history. Withdrawal is kept, since the unknown state must exist regardless. | D8, D5 |
| P2 The deployment sequence deliberately breaks acceptance | Accepted, different remedy. The freeze is announced by an app-only release before any migration, shortened from five migrations to three, and ended by a release at capability parity. The literal suggestion — retaining the legacy path — is declined: `accept_bbr_import` supplies no role, which is the accident spec §4.2 forbids. | D6, Slices 1 and 5 |
| P2 Slice 2 has a destructive rollback | Accepted. Declared forward-fix-only past a defined activation point, with the detecting query in the migration header. | Slice 6 |
| P2 Acceptance idempotency is too permissive | Accepted. Re-acceptance succeeds only when the supplied date and role match the stored declaration; otherwise it raises a conflict naming what is stored. | Slice 3 |
| P2 The current-cellar heading would display the wrong date | Accepted, and confirmed in the code at `BbrCellarBrowser.tsx:154`. The heading becomes "Holdings as at {effective_date}"; `confirmed_at` stays in the view for contract stability. | D7, Slice 8 |
| P3 The wine-page impact statement is incorrect | Accepted. Revision 1 was wrong; the route renders from BBR holdings alone and names the wine from their description. Now stated as an intended contract widening, documented and tested. | Baseline 6, D3 |

Slice numbering changed. Revision 1 → revision 2: 1→2, 2→6, 3→4, 4→7, 5→3,
6→5 and 8, 7→8, 8→9, 9→10, 10→11. Slices 1 (announce the freeze) and the
tri-state work in 7 and 8 are new.

The review's "decisions to retain" are all retained unchanged: immutable
evidence and explicit nomination, historical imports never changing current
membership, preservation of unmatched rows, nominal in-bond GBP with min/max
ranges, query-time views at this volume, audited amendment over deletion,
date-only ordering with one accepted snapshot per date, and all-owned by
default with a current-only checkbox.
