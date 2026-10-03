import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackToOrigin } from "@/components/wine/BackToOrigin";
import { FavouriteStar } from "@/components/favourites/FavouriteStar";
import { requireOwner } from "@/lib/auth/owner";
import { isTargetFavourited } from "@/lib/favourites/server";
import { perBottleP } from "@/lib/favourites/browser";
import { formatDate, formatDateTime, formatFormat, formatPence, formatSignedPct } from "@/lib/format";
import { bbrWineDestination, wineSearcherUrl } from "@/lib/listingLinks";
import { timeProtectedQuery } from "@/lib/observability/routeTiming";

export const dynamic = "force-dynamic";

// The canonical wine card. Identity and the per-format arbitrage line come from
// the wine_card views (docs/WINE-RECORD-SPEC.md step 1); the source-record
// sections still read their own snapshots by parent_sku. Reachable as
// /wine/parent/[parentSku]; /favourites/[parentSku] redirects here.

type WineCard = {
  wine_ref: string | null;
  parent_sku: string | null;
  name: string | null;
  vintage: number | null;
  producer: string | null;
  country: string | null;
  region: string | null;
  subregion: string | null;
  colour: string | null;
  product_url: string | null;
  is_biddable: boolean | null;
};

type WineCardFormat = {
  format_code: string | null;
  case_size: number | null;
  bottle_volume_ml: number | null;
  is_listed: boolean | null;
  lowest_ask_p: number | null;
  highest_bid_p: number | null;
  market_price_p: number | null;
  adjusted_guide_p: number | null;
  last_transaction_p: number | null;
  price_vs_last_pct: number | null;
  last_rest_checked_at: string | null;
};

type ReferencePrice = {
  price_per_75cl_p: number;
  resolution_kind: string;
  source_kind: string;
  reference_date: string | null;
  date_meaning: string | null;
  source_wine: string | null;
  evidence_min_p: number | null;
  evidence_max_p: number | null;
  evidence_candidate_count: number;
  has_competing_evidence: boolean;
  needs_review: boolean;
  has_current_support: boolean;
};

type ReferenceCandidate = {
  source_kind: string;
  source_price_p: number;
  price_per_75cl_p: number;
  source_format_code: string | null;
  source_case_size: number | null;
  reference_date: string | null;
  date_meaning: string | null;
  source_wine: string | null;
};

type ReleaseRecord = {
  import_id: string;
  source_row_number: number;
  offer_date: string | null;
  source_wine: string | null;
  format_code: string | null;
  release_price_p: number | null;
  case_size: number | null;
  bottle_volume_ml: number | null;
  match_method: string | null;
  source_product_url: string | null;
  tasting_notes: string | null;
};

type CellarTrackerRecord = {
  import_id: string;
  source_row_number: number;
  source_wine: string;
  vintage: number | null;
  producer: string | null;
  quantity_home: number;
  quantity_bbr: number;
  fully_consumed: boolean;
  purchase_price_per_bottle_p: number | null;
  begin_consume: number | null;
  end_consume: number | null;
  match_method: string | null;
};

type BbrHolding = {
  import_id: string;
  source_row_number: number;
  description: string | null;
  format_code: string | null;
  case_size: number | null;
  bottle_volume_ml: number | null;
  quantity_bottles: number;
  purchase_price_per_case_p: number | null;
  current_status: string | null;
  eligible_for_bbx: boolean | null;
};

type Suggestion = {
  name: string | null;
  vintage: number | null;
  producer: string | null;
  region: string | null;
  product_url: string | null;
};

function methodLabel(value: string | null): string {
  const labels: Record<string, string> = {
    local_exact: "local exact match",
    algolia_exact: "Algolia exact match",
    algolia_confirmed: "Algolia confirmed",
    exact_name_vintage: "exact name and vintage",
    direct: "supplied product ID",
    manual: "manual Parent ID",
  };
  return value ? labels[value] ?? value.replaceAll("_", " ") : "unknown method";
}

function askVsReference(askP: number | null, caseSize: number | null,
  bottleVolumeMl: number | null, referenceP: number | null): number | null {
  if (bottleVolumeMl !== 750 || referenceP == null || referenceP <= 0) return null;
  const askPerBottle = perBottleP(askP, caseSize, bottleVolumeMl);
  return askPerBottle == null ? null : (askPerBottle / referenceP - 1) * 100;
}

