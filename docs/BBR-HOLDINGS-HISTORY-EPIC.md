# BBR holdings history: epic and user stories

**Status:** draft for review, 31 August 2026. Product decisions agreed; no
technical design or implementation started.
**Owner:** application owner.
**Related documents:**
[`BBR-HOLDINGS-HISTORY-FUNCTIONAL-SPEC.md`](BBR-HOLDINGS-HISTORY-FUNCTIONAL-SPEC.md),
[`BBR-HOLDINGS-HISTORY-ENGINEERING-VIEW.md`](BBR-HOLDINGS-HISTORY-ENGINEERING-VIEW.md),
[`IMPORT-SOURCE-PROFILES.md`](IMPORT-SOURCE-PROFILES.md).

---

## Outcome

BBX will retain complete, dated BBR holdings snapshots and derive one
consolidated record of every BBR wine-format position evidenced by those
snapshots.

The resulting dataset answers two separate questions without conflating them:

- what is held at BBR now; and
- what has been observed in BBR holdings in the past.

It is the authoritative record of evidenced BBR holdings history. CellarTracker
remains ancillary and does not populate it.

The dataset will retain native BBR Parent IDs, formats, reported purchase
prices and source provenance. Scenario analysis, opportunity detection,
cross-vintage suggestions and future natural-language discovery can consume
those facts later. Those applications are outside this epic.

---

## Problem

The current BBR import workflow preserves every source file, but the owner
cellar reads only the most recently accepted snapshot. When a position is
missing from a later file, it disappears from the current cellar even though
the earlier evidence remains in import history.

This prevents the owner from browsing BBR wines previously held, seeing their
reported purchase prices or using them as a dependable input to later queries.
Historic files will initially be recovered from backups and download folders,
so they will be uploaded out of chronological order.

The source files are complete snapshots. They do not contain transaction IDs
or dependable disposal events. The system must preserve what each snapshot
says without inventing purchases, sales, withdrawals or exact holding
intervals.

---

## Product decisions

1. Every accepted BBR file is a complete snapshot of holdings at its effective
   date.
2. The owner supplies or confirms an exact effective date. A date extracted
   from the filename is a suggestion, not authority.
3. An import is explicitly accepted as either the current holdings truth or a
   historical snapshot.
4. Historical snapshots may be uploaded in any order and never replace the
   nominated current snapshot.
5. A current snapshot that is later replaced remains historical evidence and
   retains the fact that it was once accepted as current.
6. A position absent from the current snapshot but present historically is
   `formerly held`. Its exit reason is `unknown` unless separate evidence is
   added later.
7. The consolidated grain is BBR Parent ID plus format.
8. The application records observations and observed holding episodes. It does
   not claim to reconstruct individual acquisition lots or transactions.
9. Purchase prices are nominal in-bond GBP with no inflation adjustment.
10. When several prices were reported, the initial comparison basis is their
   observed range. This can change later without rewriting source evidence.
11. The BBR cellar defaults to all owned positions. A `Current holdings only`
    control restores the present-stock view.
12. Favourites remain visible and remain attached to the unified
    vintage-specific Parent ID.
13. Post-acceptance date correction is an exception. The implementation should
    favour the lowest code, storage and runtime cost, even if correction
    requires user friction.

---

## Scope

### Included

- Required effective-date and snapshot-role metadata.
- Current and historical acceptance paths.
- Out-of-order historical imports.
- Consolidated current and former BBR positions.
- Dated observation history for each position.
- First-seen, last-seen and current/former state.
- Current quantity from the nominated current snapshot only.
- Reported purchase-price observations and range.
- All-owned default with a current-only filter.
- Existing favourite, catalogue and current-market information where a Parent
  ID and format can be resolved.
- A low-frequency correction path for an incorrectly dated import.
- Preservation of raw files, rows and import provenance.

### Excluded

- CellarTracker records in the BBR ownership dataset.
- Inferred sales, withdrawals, consumption or transaction dates.
- Acquisition-lot accounting, realised returns or cost-basis accounting.
- Cross-vintage wine-family identity.
- Buying advisories, opportunity rankings or alerts.
- Scenario-engine changes.
- LLM querying, discovery or recommendations.
- Inflation or tax-basis conversion.
- A general-purpose import editor.

---

## Epic

As the owner, I want complete dated BBR holdings snapshots to form a durable
ownership history, so I can see what I hold now and what I have held before
without losing source evidence or confusing observations with transactions.

### Success measures

- The existing current BBR holdings can be reproduced exactly after the change.
- Importing historical snapshots does not change current quantities.
- Accepting a new current snapshot updates current quantities and retains every
  earlier position in all-owned history.
- Historic files uploaded out of order produce the same derived history as the
  same files uploaded chronologically.
- Every consolidated position can be traced to its accepted source snapshots.
- Current bottle totals exclude former holdings.
- No system-generated sale, withdrawal or acquisition event is presented as
  fact.

---

## User stories

### BBRH-01: date a snapshot

As the owner, I want the import flow to suggest a date from the downloaded
filename and let me confirm or replace it, so the snapshot is ordered by when
it described my holdings rather than when I found or uploaded the file.

