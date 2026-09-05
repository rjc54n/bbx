# BBR holdings history: functional specification

**Status:** draft for review, 31 August 2026; §4.5 amended 5 September 2026.
Product behaviour agreed; no technical design or implementation started.
**Scope:** BBR holdings imports and the owner-only My BBR Cellar experience.
**Companion documents:**
[`BBR-HOLDINGS-HISTORY-EPIC.md`](BBR-HOLDINGS-HISTORY-EPIC.md) and
[`BBR-HOLDINGS-HISTORY-ENGINEERING-VIEW.md`](BBR-HOLDINGS-HISTORY-ENGINEERING-VIEW.md).

---

## 1. Purpose

The feature turns immutable BBR holdings imports into a durable, dated record
of BBR wine-format positions. It retains the existing current-holdings use case
and adds a consolidated history of positions previously observed at BBR.

BBR is authoritative for this dataset. CellarTracker is not an input.

The feature records observations, not transactions. A complete snapshot proves
that a position appeared or did not appear on one effective date. It does not
prove the date or reason for a purchase, sale, withdrawal or consumption.

---

## 2. Terms

| Term | Meaning |
|---|---|
| Snapshot | One complete BBR My Cellar export describing all BBR-held positions at an effective date. |
| Effective date | The owner-confirmed date on which the file described the holdings. It is independent of upload and acceptance time. |
| Current declaration | A snapshot accepted to become the current holdings truth. It becomes a superseded current declaration when a later one replaces it. |
| Nominated current snapshot | The one current declaration that is authoritative for current BBR holdings now. |
| Historical snapshot | An accepted complete snapshot that was added as history and cannot change current holdings. |
| Position | One BBR Parent ID and format combination. |
| Observation | One valid source row asserting the position, quantity and other reported values in one snapshot. |
| Current position | A position observed in the nominated current snapshot. |
| Former position | A position observed in at least one accepted snapshot but absent from the current snapshot. |
| First seen | Earliest effective date of an accepted observation for the position. |
| Last seen | Latest effective date of an accepted observation for the position. |
| Absent by | For one observed episode, the effective date of the first later complete snapshot in which the position is absent. This is evidence of absence, not an exit date. |
| Reported purchase price | The nominal in-bond GBP purchase price per case stated by BBR in an observation. |
| Holding episode | A presentation of observed presence separated by one or more complete snapshots where the position is absent. It is not an acquisition lot. |

---

## 3. Source authority and evidence rules

1. Every uploaded BBR holdings file is treated as a complete snapshot or is
   rejected. Partial snapshots are not supported.
2. The raw file and every parsed source row remain immutable evidence.
3. Effective date and snapshot role are owner assertions attached to the
   import. They are not inferred source facts.
4. BBR's native Parent ID is the ownership identity supplied by the source.
5. Format remains part of position identity because quantities and prices apply
   to a specific case size and bottle volume.
6. A valid BBR row remains ownership evidence when its Parent ID or format is
   not present in the local catalogue. Catalogue and market fields are then
   unavailable; the observation is not discarded.
7. Market prices, bids, listing state, maturity and eligibility contained in an
   old file remain dated source evidence. Current market displays use the live
   catalogue and scanner projections.
8. Account payer and beneficial owner remain private source fields and do not
   enter public views, logs or synthetic fixtures.

---

## 4. Import workflow

### 4.1 Upload and validation

The existing file-size, CSV shape, header, encoding, row-count and checksum
checks remain. Upload does not change accepted history or current holdings.

The import captures these separate dates:

- effective date, confirmed by the owner;
- upload time, recorded by the application; and
- acceptance time, recorded by the application.

The interface may extract a suggested effective date from the filename. It may
use file metadata as a secondary hint. The owner must confirm the date.

### 4.2 Snapshot role

Before acceptance, the owner selects one role:

- `Current holdings`: the file becomes the complete current truth; or
- `Historical snapshot`: the file adds dated evidence only.

The role must be repeated on the final acceptance action. A default must not
allow an old recovered file to replace current holdings accidentally.

The nominated current snapshot must not pre-date an already accepted snapshot.
If it would, acceptance is blocked until the owner corrects a date, changes the
role or supplies a later current snapshot.

