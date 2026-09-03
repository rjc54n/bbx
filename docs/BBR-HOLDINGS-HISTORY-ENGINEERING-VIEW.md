# BBR holdings history: initial engineering view

**Status:** initial view for technical-design planning, 31 August 2026. This is
not a schema, migration or implementation plan.
**Product authority:**
[`BBR-HOLDINGS-HISTORY-FUNCTIONAL-SPEC.md`](BBR-HOLDINGS-HISTORY-FUNCTIONAL-SPEC.md).

---

## 1. Assessment

The change is feasible without replacing the existing immutable-import model.
The source evidence is already retained at import and row grain. The main
change is to stop treating "latest accepted import" as both chronology and
current-state authority.

The technical design should separate four concerns:

1. immutable source evidence;
2. owner-confirmed snapshot date and role;
3. derived current and historical position state; and
4. live catalogue and market decoration.

Keeping those concerns separate lets historical files arrive out of order and
keeps current market values live. It also avoids rewriting old evidence when a
derived rule changes.

---

## 2. Current baseline

The deployed flow already provides:

- private source-file retention;
- immutable import, source-row and matched BBR evidence records;
- checksum and parser-version deduplication;
- staged validation and explicit acceptance;
- owner-only access controls;
- a current projection selected by most recent `accepted_at`;
- a current market view joined at Parent ID and format; and
- a BBR cellar browser with filters and favourites.

The representative live import has one distinct Parent ID per row and all rows
matched the then-current catalogue. Historical files may not preserve those
properties, so technical design cannot generalise from that single sample.

---

## 3. Required conceptual changes

### 3.1 Effective chronology

`uploaded_at` and `accepted_at` are audit timestamps. Neither describes when a
historic file was true. The model needs a separate owner-confirmed effective
date.

Derived chronology must be deterministic when imports are accepted out of
order. The design must define same-date conflict handling rather than falling
back silently to upload order or UUID order.

### 3.2 Explicit current authority

The current projection now selects the latest accepted BBR import. That rule
cannot coexist safely with out-of-order historical acceptance.

Current authority must become explicit. Accepting a historical import must not
change the current projection. Accepting a new current import must replace the
prior current authority while leaving its evidence intact.

The technical design should preserve a stable current-holdings contract for
existing consumers, even if its implementation changes.

### 3.3 Ownership evidence independent of catalogue coverage

The current normalised evidence path is populated only for exact catalogue
matches. That was acceptable for a market-decorated current browser, but it is
too restrictive for an authoritative BBR history.

A valid source row with a native BBR Parent ID is evidence that the position
was held. Failure to find a current local catalogue row is a decoration or
coverage problem, not a reason to remove the ownership fact.

Technical design must keep ownership ingestion and catalogue resolution
separate while retaining the exact format needed for later market joins.

### 3.4 Consolidated position projection

The new owner-facing dataset has one row per Parent ID and format across all
accepted snapshots. It needs current membership, current quantity, first and
last seen dates, reported-price range and provenance.

Episode presentation can be derived from ordered observations. It should not
become a write-time transaction model.

### 3.5 Price observations

`purchase_price_per_case_p` already exists on BBR evidence. Historical support
changes it from one current attribute into a dated observation.

The technical design must preserve case size, bottle volume, currency and
in-bond basis. It should not persist an average, inferred cost basis or
inflation-adjusted amount as source truth. Minimum and maximum are derived
facts that can be replaced later without evidence migration.

### 3.6 Favourites

Favourites already attach to Parent ID outside the BBR import lifecycle. The
history work should consume that state, not create a second favourite concept.
Several format rows for one Parent ID will continue to share one favourite.

---

## 4. Compatibility boundaries

### Current holdings

Existing consumers of `current_bbr_holdings` and
`bbr_cellar_market_view` expect current rows only. A technical design should
either retain those contracts or provide an atomic consumer migration with
row-equivalence checks.

The current BBR cellar, wine record, favourites and any catalogue summaries
must not start counting former positions as current stock.

### Historical holdings

The all-owned and observation-history contracts should be separate from the
current contract. This keeps downstream queries explicit about whether they
want current positions, all evidenced positions or dated observations.

