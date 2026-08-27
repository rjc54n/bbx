# Performance validation on a Supabase data branch

This is the only approved place for row-equivalence or timing checks that need
production-like data. Do not point these checks at production.

## Owner setup

1. Enable Supabase Branching as project Owner or Administrator. Before each
   performance change, create a fresh branch called
   `perf-validation-<short-sha>` with production-like data. Branches have
   separate credentials and copied cellar data needs the same restricted access
   as production.
2. Create the GitHub environment `supabase-perf-validation`. Restrict it to
   reviewed performance branches, require owner approval for every run and
   block administrator bypass when the GitHub plan permits it.
3. Store only these branch-specific secrets in that environment:
   `PERFCHECK_DATABASE_URL`, `PERFCHECK_SUPABASE_URL` and
   `PERFCHECK_PUBLISHABLE_KEY`. Set `PERFCHECK_PROJECT_REF` and
   `PERFCHECK_BRANCH_NAME` as environment variables. Never put production
   database URLs, service-role keys or Supabase access tokens there.
4. If the repository plan cannot enforce environment approval, run the same
   checks manually from the owner machine against the data branch. Do not use
   production as a substitute.

GitHub Actions has no `environment.deployment: false` property. The workflow
uses the protected environment directly, which creates the approval-gated
deployment record required for its secrets to be released.

## Per-change procedure

1. Create the data branch and, if browser smoke checks are needed, a dedicated
   owner test identity on that branch. Update the two application credentials
   and database URL in the protected environment.
2. Add reviewed validation SQL to the performance change. It must use only the
   `perf_validation` schema for temporary objects, compare candidate and
   current result sets both ways, time selective queries, and end without a
   `DROP SCHEMA`. The workflow removes that schema in its `always()` cleanup.
3. Dispatch `Performance validation on Supabase data branch`, entering the
   reviewed commit SHA and the SQL file path. It checks out that exact commit,
   applies pending migrations to the branch only, then runs the supplied SQL.
   It never runs on a pull request.
4. Review row equivalence and selective latency before merging. Then delete the
   Supabase branch and remove the branch credentials from the environment.

The workflow does not contain a reusable production-targeted SQL script. The
equivalence query must be reviewed with the migration it validates, because it
has to represent that migration's old and candidate read models accurately.

## Release gate

Before merging database-dependent application code, validate the data branch.
After applying the migration to production, confirm the ledger with
`supabase migration list --linked`, then perform signed-in smoke checks for the
catalogue, scenarios, wine, favourites and CellarTracker. A merge deploys the
web app, not the database migration.
