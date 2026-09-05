# Supervised test run 2 — extraction, over a month's batch

Run 3 September 2026 over **4 August – 3 September 2026** (the most recent
month). Stage 3 of [RELEASE-OFFER-INGESTION-SKILL.md](RELEASE-OFFER-INGESTION-SKILL.md)
(§6 extraction contract) executed by hand, against the sender/content gates
and classification rules from the first run
([RELEASE-OFFER-INGESTION-TEST-RUN-2026-09-03.md](RELEASE-OFFER-INGESTION-TEST-RUN-2026-09-03.md)).

**Nothing was staged or written.** No `begin_release_offer_import` /
`stage_release_offer_batch` call was made, and no Supabase write of any kind
happened — only Gmail reads. The batch below is what extraction *would*
produce, for review before any of it touches the database. This is exactly
what the first run's report asked for: *"A second supervised run should
extract a batch and stop before accepting it."*

## Headline

| | Count |
| --- | --- |
| Threads in the window (`from:bbr.com`) | 71 |
| Candidate messages (passed sender gate) | 29 |
| Rejected — content gate (event invite, personal reply) | 2 |
| Filtered — spirits | 3 |
| **Extracted messages** | **24** |
| Wine rows, single/few-wine campaigns | 37 |
| Wine rows, two bulk back-vintage list emails | 113 (67 + 46) |
| **Total wine rows in the batch** | **150** |

The 24 extracted messages is close to the ~26/month estimate from the first
run. The **150 rows** is not — that estimate counted messages, not rows, and
two "Selection of Well Priced Back Vintage …" emails are each a 40–70-line
table of distinct wines. See §1 below; this needs a decision before any
cadence is scheduled.

## 1. The volume problem: bulk back-vintage lists

Two emails, both from `christopher.parker@bbr.com`, both a plain table
(Vintage / Wine / Case Size / Price), both explicitly and unambiguously
`back_vintage` on subject and opening line:

- **"Selection of Well Priced Back Vintage Burgundy"** (24 Aug) — 67 rows.
- **"Selection of Well Priced Back Vintage Bordeaux"** (24 Aug) — 46 rows.

Every classification rule agrees on `offer_kind` for these — there is no
ambiguity to adjudicate, unlike the single-wine `unclear` cases below. The
open question is **volume, not classification**: captured whole, these two
messages alone would put 113 back-vintage rows in front of you alongside 37
rows from the rest of the month, in a project whose stated purpose is the
release-price series and where back-vintage rows are explicitly not the
target (tolerated, not wanted — [[project_offers-are-release-prices]]).

Three ways to handle this, not mutually exclusive:

1. **Capture them whole**, as below. Cheapest to build (no special-casing),
   truest to "classify, don't gate" (§4.1 of the spec), and the anchor rule
   means a back-vintage row for a wine you already hold a release price for
   is inert — it just sits as evidence. The cost is 113 rows of hand-review
   noise a month, for wines that are mostly single-case one-offs anyway
   ("almost all single cases... first come, first served").
2. **Capture them, but route straight past the review queue** — stage with
   `offer_kind = back_vintage` pre-set and skip the manual-approval screen
   for rows from this specific email shape, since there is nothing to
   adjudicate. Needs a small amount of new logic (detect the table shape,
   trust the subject-level classification for every row it contains).
3. **Skip this email shape entirely** and accept losing back-vintage anchors
   for wines that have no release price on file yet — which the anchor rule
   would otherwise have used. This is the one option that costs real data
   under the stated "earliest available price beats none" rule.

I extracted all 150 rows below (option 1) because that is what the spec as
written says to do, and because skipping is the one option with a real
downside. But this is a volume/architecture call, not a data-quality one —
**I'd like your decision before this goes into a cadence**, not just before
it's applied.

## 2. The batch

Grouped by message. `Case Price` values are copied verbatim from the offer
block. Where a message names more than one wine, each gets its own row (per
§6 of the spec) — bundle prices are excluded throughout (§5.3, confirmed
below).

### Single/few-wine campaigns (37 rows)