### Market data

Imported bid, ask and market values remain dated evidence. User-facing current
market values continue to come from the scanner-backed catalogue projection.
No historical import should overwrite current market state.

---

## 5. Correction strategy

Post-acceptance date correction is expected to be rare. A general metadata
editing subsystem is not justified initially.

The technical design should compare two bounded options:

- an owner-only effective-date amendment with explicit audit evidence; or
- controlled deletion and resubmission of the import.

The choice should minimise total code, storage, operational and runtime cost.
User convenience is secondary because the path may never be used.

Deletion is not automatically the smaller option. It must account for checksum
uniqueness, private Storage cleanup, the nominated-current reference and any
downstream provenance links. A narrow audited amendment may have less total
impact. The design should estimate both before choosing.

No implementation should allow the nominated current snapshot to be deleted or
redated into inconsistency without a replacement or an explicit safe state.

---

## 6. Performance view

The initial dataset is small, but repeated complete snapshots multiply evidence
rows. Reconstructing every position and episode in the browser on every request
would scale with the full import history and is unlikely to remain acceptable.

The technical design should measure representative history before choosing
between query-time derivation, a maintained projection or a materialised read
model. It should preserve these properties:

- current-only reads remain cheap;
- one historical import does not rewrite immutable source rows;
- derived history is deterministic after out-of-order insertion;
- current acceptance updates all affected rows consistently; and
- indexes follow actual filter and join paths rather than speculative fields.

Production timing or equivalence checks should use a Supabase data branch when
available. Live production is not the default test bed.

---

## 7. Security and privacy view

The new metadata, projections and any correction operation remain owner-only.
Any new exposed relation requires the same RLS, privilege and
`security_invoker` review as the existing personal views.

The design must check that broader historical projections do not expose raw
personal fields such as account payer or beneficial owner. Errors and logs
must continue to avoid source-row contents.

An exceptional correction operation needs a direct owner check and bounded
target. It must not gain broad mutation rights over source evidence.

---

## 8. Migration and release view

This change affects the meaning of current holdings, so it should be released
in independently verifiable slices rather than as one app-and-database switch.
The later technical design should include:

- metadata support without changing the current projection;
- backfill of the existing accepted snapshot as the nominated current baseline;
- historical projection validation against synthetic out-of-order snapshots;
- row and quantity equivalence between old and new current projections;
- application adoption after database support is live; and
- production smoke checks that distinguish app deployment from migration
  deployment.

Historical imports should not be accepted in production until the new current
authority and rollback behaviour have been verified.

---

## 9. Testing implications

The technical design needs automated coverage for:

- historical imports accepted before and after the current import;
- upload order differing from effective-date order;
- presence, absence and reappearance;
- quantity and reported-price changes;
- several formats for one Parent ID;
- a valid BBR Parent ID absent from the local catalogue;
- same-day snapshot conflicts;
- exact-file deduplication;
- current-snapshot replacement;
- attempted correction or deletion of the current snapshot;
- non-owner and anonymous access; and
- current-view row equivalence during migration.

Fixtures must be synthetic and must not contain personal source fields.

---

## 10. Questions for technical design

These are implementation questions, not unresolved product decisions:

1. What is the least costly representation of explicit current authority?
2. Does the effective date need date-only precision, or an optional time for
   multiple same-day downloads?
3. How should same-date, non-identical complete snapshots be rejected or
   resolved?
4. How should valid ownership observations be stored when local catalogue
   format resolution is unavailable?
5. Which derived history facts are computed at read time and which are
   maintained?
6. Is a narrow audited date amendment cheaper and safer than delete and
   resubmit?
7. How are current consumers migrated without a mixed app/schema deployment
   window?
8. What volume do the recovered historical files add, and which access paths
   need performance tests?

---

## 11. Initial recommendation

Proceed to technical design after inspecting a small representative set of
historical BBR exports. Confirm that Parent ID, format, quantity and reported
purchase-price semantics are stable across years before fixing a storage
shape.

Preserve immutable evidence and the existing current projection throughout the
transition. Add explicit snapshot chronology and authority first. Build the
all-owned projection on top of those facts. Leave analytics and recommendations
to downstream work.
