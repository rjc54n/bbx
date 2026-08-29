import Link from "next/link";
import { notFound } from "next/navigation";
import { confirmReleasePriceAnchor } from "@/app/(protected)/cellar/imports/release-offers/actions";
import { clearOwnerReleaseAnchor, setOwnerReleaseAnchor } from "./actions";
import { formatDate, formatFormat, formatPence } from "@/lib/format";
import { requireOwner } from "@/lib/auth/owner";
import { wineHref } from "@/lib/nav/origin";

export const dynamic = "force-dynamic";

export default async function ReleasePriceHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ parentSku: string; formatCode: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { parentSku, formatCode } = await params;
  const query = await searchParams;
  const { supabase } = await requireOwner();
  const wineRef = `parent:${parentSku}`;

  const [
    { data: anchor, error: anchorError },
    { data: catalogue, error: catalogueError },
    { data: owner, error: ownerError },
    { data: evidence, error: evidenceError },
  ] = await Promise.all([
    supabase.from("release_price_market_view").select("*").eq("parent_sku", parentSku).eq("format_code", formatCode).maybeSingle(),
    // The anchor row is absent when no imported *and* no owner price exists, so
    // the catalogue row is what keeps this page renderable in that case.
    supabase.from("catalogue_view").select("name, vintage, region, colour, producer, product_url, case_size, bottle_volume_ml, is_listed, ask, highest_bid_p, market_price_p").eq("parent_sku", parentSku).eq("format_code", formatCode).maybeSingle(),
    supabase.from("owner_release_anchors").select("release_price_p, offer_date, source_note, superseded_source_price_p").eq("wine_ref", wineRef).eq("format_code", formatCode).maybeSingle(),
    supabase.from("release_offer_evidence_view").select("release_offer_price_id, offer_date, release_price_p, source_wine, source_product_url, match_method, source_message_id").eq("parent_sku", parentSku).eq("format_code", formatCode).order("offer_date"),
  ]);
  if (anchorError || catalogueError || ownerError || evidenceError) throw new Error("Release-price history could not be loaded.");
  if (!anchor && !catalogue) notFound();

  const returnPath = `/release-prices/${parentSku}/${formatCode}`;
  const name = anchor?.name ?? catalogue?.name ?? anchor?.source_wine ?? parentSku;
  const caseSize = anchor?.case_size ?? catalogue?.case_size ?? null;
  const bottleVolumeMl = anchor?.bottle_volume_ml ?? catalogue?.bottle_volume_ml ?? null;
  const lowestAsk = anchor?.lowest_ask_p ?? catalogue?.ask ?? null;
  const highestBid = anchor?.highest_bid_p ?? catalogue?.highest_bid_p ?? null;
  const isOwnerAnchor = anchor?.anchor_status === "owner";
  const ownerPricePounds = owner?.release_price_p != null ? (owner.release_price_p / 100).toFixed(2) : "";

  return <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
    <div className="mx-auto max-w-6xl space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/release-prices" className="text-sm text-accent underline-offset-2 hover:underline">Back to release prices</Link>
        <Link href={wineHref(parentSku, `/release-prices/${parentSku}/${formatCode}`)} className="text-sm text-accent underline-offset-2 hover:underline">View wine card ↗</Link>
      </div>
      {query.confirmed && <p role="status" className="rounded border border-green-700/30 bg-green-50 px-4 py-3 text-sm text-green-900">The selected evidence is now the confirmed release anchor.</p>}
      {query.confirm_error && <p role="alert" className="rounded border border-accent/30 bg-background px-4 py-3 text-sm text-accent">The release anchor could not be confirmed.</p>}
      {query.owner_set && <p role="status" className="rounded border border-green-700/30 bg-green-50 px-4 py-3 text-sm text-green-900">Your release price is set. It now anchors this format everywhere.</p>}
      {query.owner_cleared && <p role="status" className="rounded border border-green-700/30 bg-green-50 px-4 py-3 text-sm text-green-900">Your release price was removed. This format reverts to the imported anchor, if any.</p>}
      {query.owner_error && <p role="alert" className="rounded border border-accent/30 bg-background px-4 py-3 text-sm text-accent">The release price could not be saved. A positive price is required.</p>}

      <header className="rounded-lg border border-border bg-background p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">{anchor?.anchor_status ?? "no"} anchor</p>
        <h1 className="mt-1 text-2xl font-semibold">{name}</h1>
        <p className="mt-1 text-sm text-ink-muted">Parent {parentSku} · {formatFormat(caseSize, bottleVolumeMl)}</p>
        <div className="mt-4 flex flex-wrap gap-5 text-sm">
          <span>Anchor <strong>{anchor?.release_price_p != null ? formatPence(anchor.release_price_p) : "–"}</strong>{isOwnerAnchor && <span className="ml-1 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-ink">owner-set</span>}</span>
          <span>Current ask <strong>{formatPence(lowestAsk)}</strong></span>
          <span>Current bid <strong>{formatPence(highestBid)}</strong></span>
          {anchor?.recoup_bid_p != null && <span>Recoup bid <strong>{formatPence(anchor.recoup_bid_p)}</strong></span>}
        </div>
        <p className="mt-3 text-xs text-ink-muted">Prices are per case. The recoup bid uses the recorded 10% seller commission and excludes storage charges.</p>
      </header>

      <section className="rounded-lg border border-border bg-background p-5">
        <h2 className="text-lg font-semibold">{owner ? "Your release price" : "Set a release price"}</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          {owner
            ? "Your price anchors this format ahead of any imported offer. It carries into the catalogue, favourites and the wine card."
            : "Add the release price yourself when the import missed it (or got it wrong). Your price takes precedence over imported offers everywhere the anchor is used."}
          {owner?.superseded_source_price_p != null && <> It overrode an imported anchor of <strong>{formatPence(owner.superseded_source_price_p)}</strong>.</>}
        </p>
        <form action={setOwnerReleaseAnchor.bind(null, parentSku, formatCode, returnPath)} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs text-ink-muted">Release price per case (£)
            <input name="price" inputMode="decimal" pattern="\d+(?:\.\d{1,2})?" defaultValue={ownerPricePounds} placeholder="0.00" required className="w-36 rounded border border-border px-3 py-2 text-sm text-ink" />
          </label>
          <label className="grid gap-1 text-xs text-ink-muted">Offer date (optional)
            <input name="offer_date" type="date" defaultValue={owner?.offer_date ?? ""} className="rounded border border-border px-2 py-2 text-sm text-ink" />
          </label>
          <label className="grid min-w-[12rem] flex-1 gap-1 text-xs text-ink-muted">Note (optional)
            <input name="source_note" defaultValue={owner?.source_note ?? ""} placeholder="e.g. 2021 BBR release email" className="rounded border border-border px-3 py-2 text-sm text-ink" />
          </label>
          <button type="submit" className="rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink">{owner ? "Update price" : "Set price"}</button>
        </form>
        {owner && <form action={clearOwnerReleaseAnchor.bind(null, parentSku, formatCode, returnPath)} className="mt-3">
          <button type="submit" className="text-sm text-accent underline-offset-2 hover:underline">Remove my price and revert to imported</button>
        </form>}
        <p className="mt-3 text-xs text-ink-muted">Owner prices are recorded in bond, to match the market prices they are compared against. Duty-paid entry is not available yet.</p>
      </section>

      <section className="rounded-lg border border-border bg-background">
        <div className="border-b border-border px-5 py-3"><h2 className="font-semibold">Accepted exact evidence</h2></div>
        <div className="divide-y divide-border">
          {(evidence ?? []).length === 0
            ? <p className="px-5 py-4 text-sm text-ink-muted">No accepted imported offer resolves to this format.</p>
            : evidence?.map((item) => item.release_offer_price_id === null ? null : <article key={item.release_offer_price_id} className="grid gap-4 px-5 py-4 md:grid-cols-[1fr_auto]">
            <div>
              <p className="font-medium">{formatPence(item.release_price_p)} on {formatDate(item.offer_date)}</p>
              <p className="mt-1 text-sm text-ink-muted">{item.source_wine} · matched by {(item.match_method ?? "unknown").replaceAll("_", " ")}</p>
              {item.source_message_id && <p className="mt-1 text-xs text-ink-muted">Gmail message {item.source_message_id}</p>}
            </div>
            <form action={confirmReleasePriceAnchor.bind(null, item.release_offer_price_id, returnPath)} className="flex items-end gap-2">
              <label className="grid gap-1 text-xs text-ink-muted">Confirmation note
                <input name="note" className="rounded border border-border px-3 py-2 text-sm text-ink" placeholder="Optional" />
              </label>
              <button type="submit" className="rounded border border-accent px-3 py-2 text-sm font-medium text-accent">Confirm anchor</button>
            </form>
          </article>)}
        </div>
        {isOwnerAnchor && (evidence ?? []).length > 0 && <p className="border-t border-border px-5 py-3 text-xs text-ink-muted">Your owner price currently overrides these imported offers. Remove it above to let a confirmed offer anchor instead.</p>}
      </section>
    </div>
  </main>;
}