### 4.3 Historical preview and acceptance

The historical preview shows:

- effective date and role;
- source, valid, unresolved and invalid row counts;
- positions first seen by this import;
- positions whose last-seen date or purchase-price range will change; and
- validation issues.

Acceptance inserts the snapshot into the effective-date sequence. It can
change derived history for existing positions, but it cannot change which
positions or quantities are current.

Historical imports may be accepted in any order. Derived output depends on
effective date and deterministic tie handling, not upload or acceptance order.
If a current snapshot is already nominated, a historical snapshot cannot have
a later effective date. The owner must correct its date, nominate it as current
or first supply a later current declaration.

### 4.4 Current preview and acceptance

The current preview compares the proposed snapshot with the nominated current
snapshot at position grain. It lists, with wine and format identity:

- new current positions;
- positions becoming former;
- quantity changes;
- reported purchase-price changes;
- rows that cannot be decorated with local catalogue data; and
- invalid rows that block acceptance.

Counts alone are insufficient. The owner must be able to identify every
position that will cease to be current.

On acceptance:

- the proposed import becomes the nominated current snapshot;
- the prior current declaration becomes superseded but retains its original
  acceptance provenance;
- its observations supply current quantities;
- previously current positions missing from it become former;
- earlier imports and observations remain unchanged; and
- derived history is refreshed.

Accepting a new current snapshot does not create sale, withdrawal or
consumption events.

### 4.5 Duplicate files

**Amended 5 September 2026** on the recommendation of
[`BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN-SECOND-REVIEW.md`](BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN-SECOND-REVIEW.md).
The superseded rule is preserved at the end of this section.

An exact checksum and parser-version repeat is detected and reported, but the
detection is advisory. Opening the existing immutable import remains the
default action. The owner may instead record the same bytes as a separate
snapshot with its own effective date.

A byte-identical export downloaded on a later date is a valid observation that
the position was still held at that later date. Correctness must not depend on
market-price columns happening to differ between two downloads, because those
columns are incidental to the ownership fact being recorded.

Effective-date uniqueness (§4.3) remains the invariant that prevents two
accepted observations of the same day. If the existing import's effective date
is wrong, the correction path applies.

Superseded rule, replaced by the above: "An exact checksum and parser-version
repeat returns the existing immutable import. It does not create another
observation date."

### 4.6 Date correction

The owner can correct the effective date before acceptance.

Post-acceptance correction is an exceptional, owner-only path. The functional
requirement is that correction is possible without editing the source file or
source rows. The initial implementation may choose controlled deletion and
resubmission instead of a general metadata editor when that has lower total
code, storage and runtime cost.

Any correction must:

- show the current effective date and proposed replacement;
- recalculate derived chronology;
- prevent an ambiguous or missing current snapshot;
- preserve or explicitly record the evidence provenance affected; and
- require confirmation before a destructive step.

---

## 5. Derived position behaviour

### 5.1 Consolidation

The all-owned dataset has one row per Parent ID and format. It does not expose
one row per snapshot or one row per inferred episode.

Each consolidated row provides:

- Parent ID and format;
- source wine identity;
- current or former status;
- current quantity, which is zero for former positions;
- first-seen and last-seen dates;
- latest relevant observation date;
- minimum and maximum reported purchase price;
- provenance link to its observations;
- favourite state from the unified Parent ID record; and
- live catalogue and market values when resolvable.

### 5.2 Current status

Current status is membership in the explicitly nominated current snapshot. It
is not based on the most recently uploaded or accepted file.

Historical imports cannot change membership in the nominated current snapshot.
A position introduced only by a historical import appears as former. An import
can also change historical facts such as first seen, an earlier absence or the
observed price range.

### 5.3 Absence and reappearance

When a position appears in one complete snapshot and is missing from a later
one, the interface may say it was absent by the later date. It must not say the
position was sold or withdrawn.

If the position appears again after an observed absence, the history shows a
new observed episode. The application does not assume that the original stock
returned or that a new acquisition occurred.

### 5.4 Quantity

Only the nominated current snapshot supplies current quantity. Historical
quantities remain dated observations.