// One labelled figure in the at-a-glance status band. `sub` carries the small
// supporting line (a reference price under a percentage, a holdings breakdown).
function Stat({ label, value, sub, tone }: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "muted";
}) {
  return <div className="min-w-[7rem]">
    <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
    <dd className={`mt-1 text-lg font-semibold tabular-nums ${tone === "muted" ? "text-ink-muted" : ""}`}>{value}</dd>
    {sub && <p className="text-xs text-ink-muted tabular-nums">{sub}</p>}
  </div>;
}

function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return <section className="rounded-lg border border-border bg-background p-5">
    <h2 className="text-lg font-semibold">{title}</h2>
    {note && <p className="mt-1 max-w-3xl text-sm text-ink-muted">{note}</p>}
    {children}
  </section>;
}

export default async function WinePage({ params }: {
  params: Promise<{ parentSku: string }>;
}) {
  const { parentSku } = await params;
  if (!/^\d{5,30}$/.test(parentSku)) notFound();
  const owner = await requireOwner();
  const { supabase } = owner;

  const [wineCard, formatRows, referenceResult, candidatesResult, releases, cellartracker, holdings, suggestion, favourited] = await timeProtectedQuery("/wine/parent/[parentSku]", "wine_page_data", () => Promise.all([
    supabase.from("wine_card_view")
      .select("wine_ref,parent_sku,name,vintage,producer,country,region,subregion,colour,product_url,is_biddable")
      .eq("parent_sku", parentSku).maybeSingle(),
    supabase.from("wine_card_format_view")
      .select("format_code,case_size,bottle_volume_ml,is_listed,lowest_ask_p,highest_bid_p,market_price_p,adjusted_guide_p,last_transaction_p,price_vs_last_pct,last_rest_checked_at")
      .eq("parent_sku", parentSku).order("bottle_volume_ml").order("case_size"),
    supabase.from("resolved_reference_price_view")
      .select("price_per_75cl_p,resolution_kind,source_kind,reference_date,date_meaning,source_wine,evidence_min_p,evidence_max_p,evidence_candidate_count,has_competing_evidence,needs_review,has_current_support")
      .eq("parent_sku", parentSku).maybeSingle(),
    supabase.from("historic_reference_candidate_view")
      .select("source_kind,source_price_p,price_per_75cl_p,source_format_code,source_case_size,reference_date,date_meaning,source_wine")
      .eq("parent_sku", parentSku).order("reference_date", { ascending: true }),
    supabase.from("release_offer_evidence_view")
      .select("import_id,source_row_number,offer_date,source_wine,format_code,release_price_p,case_size,bottle_volume_ml,match_method,source_product_url,tasting_notes")
      .eq("parent_sku", parentSku).order("offer_date", { ascending: false }),
    supabase.from("current_cellartracker_records")
      .select("import_id,source_row_number,source_wine,vintage,producer,quantity_home,quantity_bbr,fully_consumed,purchase_price_per_bottle_p,begin_consume,end_consume,match_method")
      .eq("parent_sku", parentSku).order("source_wine"),
    supabase.from("current_bbr_holdings")
      .select("import_id,source_row_number,description,format_code,case_size,bottle_volume_ml,quantity_bottles,purchase_price_per_case_p,current_status,eligible_for_bbx")
      .eq("parent_sku", parentSku).order("format_code"),
    // Identity of last resort: release offers match against BBR's wider
    // prod_product catalogue, so a Parent ID need not be in the tracked book.
    supabase.from("release_offer_match_suggestion_view")
      .select("name,vintage,producer,region,product_url").eq("parent_sku", parentSku).limit(1).maybeSingle(),
    isTargetFavourited(owner, { kind: "wine", parentSku }),
  ]));

  for (const [what, result] of [
    ["Wine", wineCard], ["Catalogue formats", formatRows],
    ["Reference price", referenceResult], ["Reference evidence", candidatesResult],
    ["Release history", releases], ["CellarTracker records", cellartracker], ["BBR holdings", holdings],
  ] as const) {
    if (result.error) throw new Error(`${what} could not be loaded: ${result.error.message} (${result.error.code})`);
  }

  const wine = (wineCard.data ?? null) as WineCard | null;
  const formats = (formatRows.data ?? []) as WineCardFormat[];
  const reference = (referenceResult.data ?? null) as ReferencePrice | null;
  const referenceCandidates = (candidatesResult.data ?? []) as ReferenceCandidate[];
  const releaseRecords = (releases.data ?? []) as ReleaseRecord[];
  const cellarRecords = (cellartracker.data ?? []) as CellarTrackerRecord[];
  const bbrHoldings = (holdings.data ?? []) as BbrHolding[];
  const fallback = (suggestion.data ?? null) as Suggestion | null;

  const known = wine !== null || formats.length > 0 || reference !== null || releaseRecords.length > 0
    || cellarRecords.length > 0 || bbrHoldings.length > 0 || fallback !== null;
  if (!known) notFound();

  const identity = {
    name: wine?.name ?? cellarRecords[0]?.source_wine ?? fallback?.name
      ?? releaseRecords[0]?.source_wine ?? bbrHoldings[0]?.description ?? parentSku,
    vintage: wine?.vintage ?? cellarRecords[0]?.vintage ?? fallback?.vintage ?? null,
    producer: wine?.producer ?? cellarRecords[0]?.producer ?? fallback?.producer ?? null,
    place: [wine?.country, wine?.region ?? fallback?.region, wine?.subregion]
      .filter(Boolean).join(" · "),
    colour: wine?.colour ?? null,
  };
  const bbrDestination = bbrWineDestination({
    parentSku,
    name: identity.name,
    vintage: identity.vintage,
    productUrls: [
      wine?.product_url,
      fallback?.product_url,
      ...releaseRecords.map((record) => record.source_product_url),
    ],
  });
  const wineSearcher = wineSearcherUrl(identity.name, identity.vintage);

  // The most recent release offer that carried a tasting note. Release records
  // arrive newest-first, so the first non-empty note is the freshest.
  const tastingNote = releaseRecords.find((r) => r.tasting_notes && r.tasting_notes.trim()) ?? null;

  // The status-band glance headlines one format so every figure agrees: the
  // keenest live ask per 75cl, else the 750ml single-bottle reference, else the
  // first format. The reference comparison only applies to 75 cl formats.
  // per-format, so a single headline keeps them coherent.
  const askable = formats
    .filter((f) => f.bottle_volume_ml === 750 && perBottleP(f.lowest_ask_p, f.case_size, f.bottle_volume_ml) !== null)
    .sort((a, b) =>
      (perBottleP(a.lowest_ask_p, a.case_size, a.bottle_volume_ml) ?? Infinity)
      - (perBottleP(b.lowest_ask_p, b.case_size, b.bottle_volume_ml) ?? Infinity));
  const headline = askable[0]
    ?? formats.find((f) => f.bottle_volume_ml === 750 && f.case_size === 1)
    ?? formats[0]
    ?? null;

  // Held bottles from the two sources. CellarTracker's "at BBR" and the BBR
  // cellar holdings are the same physical bottles, so held takes the larger of
  // the two rather than summing (mirrors heldBottles in the favourites lib).
  const ctHome = cellarRecords.reduce((n, r) => n + r.quantity_home, 0);
  const ctBbr = cellarRecords.reduce((n, r) => n + r.quantity_bbr, 0);
  const bbrStored = bbrHoldings.reduce((n, r) => n + r.quantity_bottles, 0);
  const heldTotal = ctHome + Math.max(ctBbr, bbrStored);

  return <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
    <div className="mx-auto max-w-6xl space-y-5 p-5">
      <Suspense fallback={null}>
        <BackToOrigin />
      </Suspense>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Wine</p>
          <h1 className="mt-1 text-2xl font-semibold">{identity.name}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {identity.vintage ?? "Vintage unavailable"} · {identity.producer ?? "Producer unavailable"} · Parent {parentSku}
            {identity.place && ` · ${identity.place}`}{identity.colour && ` · ${identity.colour}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <FavouriteStar target={{ kind: "wine", parentSku }} favourite={favourited} label={identity.name} />
          <a href={bbrDestination.url} target="_blank" rel="noreferrer" className="rounded border border-border px-3 py-2 text-sm hover:border-accent hover:text-accent">
            {bbrDestination.kind === "product" ? "Open at BBR ↗" : "Search BBR ↗"}
          </a>
          {wineSearcher && <a href={wineSearcher} target="_blank" rel="noreferrer" className="rounded border border-border px-3 py-2 text-sm hover:border-accent hover:text-accent">Wine-Searcher ↗</a>}
          <Link href="/favourites" className="rounded border border-accent px-3 py-2 text-sm text-accent">All favourites</Link>
        </div>
      </header>

      {/* At-a-glance status band: where this wine stands, before any scrolling.
          Market figures are the headline format; holdings span all formats. */}
      <section className="rounded-lg border border-border bg-background p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${wine?.is_biddable ? "bg-accent text-accent-ink" : "border border-border text-ink-muted"}`}>
            {wine?.is_biddable ? "Biddable at BBX" : "Not biddable"}
          </span>
          {headline && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-ink-muted">
            {headline.is_listed ? "Listed" : "Unlisted"}
          </span>}
          {headline && <span className="text-xs text-ink-muted">
            Market figures: {formatFormat(headline.case_size, headline.bottle_volume_ml)} · per 75cl
          </span>}
        </div>
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-4">
          <Stat label="Ask" value={formatPence(perBottleP(headline?.lowest_ask_p ?? null, headline?.case_size ?? null, headline?.bottle_volume_ml ?? null))} />
          <Stat label="Bid" value={formatPence(perBottleP(headline?.highest_bid_p ?? null, headline?.case_size ?? null, headline?.bottle_volume_ml ?? null))} />
          <Stat label="Guide" value={formatPence(perBottleP(headline?.market_price_p ?? null, headline?.case_size ?? null, headline?.bottle_volume_ml ?? null))} />
          <Stat
            label="Ask vs reference"
            value={formatSignedPct(askVsReference(headline?.lowest_ask_p ?? null, headline?.case_size ?? null, headline?.bottle_volume_ml ?? null, reference?.price_per_75cl_p ?? null))}
            sub={reference && headline?.bottle_volume_ml === 750
              ? `${formatPence(reference.price_per_75cl_p)} / 75 cl · ${reference.resolution_kind === "owner" ? "owner-set" : reference.source_kind}`
              : "no 75 cl reference"}
          />
          <Stat
            label="Ask vs last tx"
            value={formatSignedPct(headline?.price_vs_last_pct ?? null)}
            sub={headline?.last_transaction_p != null ? `last ${formatPence(perBottleP(headline.last_transaction_p, headline.case_size, headline.bottle_volume_ml))}` : "no trade"}
          />
          <Stat
            label="Held"
            value={heldTotal || "–"}
            sub={heldTotal ? `${ctHome} home · ${Math.max(ctBbr, bbrStored)} at BBR` : "none"}
            tone={heldTotal ? undefined : "muted"}
          />
          <Stat label="BBR stored" value={bbrStored || "–"} tone={bbrStored ? undefined : "muted"} />
        </dl>
      </section>

      {formats.length === 0 && <p role="status" className="rounded border border-accent/40 bg-background p-3 text-sm">
        This wine is not in the tracked BBX catalogue, so there is no live market data for it.
        Everything below comes from the source records that reference this Parent ID.
      </p>}

      {formats.length > 0 && <Card
        title="Market now"
        note="Market prices are shown per 75 cl equivalent. The historic reference and its comparison apply only to 75 cl bottles. 'Last tx' is the most recent trade. The adjusted guide includes source offer format premiums."
      >
        <div className="mt-4 overflow-auto">
          <table className="w-full min-w-max text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="py-2 pr-3">Format</th><th className="py-2 pr-3">Listing</th>
                <th className="py-2 pr-3 text-right">Ask / 75cl</th><th className="py-2 pr-3 text-right">Bid / 75cl</th>
                <th className="py-2 pr-3 text-right">Guide / 75cl</th><th className="py-2 pr-3 text-right">Last tx / 75cl</th>
                <th className="py-2 pr-3 text-right">Reference / 75 cl</th><th className="py-2 pr-3 text-right">Ask vs reference</th><th className="py-2 pr-3 text-right">Ask vs last</th>
                <th className="py-2 pr-3 text-right font-normal normal-case text-ink-muted/70">Adjusted / 75cl</th><th className="py-2">Checked</th>
              </tr>
            </thead>
            <tbody>
              {formats.map((format) => (
                <tr key={format.format_code} className="border-t border-border">
                  <td className="py-2 pr-3">{formatFormat(format.case_size, format.bottle_volume_ml)}</td>
                  <td className="py-2 pr-3">{format.is_listed ? "Listed" : "Unlisted"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatPence(perBottleP(format.lowest_ask_p, format.case_size, format.bottle_volume_ml))}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatPence(perBottleP(format.highest_bid_p, format.case_size, format.bottle_volume_ml))}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatPence(perBottleP(format.market_price_p, format.case_size, format.bottle_volume_ml))}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatPence(perBottleP(format.last_transaction_p, format.case_size, format.bottle_volume_ml))}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{format.bottle_volume_ml === 750 ? formatPence(reference?.price_per_75cl_p ?? null) : "–"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatSignedPct(askVsReference(format.lowest_ask_p, format.case_size, format.bottle_volume_ml, reference?.price_per_75cl_p ?? null))}
                    <Link href={`/release-prices/${parentSku}/${format.format_code}`} className="block text-xs font-normal text-accent underline-offset-2 hover:underline">
                      Historic offers ↗
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatSignedPct(format.price_vs_last_pct)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-muted/70">{formatPence(perBottleP(format.adjusted_guide_p, format.case_size, format.bottle_volume_ml))}</td>
                  <td className="py-2 text-xs text-ink-muted">{formatDateTime(format.last_rest_checked_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>}

      <Card
        title="Historic reference"
        note="One in-bond price per 75 cl bottle for this wine. It is a benchmark from the available historic evidence, not a claim about the original release price."
      >
        {reference ? <div className="mt-3 space-y-2 text-sm">
          <p><strong className="text-lg tabular-nums">{formatPence(reference.price_per_75cl_p)}</strong> / 75 cl · {reference.resolution_kind === "owner" ? "Owner-set" : `Automatic from ${reference.source_kind}`}</p>
          <p className="text-ink-muted">{reference.reference_date ? `${reference.date_meaning ?? "Reference date"}: ${formatDate(reference.reference_date)}` : reference.date_meaning ?? "Date not recorded"}</p>
          {reference.source_wine && <p className="text-ink-muted">{reference.source_wine}</p>}
          {reference.has_competing_evidence && <p className="text-ink-muted">Competing prices: {formatPence(reference.evidence_min_p)} to {formatPence(reference.evidence_max_p)} per 75 cl.</p>}
          {reference.needs_review && <p className="text-accent">Purchase evidence needs review.</p>}
          {reference.resolution_kind === "owner" && !reference.has_current_support && <p className="text-ink-muted">No current corroboration for this owner-set value.</p>}
        </div> : <p className="mt-3 text-sm text-ink-muted">No historic reference price is available.</p>}
        {referenceCandidates.length > 0 && <div className="mt-4 overflow-auto">
          <table className="w-full min-w-max text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-muted"><tr>
              <th className="py-2 pr-3">Source</th><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Original price</th><th className="py-2 pr-3 text-right">Per 75 cl</th><th className="py-2">Evidence</th>
            </tr></thead>
            <tbody>{referenceCandidates.map((candidate, index) => <tr key={index} className="border-t border-border">
              <td className="py-2 pr-3">{candidate.source_kind === "bbr" ? "BBR holding" : candidate.source_kind === "cellartracker" ? "CellarTracker" : "Historic offer"}</td>
              <td className="py-2 pr-3">{candidate.reference_date ? formatDate(candidate.reference_date) : "–"}</td>
              <td className="py-2 pr-3 tabular-nums">{formatPence(candidate.source_price_p)}{candidate.source_case_size ? ` / ${candidate.source_case_size} bottles` : " / bottle"}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatPence(candidate.price_per_75cl_p)}</td>
              <td className="py-2 text-ink-muted">{reference && Math.abs(candidate.price_per_75cl_p - reference.price_per_75cl_p) <= 1 ? "Supports reference" : "Competing"}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </Card>

      {tastingNote?.tasting_notes && <Card
        title="Tasting note"
        note={`From the BBR release offer of ${formatDate(tastingNote.offer_date)}.`}
      >
        <blockquote className="mt-3 border-l-2 border-accent/40 pl-4 text-sm text-ink whitespace-pre-wrap">
          {tastingNote.tasting_notes.trim()}
        </blockquote>
      </Card>}

      <Card
        title="Release history"
        note={releaseRecords.length > 0
          ? "Every accepted BBR release offer that resolves to this Parent ID, oldest offers last."
          : undefined}
      >
        {releaseRecords.length === 0
          ? <p className="mt-3 text-sm text-ink-muted">No accepted release offer resolves to this wine.</p>
          : <div className="mt-4 overflow-auto">
            <table className="w-full min-w-max text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="py-2 pr-3">Offer date</th><th className="py-2 pr-3">Format</th>
                  <th className="py-2 pr-3 text-right">Offer / 75 cl</th>
                  <th className="py-2 pr-3">Matched by</th><th className="py-2">Record</th>
                </tr>
              </thead>
              <tbody>
                {releaseRecords.map((record) => {
                  return <tr key={`${record.import_id}-${record.source_row_number}-${record.format_code}`} className="border-t border-border">
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDate(record.offer_date)}</td>
                    <td className="py-2 pr-3">{formatFormat(record.case_size, record.bottle_volume_ml)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatPence(perBottleP(record.release_price_p, record.case_size, record.bottle_volume_ml))}</td>
                    <td className="py-2 pr-3 text-xs text-ink-muted">{methodLabel(record.match_method)}</td>
                    <td className="py-2">
                      <Link href={`/release-prices/offers/${record.import_id}/${record.source_row_number}`} className="text-sm text-accent underline-offset-2 hover:underline">Open</Link>
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>}
      </Card>

      <Card
        title="My cellar"
        note={cellarRecords.length > 0 || bbrHoldings.length > 0
          ? "CellarTracker's BBR quantity and the BBR cellar holdings describe the same bottles from two sources, so they are shown separately rather than totalled."
          : undefined}
      >
        {cellarRecords.length === 0 && bbrHoldings.length === 0
          ? <p className="mt-3 text-sm text-ink-muted">You hold none of this wine in either source.</p>
          : <div className="mt-4 space-y-5">
            {cellarRecords.length > 0 && <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">CellarTracker</h3>
              <ul className="mt-2 space-y-2">
                {cellarRecords.map((record) => <li key={`${record.import_id}-${record.source_row_number}`} className="flex flex-wrap items-baseline justify-between gap-3 rounded border border-border p-3 text-sm">
                  <div>
                    <p className="font-medium">{record.source_wine}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {record.quantity_home} at home · {record.quantity_bbr} at BBR · paid {formatPence(record.purchase_price_per_bottle_p)} / 75cl
                      {record.fully_consumed && " · fully consumed"}
                      {record.begin_consume && record.end_consume ? ` · drink ${record.begin_consume}–${record.end_consume}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-right text-xs text-ink-muted">
                    Linked by {methodLabel(record.match_method)}
                    <Link href={`/cellartracker/${record.import_id}/${record.source_row_number}`} className="mt-0.5 block text-accent underline-offset-2 hover:underline">Manage ↗</Link>
                  </span>
                </li>)}
              </ul>
            </div>}
            {bbrHoldings.length > 0 && <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">BBR cellar</h3>
              <ul className="mt-2 space-y-2">
                {bbrHoldings.map((holding) => <li key={`${holding.import_id}-${holding.source_row_number}`} className="flex flex-wrap items-baseline justify-between gap-3 rounded border border-border p-3 text-sm">
                  <div>
                    <p className="font-medium">{holding.description ?? parentSku}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {formatFormat(holding.case_size, holding.bottle_volume_ml)} · {holding.quantity_bottles} bottle{holding.quantity_bottles === 1 ? "" : "s"}
                      {" · paid "}{formatPence(perBottleP(holding.purchase_price_per_case_p, holding.case_size, holding.bottle_volume_ml))} / 75cl
                      {holding.current_status ? ` · ${holding.current_status}` : ""}
                    </p>
                  </div>
                  <span className="text-xs text-ink-muted">{holding.eligible_for_bbx ? "BBX eligible" : "Not BBX eligible"}</span>
                </li>)}
              </ul>
            </div>}
          </div>}
      </Card>

      <Card
        title="How this wine is joined up"
        note="Unlink and re-link live on the record pages, so the audit trail stays with the record rather than being duplicated here."
      >
        <ul className="mt-3 space-y-1 text-sm">
          <li>{formats.length > 0
            ? `${formats.length} format${formats.length === 1 ? "" : "s"} in the tracked BBX catalogue`
            : "Not in the tracked BBX catalogue"}</li>
          <li>{releaseRecords.length > 0
            ? `${releaseRecords.length} accepted release-offer price${releaseRecords.length === 1 ? "" : "s"}`
            : "No accepted release offers"}</li>
          <li>{cellarRecords.length > 0
            ? `${cellarRecords.length} CellarTracker record${cellarRecords.length === 1 ? "" : "s"} in the current snapshot`
            : "No CellarTracker records in the current snapshot"}</li>
          <li>{bbrHoldings.length > 0
            ? `${bbrHoldings.length} BBR cellar holding${bbrHoldings.length === 1 ? "" : "s"}`
            : "No BBR cellar holdings"}</li>
        </ul>
      </Card>
    </div>
  </main>;
}