Acceptance criteria:

- An exact effective date is required before acceptance.
- Filename and file metadata may suggest a date but never confirm it silently.
- The confirmed date is shown in preview and import history.
- Upload time remains separately visible as provenance.

### BBRH-02: nominate the snapshot role

As the owner, I want to identify an import as current or historical, so a
recovered old file cannot replace today's holdings by accident.

Acceptance criteria:

- The role is explicit before acceptance.
- A historical acceptance cannot change the nominated current snapshot.
- A current acceptance states that omitted positions will cease to be current.
- The application prevents a chronologically inconsistent current designation
  or requires the inconsistency to be resolved before acceptance.

### BBRH-03: review a proposed current snapshot

As the owner, I want to see the positions and quantities that will become
current or former before acceptance, so I can catch an incorrect file or date.

Acceptance criteria:

- Preview identifies additions, removals, quantity changes and reported-price
  changes, not only their counts.
- A removal is described as becoming formerly held with an unknown exit reason.
- Nothing changes until explicit acceptance.
- A failed or invalid import cannot become current.

### BBRH-04: add fragmented historical evidence

As the owner, I want to accept complete historical snapshots in any order, so I
can build the best available history from old backups.

Acceptance criteria:

- A historical import may pre-date existing historical imports.
- Acceptance recalculates derived first-seen, last-seen and price-range facts.
- Current holdings and current bottle totals do not change.
- The same accepted snapshots produce the same derived result regardless of
  upload order.

### BBRH-05: browse all BBR wines owned

As the owner, I want one consolidated row per Parent ID and format, so I can
scan current and former holdings without seeing one row per snapshot.

Acceptance criteria:

- All owned is the default view.
- Each row is visibly current or formerly held.
- Current quantity is shown separately from historical observations.
- Former positions contribute zero to current bottle totals.
- Search and existing cellar filters continue to work where their source data
  exists.

### BBRH-06: restrict the table to current holdings

As the owner, I want a `Current holdings only` control, so I can recover the
existing operational cellar view immediately.

Acceptance criteria:

- The control is available without navigating to another page.
- It excludes every former position.
- The resulting rows and quantities agree with the nominated current snapshot.
- The filter state can be represented in the page URL consistently with the
  existing cellar filters.

### BBRH-07: inspect a position's evidence

As the owner, I want to inspect the dated observations behind a consolidated
position, so I can understand why it is classified as current or former.

Acceptance criteria:

- The history lists every accepted snapshot containing the position.
- Each observation shows effective date, quantity, reported purchase price and
  source import.
- Gaps are described as absence from a complete snapshot, not as a sale or
  withdrawal.
- Disappearance followed by reappearance is visible without claiming that the
  same acquisition lot returned.

### BBRH-08: retain reported purchase-price history

As the owner, I want all reported purchase-price observations retained, so
later applications can compare market prices with what BBR previously reported
I paid.

Acceptance criteria:

- Values remain nominal in-bond GBP.
- No inflation adjustment is offered.
- The consolidated position exposes the minimum and maximum observed price.
- The source observation remains available for every price.
- A changed price does not create a synthetic purchase transaction.

### BBRH-09: retain favourites

As the owner, I want favourite stars to remain on current and former rows, so
the history change does not weaken an existing owner decision.

Acceptance criteria:

- Favourite state remains attached to Parent ID, not to an import or snapshot.
- Every format row for the Parent ID shows the same effective favourite state.
- Becoming formerly held does not remove the favourite.

### BBRH-10: correct an exceptional dating mistake

As the owner, I want a supported way to correct an incorrectly dated accepted
snapshot, so one manual mistake does not permanently corrupt the ordering.

Acceptance criteria:

- The source file and source rows are not edited in place.
- The correction path is explicit and owner-only.
- Derived history is recalculated after correction.
- Correcting or removing the nominated current snapshot cannot silently leave
  current holdings undefined.
- The initial implementation may use a deliberately manual delete-and-resubmit
  flow if that has lower total cost than a general metadata editor.

### BBRH-11: preserve downstream contracts

As an internal consumer, I want a stable current-holdings projection and a
separate historical projection, so existing pages continue to work while later
analytics can use the fuller dataset.

Acceptance criteria:

- Existing current-holdings semantics remain available.
- Current market data remains live rather than frozen from old imports.
- Historical source market columns remain evidence only.
- Every downstream field states its grain and provenance.

---

## Dependencies

- The existing owner-only import and Storage boundary.
- The BBR source contract and native Parent ID.
- The current catalogue and BBX market projections.
- The unified favourite at Parent ID grain.
- Representative historical exports for design validation.

## Risks

- Treating acceptance time as snapshot time would make out-of-order history
  wrong.
- Treating catalogue matching as a condition of ownership evidence would lose
  valid BBR rows when the local catalogue is incomplete.
- Repeated price observations can be mistaken for acquisition transactions.
- A current snapshot can be displaced accidentally unless its role is explicit.
- Historical growth can make a request-time reconstruction too expensive.
- A correction path can weaken immutability if source evidence and user-entered
  metadata are not kept conceptually separate.
