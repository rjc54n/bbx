import Link from "next/link";
import { notFound } from "next/navigation";
import { confirmReleasePriceAnchor } from "@/app/(protected)/cellar/imports/release-offers/actions";
import { formatDate, formatFormat, formatPence } from "@/lib/format";
import { requireOwner } from "@/lib/auth/owner";

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
  const [{ data: anchor, error: anchorError }, { data: evidence, error: evidenceError }] = await Promise.all([
    supabase.from("release_price_market_view").select("*").eq("parent_sku", parentSku).eq("format_code", formatCode).maybeSingle(),
    supabase.from("release_offer_evidence_view").select("release_offer_price_id, offer_date, release_price_p, source_wine, source_product_url, match_method, source_message_id").eq("parent_sku", parentSku).eq("format_code", formatCode).order("offer_date"),
  ]);
  if (anchorError || evidenceError) throw new Error("Release-price history could not be loaded.");
  if (!anchor) notFound();
  const returnPath = `/release-prices/${parentSku}/${formatCode}`;

  return <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
    <div className="mx-auto max-w-5xl space-y-5 p-5">
      <Link href="/release-prices" className="text-sm text-accent underline-offset-2 hover:underline">Back to release prices</Link>
      {query.confirmed && <p className="rounded border border-green-700/30 bg-green-50 px-4 py-3 text-sm text-green-900">The selected evidence is now the confirmed release anchor.</p>}
      {query.confirm_error && <p role="alert" className="rounded border border-accent/30 bg-background px-4 py-3 text-sm text-accent">The release anchor could not be confirmed.</p>}
      <header className="rounded-lg border border-border bg-background p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">{anchor.anchor_status} anchor</p>
        <h1 className="mt-1 text-2xl font-semibold">{anchor.name ?? anchor.source_wine}</h1>
        <p className="mt-1 text-sm text-ink-muted">Parent {parentSku} · {formatFormat(anchor.case_size, anchor.bottle_volume_ml)}</p>
        <div className="mt-4 flex flex-wrap gap-5 text-sm">
          <span>Anchor <strong>{formatPence(anchor.release_price_p)}</strong></span>
          <span>Current ask <strong>{formatPence(anchor.lowest_ask_p)}</strong></span>
          <span>Current bid <strong>{formatPence(anchor.highest_bid_p)}</strong></span>
          <span>Recoup bid <strong>{formatPence(anchor.recoup_bid_p)}</strong></span>
        </div>
        <p className="mt-3 text-xs text-ink-muted">The recoup bid uses the recorded 10% seller commission and excludes storage charges.</p>
      </header>
      <section className="rounded-lg border border-border bg-background">
        <div className="border-b border-border px-5 py-3"><h2 className="font-semibold">Accepted exact evidence</h2></div>
        <div className="divide-y divide-border">
          {evidence?.map((item) => item.release_offer_price_id === null ? null : <article key={item.release_offer_price_id} className="grid gap-4 px-5 py-4 md:grid-cols-[1fr_auto]">
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
      </section>
    </div>
  </main>;
}
