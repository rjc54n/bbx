# BBR holdings history: implementation plan

**Status:** revision 3, 5 September 2026, revised against
[`BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN-SECOND-REVIEW.md`](BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN-SECOND-REVIEW.md).
Every hand-off gate condition in that review is met. No code or migration
written; nothing applied to any database.

Revision 1 (3 September) was the first plan; revision 2 answered the first
review. Revision 3 answers the second: three blocking findings and four
required changes are incorporated, all eight owner questions are closed, and
the testing and production-safety boundaries are now part of the plan rather
than a paragraph of good intentions. See [§9](#9-second-review-response).

**Product authority:**
[`BBR-HOLDINGS-HISTORY-FUNCTIONAL-SPEC.md`](BBR-HOLDINGS-HISTORY-FUNCTIONAL-SPEC.md),
whose §4.5 was amended on 5 September 2026 as this review required.
**Constraints and open technical questions:**
[`BBR-HOLDINGS-HISTORY-ENGINEERING-VIEW.md`](BBR-HOLDINGS-HISTORY-ENGINEERING-VIEW.md).
**Stories and acceptance criteria:**
[`BBR-HOLDINGS-HISTORY-EPIC.md`](BBR-HOLDINGS-HISTORY-EPIC.md).

**Hand-off state:** Slice 0 may start now. Everything after it is blocked on
Slice 0's measurements, which decide the position grain (D10) and the parser
header contract.

**Close-out amendment, 5 September 2026.** Slices 0–7 shipped. On owner
direction Slice 8 became the **close-out slice for the initial feature**: it
delivers the all-owned cellar, the current/former presentation, first- and
last-seen dates, the reported-price range and the selectable `historical`
role, and keeps historical acceptance simple (no `historicalPreview`). Slice 9
(position timeline, episode grouping, import-history redesign) and Slice 10
(audited date amendment) are **deferred, not scheduled** — real deferred
decisions, not unfinished requirements. Slice 11 is **removed as a slice**; its
pre-production checks are folded into Slice 8's release sequence. Section 3's
Slice 8–11 text and the section 4 table are annotated below; the rest of this
plan is left as the historical record of revision 3.

---

## 1. Verified baseline

Read from the deployed code and migrations, 3 and 5 September 2026, not from
the companion documents.

### Schema

`supabase/migrations/20260725120000_bbr_cellar_import.sql` defines:

- `public.cellar_imports` — shared by `bbr_holdings` and
  `cellartracker_inventory` (`20260729105057_cellartracker_inventory.sql`
  widened the `source_type` check). Any new column here is visible to both
  sources, so BBR-only rules must be source-scoped `CHECK` constraints and
  partial indexes, never table-wide `NOT NULL`. Line 72 carries
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

Function privileges follow one pattern throughout: `REVOKE ALL ON FUNCTION ...
FROM PUBLIC, anon, authenticated` then `GRANT EXECUTE ... TO authenticated`
(lines 42–43, 454–457, 515–517), asserted in pgTAP with
`has_function_privilege` (`bbr_cellar_import.test.sql:119,129`).

`20260725170000_bbr_cellar_market_view.sql` adds `bbr_cellar_market_view` =
`current_bbr_holdings LEFT JOIN catalogue_view` on
`(parent_sku, format_code)`. The decoration is already a left join; the
coupling to the catalogue is enforced by the foreign keys, not by this view.

### Application

- `apps/web/src/lib/cellar/bbrParser.ts` — `BBR_PARSER_VERSION = "bbr-v1"`;
  `BBR_HEADERS` is an exact 28-name contract and `parseBbrCsv` throws
  `BbrFileError` if any one is missing; `matchBbrRows` downgrades a valid row
  to `unmatched` when the catalogue has no exact `(parent_sku, format_code)`.
  **Lines 381–393 mark a second source row with the same
  `(parent_sku, format_code)` `invalid`**, which sets `error_row_count > 0`
  and therefore makes the whole import unacceptable. See D10.
- `app/(protected)/cellar/imports/bbr/actions.ts` — upload, checksum dedupe
  (lines 110–124, returning the existing import and deleting the newly
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
throughout, and is not read by the parser. **This is one modern file. Nothing
about it generalises to the recovered exports, which is what Slice 0 exists to
establish.**

### Consequences that shape this plan

1. **The header contract will reject old exports.** `parseBbrCsv` fails the
   whole file if any of the 28 headers is absent. Recovered exports from
   earlier years are the most likely place for the column set to differ.
2. **The parser also rejects repeated positions**, which may be a legitimate
   shape in older exports (D10). Both this and the point above make Slice 0 a
   gate, not a formality.
3. **`quantity_bottles > 0` is a check constraint.** A position cannot be
   observed at zero; absence from a snapshot is the only exit signal, matching
   the spec's observational language.
4. **`cellar_import_rows.raw_row` contains `Account Payer` and
   `Beneficial Owner`.** Every new projection must be built from
   `bbr_holding_evidence`, never from `raw_row` (spec §10).
5. **Migrations must run against an empty database.** A clean
   `supabase db reset` or CI replay has no imports at all, and a legacy
   database may have several accepted ones. Neither may be assumed away.
6. **The wine record page renders from BBR holdings alone.**
   `wine/parent/[parentSku]/page.tsx:176-182` treats `bbrHoldings.length > 0`
   as sufficient to render and falls back to `bbrHoldings[0]?.description` for
   the name. See D3.
7. **The cellar heading prints the acceptance timestamp.**
   `BbrCellarBrowser.tsx:154` reads "Holdings confirmed
   {formatDateTime(confirmedAt)}", where `confirmedAt` is `accepted_at`. See
   D7.

---

## 2. Design decisions

Every decision below is now closed. The second review settled the eight
questions revision 2 left open; what remains genuinely undecided is measured
by Slice 0, not argued (D10, and the parser contract in Slice 0's gate).

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

`superseded_at` and `superseded_by` are set or null together. **A current
declaration is only ever superseded by another current declaration**, which is
what makes that constraint consistent — and is why standalone withdrawal is
removed (D5). There is no state in this model for "was current, is nominated
by nothing", and the spec does not ask for one.

Rejected: a singleton `bbr_current_snapshot` pointer table. It needs its own
RLS, grants, policies and pgTAP coverage, and it lets the pointer and the
import disagree. The partial index cannot disagree with itself.

A superseded current declaration keeps `accepted_role = 'current'`, which
records "it was once accepted as current" (epic decision 5).

### D2 — Effective date is date-only, and unique among accepted snapshots

*(Q2, Q3)*

`DATE`, no time component. A second accepted BBR snapshot with the same
effective date is refused at acceptance:

```sql
CREATE UNIQUE INDEX cellar_imports_bbr_effective_date_idx
    ON public.cellar_imports (source_type, effective_date)
    WHERE source_type = 'bbr_holdings' AND status = 'accepted';
```

Ordering is therefore total, so "deterministic tie handling" (spec §4.3) needs
no tie-breaker rule, no sequence column and no fallback to `accepted_at` or
UUID order. The index can be widened later without touching an evidence row.

Confirmed by the second review: keep one accepted snapshot per effective date
**unless Slice 0 finds genuine same-day exports** among the recovered files.

This index is also what makes D9 safe: whatever happens to file-level dedupe,
two snapshots can never describe the same day.

### D3 — Ownership evidence stops depending on catalogue coverage

*(Q4)*

Drop the `bbr_holding_evidence (parent_sku, format_code) → public.skus`
foreign key. `parent_sku` becomes the BBR-asserted Parent ID and
`format_code` the source-derived format, always populated for a valid row.
Add `catalogue_matched BOOLEAN NOT NULL`, recording whether local resolution
succeeded *at import time* — spec §7.3 asks the position history to show
"whether local catalogue decoration was available", a dated fact about the
observation, not about the catalogue today.

`stage_bbr_import` then inserts evidence for
`match_status IN ('matched', 'unmatched')`.

`cellar_import_rows` is left alone: shared with CellarTracker, its
`parent_sku` keeps meaning "resolved catalogue identity", and nothing here
needs to change it.

Rejected: a parallel `bbr_ownership_evidence` table for unmatched rows. It
doubles the write path, the RLS surface and every projection's union, to store
identical columns.

**Two contract changes follow, both intended, both tested.**

*`current_bbr_holdings` starts including rows with no catalogue match.*
Present-data impact is nil — the one accepted import matched 116 of 116 — so
the equivalence check in Slice 5 passes exactly. `bbr_cellar_market_view`
already left-joins, so such a row arrives with null market columns, which is
what spec §7.4 asks for.

*The wine record page becomes reachable for an unmatched Parent ID.* The route
renders whenever `bbrHoldings.length > 0` and names the wine from
`bbrHoldings[0].description`. The second review confirms this is right: BBR is
the ownership authority, so a wine the owner demonstrably held should have a
record even when the local catalogue has never seen it. It is treated as a
widened route contract — documented in
[`WINE-RECORD-SPEC.md`](WINE-RECORD-SPEC.md), and covered by a test asserting
such a page renders with BBR identity, no catalogue formats and no market
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
  `raw_row`. Under D10's aggregating variant this view is where several source
  rows for one position are summed.
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

**Episodes need the calendar, not just the observations.** Observations in
2021 and 2024 cannot distinguish continuous holding from
present → absent → present, because the list does not say which snapshots
existed in between. `lib/cellar/bbrEpisodes.ts` therefore takes **two** inputs
— the full ordered accepted snapshot calendar from `bbr_snapshot_view` and the
position's observations — and walks the calendar. A position with no
observation at a calendar date is absent at that date; that is the only
inference made, and it is exactly the evidence-of-absence statement spec §5.3
permits. Episode state stays out of the write model (engineering view §3.4).

**Revisit threshold:** if accepted BBR snapshots exceed 40, or
`bbr_holding_evidence` exceeds 20,000 rows, or the cellar page's server timing
exceeds 300 ms, re-measure and consider a materialised model.

**That threshold is a telemetry signal, not a licence to benchmark
production.** It is read from normal request telemetry. Any measurement it
prompts is reproduced and timed on an isolated copy, never by repeated timing
runs against the live instance. See §6.

### D5 — Correction is a narrow audited amendment, and nothing else

*(Q6)*

The engineering view asked for both options to be estimated.

**Delete and resubmit** needs a `delete_bbr_import` RPC (the CellarTracker one
in `20260729120310` is ~10 lines); private Storage object cleanup in the
server action, which is the part that fails silently and leaves orphans;
release of the file-identity row; a guard for the nominated-current reference;
and re-upload of a file the owner may no longer have — the recovered-backup
case is exactly where the original is hardest to produce twice. Roughly 40
lines of SQL, 60 of TypeScript, plus the Storage failure mode.

**Audited amendment** needs a `bbr_import_date_amendments` audit table (~25
lines with RLS and grants) and an `amend_bbr_effective_date` RPC (~50 lines)
re-checking the same chronology rules acceptance uses. No Storage work, no
file-identity interaction, no re-upload; the source file and every source row
are untouched, which is what BBRH-10 requires.

**Decision: the amendment.** Confirmed by the second review. The immutability
concern in engineering view §5 is answered by the column split:
`effective_date` and `accepted_role` are owner assertions attached to the
import (spec §3.3), not source facts, and only the date is amendable.

Constraints: owner-only; never changes `accepted_role`; must leave the
nominated current snapshot no earlier than every other accepted snapshot; must
not collide with another accepted snapshot's date (D2); writes one audit row
with old date, new date, actor and timestamp; requires UI confirmation.

**`withdraw_bbr_current_nomination` is removed from this version.** Revision 2
had it, and the second review is right that it was unrepresentable and
off-spec:

- *Unrepresentable.* D1 requires `superseded_at` and `superseded_by` together,
  and a withdrawal has no replacement import to name. The function could not
  have written a legal row.
- *Off-spec.* Spec §4.6 requires correction to "prevent an ambiguous or
  missing current snapshot", and §11 scenario 9 says removing the nominated
  current snapshot without a safe replacement is blocked.

A wrong current nomination is therefore corrected **forwards**: amend its
effective date, or accept a later, correct current snapshot that supersedes
it. The `unknown` membership state (D8) is retained, because it is still the
honest description of a database that has never nominated a current snapshot —
including every database before the first acceptance.

### D6 — Deployment sequence: evidence first, then an announced short freeze

*(Q7)*

Two properties the sequence has to hold at once: no release presents a control
the database will refuse, and **no snapshot is ever accepted while evidence is
still incomplete**.

The second point is the second review's first blocking finding, and revision 2
got it wrong. Revision 2 restored acceptance in Slice 5 and only widened
evidence coverage in Slice 6. In that window, accepting a current snapshot
containing unmatched rows would silently drop those positions from evidence
forever — and once the history projections landed, positions absent for want
of catalogue coverage would be indistinguishable from positions BBR had
genuinely stopped reporting. That is the exact failure this feature exists to
prevent.

Revision 3 therefore moves evidence coverage **inside** the freeze and ahead
of acceptance, and adds a completeness invariant to acceptance itself:

- **Slice 1** is an app-only deploy that disables the Accept control and
  explains why, shipped *before* any migration.
- **Slices 2–5** are the four migrations acceptance depends on: chronology,
  evidence coverage, the acceptance RPCs, the current-authority switch. They
  can be pushed and smoke-tested in one working session.
- **Slice 6** restores acceptance at capability parity — only the `current`
  role, the one thing the owner could already do, now with a required
  effective date and the role restated on the final action.
- `accept_bbr_snapshot` refuses any import whose evidence row count does not
  equal its valid source-row count. This is a single invariant that closes
  three holes at once: an import staged before Slice 3 with unmatched rows
  cannot be accepted (the owner is told to re-upload it), a partially staged
  import cannot be accepted, and any future divergence between the staging and
  acceptance paths fails closed rather than quietly losing positions.

Historical acceptance is a *new* capability and arrives in Slice 8, once the
projections that make its preview meaningful exist. From the owner's side the
sequence is additive: nothing is taken away except during an announced window,
and nothing new appears before it works.

I did not take the first review's suggestion of retaining the legacy path
during the window. `accept_bbr_import(p_import_id)` supplies neither a date
nor a role; keeping it callable is precisely the "an old recovered file
replaces current holdings by accident" hazard that spec §4.2 forbids a default
for. Slice 2 replaces its body with an explicit refusal message.

### D7 — Cellar URL, default state, and which date the heading shows

Spec §7.1: the page defaults to all owned positions, with a
`Current holdings only` checkbox. Confirmed by the second review.

The existing filters in `parseCellarQuery` use named enums absent from the URL
at their default. Following that: **`holdings=current` appears in the URL when
the box is ticked, and is absent otherwise.** No `holdings=all` is written.

The summary shows three separate figures (spec §7.1): consolidated positions
displayed, current positions, current bottles. Filters change the first; they
never change the definition of the second and third.

**The heading changes date.** `BbrCellarBrowser.tsx:154` currently prints
"Holdings confirmed {accepted_at}". From Slice 8 it reads **"Holdings as at
{effective_date}"** — the date the file described the holdings, and the only
date meaningful on this page. Upload and acceptance timestamps stay in
`bbr_snapshot_view` and the import history page. The `confirmed_at` column
stays in `current_bbr_holdings` for contract stability; it simply stops being
what the cellar heading shows.

### D8 — Membership is a tri-state, and unknown is not former

With no nominated current snapshot, nothing has been established about current
membership, and calling those positions "former" asserts an absence no
snapshot evidences. `bbr_positions_view.membership` is therefore:

| Nomination | Position observed in it | `membership` | `current_quantity_bottles` |
|---|---|---|---|
| exists | yes | `current` | the observed quantity |
| exists | no | `former` | `0` |
| none | — | `unknown` | `NULL` |

`NULL`, not zero, in the unknown state: zero is a claim, null is the absence
of one. Carried through the app:

- current-bottle and current-position totals show as unavailable, not zero;
- the `Current holdings only` filter is disabled with the spec §7.4 message
  ("current holdings have not been nominated"), rather than returning an empty
  table that reads as "you hold nothing";
- the position history says the position was last observed on a date, and does
  not describe it as former.

With withdrawal removed (D5), `unknown` is reachable only before the first
current acceptance. It is kept because that state is real, and because a view
that cannot express it would have to lie about a fresh database.

### D9 — File identity is advisory; effective date carries the uniqueness

Spec §4.5 previously said an exact checksum and parser-version repeat returns
the existing import and creates no new observation date. Two consequences,
both raised by the first review and confirmed by the second: two exports with
identical bytes and different dates collapse into one import, and a completely
unchanged export cannot refresh the current snapshot's date.

**Spec §4.5 was amended on 5 September 2026** to make duplicate detection
advisory. The implementation follows:

- replace `UNIQUE (source_type, content_checksum, parser_version)` with a
  non-unique index on the same columns, used for lookup;
- keep the upload-time duplicate check, but make it a choice: the owner is
  told "this exact file was already imported and accepted as the snapshot for
  2026-07-23" and chooses between opening the existing import (still the
  default) and staging the same bytes as a separate snapshot with its own
  effective date;
- rely on D2's effective-date uniqueness for the invariant that matters — one
  accepted snapshot per date. An accidental double-import cannot produce two
  observations of the same day, because the second acceptance is refused.

Rejected: a separate snapshot-occurrence table below `cellar_imports`, which
would re-key every observation join in the feature to solve the same problem.

Slice 0 still counts byte-identical pairs among the recovered files, because
that number belongs in the source profile — but the design no longer depends
on the answer.

### D10 — Position grain is measured, not assumed — **Slice 0 decides**

The plan's `UNIQUE (import_id, parent_sku, format_code)` and the parser's
existing duplicate rejection (`bbrParser.ts:381-393`) both rest on one
profiled modern file that happens to hold one row per Parent ID. The second
review is right that this does not generalise: an older export could carry
separate rows for different product codes, purchases or prices under one
Parent ID and format. Today those rows are marked `invalid`, which sets
`error_row_count > 0` and makes the **entire import unacceptable** — so this
is not a subtle data-quality question, it is a "the recovered file cannot be
imported at all" question.

**Slice 0 measures it** and the answer selects one of two designs.

*If no recovered export repeats a `(Parent ID, derived format)`:* keep the
parser rule, add the unique constraint, and observation grain equals evidence
grain. This is revision 2's design.

*If any export does repeat it:* evidence stays at source-row grain — the
existing `(import_id, source_row_number)` primary key already provides that,
so no evidence change is needed — and:

- the parser stops marking repeats `invalid`; it records a warning instead, so
  the rows survive and the import stays acceptable;
- `UNIQUE (import_id, parent_sku, format_code)` is **not** added;
- `bbr_position_observations` aggregates to `(import_id, parent_sku,
  format_code)`: `SUM(quantity_bottles)`, and `MIN`/`MAX` of
  `purchase_price_per_case_p` within the snapshot, with the contributing
  source rows listed on the position-history page;
- `bbr_positions_view` takes its price range across all observations as
  before, which now spans within-snapshot as well as between-snapshot
  variation — a strictly better purchase-price history, and the reason the
  review flagged this as evidence loss rather than a constraint detail.

No migration or projection is written until this is known.

---

## 3. Slices

Twelve slices. Every database slice is one migration, pushed with
`supabase db push --linked` and confirmed with
`supabase migration list --linked` before the next is written. Migration
filenames are indicative; timestamps are assigned when the file is created.

Slice numbering changed again in revision 3 (D6). The mapping from revision 2
is in [§9](#9-second-review-response).

### Stage A — measure, announce, then build the foundation

#### Slice 0 — inspect the recovered exports (no code) — **the hand-off gate**

Everything after this slice is blocked on it. Three of its measurements change
the design, not just the documentation.

For each recovered export, record:

1. **The header set**, against the 28 names in `BBR_HEADERS`, and whether
   `parseBbrCsv` accepts the file as it stands. *Decides the parser contract.*
2. **Repeated `(Parent ID, derived format)` combinations** — how many, and for
   each, whether `Product Code(s)`, `Quantity in Bottles` and
   `Purchase Price per Case` agree or differ across the repeated rows.
   *Decides D10.*
3. **Same-day exports** — two files whose effective dates are the same day.
   *Decides whether D2's one-snapshot-per-date rule holds.*
4. **Byte-identical pairs.** Records how real the D9 case was; no longer
   changes the design.
5. **Whether `Purchase date / warehouse goods in date` is ever populated.**
   Recorded for the future; per the second review it is *not* added to typed
   evidence in this version.
6. Row counts, and what the current parser does with each file end to end.

**Output.** A new section in
[`IMPORT-SOURCE-PROFILES.md`](IMPORT-SOURCE-PROFILES.md), containing no
personal field values, ending in an explicit statement of which D10 branch
applies and whether the parser needs a changed header contract.

**Gate.** If the header set differs, a Slice 0b before Slice 2 splits
`BBR_HEADERS` into required and optional names and keeps exact-match rejection
only for the required set. Per the second review, a changed accepted header
contract moves `BBR_PARSER_VERSION` to **`bbr-v2`**. With D9's dedupe now
advisory, the version bump no longer risks silent double-staging: the same
bytes under a new parser version simply appear as a duplicate the owner is
asked about.

This slice runs entirely against local copies of the recovered files. It
touches no database.

#### Slice 1 — announce the acceptance freeze (app only)

The Accept control on `cellar/imports/bbr/[id]/page.tsx` is disabled, with
text saying acceptance is paused while snapshot dating is added, and what will
replace it. Upload, parse and preview are untouched. Shipped **before** any
migration, so no release presents a button the database will refuse. Reverts
in one line if Slice 2 is delayed.

#### Slice 2 — snapshot chronology and authority (migration)

`2026xxxxxxxxxx_bbr_snapshot_chronology.sql`

Order inside the migration matters:

1. Add `effective_date`, `accepted_role`, `superseded_at`, `superseded_by` to
   `public.cellar_imports`, all nullable (shared table).
2. **Backfill, correct for zero, one or many accepted imports.** Order every
   accepted `bbr_holdings` import by derived effective date, then
   `accepted_at`. The last becomes the nomination
   (`accepted_role = 'current'`, `superseded_at` null); each earlier one gets
   `accepted_role = 'current'` with `superseded_at` and `superseded_by`
   pointing at its immediate successor. A clean database matches nothing and
   the statements are no-ops. Revision 2 marked *every* legacy import as an
   unsuperseded nomination, which the second review correctly notes would
   have failed at index creation on any multi-import legacy database, with no
   explanation of why.
3. **Raise with an explanatory message** if an accepted BBR import still has a
   null `effective_date` or `accepted_role`, or if two derived effective dates
   collide. Both are real inconsistencies, and both must fail here — naming
   the offending imports — rather than later at index creation.
4. **Only then** add the constraints: accepted BBR imports must have both
   `effective_date` and `accepted_role`; `superseded_at IS NOT NULL` implies
   `accepted_role = 'current'`; `superseded_at` and `superseded_by` set or
   null together.
5. The two partial unique indexes from D1 and D2, plus
   `(source_type, effective_date DESC) WHERE status = 'accepted'`.
6. Replace `accept_bbr_import`'s body with the explicit refusal from D6.

**Production preflight, not migration logic.** Before pushing, run the
read-only check that production has exactly one accepted BBR import and that
its filename yields `2026-07-23`. A deployment step with a recorded result,
not a `RAISE` inside a migration that also has to run on empty and legacy
databases.

**Verification.** New
`supabase/tests/database/bbr_snapshot_chronology.test.sql`: at most one
nominated current; a second same-date accepted snapshot is refused; an
accepted BBR import without a date or role is refused; a three-import legacy
backfill produces one nomination and two correctly chained superseded rows; a
CellarTracker import is unaffected; non-owner and anonymous access unchanged.
`supabase db reset` must succeed from empty.

**Rollback.** Drop the four columns, two indexes and the constraints; restore
the previous `accept_bbr_import` body. No evidence row is touched. Clean at
any point.

#### Slice 3 — evidence independent of catalogue coverage (migration)

`2026xxxxxxxxxx_bbr_evidence_without_catalogue_match.sql`

Moved ahead of acceptance restoration per the second review (D6).

- Drop the `bbr_holding_evidence → public.skus` foreign key.
- Add `catalogue_matched BOOLEAN NOT NULL DEFAULT TRUE`; drop the default
  after backfilling existing rows to `TRUE`.
- Rewrite `stage_bbr_import` to insert evidence for
  `match_status IN ('matched', 'unmatched')` with
  `catalogue_matched = (r.match_status = 'matched')`.
- **`UNIQUE (import_id, parent_sku, format_code)` only if Slice 0 found no
  repeated positions** (D10). If it found any, this constraint is omitted and
  the parser change and aggregating observation view go in instead.

**Existing imports are not backfilled.** Unmatched rows in imports staged
before this migration have no evidence row and are not reconstructed from
`raw_row`; that would mean re-implementing money, volume and percentage
parsing in SQL. Such an import is instead **unacceptable** — Slice 4's
completeness invariant refuses it and tells the owner to re-upload the file,
which re-stages it correctly. This replaces revision 2's silent guard, which
assumed the set was empty and did nothing if it was not.

**Rollback is forward-fix-only past its activation point.** The activation
point is the first import staged after this migration containing an unmatched
row. Before it, rollback is clean. After it, restoring the foreign key would
require deleting valid BBR ownership evidence, contradicting the purpose of
the slice — so after activation the response to a defect here is a further
migration, never a revert. The migration header says so and gives the
detecting query:

```sql
SELECT count(*) FROM public.bbr_holding_evidence WHERE NOT catalogue_matched;
```

**Verification.** Extend `bbr_cellar_import.test.sql`: staging a file whose
Parent ID is not in `skus` produces an evidence row with
`catalogue_matched = FALSE`; under the D10 no-repeats branch, a duplicate
`(parent_sku, format_code)` inside one import is rejected; under the repeats
branch, both rows are retained and warned. Plus the widened wine-route test
from D3.

#### Slice 4 — acceptance RPCs (migration)

`2026xxxxxxxxxx_bbr_snapshot_acceptance.sql`

- `set_bbr_import_effective_date(p_import_id UUID, p_effective_date DATE)` —
  pre-acceptance only; refuses an accepted import.
- `accept_bbr_snapshot(p_import_id UUID, p_effective_date DATE, p_role TEXT)`
  — owner check; import must be `validated` with no row errors; role supplied
  explicitly with no default (spec §4.2); a `current` acceptance must not
  pre-date any accepted snapshot; a `historical` acceptance must not post-date
  the nominated current snapshot (spec §4.3); D2's same-date rule applies; on
  a `current` acceptance the prior nomination is superseded in the same
  transaction, setting both `superseded_at` and `superseded_by`.
- **Evidence completeness invariant** (D6): refuse unless the import's
  evidence row count equals its valid source-row count. Grain-independent, so
  it holds under either D10 branch.
- **Conditional idempotency**: calling it on an already-accepted import
  succeeds only when `p_effective_date` and `p_role` both match what is
  stored. A retry with different values raises a conflict naming the stored
  declaration, rather than appearing to have changed the chronology.
- **No `withdraw_bbr_current_nomination`** (D5).
- The D9 constraint swap and the `stage_bbr_import` duplicate-return change.

**Privileges.** Both functions get
`REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated` then
`GRANT EXECUTE ... TO authenticated`, matching lines 454–457 and 515–517 of
the original migration. The owner check inside a `SECURITY DEFINER` body is
necessary but does not remove the default `PUBLIC` execute privilege, so both
are required. pgTAP asserts `has_function_privilege` for `anon` (false) and
`authenticated` (true) on every new function, following
`bbr_cellar_import.test.sql:119,129`.

**Verification.** Extend the Slice 2 pgTAP file with every refusal path,
matching and conflicting re-acceptance, and the completeness invariant against
an import staged before Slice 3. **Concurrency is verified separately**: pgTAP
runs in one session and cannot prove that two simultaneous acceptances cannot
both win. A two-session harness — `tests/test_bbr_acceptance_concurrency.py`,
two connections against the local database, one holding a transaction open
while the other attempts an acceptance — asserts that the second waits, then
sees the chronology the first committed. It covers current against current,
current against a later-dated historical, and historical against current with
no nomination in place, and ends every case on the two invariants: at most one
nomination, and no historical snapshot dated after it. It runs locally or on an
isolated copy, never against production (§6).

The lock that does this is not the nomination row. `20260905140000` serialised
acceptance by taking `FOR UPDATE` on the nominated current snapshot, which
locks nothing when there is no nomination, and which the waiter finds no longer
matching once the winner supersedes it — both paths let a historical snapshot
commit dated after the current one. `20260905170000` replaces it with a single
transaction-scoped advisory lock, taken by both roles before any chronology is
read.

**Rollback.** Drop the functions.

#### Slice 5 — switch current authority (migration)

`2026xxxxxxxxxx_bbr_current_authority.sql`

- `CREATE OR REPLACE VIEW public.current_bbr_holdings` selecting from the
  nominated current snapshot instead of `ORDER BY accepted_at DESC LIMIT 1`.
  Every existing column keeps its name and meaning; `confirmed_at` stays
  `accepted_at` for contract stability; `effective_date` is **added**.
- `CREATE VIEW public.bbr_snapshot_view` — the snapshot calendar and import
  history of spec §8 (D4). It lands here because both the acceptance flow and
  the freeze-ending release need it.

**Verification.** The row-equivalence check engineering view §8 requires:
capture the old view's `(parent_sku, format_code, quantity_bottles)` set and
row count, compare after. **This runs on an isolated production-shaped copy.**
Revision 2 allowed it against production "as a deliberate trade-off" if no
branch was available; per the second review that escape hatch is removed. If
no safe copy exists, this part of the release waits (§6). pgTAP: with no
nominated current snapshot the view is empty and does not fall back to a
historical import (spec §7.4).

**Rollback.** `CREATE OR REPLACE VIEW` back to the `accepted_at` rule.

#### Slice 6 — restore acceptance with dates and roles (app) — **freeze ends**

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
(BBRH-03); the D9 duplicate choice; and blocked acceptances explaining which
rule blocked them and what the owner can do — including "this file was staged
before evidence coverage changed; upload it again" for the completeness
invariant. Regenerate `apps/web/src/lib/database.types.ts`.

**Verification.** Vitest over the new module. Protected routes cannot be
driven by the browser tools without owner credentials, so verification is unit
tests plus `next build`, then one owner browser pass in production after
deploy.

### Stage B — history

#### Slice 7 — history projections (migration)

`2026xxxxxxxxxx_bbr_position_history.sql`

`bbr_position_observations`, `bbr_positions_view` and
`bbr_cellar_positions_market_view` from D4, with D8's tri-state `membership`,
in whichever D10 grain Slice 0 selected. All
`WITH (security_invoker = TRUE)`, all
`REVOKE ALL ... FROM PUBLIC, anon, authenticated` then
`GRANT SELECT ... TO authenticated`. Comments on each view stating grain and
provenance (epic BBRH-11).

**Verification.** New `supabase/tests/database/bbr_position_history.test.sql`
over synthetic snapshots, covering the engineering view §9 list:

- historical import accepted before, and after, the current import;
- upload order differing from effective-date order, asserting identical
  derived output either way;
- presence, absence, reappearance — `first_seen`, `last_seen`, `absent_by`;
- quantity and reported-price change across snapshots, with `min`/`max`;
- two formats under one Parent ID;
- under D10's repeats branch, several source rows for one position in one
  snapshot, asserting summed quantity and a within-snapshot price range;
- a valid Parent ID absent from `skus`, retained with null decoration;
- a former position contributing zero to current quantity;
- no nominated current snapshot: every position is `unknown` with a null
  current quantity, and none is reported as `former` (D8);
- non-owner and anonymous denial on all three views.

Fixtures are synthetic and small. `Account Payer` and `Beneficial Owner`
appear in no fixture and no view (spec §10).

**Rollback.** Drop three views; nothing consumes them yet.

### Stage C — the owner-facing history

#### Slice 8 — historical acceptance and the all-owned cellar (app) — **close-out slice**

> **As shipped (5 September 2026).** `historicalPreview(...)` was *not* built —
> historical acceptance instead shows a plain statement that the import adds
> dated evidence for its effective date and changes no current position or
> quantity, alongside the file's parsed rows and unresolved-position list that
> the import page already renders. The `historical` role guard in `actions.ts`
> became an allowed-value check (`current` | `historical`). The three-figure
> summary is computed over the **filtered** rows (owner decision): facet and
> search filters narrow all three; the `Current holdings only` box does not move
> the current figures. Everything else in the bullets below shipped as written.
> Verification was focused app tests + lint + `next build`; no full
> `supabase test db`. Release verification is the sequence in this section, not
> a synthetic import.

- The `historical` role becomes selectable. ~~`historicalPreview(...)` in
  `bbrSnapshots.ts`~~ — dropped; see the note above.
- `cellar/bbr/page.tsx` reads `bbr_cellar_positions_market_view`.
- `lib/cellar/bbrBrowser.ts` gains the `holdings` parameter of D7, the new
  sort fields (`membership`, `first_seen`, `last_seen`, reported price), and
  keeps every existing filter working over the wider row set.
- `components/cellar/BbrCellarBrowser.tsx` gains the
  `Current holdings only` checkbox, the membership, first-seen, last-seen and
  reported-price-or-range columns, and the three-part summary. The heading
  becomes "Holdings as at {effective_date}" (D7). Former rows show zero
  current bottles and never contribute to current totals under any filter. The
  reported price renders as one value when min = max and a range otherwise
  (spec §6.7–6.8). The unknown state renders per D8.
- Favourites are unchanged: `loadFavourites` already returns Parent IDs and
  every format row under one Parent ID shows the same star (BBRH-09).

**Verification.** `bbrBrowser.test.ts`: the current-only filter returns exactly
the nominated snapshot's positions; the current figures count only
current-membership rows (former/unknown contribute zero) and are unchanged by
the current-only filter; sorting is stable across former rows with null market
data; the unknown state renders without asserting former.

**Release sequence (folds in the former Slice 11).** Former rows, dates and
price ranges cannot be verified until a real historical snapshot exists, so
verification is interleaved with the accepts:

1. Deploy Slice 8 (`git push`).
2. Verify the current-only baseline: `/cellar/bbr` with the nominated snapshot
   only — 116 positions / 837 bottles, heading "Holdings as at 2026-07-23",
   every row `Current`, the three figures agree, facet filters narrow all three.
3. Verify the historical-role controls on `/cellar/imports/bbr/[id]`: both role
   radios with the correct statements; the `actions.ts` guard rejects any other
   value. `supabase migration list --linked` shows every BBR migration through
   `20260905170000` with `remote` populated. The mixed-role acceptance race is
   fixed and deployed (`20260905170000`), regression-tested by
   `tests/test_bbr_acceptance_concurrency.py`.
4. Accept the oldest real recovered historical file.
5. Verify former rows (`Former` badge, `0` current bottles), first/last-seen
   dates, the single-value-or-range reported price, and that the current
   figures are unchanged from step 2; `absent_by` is never phrased as a sale.
6. Accept the remaining recovered files one at a time, oldest to newest,
   re-checking the consolidated view and the unchanged current totals each time.

The still-outstanding Slice 6 owner browser pass folds into steps 2–3.

#### Slice 9 — position history and import history (app) — **DEFERRED, not scheduled (5 Sep 2026)**

Deferred on owner direction. Position timelines, episode grouping and the
import-history redesign are a deferred capability, not a gap in the shipped
feature. `absent_by` episodes and the reported-price-range → observations link
(spec §6.8, §7.3) come with it. The three Slice 7 views already support it
whenever it is picked up.

- New route `app/(protected)/cellar/bbr/[parentSku]/[formatCode]/page.tsx`
  reading `bbr_position_observations` **and** `bbr_snapshot_view`, listing
  every dated observation with effective date, quantity, reported price,
  source status fields, `catalogue_matched`, and a link to the immutable
  import (spec §7.3). Under D10's repeats branch it also lists the
  contributing source rows behind an aggregated observation.
- `lib/cellar/bbrEpisodes.ts` implementing the calendar walk of D4,
  unit-tested, with observational wording throughout: "absent by *date*",
  never "sold" or "withdrawn".
- `cellar/imports/bbr/page.tsx` shows the spec §8 columns from
  `bbr_snapshot_view`, ordered by effective date, with upload order still
  available.

**Verification.** Vitest over episode derivation with the calendar as an
input: present → absent → present is detected only because the intervening
snapshot is in the calendar; the same observations against a calendar without
that snapshot correctly yield one continuous run; two formats of one Parent ID
are independent.

### Stage D — correction, and switching history on

#### Slice 10 — correction path (migration + app) — **DEFERRED until a correction is needed (5 Sep 2026)**

Deferred on owner direction. Post-acceptance date amendment is an exceptional
path (spec §4.6); it is built when a real correction is actually required, not
pre-emptively. Pre-acceptance date correction already ships (Slice 6).

`2026xxxxxxxxxx_bbr_effective_date_amendment.sql`: the
`bbr_import_date_amendments` audit table and `amend_bbr_effective_date` RPC
from D5, with the same privilege pattern and `has_function_privilege`
assertions as Slice 4. UI on the import detail page: current date, proposed
date, what will be recalculated, and a confirmation step before the write.

**Verification.** pgTAP: an amendment leaving the nominated current snapshot
pre-dating another accepted snapshot is refused; an amendment onto an occupied
date is refused; the role cannot be changed; a non-owner is refused; one audit
row per successful amendment; source rows byte-identical afterwards.

#### Slice 11 — enable historical acceptance in production — **REMOVED as a slice (5 Sep 2026)**

Folded into Slice 8's release sequence above. Historical acceptance is enabled
by the Slice 8 deploy; the recovered files are then accepted oldest-first with
verification interleaved, on production, without a synthetic import. The
engineering-view §8 concern (verify current authority and rollback before
admitting historical snapshots) is met by steps 2–3 of that sequence and by the
deployed serialisation fix (`20260905170000`).

---

## 4. What each slice deploys

| Slice | Migration | App deploy | Acceptance available |
|---|---|---|---|
| 0 inspect exports | no | no | yes |
| 1 announce freeze | no | yes | **paused, and says so** |
| 2 chronology | yes | no | paused |
| 3 evidence coverage | yes | no | paused |
| 4 acceptance RPCs | yes | no | paused |
| 5 current authority | yes | no | paused |
| 6 dates and roles | no | yes | **restored, current role** |
| 7 history projections | yes | no | yes |
| 8 historical + cellar (close-out) | no | yes | **historical role added** |
| ~~9 position history~~ | — | — | deferred, not scheduled |
| ~~10 correction path~~ | — | — | deferred until needed |
| ~~11 production enable~~ | — | — | removed; folded into Slice 8 |

Slices 2–5 are four migrations with no app deployment between them and can be
pushed in one session, which is the whole of the freeze. No snapshot can be
accepted at any point before evidence coverage is complete.

---

## 5. Security and privacy

**Privacy (spec §10).** No new view selects `cellar_import_rows.raw_row`.
`bbr_holding_evidence` carries no personal column, and every new projection is
built from it. Fixtures contain no `Account Payer` or `Beneficial Owner`
value. Error messages name row numbers and rule violations, never source-row
contents.

**Relations.** Every new view is `security_invoker = TRUE` with
`REVOKE ALL ... FROM PUBLIC, anon, authenticated` and
`GRANT SELECT ... TO authenticated`, relying on existing base-table RLS.

**Functions.** Every new function is `SECURITY DEFINER` with
`SET search_path = ''` and a `private.is_app_owner()` check as its first
statement, **and** carries an explicit
`REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated` /
`GRANT EXECUTE ... TO authenticated` pair. The internal owner check does not
remove the default `PUBLIC` execute privilege; both are required, and both are
asserted with `has_function_privilege` in pgTAP.

Anonymous and non-owner denial is asserted for every new relation and
function, as `supabase/tests/database/read_layer_security.test.sql` does for
existing ones.

---

## 6. Testing and production safety

The 27 and 28 August incidents established that production has no spare I/O or
memory capacity for verification workloads
([DEPLOYMENT-INCIDENT-2026-08-27.md](DEPLOYMENT-INCIDENT-2026-08-27.md),
[DEPLOYMENT-INCIDENT-2026-08-28.md](DEPLOYMENT-INCIDENT-2026-08-28.md)). The
boundaries below are part of this plan, not a preamble to it.

### Local database — the whole behavioural suite

- clean migration replay (`supabase db reset` from empty), per slice;
- pgTAP for constraints, function privileges and derived-history cases;
- the two-session concurrency check for competing current acceptances;
- parser fixtures, including historical header variations and repeated
  positions;
- application unit tests and `next build`.

Fixtures are small and synthetic, covering every state transition once.
Repeating the same test at large volume adds little confidence for a personal
dataset measured in hundreds to low thousands of rows.

### Isolated production-shaped copy — only these five things

- migration rehearsal against representative data;
- before-and-after row equivalence (Slice 5);
- query-plan inspection;
- realistic-volume timing;
- one synthetic historical acceptance, then inspection of the derived views
  (Slice 11).

No production credential or endpoint is used by these. Temporary objects are
removed immediately after the check. **If no safe copy exists, the part of the
release that needs one waits** — there is no "deliberate trade-off" route to
running these against production.

### Production — deployment smoke checks only

- confirm the migration ledger once after each pushed migration;
- a pre-written, finite set of small point or count queries;
- confirm the nominated current import ID and expected row count;
- one owner browser pass through the affected pages;
- observe normal application health after deployment.

Prohibited on production: application or shell loops issuing queries;
repeated polling or benchmarking; catalogue-wide equivalence or timing scans;
concurrency tests; synthetic bulk imports; temporary verification schemas or
materialised views; automatic retry after a timeout, empty response or other
ambiguous failure.

Every production query has a bounded target and a short statement timeout. If
one times out, latency rises materially, database I/O increases, or a response
is ambiguous, stop and inspect server-side state before any further request.
No deployment verification between 02:00 and 05:00 UTC.

D4's 300 ms threshold is read from normal request telemetry. It authorises
reproducing and measuring the problem on an isolated copy; it never authorises
timing runs against production.

---

## 7. Deliberately out of scope

The epic's exclusions, confirmed against this plan: no inferred sale,
withdrawal or consumption events; no acquisition-lot or cost-basis accounting;
no inflation adjustment; no cross-vintage identity; no advisories, rankings or
alerts; no scenario-engine change; no LLM querying; no general-purpose import
editor.

Added by the second review: **`Purchase date / warehouse goods in date` is
recorded in the source profile but not added to typed evidence in this
version**, even if older exports populate it.

Also unchanged: the wine record page keeps reading `current_bbr_holdings` and
gains no former-holdings panel — its only change is the documented contract
widening in D3 — and CellarTracker is untouched apart from the shared-table
constraints being written so they cannot affect it.

---

## 8. Hand-off state

Against the second review's gate:

| Gate condition | State |
|---|---|
| Evidence coverage moved before acceptance restoration | Done — Slice 3 precedes Slice 6, plus the completeness invariant in Slice 4 (D6) |
| Current withdrawal removed | Done — removed from D5 and Slice 4; `unknown` membership retained for a never-nominated database |
| Recovered exports checked for repeated Parent ID and format rows | **Outstanding — this is Slice 0**, and D10 pre-commits both design branches |
| Duplicate-file behaviour amended and recorded | Done — functional spec §4.5 amended 5 September 2026; D9 follows it |
| Legacy backfill and function privileges explicit | Done — Slice 2 step 2, Slice 4 privileges, §5 |
| Testing plan contains the production limits | Done — §6 |

Slice 0 may start now. Slices 1 onward start when Slice 0 has reported, since
its second measurement selects the D10 branch that Slices 3, 7 and 9 are
written against.

---

## 9. Second-review response

Against
[`BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN-SECOND-REVIEW.md`](BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN-SECOND-REVIEW.md),
5 September 2026. All findings accepted; each was checked against the code
before being acted on.

| Finding | Outcome |
|---|---|
| P1 Acceptance resumes before unmatched evidence is preserved | Accepted. Evidence coverage moves inside the freeze and ahead of acceptance (Slice 3 before Slice 6). `accept_bbr_snapshot` gains an evidence-completeness invariant, which also forces any pre-Slice-3 import with unmatched rows to be re-uploaded rather than accepted incomplete. Revision 2's silent guard is gone. (D6, Slices 3–4) |
| P1 Withdrawing the current nomination has no valid stored state | Accepted, and confirmed against the plan and spec: D1 requires `superseded_at`/`superseded_by` together and a withdrawal has no replacement to name, while spec §4.6 and §11.9 forbid leaving current holdings undefined. `withdraw_bbr_current_nomination` is removed; `unknown` membership is retained for a never-nominated database; a bad nomination is corrected forwards. (D5, D8) |
| P1 Position uniqueness is inferred from one modern export | Accepted, and it is worse than a constraint question: `bbrParser.ts:381-393` marks repeats `invalid`, which makes the whole import unacceptable, so a repeating historical export cannot be imported at all today. Slice 0 now measures repeats and their product codes, quantities and prices; D10 pre-commits both designs; no constraint or projection is written until it reports. (D10, Slices 0, 3, 7, 9) |
| Legacy backfill | Accepted. Slice 2 orders accepted imports, nominates the last and chains the earlier ones as superseded, and raises with an explanatory message on a null field or a date collision instead of failing later at index creation. |
| Function privileges | Accepted. Explicit `REVOKE`/`GRANT EXECUTE` on every new function, plus `has_function_privilege` assertions for `anon` and `authenticated`, following `bbr_cellar_import.test.sql:119,129`. (§5, Slices 4 and 10) |
| Concurrency verification | Accepted. pgTAP is single-session; a two-session `psql` harness asserts that exactly one of two competing current acceptances commits. Local or isolated copy only. (Slice 4) |
| Data-branch wording | Accepted. Revision 2's "otherwise a deliberate trade-off" escape hatch is removed. Equivalence, timing, concurrency and realistic-volume work never run against production; without a safe copy, that part of the release waits. (§6, Slice 5) |
| Amend duplicate-file behaviour | Accepted and **carried out**: functional spec §4.5 amended 5 September 2026, superseded rule preserved in place. D9 implements it — advisory detection, non-unique file-identity index, effective-date uniqueness as the real invariant. |
| Close the remaining owner questions | All eight closed as recommended: one snapshot per effective date unless Slice 0 finds same-day exports (D2); widened wine route accepted (D3); all-owned default and effective date in the heading (D7); audited amendment without withdrawal (D5); `bbr-v2` if the header contract changes (Slice 0 gate); purchase-date field recorded but not typed (§7). |
| Proportionate testing and production safety | Accepted verbatim as §6, including the prohibited list, bounded queries with short statement timeouts, the 02:00–05:00 UTC exclusion, and the clarification that D4's 300 ms threshold is a telemetry signal rather than a licence to benchmark production. |

Slice numbering changed. Revision 2 → revision 3: 0→0, 1→1, 2→2, 3→**5**,
4→**7**, 5→**6**, 6→**3**, 7→7, 8→8/9, 9→10, 10→11. The substantive move is
evidence coverage from after acceptance restoration to before it.
