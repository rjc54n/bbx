# BBR holdings history implementation plan review

**Status:** External implementation-plan review, 3 September 2026. No implementation changes made.

**Reviewed document:** [BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN.md](BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN.md)

---

## Verdict

The architecture direction is sound, but the plan is not ready for implementation. Four issues could prevent deployment or produce incorrect history: clean migration replay, repeated identical snapshots, episode reconstruction, and the no-current state.

---

## Findings

### P1. Slice 1 cannot run against a clean database

Slice 1 requires exactly one accepted BBR import and raises otherwise. A clean local or CI migration replay has zero imports, so the migration would fail. The existing production import also has null chronology fields. Validating the new constraints before backfilling that row would fail.

Change Slice 1 to:

- permit zero accepted BBR imports;
- backfill before validating the constraints, or add the constraints as `NOT VALID` and validate them afterwards; and
- treat the production one-row assumption as a deployment preflight, not migration logic.

References: implementation plan lines 367-382.

### P1. File deduplication prevents valid repeated observations

Two exports can contain identical holdings but have different effective dates. The current uniqueness constraint and upload check collapse them into one import. The functional specification then says the second file creates no observation date.

This loses valid evidence that a position was still held at the later date. It can also prevent an unchanged export from becoming the new current snapshot.

The design should separate:

- file content identity, which may remain deduplicated; and
- snapshot occurrence, with its own effective date, role and provenance.

References: functional specification section 4.5; migration `20260725120000_bbr_cellar_import.sql`, line 72; current BBR upload action, lines 110-124.

### P1. Episodes cannot be derived from position observations alone

The proposed position-history page fetches only snapshots in which the position appears. That sequence cannot reveal an intervening complete snapshot where the position was absent.

For example, observations in 2021 and 2024 do not show whether ownership was continuous or followed a `present -> absent -> present` pattern.

Episode derivation needs both:

- the complete ordered snapshot calendar; and
- the position's observations within that calendar.

The alternative is a database projection that emits presence and absence transitions. TypeScript remains a reasonable presentation layer once it receives enough evidence.

References: implementation plan D4 and Slice 8, lines 210-238 and 564-577.

### P1. The no-current state cannot classify positions as former

The plan permits withdrawal of the current nomination, but `bbr_positions_view` describes non-current positions as former with a current quantity of zero. With no nominated current snapshot, current membership is unknown. Absence has not been established.

Either remove the withdrawal operation because there is no current user story for it, or use explicit states such as:

- `current`;
- `former`; and
- `current_status_unknown`.

Current quantity should be null in the unknown state, not zero.

References: implementation plan D4 and D5, lines 215-227 and 275-278; functional specification section 7.4.

### P2. The deployment sequence deliberately breaks acceptance

Slices 1 to 5 leave the existing Accept control visible while the database function refuses every acceptance. The plan calls the slices independently deployable, but the feature is broken during that period.

Use an additive sequence:

1. Add the new function and schema while retaining the existing path.
2. Deploy the new application flow.
3. Remove or restrict the legacy function.

If freezing acceptance remains the chosen trade-off, the UI must disable it with an explanatory message in the same release.

References: implementation plan D6 and deployment table, lines 280-304 and 614-633.

### P2. Slice 2 has a destructive rollback

Restoring the catalogue foreign key requires deleting unmatched ownership evidence created after deployment. That conflicts with the requirement to preserve valid BBR evidence.

The activation point should mark this as forward-fix-only, or the design should retain unmatched rows in a compatible evidence structure during rollback.

References: implementation plan Slice 2 rollback and cross-cutting rollback posture, lines 424-428 and 659-663.

### P2. Acceptance idempotency is too permissive

An already accepted import should be idempotent only when the supplied effective date and role match the stored declaration. A retry with different values should return a conflict rather than silently succeeding.

References: implementation plan Slice 5, lines 488-501.

### P2. The current-cellar heading would display the wrong date

The plan keeps `confirmed_at` as the acceptance timestamp. The existing UI presents that value as `Holdings confirmed`. The main cellar view should instead present the effective date as `Holdings as at`. Upload and acceptance timestamps belong in provenance and import history.

References: implementation plan Slice 3, lines 436-443; `BbrCellarBrowser.tsx`, lines 153-156.

### P3. The wine-page impact statement is incorrect

The plan says an unmatched Parent ID cannot match a wine page. The current wine route treats BBR holdings themselves as sufficient evidence to render a page and uses their description as fallback identity.

This may be desirable, but it needs to be documented and tested as an expanded route contract.

References: implementation plan lines 190-196; wine parent page, lines 169-182.

---

## Decisions to retain

- Immutable BBR evidence and explicit current nomination.
- Historical imports never changing current membership.
- Preservation of unmatched BBR rows.
- Nominal in-bond GBP price observations with min/max ranges.
- Query-time views at the expected data volume.
- Audited date amendment instead of deletion and resubmission.
- Date-only ordering and one accepted snapshot per date for the first version.
- All owned as the default, with a current-only checkbox.

The required changes are concentrated in snapshot identity, migration replay, episode inputs and no-current semantics. The remaining plan can proceed largely as structured once those points are resolved.
