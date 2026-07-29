# Phase 5 implementation: cellar holdings and history

**Status:** BBR and CellarTracker snapshot imports, owner cellar views and
whole-dataset catalogue matching implemented; CellarTracker schema deployed on
2026-07-29
**Decision authority:** `ADR-001-single-owner-application.md`
**Sources:** BBR current holdings CSV and CellarTracker My Cellar summary
**Source contracts:** `IMPORT-SOURCE-PROFILES.md`

## Outcome

Phase 5 creates an auditable backend record of:

- where it is held now;
- which wines are fully consumed at wine level; and
- which source supports each claim.

The supplied CellarTracker file does not contain purchase, movement or
bottle-level consumption events. A zero-total row is treated as
`fully_consumed`, but it must not generate synthetic bottle counts or dates.

The implementation is single-owner. It preserves original source evidence,
makes exact repeated uploads idempotent and keeps unresolved rows available for
later matching.

## Preconditions

Before a production upload endpoint exists:

1. The full migration chain replays successfully in the database CI workflow.
2. One production migration owner is confirmed: Supabase GitHub integration or
   a dedicated deployment workflow, never both.
3. Representative, unmodified BBR and CellarTracker exports have been
   inspected. Their bounded profile is recorded in
   `IMPORT-SOURCE-PROFILES.md`; the private files remain outside Git.
4. The owner Supabase Auth account exists, new sign-up is disabled and the
   owner allowlist is populated.
5. The Next.js application validates Supabase sessions server-side.
6. Personal tables and the private import bucket have owner-only RLS tests.

Backend schema and local import parsing may be developed before items 4–5.
Nothing that accepts an upload over the public internet may be deployed before
they are complete.

## Implementation state

The implementation now includes:

- the single-owner allowlist and owner-check function;
- owner-only RLS for personal tables and the private import bucket;
- immutable import, source-row and normalised BBR evidence tables;
- atomic staging and acceptance RPCs;
- a current BBR holdings view derived from the latest accepted snapshot;
- an owner-only current-holdings and BBX market view at exact product-format
  grain;
- strict BBR CSV parsing, checksum idempotency and exact product-format
  matching;
- login, logout, protected import history, upload, preview, comparison and
  acceptance pages;
- an owner-only BBR cellar browser with URL-backed filters and current BBX bid
  and ask values; and
- parser tests plus database permission and import-behaviour tests.

CellarTracker adds:

- Windows-1252 decoding and the documented 25-column source contract;
- full-snapshot staging, raw-row retention, checksum deduplication and explicit
  acceptance;
- rounding of numeric source prices to the nearest penny before validation;
- editable invalid rows, row discard and whole-import deletion before
  acceptance;
- a latest-accepted snapshot view containing current and fully consumed wines;
- owner-confirmed home and BBR-held quantities;
- whole-snapshot Parent ID matching through unique local exact matches and
  bounded, resumable `prod_product` Algolia searches;
- provisional candidate review, manual link, edit, unlink, suppress, restore
  and group deletion controls with resolution events; and
- approximate per-bottle BBX comparisons using the smallest available case
  size for a linked Parent ID.

The web routes are `/cellartracker`, `/cellartracker/matches` and
`/cellar/imports/cellartracker`. The imports hub links to the source-specific
history and upload page.

The representative BBR file has 116 rows. A live catalogue read on 2026-07-25
found an exact product-format match for all 116 rows. The file has since been
uploaded, reviewed and accepted in production. The import schema, owner
allowlist and authentication account are live.

GitHub cleanly replayed all migrations, linted the public schema and passed
pgTAP before the cellar market view migration was applied to production. The
web deployment completed successfully. Owner browser acceptance passed and
Vercel Authentication was removed from the stable production domain, leaving
the Supabase owner sign-in as its application gate.

Raw exports contain personal holdings and purchase history. They remain outside
Git. Commit only small, synthetic or irreversibly redacted fixtures that retain
the source headers and parsing edge cases.

## Source responsibilities

BBR is authoritative for the current position held with BBR at the snapshot
time. The supplied CellarTracker file is a dated wine-level summary. It
contains current `Quantity` and `Pending` totals plus zero-total historical
rows, but no purchase, movement or bottle-level consumption events. By product
decision, `Quantity` is home-held, `Pending` is BBR-held and a zero-total row
means the wine is `fully_consumed`.

Overlapping source records are reconciled. They are not added together without
evidence and neither source silently overwrites the other.

`Parent ID` is the preferred BBR match to `products.parent_sku`. Missing or
invalid identifiers remain unmatched source rows. CellarTracker matching uses
vintage plus the source wine identity and retains the source name after a match
is accepted. A producer-prefixed source name may use its remaining wine name as
the Algolia query, but this never turns a non-exact result into an automatic
link. See `IMPORT-SOURCE-PROFILES.md` and
`CELLARTRACKER-IMPLEMENTATION.md`.

## Import evidence model

### `cellar_imports`

One row per uploaded file:

- generated import ID;
- source type: `bbr_holdings`, `cellartracker_inventory` or a later
  `cellartracker_events`;
- SHA-256 content checksum;
- original filename, byte size and private Storage object path;
- uploader and upload time;
- parser/schema version;
- status: `uploaded`, `parsing`, `validated`, `accepted` or `failed`;
- source, parsed, matched, unmatched, warning and error row counts;
- acceptance user/time; and
- bounded failure summary.

`(source_type, content_checksum, parser_version)` is unique. Uploading the same
file again under the same parser returns the existing import rather than
duplicating evidence. A later parser version can reprocess the source without
overwriting the earlier result.

