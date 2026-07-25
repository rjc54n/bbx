# Phase 5 implementation: cellar holdings and history

**Status:** BBR slice implemented locally on 2026-07-25; database deployment,
owner bootstrap, MFA and live acceptance remain
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

The first implementation is single-owner. It must preserve original source
evidence, make repeated uploads idempotent and keep unresolved rows available
for later matching.

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

## BBR implementation state

The local implementation now includes:

- the single-owner allowlist and owner-check function;
- owner-only RLS for personal tables and the private import bucket;
- immutable import, source-row and normalised BBR evidence tables;
- atomic staging and acceptance RPCs;
- a current BBR holdings view derived from the latest accepted snapshot;
- strict BBR CSV parsing, checksum idempotency and exact product-format
  matching;
- login, logout, protected import history, upload, preview, comparison and
  acceptance pages; and
- parser tests plus database permission and import-behaviour tests.

The representative BBR file has 116 rows. A live catalogue read on 2026-07-25
found an exact product-format match for all 116 rows. This is source profiling,
not a live import. The private file has not been uploaded by the implementation
work.

The migration remains unapplied at this point. A linked dry run on 2026-07-25
listed only `20260725120000_bbr_cellar_import.sql` for deployment. The
production build, lint and 77 web tests pass locally. Clean migration replay,
pgTAP, owner provisioning, MFA and browser-level owner/non-owner checks remain
release gates.

Raw exports contain personal holdings and purchase history. They remain outside
Git. Commit only small, synthetic or irreversibly redacted fixtures that retain
the source headers and parsing edge cases.

## Source responsibilities

BBR is authoritative for the current position held with BBR at the snapshot
time. The supplied CellarTracker file is a dated wine-level summary. It
contains current `Quantity` and `Pending` totals plus zero-total historical
rows, but no purchase, movement, location or bottle-level consumption events.
By product decision, a zero-total row means the wine is `fully_consumed`.

Overlapping source records are reconciled. They are not added together without
evidence and neither source silently overwrites the other.

`Parent ID` is the preferred BBR match to `products.parent_sku`. Missing or
invalid identifiers remain unmatched source rows. CellarTracker matching rules
use vintage plus the source wine identity and must retain the source wine name
even after a match is accepted. `Pending` is a reconciliation signal, not
proof of a BBR location. See `IMPORT-SOURCE-PROFILES.md`.

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
7. Match products and formats without discarding unresolved rows.
8. Present additions, removals, quantity changes, conflicts, warnings and
   unmatched rows.
9. Accept the import explicitly.
10. In one database transaction, activate the accepted evidence and refresh
    the current-holdings projection.

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

- Implement the profiled Windows-1252 CellarTracker summary contract.
- Import current quantities and the `fully_consumed` state without inventing
  bottle events.
- Retain unresolved source wine identities.
- Reconcile overlap with accepted BBR snapshots.
- Keep physical location unspecified until the owner confirms that `Quantity`
  represents only the home cellar.

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
- A changed file produces a new snapshot and an accurate difference.
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

The holdings portion of Phase 5 is accepted when the two representative
snapshot exports can be uploaded twice without duplication, their unmatched
and conflicting rows are visible, an accepted import produces the same current
holdings on replay, and an anonymous client cannot retrieve any file, staging
row or holding. Bottle-level history remains optional and requires a
representative event export before implementation.