| Date | Wine | Case Price | offer_kind | Evidence |
| --- | --- | --- | --- | --- |
| 03/09/2026 | 2024 Porseleinberg, Swartland, South Africa | £540 per 12 bottle case in bond | release | "the 2024 vintage release" |
| 03/09/2026 | 2024 Porseleinberg, Swartland, South Africa | £600 per 6 magnum case in bond | release | "the 2024 vintage release" |
| 03/09/2026 | 2019 Porseleinberg, Swartland, South Africa | £570 per 12 bottle case in bond | unclear | no tier phrase; "a little more age... highly acclaimed 2019 vintage" |
| 02/09/2026 | 2023 Klein Constantia, Vin de Constance, Constantia, South Africa | £288 per case of 6 half-litre bottles In Bond | release | "the new 2023 release" |
| 02/09/2026 | 2023 Klein Constantia, Vin de Constance, Constantia, South Africa | £480 per case of 3 magnums In Bond | release | "the new 2023 release" |
| 01/09/2026 | 2018 Dom Pérignon, Brut, Champagne | £798 per 6-bottle case In Bond | release | "make sure the latest release finds a place in your cellar" |
| 28/08/2026 | 2019 Ch. Pichon-Longueville-Baron, Pauillac | £552 per 6-bottle case in bond | unclear | "since trying it on release" describes the AM's own history with the wine, not a tier phrase for this offer; gap 7y |
| 28/08/2026 | 2023 Pouilly-Fumé, Baron De L, de Ladoucette, Loire | £330 per six bottle case In Bond | release | "New Release" (subject) |
| 28/08/2026 | 2023 Pouilly-Fumé, Baron De L, de Ladoucette, Loire | £348 per three magnum case In Bond | release | "New Release" (subject) |
| 27/08/2026 | 2010 Château d'Yquem, Sauternes | £1620 per six-bottle case In Bond | back_vintage | no release language; gap 16y |
| 27/08/2026 | 2010 Château d'Yquem, Sauternes | £810 per three-bottle case In Bond | back_vintage | no release language; gap 16y |
| 26/08/2026 | 2024 Curious Ground Sonoma Valley, California | £360 per six-bottle case in bond | release | "the inaugural release", debut vintage of new project |
| 25/08/2026 | 2021 Heitz Martha's Vineyard, Oakville, California | £1,368 per six-bottle case in bond | release | "New Release" (subject) |
| 25/08/2026 | 2021 Heitz Trailside Vineyard, Rutherford, California | £780 per six-bottle case in bond | release | "New Release" (subject) |
| 25/08/2026 | 2021 Heitz Linda Falls Vineyard, Howell Mountain, California | £960 per six-bottle case in bond | release | "New Release" (subject) |
| 24/08/2026 | 2022 Tignanello, Antinori, Tuscany | £582 per 6-bottle case In Bond | release | no tier phrase at triage; resolved by prior-offer check — 3rd offer of the same wine (test-run 1, §4.1) |
| 21/08/2026 | 2018 Cheval des Andes, Mendoza, Argentina | £228 per 6-bottle case In Bond | back_vintage | "secured a parcel of" + gap 8y (weak signal, tier1 per gap>5y rule) |
| 20/08/2026 | 2023 Sassicaia, Tenuta San Guido, Bolgheri | £1251 per case of 6 bottles In Bond | release | "secured a small allocation... for those who missed out earlier this year" — further tranche of current-vintage release, gap 0 |
| 20/08/2026 | 2010 Ch. Canon, St Emilion | £678 per case of 6 bottles In Bond | back_vintage | "ex-negoce stock", "entering its drinking window", gap 16y |
| 20/08/2026 | 2023 Guado al Tasso, Bolgheri Superiore, Antinori, Tuscany | £519 per case of 6 bottles In Bond | unclear | no tier phrase; gap 3y, normal Super Tuscan release cadence |
| 19/08/2026 | 2023 Pegaso Arrebatacapas, Telmo Rodríguez, Cebreros, Spain | £294 per 6 bottle case In Bond | unclear | no tier phrase; "following on from last week's 2023 Granito", gap 0 |
| 18/08/2026 | 2020 Château Margaux, Margaux | £1,020 per 3-bottle case in bond ⚠️ | unclear | "top-tier parcel", gap 6y — **see §3, price is disputed** |
| 14/08/2026 | 2024 St Aubin 1er Cru, Murgers des Dents de Chien, Domaine Gérard Thomas | £180 per 6-bottle case in bond | unclear | "Rare Parcel" (ambiguous, not a tier phrase); gap 2y |
| 12/08/2026 | 2025 Bodega Chacra 'Mainque' Chardonnay, Río Negro, Patagonia | £195 per 6-bottle case In Bond | release | "the latest release from Argentina's Bodegas Chacra" |
| 12/08/2026 | 2025 Bodega Chacra Chardonnay, Río Negro, Patagonia | £375 per 6-bottle case In Bond | release | "the latest release from Argentina's Bodegas Chacra" |
| 12/08/2026 | 2025 Bodega Chacra '55' Pinot Noir, Río Negro, Patagonia | £195 per 6-bottle case In Bond | release | "the latest release from Argentina's Bodegas Chacra" |
| 12/08/2026 | 2024 Bodega Chacra '32' Pinot Noir, Río Negro, Patagonia | £399 per 6-bottle case In Bond | release | "the latest release from Argentina's Bodegas Chacra" (vintage differs from siblings — 2024, not 2025) |
| 11/08/2026 | 2025 Riesling, Smaragd, Klaus, Prager, Wachau, Austria | £249 per 6-bottle case in bond | release | "Today we had the release from our Austrian partner, Prager" — **see §4, hazard** |
| 11/08/2026 | 2025 Grüner Veltliner, Smaragd, Wachstum Bodenstein, Prager, Wachau, Austria | £249 per 6-bottle case in bond | release | "Today we had the release from our Austrian partner, Prager" — **see §4, hazard** |
| 10/08/2026 | 2025 Penfolds Reserve Bin A Chardonnay | £270 per six bottle case In Bond | release | "Following last weeks' release from Penfolds" — **duplicate, see §5** |
| 06/08/2026 | 2024 Penfolds Bin 407 Cabernet | £306 per six bottle case In Bond | release | "New Release" (subject) |
| 06/08/2026 | 2025 Penfolds Reserve Bin A Chardonnay | £270 per six bottle case In Bond | release | "New Release" (subject) — **duplicate, see §5** |
| 06/08/2026 | 2024 Penfolds Bin 389 Cabernet Shiraz | £279 per six bottle case In Bond | release | "New Release" (subject) |
| 06/08/2026 | 2025 Penfolds Bin 311 Chardonnay | £105 per six bottle case In Bond | release | "New Release" (subject) |
| 05/08/2026 | 2021 Pierre Paillard, Les Maillerettes, Bouzy Grand Cru, Blanc de Noirs, Extra Brut | £480 per case of 6 bottles In Bond | release | "I am absolutely thrilled to offer their latest release today" |
| 05/08/2026 | 2021 Pierre Paillard, Verzenay Grand Cru, Blanc de Noirs, Extra Brut | £540 per case of 6 bottles In Bond | release | "I am absolutely thrilled to offer their latest release today" |
| 05/08/2026 | 2021 Pierre Paillard, Ludes 1er Cru, Pinot Meunier, Extra Brut | £480 per case of 6 bottles In Bond | release | "I am absolutely thrilled to offer their latest release today" |
| 04/08/2026 | 2014 Roagna, Barolo Pira | £414 per 6-bottle case in bond | back_vintage | "the maturing, beguilingly delicate 2014 vintage", "rare treat", gap 12y |

