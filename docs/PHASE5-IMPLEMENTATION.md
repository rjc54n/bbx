# Phase 5 implementation: cellar holdings and history

**Status:** planned
**Decision authority:** `ADR-001-single-owner-application.md`
**Sources:** BBR current holdings CSV and CellarTracker all-time export

## Outcome

Phase 5 creates an auditable backend record of:

- what was bought;
- where it is held now;
- what has been consumed; and
- which source supports each claim.

The first implementation is single-owner. It must preserve original source
evidence, make repeated uploads idempotent and keep unresolved rows available
for later matching.

## Preconditions

Before a production upload endpoint exists:

1. The full migration chain replays successfully in the database CI workflow.
2. One production migration owner is confirmed: Supabase GitHub integration or
   a dedicated deployment workflow, never both.
3. Representative, unmodified BBR and CellarTracker exports are available as
   private fixtures for mapping. Do not infer their column contracts from
   memory or screenshots.
4. The owner Supabase Auth account exists, new sign-up is disabled and the
   owner allowlist is populated.
5. The Next.js application validates Supabase sessions server-side.
6. Personal tables and the private import bucket have owner-only RLS tests.

Backend schema and local import parsing may be developed before items 4–5.
Nothing that accepts an upload over the public internet may be deployed before
they are complete.

Raw exports contain personal holdings and purchase history. They remain outside
Git. Commit only small, synthetic or irreversibly redacted fixtures that retain
the source headers and parsing edge cases.

## Source responsibilities

BBR is authoritative for the current position held with BBR at the snapshot
time. CellarTracker is the lifetime record of purchases, movements, physical
stock and consumption, including wine outside BBR.

Overlapping source records are reconciled. They are not added together without
evidence and neither source silently overwrites the other.

`Parent ID` is the preferred BBR match to `products.parent_sku`. Missing or
invalid identifiers remain unmatched source rows. CellarTracker matching rules
must be designed from the real export and must retain the source wine name even
after a match is accepted.

## Import evidence model

### `cellar_imports`

One row per uploaded file:

- generated import ID;
- source type: `bbr_holdings` or `cellartracker_history`;
- SHA-256 content checksum;
- original filename, byte size and private Storage object path;
- uploader and upload time;
- parser/schema version;
- status: `uploaded`, `parsing`, `validated`, `accepted` or `failed`;
- source, parsed, matched, unmatched, warning and error row counts;
- acceptance user/time; and
- bounded failure summary.

`(source_type, content_checksum)` is unique. Uploading the same file again
returns the existing import rather than duplicating evidence.

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

Do not finalise the normalised BBR position and CellarTracker event columns
until representative exports have been inspected. The model must nevertheless
preserve these distinctions:

- source snapshot versus lifetime event;
- purchase, movement, current stock and consumption;
- remote, home and other locations;
- cases, loose bottles, case size and bottle volume;
- source quantity versus derived bottle-equivalent quantity;
- purchase price and currency where present;
- event/effective date versus import date; and
- matched, unmatched and manually resolved identity.

A current-holdings projection is derived from accepted evidence. It is not the
only copy of the source state.

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

- Freeze the BBR export contract from a representative file.
- Implement `Parent ID` and format matching.
- Add snapshot comparison and explicit acceptance.
- Build the current BBR-held projection.

### Slice 5D: CellarTracker history

- Freeze the CellarTracker export contract from a representative file.
- Import lifetime purchases, locations, stock and consumption.
- Retain unresolved source wine identities.
- Reconcile overlap with accepted BBR snapshots.

### Slice 5E: cellar views

- Add current holdings, drink-now evidence and concentration read models.
- Expose personal views only to the owner.
- Keep all public catalogue views free of personal columns and joins.

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
- Personal rows cannot appear through an anonymous catalogue view or RPC.

## Acceptance

Phase 5 is accepted when two representative exports can be uploaded twice
without duplication, their unmatched and conflicting rows are visible, an
accepted import produces the same current holdings on replay, and an anonymous
client cannot retrieve any file, staging row, holding or history event.
