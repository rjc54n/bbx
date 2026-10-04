# Priority work plan

Status: proposed 3 October 2026. Three sequential tranches based on the [project and database review](PROJECT-AND-DATABASE-REVIEW-2026-10-03.md). Planning only; no implementation or deployment authorised by this document. The review's production measurements are dated observations, not newly verified state.

## Delivery decision

Use **GPT-6 Astra with `xhigh` reasoning**, in **one new session per tranche**, opened sequentially. Keep this session as the review and decision record. Do not delegate implementation across parallel agents: these changes share sweep state, database objects and one constrained production instance.

Astra is available in this app and is OpenAI's most capable model for demanding reasoning and coding. Choosing `xhigh` is my judgement for work spanning Python, SQL, publication semantics and deployment safety, not a measured BBX model comparison. [Official model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra).

Each new session reads `AGENTS.md`, this plan, the review and the previous tranche's handover. It rechecks the working tree and deployed migrations. Its handover records commits, migrations actually applied, tests, observed production results and unresolved decisions. One session owns production changes at a time. New sessions have not been opened.

---

## Tranche 1: make overnight refresh reliable and diagnosable

Outcome: each due sweep publishes current data or reports an actionable failure; recovery does not unnecessarily repeat successful work. Covers R1-R4 and R11.

- Capture one normal post-fix sweep baseline: actual changed rows, stage durations, publication coverage, WAL/temporary I/O deltas and instance health through the backup window. Use job output and existing run records. Preserve the statistics-reset workaround while saving a compact summary first.
- Separate source commit, cache publication and terminal outcome on the existing run record. Treat empty caches and failed timestamp/facet publication as failures. Distinguish useful partial discovery from publication failure in the cadence guard.
- Provide an operator publication-only recovery command. Resume at a known failed stage only while the source generation is unchanged; retain the ban on retrying ambiguous production failures without state inspection.
- Batch 30-day event retention with row/time budgets and backlog reporting. Correct rotation for alternate-day and missed runs while preserving listed-wine checks and the existing freshness policy.

Before building the status UI, confirm the proposed behaviour: show latest successful publication and any later failed attempt; alert when publication age exceeds 60 hours. These are product choices requiring owner agreement under `AGENTS.md`.

Exit gate: focused PostgreSQL/Python tests cover skipped runs, partial discovery, failed cache/timestamp/facet stages, empty caches, retention backlog and rotation. One normal scheduled sweep publishes all required stages and remains healthy after the backup window. A green window-check job does not qualify. Keep observing five real sweeps for sustained recovery; local preparation for tranche 2 can proceed meanwhile.

## Tranche 2: reduce query I/O and remove confirmed waste

Outcome: cheaper reads with the same wine results and working owner enrichment. Covers R5, R6, R9 and R12.

- Rewrite latest-price-change selection to select narrow event rows before joining catalogue details. Preserve latest-event ties, filters and ordering. Drop the exact total count (owner decision below).
- Replace exact counts on the catalogue with page-plus-one pagination, as scenarios already use (owner decision below). Then measure the default sort on its own and add a compact sort index only if the measured read benefit justifies its storage and refresh cost. Abort obsolete browser requests and suppress their enrichment work.
- Remove only the confirmed duplicate `idx_release_offer_match_suggestions_group_rank`, preserving the unique constraint. Its reviewed allocation was about 0.90 MB.
- Distinguish failed enrichment from absent owner evidence. Confirm the proposed concise retry message before building it.

**Owner decision, 4 October 2026:** precise record counts are not needed for any list query. The catalogue and price-change readers may drop exact totals (`count: 'exact'`) and use page-plus-one pagination: fetch one row beyond the page to decide whether a next page exists. Confirm the replacement display before building: next/previous controls only, or with an approximate total such as the planner estimate labelled as approximate. Ordering and page boundaries stay deterministic. Other exact counts are on small owner tables (import summaries, CellarTracker records) and cost little; leave them. The `/matches` list also counts `wine_match_review_view` exactly; drop that count too only if the re-measurement shows it is expensive.

Exit gate: bidirectional result comparisons and PostgreSQL plans on a data branch or restricted local extract; lower temporary I/O for price changes; no exact count queries on the catalogue or price-change paths; recorded index costs; unchanged ordering, null handling and page boundaries. Complete migration replay, relevant tests and an authenticated browser check. Confirm deployed readers through normal use without production load tests.

## Tranche 3: reduce sustained cache and storage cost where justified

Outcome: bounded growth and sufficient refresh headroom. Conditional scope covering R7, R8, R10 and residual bloat.

- Use the five-sweep evidence to select the largest remaining cost. Compare grouped offer aggregation with the current catalogue calculation. Evaluate whether the scenario cache can be narrowed or removed without restoring slow scenario reads. Ship only a demonstrated improvement, one database slice at a time.
- Agree representative-format semantics before fixing summary ties. Remove or deprecate misleading cached freshness fields without reintroducing timestamp churn.
- Establish matching-history retention only after tracing references to current suggestions and owner decisions. Preserve original evidence and accepted records; honour the existing legacy-cleanup gate.
- Consider physical reclamation only if residual allocation still threatens headroom. Require a tested restore, measured spare disk and a maintenance plan for one relation. No routine `VACUUM FULL`.

Exit gate: unchanged pricing and owner-reference results; measured reduction in refresh cost or storage; no read regression. Proposed operating margins are below 400 MB normally, with action before 450 MB, plus separately verified peak disk/WAL headroom. If tranches 1-2 already achieve sustained stability, close this tranche with measurements and defer invasive work.

---

## Controls and scope

Keep the Free plan, full biddable universe, two-day overnight cadence and 30-day event history. Test SQL equivalence and timing off production. Deploy and smoke-test each migration independently; merging app code does not deploy SQL. No diagnostic or maintenance work during 02:00-05:00 UTC. Prove restoration of affected data before destructive cleanup, including owner records and Storage files where relevant.

Defer general refactoring, blanket index removal, extension moves, new infrastructure and a full cache redesign. Confirm architecture, UX and default-behaviour choices before implementation as required by `AGENTS.md`. Each tranche ends with a deployment/evidence checkpoint before the next changes production.
