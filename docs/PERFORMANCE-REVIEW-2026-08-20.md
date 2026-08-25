# Response-time review, 20 August 2026

## Conclusion

The slow response is mainly database work, repeated authentication work and missing loading feedback. It is not explained by React rendering alone.

The analytics route is the slowest path. Its query runs through several layered views, sorts a broad result and asks PostgreSQL for an exact count. The catalogue has a different pattern: the first page of rows is reasonably quick, but the exact count and three facet aggregates add seconds. Protected navigation also checks the same owner relationship in the proxy, layout and page.

## Measured database time

These are read-only measurements against the live Supabase project on 20 August 2026. Timings are warm-cache server execution times. They exclude network travel, PostgREST serialisation, React Server Component work and browser rendering.

| Operation | Role | Time |
|---|---|---:|
| Scenario, representative filter, first 50 rows | `authenticated` owner | 1.36 s |
| Scenario, representative filter, first 50 rows | database administrator | 2.13 to 2.76 s |
| Scenario, no filters, first 50 rows | database administrator | 6.72 s |
| Scenario exact count | database administrator | 2.19 to 2.33 s |
| Catalogue first 25 rows | `authenticated` owner | 0.11 s |
| Catalogue exact count | `authenticated` owner | 1.74 s |
| Catalogue facet values | `authenticated` owner | 2.30 s |
| Catalogue first 25 rows | database administrator | 0.12 to 0.13 s |
| Release review first 100 rows | database administrator | 0.19 s |
| One wine-card identity row | database administrator | 0.24 ms |

`pg_stat_statements` supports the same diagnosis. Recorded catalogue API calls averaged about 1.68 seconds. Facet query families ranged from roughly 0.56 to 3.32 seconds on average. Those statistics are cumulative and include old and current view definitions, so they are directional rather than a clean benchmark.

## Why each route can feel slow

### Analytics scenarios

The request uses:

```text
wine_scenario_view
  -> wine_card_format_view
  -> resolved_release_anchor_view
  -> release_price_anchor_view
  -> release_offer_evidence_view
```

The live plan repeatedly evaluates release evidence while joining and sorting the full biddable format set. In the broad case, the plan read about 648,000 shared buffer blocks before returning 50 rows. The UI permits a scenario with no filters and describes it as matching every biddable format. That is the measured 6.72-second case.

The same request also asks for `count: "exact"`. PostgreSQL must calculate the complete filtered population even though the UI displays one page. The count alone took more than two seconds.

### Catalogue

The browser starts two independent groups of work:

- a catalogue `select("*", { count: "exact" })`, followed by a release-anchor enrichment query;
- `facet_values_view`, `facet_ranges_view` and `format_options_view` in parallel.

The row page itself took about 0.11 seconds under the owner role. The exact count took 1.74 seconds and the facet values took 2.30 seconds. Parallel execution reduces elapsed time, but it also puts several aggregate scans on the database at once. Filter controls remain incomplete until the slowest facet request finishes.

The catalogue is fetched by the client after the server has already rendered the authenticated page shell. That adds another browser-to-Supabase round trip before useful rows appear.

### Protected navigation

Most protected navigation can perform three owner checks:

1. `proxy.ts` validates claims and queries `app_owners`.
2. The protected layout calls `requireOwner()`.
3. The page calls `requireOwner()` again to obtain its client.

