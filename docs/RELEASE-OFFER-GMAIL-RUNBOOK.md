# Weekly BBR release-offer ingestion

## Schedule

Run on Monday at 08:30 Europe/London. The task runs on the local Codex host, so
the host and Codex application must be available. Run the first backfill and
the next three weekly batches manually before enabling unattended recurrence.

## Task instructions

Use the Gmail connector to search the owner's mailbox with:

```text
label:Wine from:bbr.com -in:trash -in:spam
```

Read the stored high-water mark. Search from two days before it and paginate
until Gmail returns no next page. On the first run, start after 2026-05-11.

For each message:

1. Keep message ID, thread ID, sender, subject, sent time and the relevant
   plain-text or HTML body as raw source evidence.
2. Extract one source row per wine. Extract every explicit GBP price fragment
   within that row.
3. Record case size, bottle volume and tax basis only when the email states
   them. Do not infer missing formats or convert duty-paid prices to in-bond.
4. Prefer a direct BBR product URL or numeric product ID. If a personalised
   link is needed, follow each unique link once with a delay. Start only from a
   known BBR or mail-tracking host and require the final URL to be on
   `bbr.com`. Do not log or report tracking tokens.
5. Match the numeric product ID first. Otherwise use unique exact normalised
   name and vintage. Leave ambiguity pending.

Create one `gmail` release-offer import per successful run. Derive its checksum
from the ordered message IDs and canonical extracted evidence. Set
`byte_size` and `storage_object_path` to null. Use the owner UUID from
`app_owners` as `imported_by`. Preserve all rows even if an earlier batch has
the same economic evidence; analytical views handle deduplication.

Stage no more than 250 source rows per database call. Verify total source and
price-fragment counts before finalising. Accept only if extraction completed,
Gmail pagination completed and every database batch succeeded. The database
will publish only exact product-format in-bond evidence.

Advance the high-water mark to the newest successfully recorded Gmail message
only after the accepted import and count checks succeed. On any Gmail,
tracking-link or database error, do not advance it. Report the import ID,
messages scanned, qualifying messages, source rows, price fragments, exact
matches, unresolved rows, published prices and link failures. Never include
email bodies or personalised URLs in the report.
