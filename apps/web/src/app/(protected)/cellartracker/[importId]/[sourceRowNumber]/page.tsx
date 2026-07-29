import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatFormat, formatPence, formatSignedPct } from "@/lib/format";
import { requireOwner } from "@/lib/auth/owner";
import { DeleteCellarTrackerRecordForm } from "./DeleteCellarTrackerRecordForm";
import {
  confirmCellarTrackerRecordCandidate,
  setManualCellarTrackerRecordLink,
  unlinkCellarTrackerRecord,
  updateCellarTrackerRecordPrice,
} from "./actions";

export const dynamic = "force-dynamic";

type CellarTrackerRecord = {
  import_id: string;
  source_row_number: number;
  source_wine: string;
  source_match_key: string;
  match_group_key: string;
  vintage: number | null;
  bottle_volume_ml: number;
  purchase_price_per_bottle_p: number | null;
  quantity_home: number;
  quantity_bbr: number;
  total_quantity: number;
  fully_consumed: boolean;
  colour: string | null;
  producer: string | null;
  country: string | null;
  region: string | null;
  appellation: string | null;
  varietal: string | null;
  begin_consume: number | null;
  end_consume: number | null;
};

type Resolution = {
  status: "linked" | "suppressed";
  parent_sku: string | null;
  match_method: string;
};

type Candidate = {
  parent_sku: string;
  rank: number;
  name: string;
  vintage: number | null;
  producer: string | null;
  region: string | null;
  stock_origin: string | null;
  purchase_mode: string | null;
  typo_count: number | null;
  match_score: number | null;
  is_biddable: boolean;
};

type CatalogueRow = {
  parent_sku: string | null;
  name: string | null;
  vintage: number | null;
  producer: string | null;
  country: string | null;
  region: string | null;
  subregion: string | null;
  colour: string | null;
  product_url: string | null;
  format_code: string | null;
  case_size: number | null;
  bottle_volume_ml: number | null;
  ask: number | null;
  highest_bid_p: number | null;
  market_price_p: number | null;
  is_listed: boolean | null;
};

type ReleasePriceRow = {
  parent_sku: string | null;
  format_code: string | null;
  anchor_status: string | null;
  offer_date: string | null;
  release_price_p: number | null;
  source_wine: string | null;
  source_product_url: string | null;
  name: string | null;
  case_size: number | null;
  bottle_volume_ml: number | null;
  lowest_ask_p: number | null;
  highest_bid_p: number | null;
  ask_vs_release_pct: number | null;
  bid_vs_release_pct: number | null;
};

function methodLabel(value: string | null) {
  const labels: Record<string, string> = {
    local_exact: "Local exact match",
    algolia_exact: "Algolia exact match",
    algolia_confirmed: "Algolia confirmed",
    manual: "Manual Parent ID",
  };
  return value ? labels[value] ?? value.replaceAll("_", " ") : "Unlinked";
}

