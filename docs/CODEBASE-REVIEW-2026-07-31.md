# Codebase review: 31 July 2026

**Status:** findings documented; no implementation changes made

## Scope

This review covered the Python scanners, Next.js application, Supabase
migrations and tests, GitHub Actions workflows, repository documentation and
the current `codex/cellartracker-dataset` branch.

The review looked for user-visible defects, private-data handling failures,
missing regression checks, duplicated implementation and documentation that no
longer describes the code.

## Recommended order

### Fix before extending the affected features

1. Treat CellarTracker drinking-window value `9999` as unknown. The current
   parser stores it as a year and the favourite wine card can display
   `drink 9999-9999`. Prefer a display guard first. Change import semantics only
   with a parser-version decision and a plan for existing snapshots.
2. Remove private CellarTracker source objects after validation, decoding,
   parsing or staging fails. The BBR and release-offer importers already use
   this cleanup pattern. Return a separate message for an empty file.
3. Put target creation and processing in the shared upload form's exception
   handling. Always stop the polling interval and leave the form in a usable
   error state.
4. Recreate `favourite_wine_view` so its release-offer count excludes records
   in `release_offer_record_exclusions`. Add a pgTAP case in which the excluded
   offer is the only release source for a favourite.

### Address with focused regression tests

5. Add PostgreSQL `INT` and JavaScript safe-integer bounds to CellarTracker
   quantities, years and penny values. Invalid source values should mark one
   staging row invalid rather than abort the complete import RPC.
6. Decide what `source_row_number` means before changing it. CellarTracker uses
   the first data row as row 1, while the BBR and release-offer parsers use CSV
   line 2. These numbers are persistent record identifiers, so this is not a
   cosmetic correction.
7. Add tests for `parseCellarTrackerCsv`, the CellarTracker upload action and
   failure cleanup in the shared upload form.
8. Extend the general read-layer security test to discover or enumerate every
   exposed public view, including the CellarTracker, release-offer and
   favourites views. The current assertion covers only the original nine
   scanner views.

### Repository maintenance

9. Add pull-request checks for Python tests and the web lint, test and build
   commands. The scheduled scanner jobs currently run the Python unit suite 17
   times per day, but the repository workflows do not run it when application
   code changes are proposed.
10. Extract the shared release-offer and CellarTracker matching orchestration.
    The two flows repeat the same progress control, candidate search, batching
    and action structure. Keep source-specific matching rules behind explicit
    adapters rather than merging their identity rules.
11. Use one browser Supabase client factory. The current eager and lazy
    singletons create the same client but fail differently when configuration
    is missing.
12. Reformat compressed action and page files when they next change. Avoid a
    standalone formatting sweep because it would hide later behavioural diffs
    in blame history.
13. Pin the remaining Python dependency versions or add a lock mechanism.
    `psycopg2-binary`, `boto3` and `pytest` currently resolve across broad
    version ranges.
14. Decide whether builds must work without access to Google Fonts. The current
    `next/font` configuration makes a clean production build depend on that
    external download.

## Confirmed inconsistencies

### CellarTracker import and display

- The representative source has `BeginConsume = 9999` on 584 of 605 rows and
  `EndConsume = 9999` on 567 rows. The parser accepts both as ordinary years.
- Failed CellarTracker uploads can leave an object in the private
  `cellar-imports` bucket without a corresponding import record.
- A rejected promise from upload-target creation or import processing can
  leave the shared form busy and its polling interval active.
- The database enforces a 10,000-row batch limit, but the parser and server
  action do not report that limit directly when it is exceeded.
- CellarTracker source row numbering differs from the other CSV importers.

### Favourites

- `release_offer_evidence_view` filters excluded offers.
- `favourite_wine_view` counts linked release-offer resolutions directly and
  does not apply the same exclusion.
- A favourite can therefore show a `Release` provenance chip while its detail
  page has no visible release evidence.

### Validation and automation

- No repository workflow runs the web checks on a pull request or push.
- Python tests run inside both scheduled production workflows, rather than in
  a change-validation workflow.
- The general public-view security test does not cover the newer private-data
  views.
- The production web build fetches Google Fonts. It failed in a restricted
  network and passed when the network was available.

### Duplication and readability

- Release-offer and CellarTracker match action files contain 470 lines between
  them, plus nearly identical progress controls and candidate-search controls.
- `apps/web/src/lib/supabase.ts` and
  `apps/web/src/lib/supabase/client.ts` provide competing browser client
  singletons.
- Some server actions and import pages contain complete workflows on one line.
  The longest observed CellarTracker lines were 1,765 and 1,806 characters.

## Documentation corrections made with this review

- Removed the roadmap link to the absent `docs/EVIDENCE-2026-07.md` and pointed
  the implementation evidence to the documents that are present.
- Marked favourites as implemented without notes or preferred-format data.
- Marked the release-price connector as implemented rather than in progress.
- Corrected the CellarTracker market comparison to describe normalisation by
  case size and bottle volume across all available formats.
- Marked the pre-build sections of the favourites specification as historical
  and replaced its placeholder migration and test locations.
- Expanded the repository map and documented which checks are automated.

## Verification boundary

The review ran on 31 July 2026:

- 267 Python tests passed;
- 229 web tests in 22 files passed;
- web lint passed;
- the production web build passed once Google Fonts were reachable; and
- the working tree was clean before documentation work began.

The local Supabase replay, schema lint and pgTAP suite did not run because the
Docker daemon was unavailable. Database findings in this document come from
static migration and test inspection. Apply any SQL correction through a new
migration, then require clean replay, lint and pgTAP before deployment.
