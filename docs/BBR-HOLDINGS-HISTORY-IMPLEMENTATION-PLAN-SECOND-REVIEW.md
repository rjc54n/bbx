# BBR holdings history implementation plan: second review

**Status:** Release-gate review of revision 2, 5 September 2026. No implementation changes made.

**Reviewed document:** [BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN.md](BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN.md)

---

## Verdict

Revision 2 resolves most findings from the first review. It is not ready for full developer hand-off. Three implementation blockers and one product decision remain.

A developer may perform Slice 0, which inspects the recovered exports. Migration and application work should wait until the points below are incorporated into the plan and functional specification.

---

## Blocking findings

### P1. Acceptance resumes before unmatched evidence is preserved

Slice 5 restores current-snapshot acceptance. Slice 6 later changes staging so valid unmatched BBR rows enter ownership evidence.

During that window, a current snapshot containing unmatched rows can be accepted but omit those rows from `current_bbr_holdings`. A position can therefore be classified as former because catalogue coverage was incomplete, rather than because BBR omitted it.

Imports staged before Slice 6 also retain incomplete evidence. The migration deliberately does not reconstruct their unmatched rows, so accepting one later would reproduce the same problem.

Required change:

- move evidence coverage before acceptance is restored, or temporarily refuse acceptance when `unmatched_row_count > 0`;
- require any pre-Slice-6 validated import with unmatched rows to be restaged; and
- make acceptance verify that evidence accounts for every valid source row.

References: implementation plan Slices 5 and 6, lines 593-661.

### P1. Withdrawing the current nomination has no valid stored state

The model says a current declaration keeps `accepted_role = 'current'`. It ceases to be nominated when `superseded_at` is populated, but the constraints require `superseded_by` at the same time. A withdrawal has no replacement import to put in `superseded_by`.

Withdrawal also conflicts with the functional specification. That document says correction must prevent a missing current snapshot and that removing the nominated current snapshot without a safe replacement is blocked.

Required change: remove `withdraw_bbr_current_nomination` from the first version. Retain the unknown membership state for a database that has never nominated a current snapshot. Correct a bad current nomination by amending it or safely replacing it.

References: implementation plan D1, D5 and Slice 3; functional specification sections 4.6 and 11.

### P1. Position uniqueness is inferred from one modern export

The plan adds `UNIQUE (import_id, parent_sku, format_code)`. The current parser also rejects a second source row for the same Parent ID and format. Only one current export has been profiled, and it happens to contain one row per Parent ID.

Historical exports may contain separate rows for different purchases or product codes at different prices. Rejecting those rows would discard BBR evidence and weaken the intended purchase-price history.

Required change: extend Slice 0 to count repeated `(Parent ID, derived format)` combinations and compare their product codes, quantities and reported purchase prices. Do not add the unique constraint until this is known.

If repeated rows exist, preserve source evidence at source-row grain. Aggregate quantity and price range to `(Parent ID, format)` in the observation or consolidated projection.

References: implementation plan Slices 0 and 6; `bbrParser.ts`, lines 381-393; `IMPORT-SOURCE-PROFILES.md`, lines 10-32.

---

## Other plan changes required

### Legacy backfill

Slice 2 sets every existing accepted BBR import to unsuperseded `current`, then creates an index that permits only one. This works for the reported production state of one import and for an empty database, but fails for a valid legacy database containing several accepted imports.

Nominate the latest legacy accepted import and mark earlier declarations as superseded, or make the one-import requirement an explicit deployment precondition. The migration must not fail later at index creation without explaining the unsupported state.

### Function privileges

For every new database function, specify and test:

```sql
REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ... TO authenticated;
```

An owner check inside a `SECURITY DEFINER` function is required but does not replace removal of the default function privilege. Add `has_function_privilege` assertions following the existing BBR tests.

### Concurrency verification

The current pgTAP suite runs in one database session. It cannot by itself prove that two concurrent current acceptances cannot both win. Specify a two-session local or data-branch test harness. The partial unique index remains the final database backstop.

