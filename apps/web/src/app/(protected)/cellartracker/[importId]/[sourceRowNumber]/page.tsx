import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatPence } from "@/lib/format";
import { requireOwner } from "@/lib/auth/owner";
import { wineHref } from "@/lib/nav/origin";
import { isTargetFavourited } from "@/lib/favourites/server";
import { targetForRecord } from "@/lib/favourites/target";
import { FavouriteStar } from "@/components/favourites/FavouriteStar";
import { ExcludeCellarTrackerRecordForm } from "./ExcludeCellarTrackerRecordForm";
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
  const owner = await requireOwner();
  const { supabase } = owner;

  const [
    { data: sourceData, error: sourceError },
    { data: importData, error: importError },
    { data: resolutionData, error: resolutionError },
    { data: rawData, error: rawError },
  ] = await Promise.all([
    supabase.from("cellartracker_evidence")
      .select("import_id,source_row_number,source_wine,source_match_key,match_group_key,vintage,bottle_volume_ml,purchase_price_per_bottle_p,quantity_home,quantity_bbr,total_quantity,fully_consumed,colour,producer,country,region,appellation,varietal")
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
  const linkable = !resolution || resolution.status === "suppressed";
  const favouriteTarget = targetForRecord(
    "cellartracker",
    resolution?.status ?? null,
    resolution?.parent_sku ?? null,
    source.match_group_key,
  );
  const favourited = favouriteTarget
    ? await isTargetFavourited(owner, favouriteTarget)
    : false;

  return <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
    <div className="mx-auto max-w-6xl space-y-5 p-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">CellarTracker record</p>
          <h1 className="mt-1 text-2xl font-semibold">{source.source_wine}</h1>
          <p className="mt-1 text-sm text-ink-muted">{source.vintage ?? "Vintage unavailable"} · source row {source.source_row_number}</p>
        </div>
        <div className="flex items-center gap-3">
          {favouriteTarget && <FavouriteStar target={favouriteTarget} favourite={favourited} label={source.source_wine} />}
          {resolution?.parent_sku && <Link href={wineHref(resolution.parent_sku, `/cellartracker/${importId}/${sourceRowNumber}`)} className="rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink">View wine card ↗</Link>}
          <Link href="/cellartracker" className="rounded border border-accent px-3 py-2 text-sm text-accent">All CellarTracker records</Link>
        </div>
      </header>

      {query.changed && <p role="status" className="rounded border border-green-700/30 bg-green-50 p-3 text-sm text-green-900">The CellarTracker record was updated.</p>}
      {query.action_error && <p role="alert" className="rounded border border-red-700/30 bg-background p-3 text-sm text-red-800">The CellarTracker record could not be updated.</p>}
      {query.exclude_error && <p role="alert" className="rounded border border-red-700/30 bg-background p-3 text-sm text-red-800">The record was not excluded. It remains in the accepted CellarTracker snapshot.</p>}

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
              ? "No suitable match"
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

      <section aria-labelledby="exclude-record" className="rounded-lg border border-border bg-background p-5">
        <h2 id="exclude-record" className="text-lg font-semibold">Exclude record</h2>
        <p className="mt-1 text-sm text-ink-muted">Use this when the source row itself is wrong. It removes this record from the CellarTracker snapshot everywhere, and from every snapshot you accept from now on. Other records in the same wine-and-vintage match group are retained. Restore it from <Link href="/cellartracker/excluded" className="text-accent underline-offset-2 hover:underline">excluded records</Link>.</p>
        <div className="mt-4"><ExcludeCellarTrackerRecordForm importId={importId} sourceRowNumber={rowNumber} /></div>
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