function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export default async function CellarTrackerRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ importId: string; sourceRowNumber: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { importId, sourceRowNumber } = await params;
  const query = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(importId) || !/^\d+$/.test(sourceRowNumber)) notFound();
  const rowNumber = Number(sourceRowNumber);
  const { supabase } = await requireOwner();

  const [
    { data: sourceData, error: sourceError },
    { data: importData, error: importError },
    { data: resolutionData, error: resolutionError },
    { data: rawData, error: rawError },
  ] = await Promise.all([
    supabase.from("cellartracker_evidence")
      .select("import_id,source_row_number,source_wine,source_match_key,match_group_key,vintage,bottle_volume_ml,purchase_price_per_bottle_p,quantity_home,quantity_bbr,total_quantity,fully_consumed,colour,producer,country,region,appellation,varietal,begin_consume,end_consume")
      .eq("import_id", importId).eq("source_row_number", rowNumber).maybeSingle(),
    supabase.from("cellar_imports").select("status,original_filename,accepted_at")
      .eq("id", importId).eq("source_type", "cellartracker_inventory").maybeSingle(),
    supabase.from("cellartracker_product_resolutions").select("status,parent_sku,match_method")
      .eq("import_id", importId).eq("source_row_number", rowNumber).maybeSingle(),
    supabase.from("cellar_import_rows").select("raw_row,validation_errors,validation_warnings")
      .eq("import_id", importId).eq("source_row_number", rowNumber).maybeSingle(),
  ]);
  if (sourceError || importError || resolutionError || rawError) {
    throw new Error("CellarTracker record could not be loaded.");
  }
  if (!sourceData || importData?.status !== "accepted") notFound();

  const source = sourceData as CellarTrackerRecord;
  const resolution = resolutionData as Resolution | null;
  const { data: candidateData, error: candidateError } = await supabase
    .from("cellartracker_match_suggestion_view")
    .select("parent_sku,rank,name,vintage,producer,region,stock_origin,purchase_mode,typo_count,match_score,is_biddable")
    .eq("match_group_key", source.match_group_key)
    .order("rank");
  if (candidateError) throw new Error("CellarTracker match candidates could not be loaded.");
  const candidates = (candidateData ?? []) as Candidate[];

  const [{ data: catalogueData, error: catalogueError }, { data: releaseData, error: releaseError }] =
    resolution?.parent_sku
      ? await Promise.all([
        supabase.from("catalogue_view")
          .select("parent_sku,name,vintage,producer,country,region,subregion,colour,product_url,format_code,case_size,bottle_volume_ml,ask,highest_bid_p,market_price_p,is_listed")
          .eq("parent_sku", resolution.parent_sku).order("format_code"),
        supabase.from("release_price_market_view")
          .select("parent_sku,format_code,anchor_status,offer_date,release_price_p,source_wine,source_product_url,name,case_size,bottle_volume_ml,lowest_ask_p,highest_bid_p,ask_vs_release_pct,bid_vs_release_pct")
          .eq("parent_sku", resolution.parent_sku).order("format_code"),
      ])
      : [{ data: [], error: null }, { data: [], error: null }];
  if (catalogueError || releaseError) throw new Error("Linked BBX and release-price data could not be loaded.");
  const catalogue = (catalogueData ?? []) as CatalogueRow[];
  const releasePrices = (releaseData ?? []) as ReleasePriceRow[];
  const linkable = !resolution || resolution.status === "suppressed";

  return <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
    <div className="mx-auto max-w-6xl space-y-5 p-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">CellarTracker record</p>
          <h1 className="mt-1 text-2xl font-semibold">{source.source_wine}</h1>
          <p className="mt-1 text-sm text-ink-muted">{source.vintage ?? "Vintage unavailable"} · source row {source.source_row_number}</p>
        </div>
        <Link href="/cellartracker" className="rounded border border-accent px-3 py-2 text-sm text-accent">All CellarTracker records</Link>
      </header>

      {query.changed && <p role="status" className="rounded border border-green-700/30 bg-green-50 p-3 text-sm text-green-900">The CellarTracker record was updated.</p>}
      {query.action_error && <p role="alert" className="rounded border border-red-700/30 bg-background p-3 text-sm text-red-800">The CellarTracker record could not be updated.</p>}
      {query.delete_error && <p role="alert" className="rounded border border-red-700/30 bg-background p-3 text-sm text-red-800">The record was not deleted. It remains in the accepted CellarTracker snapshot.</p>}

      <section aria-labelledby="cellartracker-evidence" className="rounded-lg border border-border bg-background p-5">
        <h2 id="cellartracker-evidence" className="text-lg font-semibold">Imported CellarTracker record</h2>
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-xs uppercase text-ink-muted">Wine and vintage</dt><dd>{source.source_wine} · {source.vintage ?? "Vintage unavailable"}</dd></div>
          <div><dt className="text-xs uppercase text-ink-muted">Imported from</dt><dd>{importData.original_filename} · accepted {formatDate(importData.accepted_at)}</dd></div>
          <div><dt className="text-xs uppercase text-ink-muted">Status</dt><dd>{source.fully_consumed ? "Consumed" : `${source.total_quantity} bottle${source.total_quantity === 1 ? "" : "s"} held`}</dd></div>
          <div><dt className="text-xs uppercase text-ink-muted">At home</dt><dd>{source.quantity_home} bottle{source.quantity_home === 1 ? "" : "s"}</dd></div>
          <div><dt className="text-xs uppercase text-ink-muted">At BBR</dt><dd>{source.quantity_bbr} bottle{source.quantity_bbr === 1 ? "" : "s"}</dd></div>
          <div><dt className="text-xs uppercase text-ink-muted">Bottle size</dt><dd>{source.bottle_volume_ml / 10}cl</dd></div>
          <div><dt className="text-xs uppercase text-ink-muted">Producer</dt><dd>{source.producer ?? "Unavailable"}</dd></div>
          <div><dt className="text-xs uppercase text-ink-muted">Origin</dt><dd>{[source.country, source.region, source.appellation].filter(Boolean).join(" · ") || "Unavailable"}</dd></div>
          <div><dt className="text-xs uppercase text-ink-muted">Colour and variety</dt><dd>{[source.colour, source.varietal].filter(Boolean).join(" · ") || "Unavailable"}</dd></div>
          <div><dt className="text-xs uppercase text-ink-muted">Drinking window</dt><dd>{source.begin_consume ?? "–"} to {source.end_consume ?? "–"}</dd></div>
        </dl>
        <form action={updateCellarTrackerRecordPrice.bind(null, importId, rowNumber)} className="mt-5 flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <label className="grid gap-1 text-xs text-ink-muted">Purchase price per bottle
            <span className="flex items-center rounded border border-border bg-background focus-within:border-accent">
              <span className="pl-3 text-sm text-ink-muted">£</span>
              <input name="price" inputMode="decimal" pattern="\d+(?:\.\d{1,2})?" defaultValue={source.purchase_price_per_bottle_p === null ? "" : (source.purchase_price_per_bottle_p / 100).toFixed(2)} className="w-32 rounded px-2 py-1.5 text-sm text-ink outline-none" required />
            </span>
          </label>
          <button className="rounded border border-accent px-3 py-1.5 text-sm text-accent">Save price</button>
          <span className="pb-1.5 text-xs text-ink-muted">Current value {formatPence(source.purchase_price_per_bottle_p)}</span>
        </form>
      </section>

      <section aria-labelledby="product-link" className="rounded-lg border border-border bg-background p-5">
        <h2 id="product-link" className="text-lg font-semibold">Product link</h2>
        <p className="mt-3 text-sm">
          <span className="text-ink-muted">Current status: </span>
          {resolution?.status === "linked"
            ? `Linked to Parent ${resolution.parent_sku} by ${methodLabel(resolution.match_method)}`
            : resolution?.status === "suppressed"
              ? "Rejected and suppressed"
              : candidates.length > 0
                ? "Provisional candidates available, not linked"
                : "Unlinked"}
        </p>

        {linkable && candidates.length > 0 && <section aria-labelledby="provisional-candidates" className="mt-4 rounded border border-border bg-accent-soft/40 p-4">
          <h3 id="provisional-candidates" className="font-medium">Provisional candidates</h3>
          <p className="mt-1 text-sm text-ink-muted">These suggestions came from the latest CellarTracker match run. Confirming one links this record only.</p>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {candidates.map((candidate) => <article key={candidate.parent_sku} className="flex items-start justify-between gap-3 rounded border border-border bg-background p-3 text-sm">
              <div>
                <p className="font-medium">#{candidate.rank} {candidate.name}</p>
                <p className="mt-1 text-xs text-ink-muted">Parent {candidate.parent_sku} · {candidate.producer ?? "Producer unavailable"} · {candidate.region ?? "Region unavailable"}</p>
                <p className="text-xs text-ink-muted">{candidate.stock_origin ?? "Stock origin unavailable"} · {candidate.purchase_mode ?? "Purchase mode unavailable"} · {candidate.is_biddable ? "BBX-eligible" : "not currently BBX-eligible"}{candidate.typo_count !== null ? ` · ${candidate.typo_count} typo${candidate.typo_count === 1 ? "" : "s"}` : ""}{candidate.match_score !== null ? ` · ${Math.round(candidate.match_score * 100)}% name match` : ""}</p>
              </div>
              <form action={confirmCellarTrackerRecordCandidate.bind(null, importId, rowNumber, candidate.parent_sku)}>
                <button className="rounded border border-accent px-2 py-1 text-xs text-accent">Confirm record</button>
              </form>
            </article>)}
          </div>
        </section>}

        {linkable && <div className="mt-4 flex flex-wrap gap-3">
          <form action={setManualCellarTrackerRecordLink.bind(null, importId, rowNumber)} className="flex gap-2">
            <label className="sr-only" htmlFor="parent-sku">Parent ID</label>
            <input id="parent-sku" name="parent_sku" inputMode="numeric" pattern="[0-9]{5,30}" placeholder="Parent ID" className="w-40 rounded border border-border px-2 py-1.5 text-sm" required />
            <button className="rounded border border-accent px-3 py-1.5 text-sm text-accent">{resolution?.status === "suppressed" ? "Restore and link" : "Link manually"}</button>
          </form>
          {resolution?.status === "suppressed" && <form action={unlinkCellarTrackerRecord.bind(null, importId, rowNumber)}>
            <button className="rounded border border-border px-3 py-1.5 text-sm">Restore to unmatched</button>
          </form>}
        </div>}

        {resolution?.status === "linked" && <div className="mt-4 flex flex-wrap gap-3">
          <form action={setManualCellarTrackerRecordLink.bind(null, importId, rowNumber)} className="flex gap-2">
            <label className="sr-only" htmlFor="edit-parent-sku">Parent ID</label>
            <input id="edit-parent-sku" name="parent_sku" inputMode="numeric" pattern="[0-9]{5,30}" defaultValue={resolution.parent_sku ?? ""} className="w-40 rounded border border-border px-2 py-1.5 text-sm" required />
            <button className="rounded border border-border px-3 py-1.5 text-sm">Edit linked Parent ID</button>
          </form>
          <form action={unlinkCellarTrackerRecord.bind(null, importId, rowNumber)}>
            <button className="rounded border border-accent px-3 py-1.5 text-sm text-accent">Unlink record</button>
          </form>
        </div>}
      </section>

      {resolution?.parent_sku && <section aria-labelledby="catalogue-card" className="rounded-lg border border-border bg-background p-5">
        <h2 id="catalogue-card" className="text-lg font-semibold">Current BBX catalogue card</h2>
        {catalogue.length === 0
          ? <p className="mt-3 text-sm text-ink-muted">This Parent ID is saved, but it is not currently in the BBX-eligible catalogue.</p>
          : <div className="mt-4 space-y-4">{catalogue.map((product) => <article key={product.format_code} className="rounded border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="font-semibold">{product.name}</h3><p className="mt-1 text-sm text-ink-muted">Parent {product.parent_sku} · {product.vintage ?? "Vintage unavailable"} · {product.producer ?? "Producer unavailable"}</p></div>
              {product.product_url && <a className="text-sm text-accent underline-offset-2 hover:underline" href={product.product_url}>Open BBR product</a>}
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <div><dt className="text-xs uppercase text-ink-muted">Region</dt><dd>{[product.country, product.region, product.subregion].filter(Boolean).join(" · ") || "Unavailable"}</dd></div>
              <div><dt className="text-xs uppercase text-ink-muted">Format</dt><dd>{formatFormat(product.case_size, product.bottle_volume_ml)}</dd></div>
              <div><dt className="text-xs uppercase text-ink-muted">Listing status</dt><dd>{product.is_listed ? "Listed" : "Unlisted"}</dd></div>
              <div><dt className="text-xs uppercase text-ink-muted">Lowest ask</dt><dd>{formatPence(product.ask)}</dd></div>
              <div><dt className="text-xs uppercase text-ink-muted">Highest bid</dt><dd>{formatPence(product.highest_bid_p)}</dd></div>
              <div><dt className="text-xs uppercase text-ink-muted">Market price</dt><dd>{formatPence(product.market_price_p)}</dd></div>
            </dl>
          </article>)}</div>}
      </section>}

      {resolution?.parent_sku && <section aria-labelledby="release-prices" className="rounded-lg border border-border bg-background p-5">
        <h2 id="release-prices" className="text-lg font-semibold">Release price data</h2>
        {releasePrices.length === 0
          ? <p className="mt-3 text-sm text-ink-muted">No accepted release-price evidence is linked to this Parent ID.</p>
          : <div className="mt-4 space-y-3">{releasePrices.map((price) => <article key={price.format_code} className="rounded border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="font-semibold">{price.name ?? price.source_wine}</h3><p className="mt-1 text-sm text-ink-muted">{formatFormat(price.case_size, price.bottle_volume_ml)} · {price.anchor_status ?? "provisional"} anchor · {formatDate(price.offer_date)}</p></div>
              {price.format_code && <Link href={`/release-prices/${resolution.parent_sku}/${price.format_code}`} className="text-sm text-accent underline-offset-2 hover:underline">Open release-price history</Link>}
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <div><dt className="text-xs uppercase text-ink-muted">Release price</dt><dd>{formatPence(price.release_price_p)}</dd></div>
              <div><dt className="text-xs uppercase text-ink-muted">Current ask</dt><dd>{formatPence(price.lowest_ask_p)} <span className="text-xs text-ink-muted">({formatSignedPct(price.ask_vs_release_pct)})</span></dd></div>
              <div><dt className="text-xs uppercase text-ink-muted">Current bid</dt><dd>{formatPence(price.highest_bid_p)} <span className="text-xs text-ink-muted">({formatSignedPct(price.bid_vs_release_pct)})</span></dd></div>
            </dl>
          </article>)}</div>}
      </section>}

      <section aria-labelledby="delete-record" className="rounded-lg border border-red-700/30 bg-background p-5">
        <h2 id="delete-record" className="text-lg font-semibold">Delete record</h2>
        <p className="mt-1 text-sm text-ink-muted">This removes only this record from the accepted CellarTracker snapshot. Other records in the same wine-and-vintage match group are retained.</p>
        <div className="mt-4"><DeleteCellarTrackerRecordForm importId={importId} sourceRowNumber={rowNumber} /></div>
      </section>

      <details className="rounded-lg border border-border bg-background p-5">
        <summary className="cursor-pointer font-semibold">Imported JSON and validation data</summary>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <section><h2 className="text-sm font-medium">Raw row</h2><pre className="mt-2 overflow-auto rounded bg-accent-soft p-3 text-xs">{json(rawData?.raw_row)}</pre></section>
          <section><h2 className="text-sm font-medium">Validation warnings</h2><pre className="mt-2 overflow-auto rounded bg-accent-soft p-3 text-xs">{json(rawData?.validation_warnings)}</pre></section>
          <section><h2 className="text-sm font-medium">Validation errors</h2><pre className="mt-2 overflow-auto rounded bg-accent-soft p-3 text-xs">{json(rawData?.validation_errors)}</pre></section>
        </div>
      </details>
    </div>
  </main>;
}