`getOwnerContext()` is not wrapped in React `cache`, so the layout and page do not share the result. The proxy runs in a separate request phase and cannot share the layout cache. Supabase Auth guidance for Next.js requires server-side token validation, but the database allowlist lookup does not need to run three times. Next.js recommends a cached data-access layer for secure authorisation and a lighter optimistic check in the proxy. See the [Next.js authentication guide](https://nextjs.org/docs/app/guides/authentication).

### No navigation feedback

There is no protected `loading.tsx`. Every protected route is forced dynamic. A click can leave the old page unchanged while the server waits for authentication and data. The user reads that absence of feedback as a missed click or frozen app.

Next.js can stream a loading boundary while dynamic content resolves. This does not reduce the database time, but it makes the state visible and permits route sections to arrive separately. See the [Next.js production checklist](https://nextjs.org/docs/app/guides/production-checklist).

### Wine page and CellarTracker totals

The wine page performs seven reads in parallel. Most are selective by Parent ID and should remain cheap, but completion waits for the slowest read. Identity precedence is then resolved in TypeScript. One consolidated, indexed read model would reduce request overhead after the rules settle.

The CellarTracker page reads all 604 current rows to sum two quantity columns. This is small today. It grows linearly and should become a database aggregate before larger imports arrive.

## Proposed fixes

### 1. Build a lean analytics read path

Do this before UI micro-optimisation.

- Stop querying the general-purpose stack for each scenario page.
- Pre-resolve the current release anchor once per wine and format. A materialised read model refreshed after imports and owner edits is a reasonable option.
- Select only columns used by the result table, not `*`.
- Add indexes that match the supported filters and sort fields after checking real plans with [`index_advisor`](https://supabase.com/docs/guides/database/extensions/index_advisor).
- Remove exact counts from interactive requests. Use an estimate, `has_more`, or a maintained summary.
- Give a new scenario a selective default. Do not let an accidental empty filter trigger the costliest query without warning.

Target a warm database p95 below 500 ms for the first scenario page. Treat any plan above one second as a failed performance test.

### 2. Make catalogue metadata cheap

- Cache facet values, ranges and format options. They change at scan cadence, not at navigation cadence.
- Refresh cached metadata after the daily sweep or a successful catalogue import.
- Replace the exact catalogue count with an estimate or maintained counter.
- Consider loading the initial rows and metadata on the server, then stream the table and filters. This removes the post-render client round trip.
- Keep page reads and facets separate so a slow facet does not block rows.

The recent migration from aggregate-over-`catalogue_view` to base tables was a good optimisation. The live timings show that the remaining aggregates are still too expensive for every visit.

### 3. Perform one secure owner lookup per render

- Wrap the server data-access check in React `cache` so the layout and page share one result.
- Keep the proxy for session routing and token refresh. Avoid its database owner lookup if the cached data-access layer remains the authoritative check.
- Keep row-level security as the database backstop.
- Measure auth and owner-check time separately in server timing logs.

This follows the split in the [Next.js authentication guide](https://nextjs.org/docs/app/guides/authentication) and keeps the security decision on the server.

### 4. Add visible, streamed loading states

- Add a protected-area `loading.tsx` for immediate navigation feedback.
- Add route-specific skeletons for scenarios, wine and release prices.
- Put slow, independent sections behind `Suspense` so the page shell and identity can appear before evidence tables.
- Preserve the old table while client-side catalogue filters load, but add an explicit busy state and prevent stale totals from looking current.

Aim to show feedback within 200 ms, even when the data takes longer.

### 5. Add timing evidence to normal operation

- Enable and review Supabase Query Performance reports and `pg_stat_statements` regularly. The [Supabase performance debugging guide](https://supabase.com/docs/guides/database/debugging-performance) describes the supported tools.
- Record Server-Timing values for auth, owner lookup and each route query group.
- Add a small set of live read-only performance tests for catalogue, scenario and wine pages.
- Alert on query regressions rather than relying on user reports.

## Acceptance checks

After the changes, verify with the signed-in deployed app:

- first visible feedback appears within 200 ms on protected navigation;
- catalogue rows appear before facet metadata;
- catalogue page and facet database work complete below 1 second at p95;
- a representative scenario page completes below 500 ms at the database;
- an empty-filter scenario is blocked, warned or served from a precomputed read model;
- one navigation performs no more than one database owner lookup after the proxy phase;
- query plans remain within budget after a production-sized import.

These targets should be measured in the deployment region. Local build time and unit-test speed do not predict signed-in page latency.

