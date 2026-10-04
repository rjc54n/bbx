# Owner-data backup and restore test

Status: completed locally on 4 October 2026. The production database and Storage bucket were read only. The two throwaway local databases were deleted after verification. The backup files are outside Git.

The backup is in `/Users/richardcarvell/BBX-backups/2026-10-04T1630Z/`. The directory and its contents are restricted to the local user. `public-schema.sql` (320,599 bytes) contains the `public` schema definitions; `public-data.sql` (22,005,991 bytes) contains its table data. `storage/cellar-imports/` contains all 14 private bucket objects (17,279,790 bytes). `sha256sums.txt` records hashes for those 16 files. The directory also holds the Storage listing, size metadata and table-count comparison inputs. No dump, object or manifest is in the repository.

This covers the owner tables in `public`, including cellar imports, BBR and CellarTracker evidence, release offers, matches, favourites, reference-price decisions and saved scenarios. It excludes the `private` schema, Auth users and configuration, and Storage bucket configuration and metadata. The `private` schema was backed up on 1 October and its current scan data can be rebuilt from BBX. Downloaded Storage files were checked but not uploaded to a test bucket. A full application recovery would also need the excluded Auth and Storage configuration.

---

## Read-only production checks

The dump and checks ran after 16:20 UTC, outside the 02:00-05:00 UTC risk window. The 3 October sweep had finished at 23:07 UTC. GitHub showed no running `daily_sweep.yml` job; `pg_stat_activity` found zero other active queries. Supabase reported `ACTIVE_HEALTHY`. A trivial `SELECT now()` succeeded after a separate CLI temporary-role connection failed before its SQL ran. Recent checkpoint logs showed write/sync times of 0.107/0.002 seconds at 16:25 UTC and 0.208/0.002 seconds at 16:20 UTC. These checks supported a bounded read-only dump; they do not prove sustained capacity or independently verify the dashboard disk-I/O metric.

The schema and data were dumped separately with the Supabase CLI. `--data-only --use-copy` reported a circular foreign-key constraint on `cellar_imports`, so the local data restore used a single transaction with triggers disabled in that local session. No production setting changed.

## Restore result

The saved `public` definitions cannot be replayed into a completely empty PostgreSQL database because public views refer to `private.skus` and other Supabase objects. The successful throwaway test first loaded a schema-only copy of the locally migration-built Supabase database, cleared only its `public` schema, recreated its `pg_trgm` dependency, then replayed the saved production `public-schema.sql` and `public-data.sql`. Both saved files loaded without error.

All 28 public table counts matched production, 42,780 rows in each database:

| Table | Rows | Table | Rows |
|---|---:|---|---:|
| `app_owners` | 1 | `bbr_holding_evidence` | 910 |
| `bbx_fee_schedule` | 1 | `cellar_import_rows` | 1,557 |
| `cellar_imports` | 9 | `cellartracker_evidence` | 604 |
| `cellartracker_match_run_groups` | 1,788 | `cellartracker_match_runs` | 5 |
| `cellartracker_match_suggestions` | 2,025 | `cellartracker_product_resolutions` | 294 |
| `cellartracker_record_decisions` | 295 | `cellartracker_resolution_events` | 299 |
| `owner_release_anchors` | 4 | `pending_favourites` | 0 |
| `reference_price_decisions` | 5 | `release_offer_imports` | 2 |
| `release_offer_match_run_groups` | 10,822 | `release_offer_match_runs` | 6 |
| `release_offer_match_suggestions` | 7,755 | `release_offer_prices` | 5,765 |
| `release_offer_product_resolutions` | 2,086 | `release_offer_record_exclusions` | 17 |
| `release_offer_resolution_events` | 1,819 | `release_offer_source_rows` | 3,606 |
| `release_price_anchor_overrides` | 0 | `saved_scenarios` | 3 |
| `wine_favourites` | 23 | `wine_match_group_evidence` | 3,079 |

The live `cellar-imports` listing returned 14 paths. The local download had the same 14 paths and each byte size matched `storage.objects`; both totals were 17,279,790 bytes. All 16 checksum entries passed `shasum -a 256 -c sha256sums.txt`. The restore checks establish that these bytes can be read and the public table data can be loaded with its saved definitions and local dependencies. They do not test Auth sign-in or a Storage upload.

---

## Restore commands

Run against a local Supabase stack built from this repository's migrations. The local database container below is named `supabase_db_bbx`; change the name and throwaway database name for another local setup. Use the backup path above as `BACKUP`. These commands operate only on local databases. Do not point them at a linked project.

```bash
BACKUP=/Users/richardcarvell/BBX-backups/2026-10-04T1630Z
docker exec supabase_db_bbx pg_dump -U postgres -d postgres --schema-only --no-owner --no-acl > /tmp/bbx-local-schema.sql
docker exec supabase_db_bbx createdb -U supabase_admin bbx_public_restore
docker exec -i supabase_db_bbx psql -U supabase_admin -d bbx_public_restore -X -q -v ON_ERROR_STOP=1 < /tmp/bbx-local-schema.sql
docker exec supabase_db_bbx psql -U supabase_admin -d bbx_public_restore -X -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE'
docker exec supabase_db_bbx psql -U supabase_admin -d bbx_public_restore -X -v ON_ERROR_STOP=1 -c 'CREATE SCHEMA public; CREATE EXTENSION pg_trgm WITH SCHEMA public'
docker exec -i supabase_db_bbx psql -U supabase_admin -d bbx_public_restore -X -q -v ON_ERROR_STOP=1 < "$BACKUP/public-schema.sql"
docker exec -e 'PGOPTIONS=-c session_replication_role=replica' -i supabase_db_bbx psql -U supabase_admin -d bbx_public_restore -X -q -v ON_ERROR_STOP=1 --single-transaction -f /dev/stdin < "$BACKUP/public-data.sql"
docker exec supabase_db_bbx dropdb -U supabase_admin bbx_public_restore
rm /tmp/bbx-local-schema.sql
```

The local trigger setting handles circular public foreign keys and references to excluded Auth users. It applies only to the data-load session. Check row counts and any needed Auth references before treating a restored database as an application environment. The tested throwaway databases were removed on 4 October.