**Bundle prices correctly excluded** (not rows above): Porseleinberg "a case
of each would be £1110 for the 24 bottles"; Heitz "£3,108 for a set of all
three cases of 6" (= 1368+780+960, confirms it's additive); Pierre Paillard
"a case of each comes to £1500 on the nose" (= 480+540+480). All three are
the exact §5.3 hazard from the first run, and all three were caught.

### Bulk back-vintage lists (113 rows)

Full tables reproduced in the source emails; not repeated here at 113 rows —
sampled top and bottom of each for shape-checking:

**"Selection of Well Priced Back Vintage Burgundy"** (24/08/2026, 67 rows) —
first and last: `2018 Beaune, Aux Cras, 1er Cru, Camille Giroud — £252 per
6-bottle case`; `2011 Vosne-Romanée, Les Rouges, 1er Cru, Domaine Jean Grivot
— £480 per 6-bottle case`. All `offer_kind = back_vintage`, evidence "Back
Vintage Burgundy" (subject + opening line).

**"Selection of Well Priced Back Vintage Bordeaux"** (24/08/2026, 46 rows) —
first and last: `2012 Château Bellevue, St Emilion — £444 per 12-bottle
case`; `2010 Sarget de Gruaud Larose, St Julien — £312 per 12-bottle case`.
All `offer_kind = back_vintage`, evidence "Back Vintage Bordeaux Cases"
(subject + opening line).

Producer and appellation are given per row in both tables; no producer- or
vintage-in-subject repair is needed for these two.

## 3. Flag: 2020 Château Margaux price is self-contradictory

This is the exact hazard the first run found (§3.1 there) and it reproduces
verbatim in this window — same email, now in scope for extraction rather
than just triage:

> "At **£1,020 per bottle** in bond, the wine looks extremely attractive..."
> *(prose)*
>
> "2020 Château Margaux, Margaux — **£1,020 per 3-bottle case** in bond"
> *(offer block)*