### `cellar_import_rows`

One immutable staging row per source row:

- import ID and one-based source row number;
- raw row as JSON, preserving original field names and values;
- stable source record identifier where the export supplies one;
- parse and match status;
- structured validation messages;
- proposed `parent_sku` and format match, with method and confidence; and
- normalised candidate values produced by the versioned parser.

`(import_id, source_row_number)` is unique. Parsing a file again replaces no
accepted evidence. A new parser run is recorded as a new attempt or versioned
result.

### Normalised evidence

The normalised model must preserve these distinctions:

- BBR snapshot, CellarTracker inventory summary and lifetime event;
- purchase, movement, current stock and consumption;
- remote, home and other locations;
- cases, loose bottles, case size and bottle volume;
- source quantity versus derived bottle-equivalent quantity;
- purchase price and currency where present;
- event/effective date versus import date; and
- matched, unmatched and manually resolved identity.

A current-holdings projection is derived from accepted evidence. It is not the
only copy of the source state. Event tables may be introduced only after an
event-bearing export has been inspected. A CellarTracker summary row must
never be converted into a synthetic purchase or consumption event. A
zero-total row may set the wine-level `fully_consumed` state.

## Upload and acceptance flow

1. Validate the owner session before accepting bytes.
2. Enforce a configured byte limit, row limit and accepted CSV content types.
3. Compute the checksum before creating new evidence.
4. Store the original file in the private import bucket.
5. Parse into immutable staging rows with a versioned source parser.
6. Validate headers, required values, dates, quantities and source invariants.
7. Present validation errors, warnings and repair or deletion controls.
8. Accept the import explicitly.
9. In one database transaction, activate the accepted evidence and refresh
    the current-holdings projection.
10. Run catalogue matching separately against the consolidated accepted
    dataset.

A parsing, matching or projection failure leaves the previous accepted cellar
unchanged. Acceptance is repeatable and records its actor.

## Security requirements

- No personal relation grants access to `PUBLIC` or `anon`.
- RLS covers `SELECT`, `INSERT`, `UPDATE` and `DELETE`, even if the interface
  initially uses fewer operations.
- The owner check uses the stable Auth user ID, not an email address or
  user-editable metadata.
- The Storage bucket is private. Object paths are generated by the server and
  are not trusted from the uploaded filename.
- Original filenames are display metadata only.
- CSV cells are data. They are never evaluated as formulas, HTML or commands.
- Logs contain import IDs and counts, not full holdings rows or source files.
- Error messages returned to the browser do not contain database credentials,
  private object paths or raw rows from other imports.

## Delivery slices

### Slice 5A: authentication and owner boundary

- Add the owner allowlist and owner-check function by migration.
- Add RLS tests for anonymous, owner and non-owner sessions.
- Add server and browser Supabase clients for cookie-backed sessions.
- Add login, logout and protected-route behaviour.
- Provision the production owner as environment data and disable sign-up.

### Slice 5B: immutable upload evidence

- Add the private bucket, import tables and policies.
- Add the authenticated upload endpoint.
- Store source files and rows without updating current holdings.
- Implement checksum idempotency and bounded validation.

### Slice 5C: BBR current holdings

- Implement the profiled BBR export contract.
- Implement `Parent ID` and format matching.
- Add snapshot comparison and explicit acceptance.
- Build the current BBR-held projection.

### Slice 5D: CellarTracker inventory summary

- **Shipped 2026-07-29.** The Windows-1252 summary contract, full-snapshot
  import, current and consumed view, and separate catalogue matching page are
  implemented.
- `Quantity` is home-held and `Pending` is BBR-held by final owner decision.
- The BBR/CellarTracker reconciliation tool remains a separate backlog item.
- Multi-format CellarTracker support is intentionally excluded because size is
  recorded at bottle rather than wine grain.

### Slice 5E: cellar views

- Add current holdings, drink-now evidence and concentration read models.
- Expose personal views only to the owner.
- Keep all public catalogue views free of personal columns and joins.

## Optional bottle-level follow-on

A CellarTracker transaction or individual-bottle export may be added later if
dated consumption history becomes useful. It is not part of Phase 5
acceptance. Profile the source before adding event tables or projections.

## Test plan

- A clean database applies every migration in order.
- Anonymous and non-owner sessions cannot read, upload or change cellar data.
- The owner can perform the intended operations.
- Private source objects cannot be listed or downloaded without the owner
  session.
- A duplicate file checksum creates no duplicate import or evidence.
- A changed file produces a new snapshot. Acceptance selects the latest by
  acceptance time.
- Invalid headers, oversized files and excessive row counts fail before
  activation.
- A failed parse or projection leaves the accepted cellar unchanged.
- Unmatched rows retain the complete original source record.
- Reprocessing with a newer parser preserves the earlier result and provenance.
- BBR and CellarTracker overlap produces a visible conflict rather than doubled
  stock.
- Windows-1252 source names survive import without replacement characters.
- Zero-total CellarTracker rows set `fully_consumed` but create no synthetic
  purchase or consumption events, quantities or dates.
- Personal rows cannot appear through an anonymous catalogue view or RPC.

## Acceptance

The BBR and CellarTracker holdings imports are implemented. CellarTracker's
acceptance-time additions, removals and quantity-change summary is not yet
shown in the interface; it remains informational and must not block acceptance.
The separate BBR/CellarTracker reconciliation tool is backlog work. Bottle-level
history remains optional and requires a representative event export before
implementation.