### Data-branch wording

The production-enable checklist requires a data branch, while an earlier section allows production equivalence work when no branch is available. Remove that ambiguity. Equivalence, timing, concurrency and realistic-volume tests do not run against production. If they require production-shaped data and no safe copy exists, that part of the release waits.

---

## Product decisions

### Amend duplicate-file behaviour

Amend functional specification section 4.5. A byte-identical export downloaded on a later date is a valid snapshot observation. Correctness should not depend on incidental market-price columns changing between downloads.

Keep checksum detection advisory. Opening the existing import remains the default action, but the owner can stage the same bytes as a separate snapshot with a different effective date. Effective-date uniqueness prevents two accepted observations for the same day.

### Close the remaining owner questions

- Keep one accepted snapshot per effective date unless Slice 0 finds genuine same-day exports.
- Accept the widened wine-record route because BBR is the ownership authority.
- Keep All owned as the default and show the effective date in the cellar heading.
- Keep audited effective-date amendment, without standalone current withdrawal.
- Use `bbr-v2` if the accepted header contract changes.
- Record whether the purchase-date field is populated, but do not add it to typed evidence in this version.

---

## Proportionate testing and production safety

The 27 and 28 August incidents established that production has no spare I/O or memory capacity for verification workloads. Concurrent verification runs, long catalogue-wide scans and retrying an ambiguous request contributed to API failure and prolonged database degradation. See [DEPLOYMENT-INCIDENT-2026-08-27.md](DEPLOYMENT-INCIDENT-2026-08-27.md) and [DEPLOYMENT-INCIDENT-2026-08-28.md](DEPLOYMENT-INCIDENT-2026-08-28.md).

Testing for this feature must follow these boundaries.

### Local database

Run the complete behavioural suite locally:

- clean migration replay;
- pgTAP constraints, permissions and derived-history cases;
- two-session concurrency checks;
- parser fixtures, including historical header variations and repeated positions;
- application unit tests and production build.

Synthetic fixtures should be small but cover every state transition. Repeating the same test at large volume adds little confidence for a personal dataset measured in hundreds or low thousands of rows.

### Data branch or other isolated copy

Use an isolated production-shaped database only for:

- migration rehearsal against representative data;
- before-and-after row equivalence;
- query-plan inspection;
- realistic-volume timing; and
- one synthetic historical acceptance followed by inspection of the derived views.

No production credential or endpoint should be used by these tests. Remove any temporary objects immediately after the check.

### Production

Production receives deployment smoke checks, not a test workload:

- confirm the migration ledger once after each pushed migration;
- run only a pre-written, finite set of small point or count queries;
- confirm the nominated current import ID and expected row count;
- perform one owner browser pass through the affected pages; and
- observe normal application health after deployment.

The following are prohibited on production:

- application or shell loops issuing database queries;
- repeated polling or benchmarking;
- catalogue-wide equivalence or timing scans;
- concurrency tests;
- synthetic bulk imports;
- temporary verification schemas or materialised views; and
- automatic retry after a timeout, empty response or other ambiguous failure.

Every production query must have a bounded target and a short statement timeout. If a query times out, latency rises materially, database I/O increases, or the response is ambiguous, stop. Inspect server-side state before considering any further request. Do not conduct deployment verification between 02:00 and 05:00 UTC.

The 300 ms read-model revisit threshold in D4 is an operational signal. It does not authorise repeated timing runs against production. Use normal request telemetry to identify a possible problem, then reproduce and measure it on an isolated copy.

---

## Hand-off gate

Developer work beyond Slice 0 starts only when:

- evidence coverage is moved before acceptance restoration;
- current withdrawal is removed or the product specification and state model are deliberately redesigned;
- recovered exports have been checked for repeated Parent ID and format rows;
- duplicate-file behaviour is amended and recorded;
- legacy backfill and function privileges are explicit; and
- the testing plan contains the production limits above.

After those changes, the plan is suitable for implementation in its proposed small migration slices.