Same figure, threefold unit contradiction. The corpus holds a prior offer of
the same wine at £1,440 per 3-bottle case (23 Jun 2021, En Primeur) — a
100-point First Growth does not fall to £340/bottle five years later, so the
prose reading (£1,020/bottle ≈ £3,060/3-bottle case) is the credible one.
**I have not resolved this in the table above** — the Case Price cell carries
the offer-block value verbatim, flagged, because silently "correcting" it
would be a guess dressed up as extraction. This is the row I'd want a human
set of eyes on before it goes anywhere near an anchor price.

## 4. New hazard: the Prager release lives inside a transactional thread, and its price isn't in offer-block prose

The first run predicted this shape from historical mail (§ Defect 1: sender
replying into an automated order-confirmation thread) — this run found a
live instance of the *exact* case cited there, the 11 August 2026 Prager
release, `Christopher.Parker@bbr.com` replying into thread `19ff0225432ef030`
which opens with a `bbr@bbr.com` "Order Confirmation". Thread-level triage
keyed on the first sender drops it; message-level triage catches it.

But there's a second problem this run surfaces that the first one didn't:
**the reply carries no offer-block price line at all.** The reply text is
"Today we had the release from our Austrian partner, Prager... I have
secured this for your cellar" — no `£N per <qty> <unit> case in bond`
anywhere. The only prices are in the *quoted order-confirmation table below
it*, in an invoice shape (`Quantity | Item Price | Total`, e.g. `6 | 41.50 |
249.00`), not the offer-block prose the content gate and price parser are
built around. I derived £249 per 6-bottle case for each wine by reading the
table (`6 × £41.50 = £249.00`), but a parser built only for the prose grammar
would find nothing here and reject the whole message at the content gate —
the opposite failure to a false positive, and harder to notice because it
fails silently as "not an offer" rather than visibly as a bad row.

Worth naming separately: this message is also not really a *solicited*
offer in the usual sense — Chris says he has already secured the wine for
the account unless told otherwise ("Let me know if you do not want to keep
this"), and the parent thread is a paid Order Confirmation for £498. It is a
genuine first-sighting release price for both Prager wines, arrived at
through a different transaction shape than every other row in this batch.

## 5. Minor: a duplicate is expected, and is harmless

`2025 Penfolds Reserve Bin A Chardonnay` appears twice — once as a standalone
spotlight (10 Aug, "Following last weeks' release") and once inside the
"Penfolds Bin Collection" email it's spotlighting (6 Aug, "New Release").
Same price both times (£270/6). `release_price_anchor_view` orders by
`offer_date` and takes the earliest, so the 6 Aug row wins and the 10 Aug row
is inert corroborating evidence — no action needed, noting it only so it
isn't mistaken for an extraction bug when it shows up twice in review.

## 6. What this confirms from the first run

- **All three §5 body hazards recur and were handled correctly**: name/price
  running together (Porseleinberg), a second wine in prose with its own
  price (Porseleinberg 2019 tranche), bundle prices excluded (three separate
  instances this run, listed in §2).
- **The `ex-<origin>` family is real and recurring**: "ex-negoce stock" (Ch.
  Canon) joins "ex-bodega"/"ex-château"/"ex-domaine" from the first run.
  Confirms the spec's recommendation to generalise this as a family rather
  than list variants.
- **Full-body reading changes at least one classification the snippet-only
  first pass got wrong**: 2018 Dom Pérignon reads as `unclear` from the
  subject/snippet ("the eagerly anticipated offer for") but the full body
  contains an explicit tier-2 phrase ("the latest release") the snippet
  truncated before. Reinforces that classification needs the full body, not
  metadata — the first run already fetched full bodies for its `unclear`
  adjudication, but this is a case where the difference is visible.
- **`unclear` stays genuinely irreducible for several rows** even with full
  bodies and no gating pressure: Pichon-Baron, Guado al Tasso, Pegaso
  Arrebatacapas, St Aubin, Ch. Margaux. None of these carry a tier-1 or
  tier-2 phrase; all are captured and labelled per §4.1, none blocked.

## 7. Outstanding decisions

1. **§1 — bulk back-vintage lists.** Capture whole, route around review, or
   skip. My lean is option 2 (capture, skip the review screen for this
   specific shape) but this is your call to make, not mine to build around.
2. **§3 — the Ch. Margaux row.** Hold it out of the batch until you've looked
   at it, or stage it flagged rather than silently trusting the offer block?
3. **§4 — the Prager shape.** Worth a second extraction path for
   invoice-table pricing inside replies, given it will recur (spirits AM
   cover, other "I've secured this for you" messages) — or narrow enough to
   handle by hand when it comes up (twice a year per the first run's
   estimate)?

Nothing above blocks staging the other ~145 rows once you've had a look —
these three are the ones that need a decision, not a rebuild.