A fall in quantity is shown as a difference between observations. It is not
converted into a disposal event. A rise is not converted into a purchase
event.

---

## 6. Purchase-price behaviour

1. All values are nominal in-bond GBP.
2. No inflation adjustment is performed or offered.
3. The source case size and bottle volume remain attached to the price.
4. Every dated reported price remains available as evidence.
5. A price change does not identify a transaction or acquisition lot.
6. The consolidated position exposes the observed minimum and maximum.
7. When the range contains one value, the interface displays one reported
   price.
8. When the range contains several values, the interface displays a range and
   links to the dated observations.
9. Current ask and bid values remain live market data. They are not copied into
   or treated as ownership history.

Later consumers may compare a current market value with the range. This spec
does not define an advisory, ranking or alert.

---

## 7. My BBR Cellar

### 7.1 Default state

The page defaults to all owned positions. A checkbox labelled `Current
holdings only` restricts the table to positions in the nominated current
snapshot.

The page summary separates:

- total consolidated positions displayed;
- current positions; and
- current bottles.

Former positions never contribute to current bottle totals.

### 7.2 Table

The table retains the existing wine, region, vintage, format, market and
favourite information. It adds or adapts:

- status;
- current bottles;
- first seen;
- last seen; and
- reported purchase price or range.

The row grain is Parent ID plus format. Favourite state remains Parent ID
grain, so all format rows for one Parent ID show the same state.

Existing search, vintage, region, colour, maturity, eligibility, listing and
bid filters continue where meaningful. Filtered results must not alter the
definition of current totals.

### 7.3 Position history

A consolidated row links to a position history showing every dated
observation. Each entry shows:

- effective date;
- quantity;
- reported purchase price per case;
- source status fields;
- whether local catalogue decoration was available; and
- the immutable import record.

The history may group observations into episodes for readability. The language
must remain observational.

### 7.4 Empty and degraded states

- With no current snapshot, the application states that current holdings have
  not been nominated. It does not select a historical import automatically.
- A former row with no current catalogue match remains visible with market data
  marked unavailable.
- A valid source row with an unresolved local format remains visible as BBR
  evidence and can be reviewed separately.
- If no historical snapshots exist, all-owned and current-only contain the
  same positions.

---

## 8. Import history

The BBR import history shows for each import:

- filename;
- effective date;
- upload and acceptance times;
- historical, nominated-current or superseded-current state;
- row counts and validation state; and
- whether it is the nominated current snapshot.

History is ordered by effective date by default. Upload order remains available
as provenance.

---

## 9. Downstream contract

This feature supplies facts for later consumers. It does not implement those
consumers.

The architecture must make these facts available with explicit grain and
provenance:

- all evidenced Parent IDs and formats;
- current/former state;
- current quantity;
- dated quantities;
- first and last observed dates;
- reported purchase-price observations and range; and
- current catalogue and market linkage state.

Cross-vintage wine relationships, scenarios, discovery queries, advisories and
LLM recommendations remain separate applications.

---

## 10. Permissions and privacy

All imports, observations, derived history and correction actions remain
owner-only. Existing anonymous and non-owner denial rules continue.

Raw files remain in private Storage. Personal source fields remain excluded
from public projections, logs, errors and fixtures.

---

## 11. Acceptance scenarios

1. Import current snapshot A containing position X. X is current.
2. Import historical snapshot B, dated before A and containing position Y. Y is
   former; X remains current.
3. Import historical snapshot C between B and A. Derived dates reorder without
   changing current holdings.
4. Accept current snapshot D without X. X becomes former, but A and its X
   observation remain accessible.
5. Accept current snapshot E where X reappears at another reported price. X is
   current and its history shows separated observations without claiming a new
   purchase.
6. Import a valid Parent ID absent from the local catalogue. The position is
   retained with market data unavailable.
7. Repeat an exact file. The existing import is returned and no observations
   duplicate.
8. Correct a historical effective date. The chronology changes; source rows
   do not.
9. Attempt to remove or correct the nominated current snapshot without a safe
   replacement. The operation is blocked.
10. Filter to current holdings only. Rows and quantities agree with the
    nominated current snapshot.
