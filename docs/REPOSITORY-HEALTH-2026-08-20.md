# Repository health review, 20 August 2026

## Current state

The repository is in workable condition. The review started from a clean `main` at `eb6f34e`, matching `origin/main`. Python tests, web tests, lint and the production build passed. The live Supabase migration ledger matches the local migrations.

The main weakness is change validation. Database migrations have a pull-request workflow, but application code does not. Recent successful GitHub Actions runs are scheduled production jobs, not checks on the changes being merged. Current dependency advisories also need attention.

## Health summary

| Area | State | Evidence and action |
|---|---|---|
| Python tests | Good | 280 tests passed |
| Web tests | Good | 253 tests passed across 27 files |
| Lint | Good | ESLint passed |
| Production build | Pass with a reproducibility issue | Build passed with network access; it failed without access while downloading Google Geist fonts |
| Database migrations | Good | Live and local ledgers match through the latest migration |
| Database migration CI | Good but narrow | Clean replay, schema lint and pgTAP run for `supabase/**` changes |
| Web and Python CI | Missing | No pull-request workflow runs lint, tests or build for application changes |
| Dependency audit | Needs action | `npm audit --omit=dev` reports four high-severity advisories |
| Documentation | Stale in several places | Wine-record status and web routes do not match the implementation |
| Security advisers | Needs triage | One mutable function search path, public `pg_trgm`, 46 callable definer functions and leaked-password protection disabled |
| Performance advisers | Needs triage | 23 unindexed foreign keys and five unused indexes |
| Formatting | Minor fault | One trailing-whitespace error in the reviewed range |

## Documentation drift

### Canonical wine record

[`WINE-RECORD-SPEC.md`](WINE-RECORD-SPEC.md) says `Status: draft for review. No code yet.` Steps for wine-card views, owner release anchors and saved scenarios have been implemented. The file now mixes architecture, future plans and historical implementation notes.

Replace the opening status with a short table:

| Step | State | Migration or route |
|---|---|---|
| Canonical BBR wine reference | Implemented | `wine_card_view` |
| Per-format card metrics | Implemented | `wine_card_format_view` |
| Owner release anchor | Implemented with defects noted in the independent review | `owner_release_anchors` and `resolved_release_anchor_view` |
| Source-neutral local wine identity | Planned | No table or resolver yet |
| Saved filter scenarios | Prototype | `/scenarios` and `wine_scenario_view` |
| Agent consumption and versioned strategies | Planned | No stable interface yet |

Move settled choices into an architecture decision record. Keep future work in a smaller implementation plan. This will stop the specification growing with commit-by-commit notes.

### Web README

[`apps/web/README.md`](../apps/web/README.md) calls the root catalogue public, but `/` is inside the protected route group and the proxy requires an owner. It omits `/wine/parent/[parentSku]` and `/scenarios`. It also does not describe owner release anchors or their current limitation.

Update the route table and state the access boundary once. Avoid calling any route public unless an anonymous request has been tested against the deployed app.

### Root README and roadmap

The root README accurately says that web and Python pull-request checks are absent. Its repository structure and roadmap list do not mention the wine-record specification or the scenario prototype.

The July roadmap describes named, versioned strategies. The August implementation stores unversioned filter definitions. Call these saved queries until versioning, output contracts and agent use exist. This distinction will prevent the prototype becoming an accidental permanent API.

## CI and release practice

The database workflow is sensible. It replays migrations on a clean database, lints the public schema and runs pgTAP. Its path filter means it does not validate TypeScript changes that depend on a new or changed view unless the same pull request also touches `supabase/**`.

Add two required pull-request jobs:

1. Web: `npm ci`, `npm run lint`, `npm test`, `npm run build`.
2. Python: install `requirements-dev.txt`, then run `python -m pytest tests/ -q`.

Keep database validation separate because it needs Docker and has a different failure mode. Add path filters only after confirming that shared files cannot bypass the relevant job.

The production build imports Geist through `next/font/google`. A sandboxed build failed because it could not reach Google; the same build passed with network access. For reproducible releases, self-host the font with `next/font/local` or make the build environment's network dependency explicit.

The workflow actions use version tags such as `actions/checkout@v4` and `supabase/setup-cli@v2`. Pin actions to reviewed commit SHAs if supply-chain policy requires repeatable workflow code.

## Dependency state

`npm audit --omit=dev` reported four high-severity advisories on 20 August:

- `nanoid` 3.3.16;
- PostCSS through Tailwind and Next.js;
- `sharp` 0.34.5 through Next.js;
- the Next.js dependency range because it carries affected PostCSS and Sharp versions.

Run an update in a separate branch, inspect the lockfile and repeat lint, tests, build and a signed-in smoke test. Do not apply `npm audit fix` without reviewing the Next.js change it selects.

`npm ls --depth=0` also reports several extraneous WASM support packages. A clean `npm ci` in CI will show whether these are only local installation residue. If they reappear after a clean install, find the package-manager cause before committing lockfile churn.

The Python runtime pins three direct packages but leaves `psycopg2-binary`, `boto3` and the test runner on broad ranges. Add a lock or constraints file for deployed and CI environments. Keep the human-edited requirements file if it remains useful, but test the resolved set that production uses.

## Database and security practice

Positive points:

- the live migration ledger matches source control;
- new public views use invoker security;
- owner facts use row-level security and an owner-only policy;
- new owner write functions set an empty search path and check `private.is_app_owner()`;
- the web app uses a publishable or anonymous Supabase token, not a service-role token;
- migrations and access rules have pgTAP coverage.

The [Supabase database advisers](https://supabase.com/docs/guides/database/database-advisors) currently report 49 security warnings. The 46 callable `SECURITY DEFINER` functions are not automatically faults. They are a review list. Each should have a fixed search path, schema-qualified objects, a direct owner check where needed, constrained inputs and the narrowest grants.

One warning is directly actionable: `public.search_producers` has a mutable search path. Add an explicit empty search path and schema-qualify its references. The `pg_trgm` extension is installed in `public`; move it to an extension schema if the migration and dependent objects can be changed safely. Enable leaked-password protection in Supabase Auth.

The performance adviser reports 23 unindexed foreign keys. Do not add all 23 indexes mechanically. Check delete and update paths, table size and real plans. The new `owner_release_anchors.decided_by` reference is currently tiny, but should be included in that review. Remove an unused index only after checking scheduled jobs and less frequent management queries.

Supabase's [row-level security guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) supports the current database backstop. The application owner check improves routing and error messages; it does not replace row-level security.

## Test coverage gaps

The general view-security test lists nine original public views explicitly. New views have individual tests, but the general test does not discover every exposed view. A new public view can therefore omit invoker security without failing the general safety check.

Change the test to compare all application-owned public views against an explicit exception list. This provides one safety net as the read layer grows.

Add regression tests for:

- owner anchor precedence across catalogue, favourites, wine card and scenarios;
- non-in-bond tax-basis suppression;
- out-of-range pagination with an empty successful response;
- scenario query time and plan shape on representative data;
- approximate count wording;
- one owner lookup per server render.

## Maintenance order

1. Fix the two release-price correctness faults.
2. Update production dependencies and verify the lockfile.
3. Add required web and Python pull-request checks.
4. Fix the mutable function search path and enable leaked-password protection.
5. Update the wine-record and route documentation.
6. Generalise the public-view security test.
7. Triage foreign-key indexes and unused indexes from measured workloads.

## Review boundary

This review verified source, local checks and live database metadata. It did not edit the database, deploy the app or test the signed-in production UI. A passing local build and a matching migration ledger should not be described as deployment verification.

